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

    with pytest.raises(ValueError, match="identical acquisition timestamps"):
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
    passed, failures, claims, contradictions = DeterministicVerifier.verify(pkg, candidate_claims=[])
    assert passed is False
    assert any("CHECK_L_OUT_OF_BOUNDS_DELTA_NDVI" in fail for fail in failures)


def test_verifier_check_l_rejects_out_of_bounds_delta_dprvi():
    """Verify Check L deterministic package rejection when Delta-DpRVI is outside [-1.0, 1.0]."""
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
    passed, failures, claims, contradictions = DeterministicVerifier.verify(pkg, candidate_claims=[])
    assert passed is False
    assert any("CHECK_L_OUT_OF_BOUNDS_DELTA_DPRVI" in fail for fail in failures)


def test_verifier_check_l_contradicts_fabricated_delta_claim():
    """Verify Check L claim-level contradiction when user claims an impossible delta."""
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
    passed, failures, claims, contradictions = DeterministicVerifier.verify(pkg, candidate_claims=[claim])
    eval_claim = claims[0]
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
    # Priority 3: API Trace contract survives serialization
    assert data["trace"]["execution_steps"] is not None
    assert len(data["trace"]["execution_steps"]) >= 1
    assert data["trace"]["cumulative_transfer_bytes"] is not None
    assert data["trace"]["transfer_budget_bytes"] is not None
    assert data["trace"]["cumulative_transfer_bytes"] <= data["trace"]["transfer_budget_bytes"]


# ============================================================================
# 7. Priority 1 & 2 & 5 Remediation Tests
# ============================================================================

def test_failed_retrieval_blocks_downstream_temporal_analysis_and_prevents_fabrication(monkeypatch):
    """Verify that failed retrieval halts temporal analysis and prevents dummy array fabrication."""
    orchestrator = MultiStepOrchestrator()

    # Monkeypatch stac_composite_retrieve tool to simulate acquisition failure
    from app.agent.tools import tool_registry
    original_tool = tool_registry.get("stac_composite_retrieve")

    class FailingRetrieveTool:
        def __init__(self):
            self.name = "stac_composite_retrieve"
            self.description = "Failing mock"
            self.category = "acquisition"
        def run(self, **kwargs):
            return {
                "status": "error",
                "scene_id": kwargs.get("scene_id", "test"),
                "error": "STAC connection timed out; unable to read COG assets",
                "array": None,
                "data_base64": None,
                "size_bytes": 0
            }

    monkeypatch.setattr(tool_registry, "_tools", {**tool_registry._tools, "stac_composite_retrieve": FailingRetrieveTool()})

    res = orchestrator.orchestrate("Analyze Sentinel-2 NDVI change in Mumbai between 2023-01-01 and 2024-01-01")

    # Verify overall workflow reports failure, NOT false success
    assert res["status"] == "failed"
    assert res["confidence"] is None
    assert res["confidence_label"] == "Acquisition Failed"
    assert "failed" in res["answer"].lower() or "blocked" in res["answer"].lower()

    # Verify the dependent step is marked blocked
    steps = res["trace"]["execution_steps"]
    temporal_step = next((s for s in steps if s["tool"] == "temporal_optical_change"), None)
    assert temporal_step is not None
    assert temporal_step["status"] == "blocked"
    assert "blocked" in temporal_step["error"].lower()

    # Ensure no fabricated change stats exist
    assert "temporal_optical_change" in res["metadata"]
    assert res["metadata"]["temporal_optical_change"]["status"] == "blocked"


def test_cumulative_transfer_budget_exhaustion_halts_cleanly():
    """Verify that exhausting transfer budget halts execution cleanly without false success."""
    orchestrator = MultiStepOrchestrator()
    # Execute with an impossible 0 byte budget
    res = orchestrator.orchestrate(
        query="Analyze Sentinel-2 NDVI change in Mumbai between 2023-01-01 and 2024-01-01",
        max_bytes=0
    )

    assert res["status"] == "budget_exhausted"
    assert res["confidence"] is None
    assert res["confidence_label"] == "Budget Exhausted"
    assert "exhausted" in res["answer"].lower()
    assert res["trace"]["cumulative_transfer_bytes"] <= res["trace"]["transfer_budget_bytes"]


