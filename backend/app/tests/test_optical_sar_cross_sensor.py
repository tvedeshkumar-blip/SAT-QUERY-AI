import os
import sys
import io
import json
import base64
import pytest
import numpy as np
from PIL import Image
from fastapi.testclient import TestClient

# Ensure backend root is on sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app
from app.acquisition.cross_sensor_validator import CrossSensorValidator
from app.models.optical_sar.optical_sar_fusion import (
    OpticalSARJointAnalysisProvider,
    OpticalSARVisualizationBaseline,
    OpticalSARProvider
)

client = TestClient(app)

import rasterio
from rasterio.transform import from_bounds

def create_geotiff_b64(
    bounds=(77.5, 12.9, 77.6, 13.0),
    crs="EPSG:4326",
    width=64,
    height=64,
    bands=3,
    tags=None
) -> str:
    """Generates an in-memory valid GeoTIFF with georeferencing and tags."""
    memfile = rasterio.MemoryFile()
    transform = from_bounds(*bounds, width, height)
    with memfile.open(
        driver="GTiff",
        height=height,
        width=width,
        count=bands,
        dtype="uint8",
        crs=crs,
        transform=transform
    ) as dst:
        data = np.random.randint(40, 200, (bands, height, width), dtype=np.uint8)
        dst.write(data)
        if tags:
            dst.update_tags(**tags)
    raw_bytes = memfile.getbuffer()
    return "data:image/tiff;base64," + base64.b64encode(raw_bytes).decode("utf-8")

def create_preview_jpeg_b64(w: int = 128, h: int = 128) -> str:
    """Generates an unprojected browse JPEG preview."""
    img = Image.new("RGB", (w, h), color=(100, 150, 200))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")


# ============================================================================
# 1. Missing Optical or SAR Inputs
# ============================================================================

def test_missing_optical_scene_rejected():
    sar_b64 = create_geotiff_b64()
    res = CrossSensorValidator.validate_pair(
        optical_input=None,
        sar_input=sar_b64,
        optical_filename="missing_optical.tif",
        sar_filename="sentinel1_grd.tif"
    )
    assert res["is_compatible"] is False
    assert res["status"] == "rejected"
    assert "Missing" in res["rejection_reason"]


def test_missing_sar_scene_rejected():
    opt_b64 = create_geotiff_b64()
    res = CrossSensorValidator.validate_pair(
        optical_input=opt_b64,
        sar_input=None,
        optical_filename="sentinel2_l2a.tif",
        sar_filename="missing_sar.tif"
    )
    assert res["is_compatible"] is False
    assert res["status"] == "rejected"
    assert "Missing" in res["rejection_reason"]


def test_missing_both_scenes_rejected():
    res = CrossSensorValidator.validate_pair(
        optical_input=None,
        sar_input=None
    )
    assert res["is_compatible"] is False
    assert res["status"] == "rejected"
    assert "Missing" in res["rejection_reason"]


# ============================================================================
# 2. Modality Mismatch & Homogeneous Sensor Rejection
# ============================================================================

def test_optical_plus_optical_rejected():
    opt1_b64 = create_geotiff_b64()
    opt2_b64 = create_geotiff_b64()
    res = CrossSensorValidator.validate_pair(
        optical_input=opt1_b64,
        sar_input=opt2_b64,
        optical_provenance={"modality": "OPTICAL", "sensor": "Sentinel-2"},
        sar_provenance={"modality": "OPTICAL", "sensor": "Landsat-8"}
    )
    assert res["is_compatible"] is False
    assert res["status"] == "rejected"
    assert "both scenes are optical" in res["rejection_reason"].lower()


def test_sar_plus_sar_rejected():
    sar1_b64 = create_geotiff_b64()
    sar2_b64 = create_geotiff_b64()
    res = CrossSensorValidator.validate_pair(
        optical_input=sar1_b64,
        sar_input=sar2_b64,
        optical_provenance={"modality": "SAR", "sensor": "Sentinel-1"},
        sar_provenance={"modality": "SAR", "sensor": "RISAT-1A"}
    )
    assert res["is_compatible"] is False
    assert res["status"] == "rejected"
    assert "SAR" in res["rejection_reason"]


# ============================================================================
# 3. Preview Thumbnail & Non-Scientific Asset Rejection
# ============================================================================

