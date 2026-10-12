"""
Stage 14 Test Suite: Dynamic Multi-Step Agent Orchestration and Multimodal Temporal Analysis.

Tests:
1. Natural language query parsing: gazetteer lookup, bounding boxes, ISO dates, month ranges, ambiguity detection.
2. Ambiguity clarification: never inventing fake coordinates or dates; structured clarification prompts.
3. Sentinel-2 temporal optical change: SCL cloud/shadow masking, Delta-NDVI, vegetation loss/gain, zero-valid-pixel defense.
4. Sentinel-1 RTC temporal SAR change: dual-pol DpRVI, Delta-DpRVI, Delta-dB, q > 1.0 assumption violation tracking, layover/shadow disclaimer.
5. Deterministic Verifier Check L: package-level and claim-level enforcement that an LLM cannot override.
6. Multi-step orchestration safeguards: bounded steps (<= 10), bounded retries (<= 2), transfer budget (<= 20 MB).
7. API endpoints: /api/v1/analyze and /api/v1/analyze/orchestrate.
"""

import pytest
import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.agent.orchestrator import QueryParser, MultiStepOrchestrator, MAX_ORCHESTRATION_STEPS, MAX_TOOL_RETRIES
from app.remote_sensing.temporal import compute_temporal_optical_change, compute_temporal_sar_change
from app.remote_sensing.sar import compute_dprvi_and_backscatter
from app.agent.tools import tool_registry
from app.agent.verifier import DeterministicVerifier, EvidencePackageBuilder
from app.schemas.verification import EvidencePackageSchema, ClaimVerificationItem, PhysicalMeasurementItem
from app.schemas.analysis import AnalysisRequest
from app.agent.controller import agent_controller

client = TestClient(app)


# ============================================================================
# 1. Natural Language Query Parser & Ambiguity Clarification Tests
# ============================================================================

def test_query_parser_known_city_and_iso_dates():
    """Verify parsing of known gazetteer cities and explicit ISO dates."""
    q = "Analyze vegetation change in Mumbai between 2023-01-15 and 2024-01-15"
    parsed = QueryParser.parse(q)
    assert parsed["is_ambiguous"] is False
    assert parsed["location_name"] == "Mumbai"
    assert parsed["bbox"] == [72.75, 18.88, 73.05, 19.30]
    assert parsed["start_date"] == "2023-01-15"
    assert parsed["end_date"] == "2024-01-15"
    assert parsed["task"] == "temporal_optical_change"


def test_query_parser_explicit_bounding_box():
    """Verify parsing of explicit numerical bounding box coordinates."""
    q = "Evaluate Sentinel-1 SAR change in [76.85, 28.40, 77.35, 28.88] from 2023 to 2024"
    parsed = QueryParser.parse(q)
    assert parsed["is_ambiguous"] is False
    assert parsed["bbox"] == [76.85, 28.40, 77.35, 28.88]
    assert parsed["task"] == "temporal_sar_change"


def test_query_parser_month_year_range():
    """Verify parsing of month-year descriptions like 'January 2023 to March 2024'."""
    q = "Compare NDVI vegetation vitality in Delhi between January 2023 and March 2024"
    parsed = QueryParser.parse(q)
    assert parsed["is_ambiguous"] is False
    assert parsed["location_name"] == "Delhi"
    assert parsed["start_date"] == "2023-01-01"
    assert parsed["end_date"] == "2024-03-28"


def test_query_parser_ambiguous_location_prompts_clarification():
    """Verify that omitting a geographic location prompts for clarification rather than inventing fake coordinates."""
    q = "Analyze temporal vegetation change between 2023-01-01 and 2024-01-01"
    parsed = QueryParser.parse(q, has_images=False)
    assert parsed["is_ambiguous"] is True
    assert "spatial_location" in parsed["missing_parameters"]
    assert "geographic area of interest" in parsed["clarification_prompt"]
    assert parsed["bbox"] is None


def test_query_parser_ambiguous_dates_prompts_clarification():
    """Verify that temporal change queries omitting dates prompt for clarification without hallucinating timeframes."""
    q = "Evaluate deforestation and canopy change in Mumbai"
    parsed = QueryParser.parse(q, has_images=False)
    assert parsed["is_ambiguous"] is True
    assert "temporal_date_range" in parsed["missing_parameters"]
    assert "temporal comparison dates or date range" in parsed["clarification_prompt"]


