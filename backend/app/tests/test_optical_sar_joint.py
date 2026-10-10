import pytest
import numpy as np
import rasterio
from rasterio.transform import from_bounds

from app.models.optical_sar.optical_sar_fusion import (
    OpticalSARJointAnalysisProvider,
    OpticalSARVisualizationBaseline,
    OpticalSARProvider
)
from app.remote_sensing.registration import align_image_pair, compute_source_valid_mask


def test_optical_sar_joint_analysis_artifacts():
    analyzer = OpticalSARJointAnalysisProvider()
    opt = np.random.randint(40, 220, (100, 100, 3), dtype=np.uint8)
    sar = np.random.randint(10, 250, (100, 100), dtype=np.uint8)

    res = analyzer.predict([opt, sar], query="Fuse optical and SAR imagery.")
    assert "answer" in res
    assert "optical_evidence" in res
    assert "sar_evidence" in res
    assert "fused_evidence" in res
    assert "limitations" in res
    assert len(res["limitations"]) > 0

    # Verify all evidence types
    types = [e["type"] for e in res["evidence"]]
    assert "original" in types
    assert "processed" in types
    assert "fused" in types
    assert "mask" in types


def test_optical_sar_provider_delegation():
    provider = OpticalSARProvider()
    opt = np.full((64, 64, 3), 100, dtype=np.uint8)
    sar = np.full((64, 64), 75, dtype=np.uint8)
    res = provider.predict([opt, sar], query="Joint analysis")
    assert "fused_evidence" in res


# ============================================================================
# Stage 6 Scientific-Integrity Regression Tests (GAP-1, GAP-2, GAP-3)
# ============================================================================

def test_zero_padded_margins_do_not_inflate_water_mask():
    """
    1. Zero-padded, non-overlapping margins do not increase the water mask or any class percentage.
    """
    analyzer = OpticalSARJointAnalysisProvider()

    # 100x100 optical scene covering [10.0, 10.0, 10.1, 10.1]
    bounds_opt = [10.0, 10.0, 10.1, 10.1]
    t_opt = from_bounds(*bounds_opt, 100, 100)
    meta_opt = {
        "crs": "EPSG:4326",
        "bounds": bounds_opt,
        "transform": list(t_opt)[:6],
        "width": 100,
        "height": 100
    }
    opt = np.full((100, 100, 3), 120, dtype=np.uint8)

    # 50x50 SAR scene covering only southern half [10.0, 10.0, 10.1, 10.05]
    bounds_sar = [10.0, 10.0, 10.1, 10.05]
    t_sar = from_bounds(*bounds_sar, 50, 50)
    meta_sar = {
        "crs": "EPSG:4326",
        "bounds": bounds_sar,
        "transform": list(t_sar)[:6],
        "width": 50,
        "height": 50
    }
    sar = np.full((50, 50), 100, dtype=np.uint8)

    res = analyzer.predict([opt, sar], metadata={"optical": meta_opt, "sar": meta_sar})

    # Reprojection leaves the northern half of the aligned SAR raster as 0-padded.
    # The zero-padded northern margin must NOT be counted as specular water!
    assert res.get("status") != "unsupported"
    assert res["valid_pixel_count"] < 10000
    # Inside valid footprint, SAR is 100 (> 45), so water pixel count must be 0
    assert res["water_pct"] == 0.0


def test_genuine_zero_valued_pixels_retained():
    """
    2. Genuine zero-valued pixels are retained when the source validity mask marks them as valid.
    """
    analyzer = OpticalSARJointAnalysisProvider()

    bounds = [10.0, 10.0, 10.1, 10.1]
    t = from_bounds(*bounds, 50, 50)
    meta = {
        "crs": "EPSG:4326",
        "bounds": bounds,
        "transform": list(t)[:6],
        "nodata": None  # Zero is a genuine measurement, not nodata
    }

    opt = np.full((50, 50, 3), 20, dtype=np.uint8)  # Low optical albedo (< 60)
    sar = np.zeros((50, 50), dtype=np.uint8)        # Genuine zero radar backscatter (< 45)

    res = analyzer.predict([opt, sar], metadata={"optical": meta, "sar": meta})
    assert res["valid_pixel_count"] == 2500
    assert res["water_pct"] == 100.0


def test_source_nodata_and_invalids_excluded_from_shared_mask():
    """
    3. Source nodata and invalid pixels from either modality are excluded from shared valid mask.
    """
    bounds = [10.0, 10.0, 10.1, 10.1]
    t = from_bounds(*bounds, 50, 50)

    opt = np.full((50, 50, 3), 100, dtype=np.float32)
    opt[:10, :10] = np.nan  # Invalids in top-left 10x10
    meta_opt = {
        "crs": "EPSG:4326",
        "bounds": bounds,
        "transform": list(t)[:6],
        "nodata": None
    }

    sar = np.full((50, 50), 100, dtype=np.float32)
    sar[40:, 40:] = -9999.0  # Nodata in bottom-right 10x10
    meta_sar = {
        "crs": "EPSG:4326",
        "bounds": bounds,
        "transform": list(t)[:6],
        "nodata": -9999.0
    }

    _, _, reg_info = align_image_pair(opt, sar, meta_opt, meta_sar)
    mask = reg_info["valid_mask"]

    # 2500 total - 100 (NaN in opt) - 100 (nodata in sar) = 2300 valid
    assert reg_info["valid_pixel_count"] == 2300
    assert not mask[:10, :10].any()  # Optical NaNs excluded
    assert not mask[40:, 40:].any()  # SAR nodata excluded