def test_optical_browse_jpeg_thumbnail_rejected():
    jpeg_b64 = create_preview_jpeg_b64()
    sar_b64 = create_geotiff_b64()
    res = CrossSensorValidator.validate_pair(
        optical_input=jpeg_b64,
        sar_input=sar_b64,
        optical_filename="preview.jpg",
        sar_filename="sentinel1.tif"
    )
    assert res["is_compatible"] is False
    assert res["status"] == "rejected"
    assert "preview asset detected" in res["rejection_reason"].lower()


def test_sar_browse_jpeg_thumbnail_rejected():
    opt_b64 = create_geotiff_b64()
    jpeg_b64 = create_preview_jpeg_b64()
    res = CrossSensorValidator.validate_pair(
        optical_input=opt_b64,
        sar_input=jpeg_b64,
        optical_filename="sentinel2.tif",
        sar_filename="preview.jpg"
    )
    assert res["is_compatible"] is False
    assert res["status"] == "rejected"
    assert "preview asset detected" in res["rejection_reason"].lower()


# ============================================================================
# 4. Georeferencing & CRS Mismatch Rejection
# ============================================================================

def test_crs_mismatch_rejected():
    opt_b64 = create_geotiff_b64(bounds=(77.5, 12.9, 77.6, 13.0), crs="EPSG:4326")
    sar_b64 = create_geotiff_b64(bounds=(700000, 1400000, 710000, 1410000), crs="EPSG:32643")
    res = CrossSensorValidator.validate_pair(
        optical_input=opt_b64,
        sar_input=sar_b64,
        optical_provenance={"modality": "OPTICAL"},
        sar_provenance={"modality": "SAR"}
    )
    assert res["is_compatible"] is False
    assert res["status"] == "rejected"
    assert "CRS mismatch" in res["rejection_reason"]


# ============================================================================
# 5. Spatial Footprint Overlap Validation
# ============================================================================

def test_zero_spatial_overlap_rejected():
    # Bengaluru bounding box vs Mumbai bounding box
    opt_b64 = create_geotiff_b64(bounds=(77.5, 12.9, 77.6, 13.0), crs="EPSG:4326")
    sar_b64 = create_geotiff_b64(bounds=(72.8, 18.9, 72.9, 19.0), crs="EPSG:4326")
    res = CrossSensorValidator.validate_pair(
        optical_input=opt_b64,
        sar_input=sar_b64,
        optical_provenance={"modality": "OPTICAL"},
        sar_provenance={"modality": "SAR"}
    )
    assert res["is_compatible"] is False
    assert res["status"] == "rejected"
    assert "Zero spatial overlap" in res["rejection_reason"]


def test_insufficient_overlap_below_10_pct_rejected():
    # Footprint overlap of approximately 5%
    opt_b64 = create_geotiff_b64(bounds=(10.0, 10.0, 11.0, 11.0), crs="EPSG:4326")
    sar_b64 = create_geotiff_b64(bounds=(10.95, 10.0, 11.95, 11.0), crs="EPSG:4326")
    res = CrossSensorValidator.validate_pair(
        optical_input=opt_b64,
        sar_input=sar_b64,
        optical_provenance={"modality": "OPTICAL"},
        sar_provenance={"modality": "SAR"}
    )
    assert res["is_compatible"] is False
    assert res["status"] == "rejected"
    assert "Insufficient spatial overlap" in res["rejection_reason"]


def test_sufficient_spatial_overlap_accepted():
    # Footprints with 80% overlap
    opt_b64 = create_geotiff_b64(bounds=(77.50, 12.90, 77.60, 13.00), crs="EPSG:4326")
    sar_b64 = create_geotiff_b64(bounds=(77.52, 12.90, 77.62, 13.00), crs="EPSG:4326")
    res = CrossSensorValidator.validate_pair(
        optical_input=opt_b64,
        sar_input=sar_b64,
        optical_provenance={"modality": "OPTICAL", "datetime": "2024-02-01T10:00:00Z"},
        sar_provenance={"modality": "SAR", "datetime": "2024-02-05T10:00:00Z"}
    )
    assert res["is_compatible"] is True
    assert res["spatial_overlap_pct"] > 50.0


# ============================================================================
# 6. Temporal Baseline Delta & Advisory Warnings
# ============================================================================