def test_optical_sar_joint_fusion_orchestration_flow():
    """Verify end-to-end plan formulation and execution for optical + SAR cross-sensor query."""
    orchestrator = MultiStepOrchestrator()
    res = orchestrator.orchestrate(
        query="Perform joint optical and radar fusion for Mumbai [72.75, 18.88, 73.05, 19.30]"
    )

    assert res["task"] == "optical_sar"
    assert res["status"] == "success"
    assert res["confidence"] is not None
    assert "optical_sar_fusion" in res["trace"]["models_selected"]

    # Verify execution DAG contains optical, SAR, and fusion steps
    steps = res["trace"]["execution_steps"]
    assert any(s["tool"] == "optical_sar_fusion" and s["status"] == "completed" for s in steps)

    # Verify evidence items contain fused composite
    assert any(e["type"] == "fused" for e in res["evidence"])


def test_orchestrator_bounded_retry_loop(monkeypatch):
    """Verify bounded retry loop executes up to MAX_TOOL_RETRIES and records retries in trace."""
    orchestrator = MultiStepOrchestrator()
    from app.agent.tools import tool_registry

    call_count = {"count": 0}

    class FlakyRetrieveTool:
        def __init__(self):
            self.name = "stac_composite_retrieve"
            self.description = "Flaky mock"
            self.category = "acquisition"
        def run(self, **kwargs):
            call_count["count"] += 1
            if call_count["count"] == 1:
                # Transient error on first call
                return {"status": "error", "error": "Transient 503 Service Unavailable", "size_bytes": 0}
            # Success on second call
            dummy = np.full((10, 10, 3), 1000, dtype=np.float32)
            return {
                "status": "success",
                "scene_id": kwargs.get("scene_id", "s2"),
                "array": dummy,
                "raster_metadata": {"width": 10, "height": 10},
                "size_bytes": 1024,
                "ndvi_result": {"ndvi_mean": 0.50, "status": "success"}
            }

    monkeypatch.setattr(tool_registry, "_tools", {**tool_registry._tools, "stac_composite_retrieve": FlakyRetrieveTool()})

    res = orchestrator.orchestrate("Compute Sentinel-2 NDVI in Bengaluru [77.45, 12.85, 77.75, 13.15]")

    # Verify retried tool succeeded
    assert call_count["count"] >= 2
    retry_steps = [s for s in res["trace"]["steps"] if "RETRY" in s.get("step", "")]
    assert len(retry_steps) >= 1


def test_temporal_sar_baseline_computed_on_joint_valid_mask():
    """Verify that temporal SAR baseline DpRVI means are calculated on the joint valid-pixel mask."""
    # Create two scenes with different nodata regions
    vv1 = np.full((10, 10), 0.05, dtype=np.float32)
    vh1 = np.full((10, 10), 0.0125, dtype=np.float32)  # q = 0.25 -> DpRVI = 0.5200
    vv1[:3, :] = -9999.0  # Top 3 rows nodata in T1

    vv2 = np.full((10, 10), 0.05, dtype=np.float32)
    vh2 = np.full((10, 10), 0.010, dtype=np.float32)   # q = 0.20 -> DpRVI = 0.4444
    vv2[:, :3] = -9999.0  # Left 3 cols nodata in T2

    res = compute_temporal_sar_change(
        t1_vv=vv1, t1_vh=vh1,
        t2_vv=vv2, t2_vh=vh2,
        t1_datetime="2023-01-01T00:00:00Z",
        t2_datetime="2024-01-01T00:00:00Z"
    )

    assert res["status"] == "success"
    # Joint mask is where both T1 and T2 are valid (7 * 7 = 49 pixels)
    assert res["joint_valid_pixel_count"] == 49
    # T1 and T2 baseline means should be computed across the joint valid mask
    assert res["dprvi_t1_mean"] is not None
    assert res["dprvi_t2_mean"] is not None
    # Mean delta should equal t2_mean - t1_mean
    expected_delta = round(res["dprvi_t2_mean"] - res["dprvi_t1_mean"], 4)
    assert abs(res["delta_dprvi_mean"] - expected_delta) < 1e-3