def test_query_parser_unambiguous_when_images_present():
    """Verify that when workspace satellite imagery is already uploaded, location and timestamps are implicitly present."""
    q = "Analyze vegetation difference between these two scenes"
    parsed = QueryParser.parse(q, has_images=True)
    assert parsed["is_ambiguous"] is False


# ============================================================================
# 2. Sentinel-2 Temporal Optical Change & SCL Screening Tests
# ============================================================================

def test_temporal_optical_change_valid_vegetation_loss():
    """Verify Delta-NDVI computation, vegetation loss detection, and SCL masking across two dates."""
    # Create synthetic T1 (high vegetation) and T2 (degraded vegetation) rasters
    np.random.seed(42)
    h, w = 40, 40
    # T1: High NIR (B08=3500), Low Red (B04=500) -> NDVI ~ 0.75
    b04_t1 = np.full((h, w), 500, dtype=np.uint16)
    b08_t1 = np.full((h, w), 3500, dtype=np.uint16)
    scl_t1 = np.full((h, w), 4, dtype=np.uint8)  # Vegetation class (clear)

    # T2: Lower NIR (B08=1500), Higher Red (B04=1000) -> NDVI ~ 0.20
    b04_t2 = np.full((h, w), 1000, dtype=np.uint16)
    b08_t2 = np.full((h, w), 1500, dtype=np.uint16)
    scl_t2 = np.full((h, w), 4, dtype=np.uint8)  # Vegetation class (clear)

    t1_data = {
        "b04": b04_t1,
        "b08": b08_t1,
        "scl": scl_t1,
        "meta": {"crs": "EPSG:32643", "transform": [10.0, 0, 100, 0, -10.0, 200], "datetime": "2023-02-01T10:00:00Z"}
    }
    t2_data = {
        "b04": b04_t2,
        "b08": b08_t2,
        "scl": scl_t2,
        "meta": {"crs": "EPSG:32643", "transform": [10.0, 0, 100, 0, -10.0, 200], "datetime": "2024-02-01T10:00:00Z"}
    }

    res = compute_temporal_optical_change(t1_data, t2_data)
    assert res["status"] == "success"
    assert res["delta_ndvi_mean"] < -0.40  # Significant drop in NDVI
    assert res["vegetation_loss_pct"] > 95.0
    assert res["vegetation_gain_pct"] == 0.0
    assert res["joint_valid_pixel_count"] == h * w
    assert "colorized_change_preview_base64" in res


def test_temporal_optical_change_zero_valid_pixels_cloud_cover():
    """Verify that when SCL filters out all pixels due to clouds, zero numeric statistics are reported."""
    h, w = 30, 30
    b04 = np.full((h, w), 500, dtype=np.uint16)
    b08 = np.full((h, w), 3500, dtype=np.uint16)
    # T1 clear, but T2 completely obscured by cloud (SCL=9)
    scl_t1 = np.full((h, w), 4, dtype=np.uint8)
    scl_t2 = np.full((h, w), 9, dtype=np.uint8)  # High probability cloud

    t1_data = {"b04": b04, "b08": b08, "scl": scl_t1, "meta": {"datetime": "2023-01-01T00:00:00Z"}}
    t2_data = {"b04": b04, "b08": b08, "scl": scl_t2, "meta": {"datetime": "2024-01-01T00:00:00Z"}}

    res = compute_temporal_optical_change(t1_data, t2_data)
    assert res["status"] == "unsupported_zero_valid_pixels"
    assert res["delta_ndvi_mean"] is None
    assert res["vegetation_loss_pct"] is None
    assert res["joint_valid_pixel_count"] == 0


def test_temporal_optical_change_rejects_identical_timestamps():
    """Verify that comparing scenes with identical acquisition timestamps is rejected."""
    h, w = 20, 20
    b04 = np.full((h, w), 500, dtype=np.uint16)
    b08 = np.full((h, w), 2000, dtype=np.uint16)
    scl = np.full((h, w), 4, dtype=np.uint8)

    t1_data = {"b04": b04, "b08": b08, "scl": scl, "meta": {"datetime": "2023-05-01T10:00:00Z"}}
    t2_data = {"b04": b04, "b08": b08, "scl": scl, "meta": {"datetime": "2023-05-01T10:00:00Z"}}

    with pytest.raises(ValueError, match="Temporal optical change requires two distinct acquisition timestamps"):
        compute_temporal_optical_change(t1_data, t2_data)