def test_temporal_separation_over_60_days_emits_warning():
    opt_b64 = create_geotiff_b64()
    sar_b64 = create_geotiff_b64()
    res = CrossSensorValidator.validate_pair(
        optical_input=opt_b64,
        sar_input=sar_b64,
        optical_provenance={"modality": "OPTICAL", "datetime": "2024-01-01T00:00:00Z"},
        sar_provenance={"modality": "SAR", "datetime": "2024-04-15T00:00:00Z"} # 105 days
    )
    assert res["is_compatible"] is True
    assert res["temporal_delta_days"] is not None
    assert res["temporal_delta_days"] > 60.0
    assert any("Temporal separation advisory" in w for w in res["warnings"])


# ============================================================================
# 7. SAR Radiometric Calibration & Terrain Correction Status
# ============================================================================

def test_uncalibrated_sar_reported_truthfully():
    opt_b64 = create_geotiff_b64()
    sar_b64 = create_geotiff_b64(tags={"SENSOR": "Sentinel-1", "POLARIZATION": "VV"})
    res = CrossSensorValidator.validate_pair(
        optical_input=opt_b64,
        sar_input=sar_b64,
        optical_provenance={"modality": "OPTICAL", "datetime": "2024-02-01T00:00:00Z"},
        sar_provenance={"modality": "SAR", "datetime": "2024-02-03T00:00:00Z"}
    )
    assert res["sar_calibration_status"] == "unverified_linear_dn"
    assert res["sar_terrain_correction_status"] == "ellipsoid_geocoded_grd"
    assert any("sigma-0/gamma-0 calibration look-up tables" in w for w in res["warnings"])
    assert any("ellipsoid-geocoded (GRD)" in w for w in res["warnings"])


def test_verified_calibrated_rtc_sar_recognized():
    opt_b64 = create_geotiff_b64()
    sar_b64 = create_geotiff_b64(tags={
        "SENSOR": "Sentinel-1",
        "POLARIZATION": "VH",
        "CALIBRATION": "sigma0",
        "PROCESSING": "radiometric_terrain_corrected_rtc"
    })
    res = CrossSensorValidator.validate_pair(
        optical_input=opt_b64,
        sar_input=sar_b64,
        optical_provenance={"modality": "OPTICAL", "datetime": "2024-02-01T00:00:00Z"},
        sar_provenance={"modality": "SAR", "datetime": "2024-02-03T00:00:00Z"}
    )
    assert res["sar_calibration_status"] == "calibrated_backscatter"
    assert res["sar_terrain_correction_status"] == "radiometrically_terrain_corrected"
    assert res["sar_polarization"] == "VH"


# ============================================================================
# 8. Physical Non-Interchangeability Assertion
# ============================================================================

def test_physical_non_interchangeability_assertion_present():
    opt_b64 = create_geotiff_b64()
    sar_b64 = create_geotiff_b64()
    res = CrossSensorValidator.validate_pair(
        optical_input=opt_b64,
        sar_input=sar_b64,
        optical_provenance={"modality": "OPTICAL"},
        sar_provenance={"modality": "SAR"}
    )
    assert any("Optical surface reflectance" in s and "SAR microwave backscatter" in s for s in res["scientific_limitations"])


# ============================================================================
# 9. API Endpoints
# ============================================================================