# ============================================================================
# Stage 15.1: Targeted Retrieval-Failure & Unsupported-Outcome Regression Tests
# ============================================================================

def test_sentinel2_ndvi_retrieval_failure_after_retries(monkeypatch):
    """Verify failed Sentinel-2 retrieval yields overall status 'failed', null confidence, and 'Acquisition Failed' label."""
    orchestrator = MultiStepOrchestrator()

    class S2FailingRetrieveTool:
        def __init__(self):
            self.name = "stac_composite_retrieve"
            self.description = "Failing S2 retrieve mock"
            self.category = "acquisition"
        def run(self, **kwargs):
            return {
                "status": "error",
                "scene_id": kwargs.get("scene_id", "test_s2"),
                "error": "STAC connection timed out; unable to read COG assets",
                "array": None,
                "data_base64": None,
                "size_bytes": 0
            }

    monkeypatch.setattr(tool_registry, "_tools", {**tool_registry._tools, "stac_composite_retrieve": S2FailingRetrieveTool()})

    res = orchestrator.orchestrate("Compute Sentinel-2 NDVI in Bengaluru [77.45, 12.85, 77.75, 13.15]")

    assert res["status"] == "failed"
    assert res["confidence"] is None
    assert res["confidence_label"] == "Acquisition Failed"
    assert "failed" in res["answer"].lower()
    assert "stac connection timed out" in res["answer"].lower()
    assert res["verification"]["passed"] is False
    assert not res["metadata"].get("ndvi_result")


def test_sentinel1_dprvi_retrieval_failure_after_retries(monkeypatch):
    """Verify failed Sentinel-1 retrieval yields overall status 'failed', null confidence, and 'Acquisition Failed' label."""
    orchestrator = MultiStepOrchestrator()

    class S1FailingRetrieveTool:
        def __init__(self):
            self.name = "stac_composite_retrieve"
            self.description = "Failing S1 retrieve mock"
            self.category = "acquisition"
        def run(self, **kwargs):
            return {
                "status": "error",
                "scene_id": kwargs.get("scene_id", "test_s1"),
                "error": "STAC radar asset retrieval failed; S1 RTC unavailable",
                "array": None,
                "data_base64": None,
                "size_bytes": 0
            }

    monkeypatch.setattr(tool_registry, "_tools", {**tool_registry._tools, "stac_composite_retrieve": S1FailingRetrieveTool()})

    res = orchestrator.orchestrate("Compute Sentinel-1 RTC dual-pol DpRVI for Delhi [76.85, 28.40, 77.35, 28.88]")

    assert res["status"] == "failed"
    assert res["confidence"] is None
    assert res["confidence_label"] == "Acquisition Failed"
    assert "failed" in res["answer"].lower()
    assert "stac radar asset retrieval failed" in res["answer"].lower()
    assert res["verification"]["passed"] is False
    assert not res["metadata"].get("dprvi_result")


def test_sentinel2_ndvi_successful_analysis():
    """Verify successful Sentinel-2 NDVI analysis remains successful with deterministic verification."""
    orchestrator = MultiStepOrchestrator()
    res = orchestrator.orchestrate("Compute Sentinel-2 NDVI in Bengaluru [77.45, 12.85, 77.75, 13.15]")

    assert res["status"] == "success"
    assert res["confidence"] == 0.95
    assert res["confidence_label"] == "Deterministic Verified"
    assert res["verification"]["passed"] is True
    assert "calibrated sentinel-2 surface reflectance ndvi" in res["answer"].lower()
    assert res["metadata"]["ndvi_result"]["ndvi_mean"] is not None


def test_sentinel1_dprvi_successful_analysis():
    """Verify successful Sentinel-1 DpRVI analysis remains successful with deterministic verification."""
    orchestrator = MultiStepOrchestrator()
    res = orchestrator.orchestrate("Compute Sentinel-1 RTC dual-pol DpRVI for Delhi [76.85, 28.40, 77.35, 28.88]")

    assert res["status"] == "success"
    assert res["confidence"] == 0.95
    assert res["confidence_label"] == "Deterministic Verified"
    assert res["verification"]["passed"] is True
    assert "calibrated sentinel-1 rtc dual-polarization" in res["answer"].lower()
    assert res["metadata"]["dprvi_result"]["dprvi_mean"] is not None