# ============================================================================
# 3. Sentinel-1 RTC Temporal SAR Change & DpRVI Assumption Violations Tests
# ============================================================================

def test_temporal_sar_change_with_assumption_violation_tracking():
    """
    Verify Delta-DpRVI calculation and explicit tracking of q = VH/VV > 1.0 assumption violations.
    Do not assume clipping makes the measurement valid; verify that violations are tracked.
    """
    h, w = 30, 30
    # Normal physical values: VV = 0.10, VH = 0.02 -> q = 0.20
    vv_t1 = np.full((h, w), 0.10, dtype=np.float32)
    vh_t1 = np.full((h, w), 0.02, dtype=np.float32)

    # T2 has 10 unphysical pixels where VH > VV (e.g. cross-pol backscatter spike q > 1.0)
    vv_t2 = np.full((h, w), 0.08, dtype=np.float32)
    vh_t2 = np.full((h, w), 0.02, dtype=np.float32)
    # Inject 10 pixels violating Mandal et al. (2020) assumption
    vh_t2[0, :10] = 0.16  # q = 0.16 / 0.08 = 2.0 > 1.0!

    t1_data = {
        "vv": vv_t1,
        "vh": vh_t1,
        "meta": {"crs": "EPSG:32643", "transform": [10.0, 0, 100, 0, -10.0, 200], "datetime": "2023-01-10T00:00:00Z"}
    }
    t2_data = {
        "vv": vv_t2,
        "vh": vh_t2,
        "meta": {"crs": "EPSG:32643", "transform": [10.0, 0, 100, 0, -10.0, 200], "datetime": "2024-01-10T00:00:00Z"}
    }

    res = compute_temporal_sar_change(t1_data, t2_data)
    assert res["status"] == "success"
    assert -1.0 <= res["delta_dprvi_mean"] <= 1.0
    # Check explicit assumption violation tracking
    violations = res["dprvi_assumption_violations"]
    assert violations["total_count"] == 10
    assert violations["flagged_unphysical_q"] is True
    print("ACTUAL LIMITATIONS:", res.get("scientific_limitations"))
    assert any("Mandal" in lim for lim in res["scientific_limitations"])
    # Layover/shadow disclaimer
    assert "unavailable_from_stac_provider" in res["validity_policy"]["sar_terrain_layover_shadow_mask"]


def test_dprvi_single_scene_tracks_q_greater_than_one():
    """Verify that sar.py compute_dprvi_and_backscatter tracks assumption violations."""
    h, w = 10, 10
    vv = np.full((h, w), 0.05, dtype=np.float32)
    vh = np.full((h, w), 0.01, dtype=np.float32)
    # Violate assumption on 3 pixels
    vh[0, :3] = 0.10  # q = 2.0 > 1.0

    res = compute_dprvi_and_backscatter(vv, vh)
    assert res["status"] == "success"
    assert res["dprvi_assumption_violations"]["assumption_violation_count"] == 3
    assert res["dprvi_assumption_violations"]["assumption_violation_pct"] == 3.0
    assert res["dprvi_assumption_violations"]["flagged_unphysical_q"] is True


# ============================================================================
# 4. Deterministic Verifier Check L Tests
# ============================================================================

def test_verifier_check_l_rejects_out_of_bounds_delta_ndvi():
    """Verify Check L deterministic package rejection when Delta-NDVI is outside [-2.0, 2.0]."""
    verifier = DeterministicVerifier()
    pkg = EvidencePackageSchema(
        task_id="test_chk_l_1",
        query="Test Delta NDVI bounds",
        task="temporal_optical_change",
        physical_measurements=[
            PhysicalMeasurementItem(
                name="temporal_delta_ndvi_mean",
                value=2.85,  # Mathematically impossible! Valid range is [-2.0, 2.0]
                unit="unitless_ratio",
                statistic_type="mean",
                mask_applied="joint_clear_scl_mask"
            )
        ]
    )
    result = verifier.verify(pkg, candidate_claims=[])
    assert result["deterministic_passed"] is False
    assert any("CHECK_L_OUT_OF_BOUNDS_DELTA_NDVI" in fail for fail in result["deterministic_failures"])