def test_missing_georeferencing_cannot_claim_geographic_alignment():
    """
    4. Missing georeferencing cannot silently fall back to resize-based geographic alignment.
    """
    img_a = np.zeros((60, 60, 3), dtype=np.uint8)
    img_b = np.zeros((100, 80), dtype=np.uint8)

    _, _, reg_info = align_image_pair(img_a, img_b)

    assert reg_info["georeferenced"] is False
    assert reg_info["co_registered"] is False
    assert reg_info["alignment_valid"] is False
    assert reg_info["is_display_only"] is True
    assert reg_info["registration_method"] == "unreferenced_visual_resize_only"


def test_display_only_resizing_cannot_feed_geospatial_classification():
    """
    5. Display-only resizing cannot feed geospatial classification or area calculations.
    """
    analyzer = OpticalSARJointAnalysisProvider()

    opt = np.random.randint(40, 200, (60, 60, 3), dtype=np.uint8)
    sar = np.random.randint(10, 200, (100, 80), dtype=np.uint8)

    res = analyzer.predict([opt, sar])

    assert res["status"] == "unsupported"
    assert res["analysis_status"] == "unsupported_alignment"
    assert res["water_pct"] is None
    assert res["urban_pct"] is None
    assert res["veg_pct"] is None
    # No classification masks emitted
    mask_evidences = [e for e in res["evidence"] if e.get("type") == "mask"]
    assert len(mask_evidences) == 0


def test_existing_correctly_georeferenced_alignment_continues_working():
    """
    6. Existing correctly georeferenced alignment continues to work.
    """
    analyzer = OpticalSARJointAnalysisProvider()

    bounds = [77.5, 12.9, 77.6, 13.0]
    t = from_bounds(*bounds, 64, 64)
    meta = {
        "crs": "EPSG:4326",
        "bounds": bounds,
        "transform": list(t)[:6],
        "width": 64,
        "height": 64
    }

    opt = np.random.randint(40, 200, (64, 64, 3), dtype=np.uint8)
    sar = np.random.randint(10, 200, (64, 64), dtype=np.uint8)

    res = analyzer.predict([opt, sar], metadata={"optical": meta, "sar": meta})

    assert res["actual_model_used"] == "OpticalSARJointAnalysisProvider"
    assert res["fallback_used"] is False
    assert res["registration_info"]["co_registered"] is True
    assert res["valid_pixel_count"] == 64 * 64
    assert res["water_pct"] is not None


def test_empty_valid_data_intersection_produces_explicit_unsupported():
    """
    7. Empty valid-data intersections produce an explicit unsupported result rather than misleading percentages.
    """
    analyzer = OpticalSARJointAnalysisProvider()

    bounds = [10.0, 10.0, 10.1, 10.1]
    t = from_bounds(*bounds, 50, 50)

    # Optical scene where all pixels match nodata = 0
    opt = np.zeros((50, 50, 3), dtype=np.uint8)
    meta_opt = {
        "crs": "EPSG:4326",
        "bounds": bounds,
        "transform": list(t)[:6],
        "nodata": 0
    }

    sar = np.full((50, 50), 100, dtype=np.uint8)
    meta_sar = {
        "crs": "EPSG:4326",
        "bounds": bounds,
        "transform": list(t)[:6],
        "nodata": None
    }

    res = analyzer.predict([opt, sar], metadata={"optical": meta_opt, "sar": meta_sar})

    assert res["status"] == "unsupported"
    assert res["analysis_status"] == "unsupported_empty_intersection"
    assert res["valid_pixel_count"] == 0
    assert res["water_pct"] is None
    assert res["urban_pct"] is None
    assert res["veg_pct"] is None
    assert "empty" in res["answer"].lower()


def test_heuristic_outputs_retain_scientific_disclaimers():
    """
    8. Heuristic outputs retain their scientific disclaimers and accurate provider/fallback metadata.
    """
    analyzer = OpticalSARJointAnalysisProvider()

    bounds = [10.0, 10.0, 10.1, 10.1]
    t = from_bounds(*bounds, 50, 50)
    meta = {
        "crs": "EPSG:4326",
        "bounds": bounds,
        "transform": list(t)[:6]
    }

    opt = np.random.randint(40, 200, (50, 50, 3), dtype=np.uint8)
    sar = np.random.randint(10, 200, (50, 50), dtype=np.uint8)

    res = analyzer.predict([opt, sar], metadata={"optical": meta, "sar": meta})

    assert res["actual_model_used"] == "OpticalSARJointAnalysisProvider"
    assert res["fallback_used"] is False
    assert "Preliminary Scene-Normalized Heuristic Indicators" in res["answer"]

    lims = " ".join(res["limitations"]).lower()
    assert "preliminary" in lims
    assert "no trained machine learning model" in lims
    assert "non-interchangeable" in lims