def test_sentinel2_ndvi_zero_valid_pixels_unsupported(monkeypatch):
    """Verify zero-valid-pixel S2 outcome produces 'unsupported' status and 'Zero Valid Pixels' label."""
    orchestrator = MultiStepOrchestrator()

    class S2ZeroPixelRetrieveTool:
        def __init__(self):
            self.name = "stac_composite_retrieve"
            self.description = "Zero-pixel S2 retrieve mock"
            self.category = "acquisition"
        def run(self, **kwargs):
            return {
                "status": "success",
                "scene_id": "test_s2_zero",
                "size_bytes": 1024,
                "ndvi_result": {
                    "status": "unsupported_zero_valid_pixels",
                    "ndvi_mean": None,
                    "summary": "No valid clear-sky pixels found after applying SCL quality mask. NDVI calculation unsupported."
                }
            }

    monkeypatch.setattr(tool_registry, "_tools", {**tool_registry._tools, "stac_composite_retrieve": S2ZeroPixelRetrieveTool()})

    res = orchestrator.orchestrate("Compute Sentinel-2 NDVI in Bengaluru [77.45, 12.85, 77.75, 13.15]")

    assert res["status"] == "unsupported"
    assert res["confidence"] is None
    assert res["confidence_label"] == "Zero Valid Pixels"
    assert "no valid clear-sky pixels" in res["answer"].lower()
    assert res["verification"]["passed"] is False


def test_sentinel1_dprvi_zero_valid_pixels_unsupported(monkeypatch):
    """Verify zero-valid-pixel S1 outcome produces 'unsupported' status and 'Zero Valid Pixels' label."""
    orchestrator = MultiStepOrchestrator()

    class S1ZeroPixelRetrieveTool:
        def __init__(self):
            self.name = "stac_composite_retrieve"
            self.description = "Zero-pixel S1 retrieve mock"
            self.category = "acquisition"
        def run(self, **kwargs):
            return {
                "status": "success",
                "scene_id": "test_s1_zero",
                "size_bytes": 1024,
                "dprvi_result": {
                    "status": "unsupported_zero_valid_pixels",
                    "dprvi_mean": None,
                    "summary": "No valid radar pixels found. DpRVI calculation unsupported."
                }
            }

    monkeypatch.setattr(tool_registry, "_tools", {**tool_registry._tools, "stac_composite_retrieve": S1ZeroPixelRetrieveTool()})

    res = orchestrator.orchestrate("Compute Sentinel-1 RTC dual-pol DpRVI for Delhi [76.85, 28.40, 77.35, 28.88]")

    assert res["status"] == "unsupported"
    assert res["confidence"] is None
    assert res["confidence_label"] == "Zero Valid Pixels"
    assert "no valid radar pixels" in res["answer"].lower()
    assert res["verification"]["passed"] is False


def test_sentinel2_ndvi_explicitly_unsupported_outcome(monkeypatch):
    """Verify explicitly unsupported scientific outcome is classified as 'unsupported' with 'Unsupported Analysis' label."""
    orchestrator = MultiStepOrchestrator()

    class S2UnsupportedRetrieveTool:
        def __init__(self):
            self.name = "stac_composite_retrieve"
            self.description = "Unsupported S2 retrieve mock"
            self.category = "acquisition"
        def run(self, **kwargs):
            return {
                "status": "success",
                "scene_id": "test_s2_unsupported",
                "size_bytes": 1024,
                "ndvi_result": {
                    "status": "unsupported",
                    "ndvi_mean": None,
                    "summary": "Sentinel-2 band ratio unsupported for requested wavelength."
                }
            }

    monkeypatch.setattr(tool_registry, "_tools", {**tool_registry._tools, "stac_composite_retrieve": S2UnsupportedRetrieveTool()})

    res = orchestrator.orchestrate("Compute Sentinel-2 NDVI in Bengaluru [77.45, 12.85, 77.75, 13.15]")

    assert res["status"] == "unsupported"
    assert res["confidence"] is None
    assert res["confidence_label"] == "Unsupported Analysis"
    assert "unsupported" in res["answer"].lower()
    assert res["verification"]["passed"] is False