def test_api_validate_optical_sar_pair_endpoint():
    opt_b64 = create_geotiff_b64(bounds=(77.5, 12.9, 77.6, 13.0))
    sar_b64 = create_geotiff_b64(bounds=(77.5, 12.9, 77.6, 13.0))

    resp = client.post("/api/v1/acquisition/validate-optical-sar-pair", json={
        "optical_data_base64": opt_b64,
        "sar_data_base64": sar_b64,
        "optical_filename": "s2.tif",
        "sar_filename": "s1.tif",
        "optical_provenance": {"modality": "OPTICAL", "datetime": "2024-02-01T10:00:00Z"},
        "sar_provenance": {"modality": "SAR", "datetime": "2024-02-05T10:00:00Z"}
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_compatible"] is True
    assert data["status"] in ("compatible", "compatible_with_limitations")
    assert data["crs_compatible"] is True
    assert data["primary_provider"] == "OpticalSARJointAnalysisProvider"


def test_api_search_optical_sar_pair_endpoint():
    resp = client.post("/api/v1/acquisition/search-optical-sar-pair", json={
        "bbox": [77.5, 12.9, 77.6, 13.0],
        "optical_start_date": "2024-01-01",
        "optical_end_date": "2024-03-31",
        "sar_start_date": "2024-01-01",
        "sar_end_date": "2024-03-31",
        "max_cloud_cover": 20.0,
        "limit": 4
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("success", "partial", "zero_results")
    assert "optical_results" in data
    assert "sar_results" in data


# ============================================================================
# 10. Agent Controller Integration & Provenance Inspection
# ============================================================================

def test_controller_optical_sar_rejection_on_preview_jpeg():
    jpeg_b64 = create_preview_jpeg_b64()
    sar_b64 = create_geotiff_b64()

    payload = {
        "query": "Perform joint optical and SAR analysis on this pair.",
        "mode": "optical_sar",
        "images": [
            {
                "data": jpeg_b64,
                "mimeType": "image/jpeg",
                "filename": "preview.jpg",
                "role": "optical",
                "provenance": {"modality": "OPTICAL"}
            },
            {
                "data": sar_b64,
                "mimeType": "image/tiff",
                "filename": "sentinel1.tif",
                "role": "sar",
                "provenance": {"modality": "SAR"}
            }
        ]
    }

    resp = client.post("/api/v1/analyze", json=payload)
    # Controller Step 4c rejects browse preview
    assert resp.status_code == 400
    detail = resp.json().get("detail", "")
    assert "preview asset detected" in detail.lower()


def test_controller_optical_sar_success_with_scientific_provenance():
    opt_b64 = create_geotiff_b64(bounds=(77.5, 12.9, 77.6, 13.0))
    sar_b64 = create_geotiff_b64(bounds=(77.5, 12.9, 77.6, 13.0), tags={"POLARIZATION": "VV"})

    payload = {
        "query": "Execute optical and SAR cross-sensor joint analysis.",
        "mode": "optical_sar",
        "images": [
            {
                "data": opt_b64,
                "mimeType": "image/tiff",
                "filename": "sentinel2.tif",
                "role": "optical",
                "provenance": {
                    "modality": "OPTICAL",
                    "sensor": "Sentinel-2 L2A",
                    "datetime": "2024-02-01T10:00:00Z"
                }
            },
            {
                "data": sar_b64,
                "mimeType": "image/tiff",
                "filename": "sentinel1.tif",
                "role": "sar",
                "provenance": {
                    "modality": "SAR",
                    "sensor": "Sentinel-1 GRD",
                    "datetime": "2024-02-05T10:00:00Z"
                }
            }
        ]
    }

    resp = client.post("/api/v1/analyze", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["primary_model"] == "OpticalSARJointAnalysisProvider"
    assert data["fallback_used"] is False
    assert "optical_sar_provenance" in data["metadata"]
    prov = data["metadata"]["optical_sar_provenance"]
    assert prov["sar"]["calibration_status"] == "unverified_linear_dn"
    assert prov["sar"]["terrain_correction_status"] == "ellipsoid_geocoded_grd"
    assert "physical_assertion" in prov["scientific_distinction"]


# ============================================================================
# 11. Model Baseline & Truthful Fallback Verification
# ============================================================================

def test_truthful_model_and_baseline_reporting():
    primary_analyzer = OpticalSARJointAnalysisProvider()
    baseline_analyzer = OpticalSARVisualizationBaseline()

    opt = np.random.randint(40, 220, (64, 64, 3), dtype=np.uint8)
    sar = np.random.randint(10, 250, (64, 64), dtype=np.uint8)

    # Primary provider execution
    res_primary = primary_analyzer.predict([opt, sar], query="Joint analysis")
    assert res_primary["primary_model"] == "OpticalSARJointAnalysisProvider"
    assert res_primary["actual_model_used"] == "OpticalSARJointAnalysisProvider"
    assert res_primary["fallback_used"] is False

    # Baseline provider execution
    res_baseline = baseline_analyzer.predict([opt, sar], query="Baseline visualization")
    assert res_baseline["primary_model"] == "OpticalSARJointAnalysisProvider"
    assert res_baseline["actual_model_used"] == "OpticalSARVisualizationBaseline"
    assert res_baseline["fallback_used"] is True


def test_controlled_real_asset_optical_sar_fusion_pipeline():
    """
    Stage 6D: Controlled Real-Asset Optical-SAR Fusion Test.
    Executes the existing Stage 6 optical-SAR analysis on genuine Sentinel-2 B04
    and Sentinel-1 RTC VV windows acquired over Bengaluru AOI.
    """
    from app.acquisition.windowed_reader import SafeWindowedCOGReader
    import httpx

    token_url = "https://planetarycomputer.microsoft.com/api/sas/v1/token/sentinel-1-rtc"
    try:
        with httpx.Client(timeout=10.0) as http_client:
            resp = http_client.get(token_url)
            if resp.status_code != 200:
                pytest.skip("Planetary Computer token endpoint unavailable")
            token = resp.json().get("token")
    except Exception as e:
        pytest.skip(f"Network error accessing token service: {e}")

    aoi_bengaluru = [77.58, 12.96, 77.60, 12.98]
    s2_url = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/43/P/GQ/2024/3/S2A_43PGQ_20240328_0_L2A/B04.tif"
    s1_raw = "https://sentinel1euwestrtc.blob.core.windows.net/sentinel1-grd-rtc/GRD/2024/3/22/IW/DV/S1A_IW_GRDH_1SDV_20240322T004029_20240322T004054_053087_066E0A_9C2C/measurement/iw-vv.rtc.tiff"
    s1_url = f"{s1_raw}?{token}"

    # 1. Acquire bounded windows
    s2_arr, s2_meta = SafeWindowedCOGReader.read_cog_window(s2_url, aoi_bengaluru)
    s1_arr, s1_meta = SafeWindowedCOGReader.read_cog_window(s1_url, aoi_bengaluru)

    assert s2_arr.shape == s1_arr.shape == (224, 220)
    assert s2_arr.dtype == np.uint16
    assert s1_arr.dtype == np.float32

    # 2. Execute existing OpticalSARJointAnalysisProvider
    provider = OpticalSARJointAnalysisProvider()
    res = provider.predict(
        images=[s2_arr, s1_arr],
        query="Perform controlled real-asset cross-sensor analysis over Bengaluru downtown.",
        metadata={
            "optical": {
                **s2_meta,
                "modality": "OPTICAL",
                "sensor": "Sentinel-2 L2A",
                "item_id": "S2A_43PGQ_20240328_0_L2A",
                "datetime": "2024-03-28T05:27:01Z"
            },
            "sar": {
                **s1_meta,
                "modality": "SAR",
                "sensor": "Sentinel-1 C-SAR IW RTC",
                "item_id": "S1A_IW_GRDH_1SDV_20240322T004029_20240322T004054_053087_066E0A_rtc",
                "datetime": "2024-03-22T00:40:42Z",
                "polarization": "VV",
                "calibration_status": "calibrated_backscatter",
                "terrain_correction_status": "radiometrically_terrain_corrected"
            }
        }
    )

    # 3. Verify pipeline execution, provenance, and registration safeguards
    assert res["primary_model"] == "OpticalSARJointAnalysisProvider"
    assert res["actual_model_used"] == "OpticalSARJointAnalysisProvider"
    assert res["fallback_used"] is False
    assert res["registration_info"]["co_registered"] is True
    assert res["registration_info"]["registration_method"] == "identical_grid_co_registered"
    assert res["registration_info"]["spatial_overlap_percent"] == 100.0
    assert res["valid_pixel_count"] == 49280
    assert res["water_pct"] is not None
    assert res["urban_pct"] is not None
    assert res["veg_pct"] is not None
    assert len(res["evidence"]) == 4

    # 4. Stage 6E Physical semantics and provenance verification
    ev_map = {e["id"]: e for e in res["evidence"]}
    opt_stat = ev_map["ev_optical_reflectance"]["statistics"]
    sar_stat = ev_map["ev_sar_backscatter"]["statistics"]

    assert opt_stat["physical_boa_reflectance_mean"] == pytest.approx(0.1298, rel=1e-2)
    assert opt_stat["physical_reflectance_percent"] == "12.98%"
    assert opt_stat["mean_albedo"] == 92.8
    assert "8-bit uint8" in opt_stat["display_scale"]

    assert sar_stat["calibration_quantity"] == "gamma-0"
    assert sar_stat["linear_power_mean"] == pytest.approx(0.7417, rel=1e-2)
    assert sar_stat["calibrated_db_mean"] == pytest.approx(-4.98, rel=1e-2)
    assert sar_stat["mean_backscatter_intensity"] == 105.8
    assert "8-bit uint8" in sar_stat["display_scale"]

    assert "Calibrated gamma-0 backscatter" in res["answer"]
    assert "mean linear gamma-0 power: 0.7417 (-4.98 dB)" in res["answer"]
    assert "mean BOA surface reflectance: 0.1298 (12.98%" in res["answer"]
    assert res["model_provenance"]["calibration_quantity"] == "gamma-0"
    assert any("preliminary scene-normalized empirical proxies" in lim for lim in res["limitations"])