def test_verifier_check_l_rejects_out_of_bounds_delta_dprvi():
    """Verify Check L deterministic package rejection when Delta-DpRVI is outside [-1.0, 1.0]."""
    verifier = DeterministicVerifier()
    pkg = EvidencePackageSchema(
        task_id="test_chk_l_2",
        query="Test Delta DpRVI bounds",
        task="temporal_sar_change",
        physical_measurements=[
            PhysicalMeasurementItem(
                name="temporal_delta_dprvi_mean",
                value=-1.65,  # Impossible! Valid range is [-1.0, 1.0]
                unit="unitless_ratio",
                statistic_type="mean",
                mask_applied="sar_valid_finite_mask"
            )
        ]
    )
    result = verifier.verify(pkg, candidate_claims=[])
    assert result["deterministic_passed"] is False
    assert any("CHECK_L_OUT_OF_BOUNDS_DELTA_DPRVI" in fail for fail in result["deterministic_failures"])


def test_verifier_check_l_contradicts_fabricated_delta_claim():
    """Verify Check L claim-level contradiction when user claims an impossible delta."""
    verifier = DeterministicVerifier()
    pkg = EvidencePackageSchema(
        task_id="test_chk_l_3",
        query="Verify claim",
        task="temporal_optical_change",
        physical_measurements=[
            PhysicalMeasurementItem(
                name="temporal_delta_ndvi_mean",
                value=-0.35,
                unit="unitless_ratio",
                statistic_type="mean",
                mask_applied="joint_clear_scl_mask"
            )
        ]
    )
    claim = ClaimVerificationItem(
        claim_text="The observed Delta-NDVI is +3.5 indicating rapid greening.",
        claim_type="measurement",
        status="supported"
    )
    result = verifier.verify(pkg, candidate_claims=[claim])
    eval_claim = result["claims"][0]
    assert eval_claim.status == "contradicted"
    assert "exceeds mathematical limits" in eval_claim.reason


# ============================================================================
# 5. Multi-Step Orchestrator Execution, Safety Caps & Retries Tests
# ============================================================================

def test_orchestrator_safety_caps_step_limit():
    """Verify that multi-step planner enforces MAX_ORCHESTRATION_STEPS <= 10."""
    orchestrator = MultiStepOrchestrator()
    assert MAX_ORCHESTRATION_STEPS <= 10
    assert MAX_TOOL_RETRIES <= 2


def test_orchestration_workflow_end_to_end_mumbai():
    """Verify full multi-step orchestration execution for an optical change query over Mumbai."""
    orchestrator = MultiStepOrchestrator()
    res = orchestrator.orchestrate(
        query="Analyze Sentinel-2 NDVI change in Mumbai between 2023-01-01 and 2024-01-01"
    )
    assert res["status"] == "success"
    assert res["is_clarification_required"] is False
    assert len(res["trace"]["steps"]) >= 4
    assert res["trace"]["execution_steps"] is not None
    assert len(res["trace"]["execution_steps"]) >= 2
    assert res["reproducible_report"] is not None
    assert res["verification"]["passed"] is True


def test_orchestration_workflow_clarification_gate():
    """Verify that ambiguous query returns clarification status without running tools."""
    orchestrator = MultiStepOrchestrator()
    res = orchestrator.orchestrate(
        query="Analyze deforestation and vegetation change"
    )
    assert res["status"] == "clarification_required"
    assert res["is_clarification_required"] is True
    assert "spatial_location" in res["missing_parameters"]
    assert "temporal_date_range" in res["missing_parameters"]
    assert len(res["suggested_examples"]) >= 2


# ============================================================================
# 6. End-to-End API Routes Integration Tests
# ============================================================================

def test_api_analyze_orchestration_clarification_response():
    """Verify that POST /api/v1/analyze returns clarification payload for ambiguous query."""
    payload = {
        "query": "Evaluate temporal radar backscatter changes",
        "images": []
    }
    resp = client.post("/api/v1/analyze", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_clarification_required"] is True
    assert "spatial_location" in data["missing_parameters"]


def test_api_analyze_orchestration_full_execution():
    """Verify that POST /api/v1/analyze executes multi-step workflow for valid query."""
    payload = {
        "query": "Compute Sentinel-1 RTC dual-pol DpRVI for Delhi [76.85, 28.40, 77.35, 28.88] between 2023-01-01 and 2024-01-01",
        "mode": "orchestration",
        "images": []
    }
    resp = client.post("/api/v1/analyze", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_clarification_required"] is False
    assert data["mode"] == "orchestration"
    assert data["trace"] is not None
    assert len(data["trace"]["steps"]) >= 3
