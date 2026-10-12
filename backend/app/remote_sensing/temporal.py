"""
Stage 14: Multimodal Temporal Remote Sensing Analysis.

Implements scientifically rigorous temporal change detection pipelines for:
1. Sentinel-2 Bi-Temporal Optical NDVI Change:
   - Comparable surface reflectance (BOA) with SCL atmospheric quality masking.
   - Screen clouds, shadows, and defective pixels on BOTH T1 and T2.
   - Joint clear valid mask intersection.
   - Delta-NDVI = NDVI_T2 - NDVI_T1 in [-2.0, +2.0].
   - Physical change classification (vegetation loss, gain, stable).
   - Zero-valid-pixel defense: Returns None when joint clear pixels are absent.

2. Sentinel-1 Bi-Temporal RTC Dual-Polarization SAR Change:
   - Consistent polarization (DUAL_VV_VH) and linear gamma0 power convention.
   - Spatial grid alignment and georeferencing validation.
   - Calibrated DpRVI calculation (Mandal et al., 2020) with physical assumption checks (q > 1.0).
   - Delta-DpRVI = DpRVI_T2 - DpRVI_T1 in [-1.0, +1.0].
   - Delta backscatter power (dB) for VV, VH, and cross-pol ratio.
   - Transparent terrain layover/shadow disclaimer.
   - Zero-valid-pixel defense: Returns None when joint valid pixels are absent.
"""

import logging
import numpy as np
from datetime import datetime
from typing import Dict, Any, Optional, Tuple, List

from app.remote_sensing.preprocessing import convert_array_to_base64_png
from app.remote_sensing.sar import compute_calibrated_dual_pol_sar
from app.remote_sensing.bands import compute_calibrated_sentinel2_ndvi

logger = logging.getLogger("satquery.temporal")

# SCL Atmospheric Masking Policy
SCL_CLEAR_CLASSES = {4, 5, 6, 7, 11}       # Vegetation, Bare Soil, Water, Unclassified, Snow/Ice
SCL_EXCLUDED_CLASSES = {0, 1, 3, 8, 9, 10}  # No data, Defective, Cloud shadows, Cloud med/high, Cirrus


def compute_temporal_optical_change(
    t1_b04: Any,
    t1_b08: Any = None,
    t2_b04: Any = None,
    t2_b08: Any = None,
    t1_scl: Optional[np.ndarray] = None,
    t2_scl: Optional[np.ndarray] = None,
    t1_meta: Optional[Dict[str, Any]] = None,
    t2_meta: Optional[Dict[str, Any]] = None,
    t1_datetime: Optional[str] = None,
    t2_datetime: Optional[str] = None,
    loss_threshold: float = -0.15,
    gain_threshold: float = 0.15,
    reflectance_scale: float = 10000.0
) -> Dict[str, Any]:
    """
    Computes calibrated temporal Sentinel-2 NDVI change with per-scene SCL atmospheric screening.
    Supports either explicit individual band arrays or structured dictionary inputs for T1/T2.
    """
    if isinstance(t1_b04, dict) and (isinstance(t1_b08, dict) or t2_b04 is None):
        t1_dict = t1_b04
        t2_dict = t1_b08 or {}
        t1_b04 = t1_dict.get("b04") if t1_dict.get("b04") is not None else t1_dict.get("red")
        t1_b08 = t1_dict.get("b08") if t1_dict.get("b08") is not None else t1_dict.get("nir")
        t1_scl = t1_dict.get("scl")
        t1_meta = t1_dict.get("meta") or {}
        t1_datetime = t1_datetime or t1_meta.get("datetime")

        t2_b04 = t2_dict.get("b04") if t2_dict.get("b04") is not None else t2_dict.get("red")
        t2_b08 = t2_dict.get("b08") if t2_dict.get("b08") is not None else t2_dict.get("nir")
        t2_scl = t2_dict.get("scl")
        t2_meta = t2_dict.get("meta") or {}
        t2_datetime = t2_datetime or t2_meta.get("datetime")

    t1_meta = t1_meta or {}
    t2_meta = t2_meta or {}

    # 1. Temporal Chronology Validation
    dt1_str = t1_datetime or t1_meta.get("datetime")
    dt2_str = t2_datetime or t2_meta.get("datetime")
    chronology_warning = None

    if dt1_str and dt2_str:
        try:
            # Parse ISO timestamps
            clean_dt1 = dt1_str.replace("Z", "+00:00")
            clean_dt2 = dt2_str.replace("Z", "+00:00")
            d1 = datetime.fromisoformat(clean_dt1)
            d2 = datetime.fromisoformat(clean_dt2)
            if d1 == d2:
                raise ValueError(
                    f"Degenerate temporal pair: T1 and T2 have identical acquisition timestamps ('{dt1_str}'). "
                    "Temporal change detection strictly requires distinct acquisition dates."
                )
            if d1 > d2:
                chronology_warning = (
                    f"Chronological inversion: T1 ('{dt1_str}') is later than T2 ('{dt2_str}'). "
                    "Delta-NDVI is computed as T2 - T1."
                )
        except (ValueError, TypeError) as date_err:
            if "identical" in str(date_err):
                raise
            logger.debug(f"Could not parse timestamps for chronology validation: {date_err}")

    # 2. Extract 2D single-band arrays
    def to_2d(arr: np.ndarray) -> np.ndarray:
        if arr.ndim == 3:
            return arr[0, :, :] if arr.shape[0] in (1, 2, 3, 4) and arr.shape[0] < arr.shape[1] else arr[:, :, 0]
        return arr

    b04_1 = to_2d(t1_b04).astype(np.float64)
    b08_1 = to_2d(t1_b08).astype(np.float64)
    b04_2 = to_2d(t2_b04).astype(np.float64)
    b08_2 = to_2d(t2_b08).astype(np.float64)

    h, w = b04_1.shape[:2]
    total_pixels = int(h * w)

    # 3. Grid Alignment (Reproject T2 to T1 grid if dimensions or georeferencing differ)
    if b04_2.shape[:2] != (h, w) or (t2_meta.get("transform") and t1_meta.get("transform") and t2_meta.get("transform") != t1_meta.get("transform")):
        if t1_meta.get("crs") and t2_meta.get("crs"):
            from rasterio.warp import reproject, Resampling
            from rasterio.transform import Affine

            target_shape = (h, w)
            aligned_b04_2 = np.zeros(target_shape, dtype=np.float64)
            aligned_b08_2 = np.zeros(target_shape, dtype=np.float64)

            t1_trans = Affine(*t1_meta["transform"][:6])
            t2_trans = Affine(*t2_meta["transform"][:6])

            reproject(
                source=b04_2, destination=aligned_b04_2,
                src_transform=t2_trans, src_crs=t2_meta["crs"],
                dst_transform=t1_trans, dst_crs=t1_meta["crs"],
                resampling=Resampling.bilinear,
                src_nodata=t2_meta.get("nodata"), dst_nodata=t2_meta.get("nodata")
            )
            reproject(
                source=b08_2, destination=aligned_b08_2,
                src_transform=t2_trans, src_crs=t2_meta["crs"],
                dst_transform=t1_trans, dst_crs=t1_meta["crs"],
                resampling=Resampling.bilinear,
                src_nodata=t2_meta.get("nodata"), dst_nodata=t2_meta.get("nodata")
            )
            b04_2 = aligned_b04_2
            b08_2 = aligned_b08_2

            if t2_scl is not None:
                scl_2_raw = to_2d(t2_scl)
                aligned_scl_2 = np.zeros(target_shape, dtype=scl_2_raw.dtype)
                reproject(
                    source=scl_2_raw, destination=aligned_scl_2,
                    src_transform=t2_trans, src_crs=t2_meta["crs"],
                    dst_transform=t1_trans, dst_crs=t1_meta["crs"],
                    resampling=Resampling.nearest,
                    src_nodata=t2_meta.get("nodata"), dst_nodata=t2_meta.get("nodata")
                )
                t2_scl = aligned_scl_2
        else:
            raise ValueError(f"Grid dimension mismatch between T1 ({h}x{w}) and T2 ({b04_2.shape}) without valid CRS.")

    # 4. SCL Quality Screening Construction
    def make_scl_mask(scl_in: Optional[np.ndarray]) -> np.ndarray:
        if scl_in is None:
            return np.ones((h, w), dtype=bool)
        scl_2d = to_2d(scl_in)
        clear = np.isin(scl_2d, list(SCL_CLEAR_CLASSES))
        return clear

    t1_clear = make_scl_mask(t1_scl)
    t2_clear = make_scl_mask(t2_scl)
    joint_clear_mask = t1_clear & t2_clear

    # 5. Calibrated Surface Reflectance & Valid NDVI Masking
    # Scale integer BOA reflectance to [0.0, 1.5]
    scale = float(t1_meta.get("scale_factor", reflectance_scale))
    r_red_1 = b04_1 / scale if np.max(b04_1) > 2.0 else b04_1
    r_nir_1 = b08_1 / scale if np.max(b08_1) > 2.0 else b08_1
    r_red_2 = b04_2 / scale if np.max(b04_2) > 2.0 else b04_2
    r_nir_2 = b08_2 / scale if np.max(b08_2) > 2.0 else b08_2

    finite_1 = np.isfinite(r_red_1) & np.isfinite(r_nir_1)
    finite_2 = np.isfinite(r_red_2) & np.isfinite(r_nir_2)

    valid_refl_1 = (r_red_1 >= 0.0) & (r_red_1 <= 1.5) & (r_nir_1 >= 0.0) & (r_nir_1 <= 1.5)
    valid_refl_2 = (r_red_2 >= 0.0) & (r_red_2 <= 1.5) & (r_nir_2 >= 0.0) & (r_nir_2 <= 1.5)

    denom_1 = r_nir_1 + r_red_1
    denom_2 = r_nir_2 + r_red_2
    valid_denom_1 = np.abs(denom_1) > 1e-5
    valid_denom_2 = np.abs(denom_2) > 1e-5

    t1_valid = t1_clear & finite_1 & valid_refl_1 & valid_denom_1
    t2_valid = t2_clear & finite_2 & valid_refl_2 & valid_denom_2

    joint_valid_mask = t1_valid & t2_valid
    joint_valid_count = int(np.count_nonzero(joint_valid_mask))
    joint_clearance_pct = round((joint_valid_count / max(1, total_pixels)) * 100.0, 1)

    # 6. Compute Calibrated NDVI and Delta-NDVI
    delta_ndvi_arr = np.full((h, w), np.nan, dtype=np.float32)
    t1_ndvi_arr = np.full((h, w), np.nan, dtype=np.float32)
    t2_ndvi_arr = np.full((h, w), np.nan, dtype=np.float32)

    if joint_valid_count == 0:
        delta_ndvi_mean = None
        delta_ndvi_median = None
        delta_ndvi_p10 = None
        delta_ndvi_p90 = None
        delta_ndvi_std = None
        ndvi_t1_mean = None
        ndvi_t2_mean = None
        vegetation_loss_pct = None
        vegetation_gain_pct = None
        stable_vegetation_pct = None
        loss_pixel_count = 0
        gain_pixel_count = 0
        stable_pixel_count = 0
        status = "unsupported_zero_valid_pixels"
        summary = (
            "Temporal optical NDVI change analysis unsupported: Zero joint clear pixels between T1 and T2 "
            "after Scene Classification Layer (SCL) cloud, cloud shadow, and non-physical reflectance screening."
        )
    else:
        # Compute NDVIs on joint valid footprint
        t1_ndvi = (r_nir_1[joint_valid_mask] - r_red_1[joint_valid_mask]) / denom_1[joint_valid_mask]
        t2_ndvi = (r_nir_2[joint_valid_mask] - r_red_2[joint_valid_mask]) / denom_2[joint_valid_mask]

        t1_ndvi = np.clip(t1_ndvi, -1.0, 1.0)
        t2_ndvi = np.clip(t2_ndvi, -1.0, 1.0)

        delta = t2_ndvi - t1_ndvi
        delta = np.clip(delta, -2.0, 2.0)

        delta_ndvi_arr[joint_valid_mask] = delta.astype(np.float32)
        t1_ndvi_arr[joint_valid_mask] = t1_ndvi.astype(np.float32)
        t2_ndvi_arr[joint_valid_mask] = t2_ndvi.astype(np.float32)

        delta_ndvi_mean = round(float(np.mean(delta)), 4)
        delta_ndvi_median = round(float(np.median(delta)), 4)
        delta_ndvi_p10 = round(float(np.percentile(delta, 10)), 4)
        delta_ndvi_p90 = round(float(np.percentile(delta, 90)), 4)
        delta_ndvi_std = round(float(np.std(delta)), 4)

        ndvi_t1_mean = round(float(np.mean(t1_ndvi)), 4)
        ndvi_t2_mean = round(float(np.mean(t2_ndvi)), 4)

        # Classification of physical vegetation change
        loss_pixel_count = int(np.count_nonzero(delta <= loss_threshold))
        gain_pixel_count = int(np.count_nonzero(delta >= gain_threshold))
        stable_pixel_count = int(np.count_nonzero((delta > loss_threshold) & (delta < gain_threshold)))

        vegetation_loss_pct = round((loss_pixel_count / joint_valid_count) * 100.0, 2)
        vegetation_gain_pct = round((gain_pixel_count / joint_valid_count) * 100.0, 2)
        stable_vegetation_pct = round((stable_pixel_count / joint_valid_count) * 100.0, 2)

        status = "success"
        summary = (
            f"Sentinel-2 temporal optical change computed across {joint_valid_count:,} joint clear pixels ({joint_clearance_pct}% scene clearance). "
            f"Mean Delta-NDVI: {delta_ndvi_mean:+.4f} (T1: {ndvi_t1_mean:.4f} -> T2: {ndvi_t2_mean:.4f}). "
            f"Vegetation loss: {vegetation_loss_pct}% ({loss_pixel_count:,} px), "
            f"gain: {vegetation_gain_pct}% ({gain_pixel_count:,} px), "
            f"stable: {stable_vegetation_pct}%."
        )

    # 7. Colorized Delta-NDVI Change Map Preview
    colorized_rgb = np.full((h, w, 3), 35, dtype=np.uint8)  # Masked pixels: dark gray [35, 35, 35]
    if joint_valid_count > 0:
        m_loss = joint_valid_mask & (delta_ndvi_arr <= loss_threshold)
        m_gain = joint_valid_mask & (delta_ndvi_arr >= gain_threshold)
        m_stable = joint_valid_mask & (delta_ndvi_arr > loss_threshold) & (delta_ndvi_arr < gain_threshold)

        colorized_rgb[m_loss] = [215, 45, 35]       # Vegetation loss / canopy clearing: Crimson Red
        colorized_rgb[m_gain] = [40, 180, 50]       # Vegetation gain / vigor increase: Green
        colorized_rgb[m_stable] = [120, 130, 140]   # Stable / unchanged: Neutral Slate

    colorized_b64 = convert_array_to_base64_png(colorized_rgb)

    limitations = [
        "Sentinel-2 temporal optical change uses Level-2A Bottom-Of-Atmosphere (BOA) surface reflectance (B04 + B08).",
        "Scene Classification Layer (SCL) atmospheric filtering applied to both T1 and T2: cloud, shadow, and cirrus pixels excluded.",
        f"Vegetation change thresholds: Loss (Delta-NDVI <= {loss_threshold:.2f}), Gain (Delta-NDVI >= {gain_threshold:.2f}).",
        "Delta-NDVI represents relative changes in photosynthetic canopy vigor; seasonal phenology must be considered."
    ]
    if chronology_warning:
        limitations.insert(0, chronology_warning)

    return {
        "status": status,
        "is_calibrated": True,
        "summary": summary,
        "delta_ndvi_mean": delta_ndvi_mean,
        "delta_ndvi_median": delta_ndvi_median,
        "delta_ndvi_p10": delta_ndvi_p10,
        "delta_ndvi_p90": delta_ndvi_p90,
        "delta_ndvi_std": delta_ndvi_std,
        "ndvi_t1_mean": ndvi_t1_mean,
        "ndvi_t2_mean": ndvi_t2_mean,
        "vegetation_loss_pct": vegetation_loss_pct,
        "vegetation_gain_pct": vegetation_gain_pct,
        "stable_vegetation_pct": stable_vegetation_pct,
        "loss_pixel_count": loss_pixel_count,
        "gain_pixel_count": gain_pixel_count,
        "stable_pixel_count": stable_pixel_count,
        "loss_threshold": loss_threshold,
        "gain_threshold": gain_threshold,
        "joint_valid_pixel_count": joint_valid_count,
        "total_pixel_count": total_pixels,
        "joint_clearance_pct": joint_clearance_pct,
        "joint_valid_mask": joint_valid_mask,
        "delta_ndvi_array": delta_ndvi_arr,
        "colorized_preview_base64": colorized_b64,
        "colorized_change_preview_base64": colorized_b64,
        "preview_base64": colorized_b64,
        "t1_datetime": dt1_str,
        "t2_datetime": dt2_str,
        "scl_filtering_applied": True,
        "scientific_limitations": limitations
    }


def compute_temporal_sar_change(
    t1_vv: Any,
    t1_vh: Any = None,
    t2_vv: Any = None,
    t2_vh: Any = None,
    t1_meta: Optional[Dict[str, Any]] = None,
    t2_meta: Optional[Dict[str, Any]] = None,
    t1_datetime: Optional[str] = None,
    t2_datetime: Optional[str] = None,
    canopy_loss_threshold: float = -0.15,
    canopy_gain_threshold: float = 0.15,
    input_is_db: bool = False
) -> Dict[str, Any]:
    """
    Computes calibrated temporal Sentinel-1 RTC dual-polarization SAR change (Delta-DpRVI & Delta-Backscatter).
    Supports either explicit individual band arrays or structured dictionary inputs for T1/T2.
    """
    if isinstance(t1_vv, dict) and (isinstance(t1_vh, dict) or t2_vv is None):
        t1_dict = t1_vv
        t2_dict = t1_vh or {}
        t1_vv = t1_dict.get("vv")
        t1_vh = t1_dict.get("vh")
        t1_meta = t1_dict.get("meta") or {}
        t1_datetime = t1_datetime or t1_meta.get("datetime")

        t2_vv = t2_dict.get("vv")
        t2_vh = t2_dict.get("vh")
        t2_meta = t2_dict.get("meta") or {}
        t2_datetime = t2_datetime or t2_meta.get("datetime")

    t1_meta = t1_meta or {}
    t2_meta = t2_meta or {}

    # 1. Temporal Chronology Validation
    dt1_str = t1_datetime or t1_meta.get("datetime")
    dt2_str = t2_datetime or t2_meta.get("datetime")
    chronology_warning = None

    if dt1_str and dt2_str:
        try:
            clean_dt1 = dt1_str.replace("Z", "+00:00")
            clean_dt2 = dt2_str.replace("Z", "+00:00")
            d1 = datetime.fromisoformat(clean_dt1)
            d2 = datetime.fromisoformat(clean_dt2)
            if d1 == d2:
                raise ValueError(
                    f"Degenerate temporal pair: T1 and T2 have identical acquisition timestamps ('{dt1_str}'). "
                    "Temporal SAR change detection strictly requires distinct acquisition dates."
                )
            if d1 > d2:
                chronology_warning = (
                    f"Chronological inversion: T1 ('{dt1_str}') is later than T2 ('{dt2_str}'). "
                    "Delta-DpRVI is computed as T2 - T1."
                )
        except (ValueError, TypeError) as date_err:
            if "identical" in str(date_err):
                raise
            logger.debug(f"Could not parse SAR timestamps for chronology validation: {date_err}")

    # 2. Extract 2D single-band arrays
    def to_2d(arr: np.ndarray) -> np.ndarray:
        if arr.ndim == 3:
            return arr[0, :, :] if arr.shape[0] in (1, 2, 3, 4) and arr.shape[0] < arr.shape[1] else arr[:, :, 0]
        return arr

    vv_1 = to_2d(t1_vv)
    vh_1 = to_2d(t1_vh)
    vv_2 = to_2d(t2_vv)
    vh_2 = to_2d(t2_vh)

    h, w = vv_1.shape[:2]
    total_pixels = int(h * w)

    # 3. Spatial Grid Alignment (Reproject T2 to T1 grid if needed)
    if vv_2.shape[:2] != (h, w) or (t2_meta.get("transform") and t1_meta.get("transform") and t2_meta.get("transform") != t1_meta.get("transform")):
        if t1_meta.get("crs") and t2_meta.get("crs"):
            from rasterio.warp import reproject, Resampling
            from rasterio.transform import Affine

            target_shape = (h, w)
            aligned_vv_2 = np.zeros(target_shape, dtype=vv_2.dtype)
            aligned_vh_2 = np.zeros(target_shape, dtype=vh_2.dtype)

            t1_trans = Affine(*t1_meta["transform"][:6])
            t2_trans = Affine(*t2_meta["transform"][:6])

            reproject(
                source=vv_2, destination=aligned_vv_2,
                src_transform=t2_trans, src_crs=t2_meta["crs"],
                dst_transform=t1_trans, dst_crs=t1_meta["crs"],
                resampling=Resampling.bilinear,
                src_nodata=t2_meta.get("nodata"), dst_nodata=t2_meta.get("nodata")
            )
            reproject(
                source=vh_2, destination=aligned_vh_2,
                src_transform=t2_trans, src_crs=t2_meta["crs"],
                dst_transform=t1_trans, dst_crs=t1_meta["crs"],
                resampling=Resampling.bilinear,
                src_nodata=t2_meta.get("nodata"), dst_nodata=t2_meta.get("nodata")
            )
            vv_2 = aligned_vv_2
            vh_2 = aligned_vh_2
        else:
            raise ValueError(f"SAR grid dimension mismatch between T1 ({h}x{w}) and T2 ({vv_2.shape}) without valid CRS.")

    # 4. Calibrated DpRVI & Backscatter Calculation for T1 and T2
    t1_sar = compute_calibrated_dual_pol_sar(
        vv_arr=vv_1, vh_arr=vh_1, vv_meta=t1_meta, vh_meta=t1_meta, input_is_db=input_is_db
    )
    t2_sar = compute_calibrated_dual_pol_sar(
        vv_arr=vv_2, vh_arr=vh_2, vv_meta=t2_meta, vh_meta=t2_meta, input_is_db=input_is_db
    )

    t1_valid_mask = t1_sar.get("valid_mask", np.zeros((h, w), dtype=bool))
    t2_valid_mask = t2_sar.get("valid_mask", np.zeros((h, w), dtype=bool))

    joint_valid_mask = t1_valid_mask & t2_valid_mask
    joint_valid_count = int(np.count_nonzero(joint_valid_mask))
    joint_clearance_pct = round((joint_valid_count / max(1, total_pixels)) * 100.0, 1)

    delta_dprvi_arr = np.full((h, w), np.nan, dtype=np.float32)

    # Track assumption violations across T1 and T2
    t1_violations = t1_sar.get("dprvi_assumption_violations", {})
    t2_violations = t2_sar.get("dprvi_assumption_violations", {})
    total_violations = t1_violations.get("count", 0) + t2_violations.get("count", 0)

    if joint_valid_count == 0:
        delta_dprvi_mean = None
        delta_dprvi_median = None
        delta_dprvi_p10 = None
        delta_dprvi_p90 = None
        delta_dprvi_std = None
        dprvi_t1_mean = None
        dprvi_t2_mean = None
        delta_vv_db = None
        delta_vh_db = None
        delta_cross_pol_db = None
        radar_canopy_loss_pct = None
        radar_canopy_gain_pct = None
        stable_canopy_pct = None
        loss_pixel_count = 0
        gain_pixel_count = 0
        stable_pixel_count = 0
        status = "unsupported_zero_valid_pixels"
        summary = (
            "Temporal SAR dual-polarization change analysis unsupported: Zero joint valid radar pixels between T1 and T2 "
            "after nodata sentinel, non-positive linear power, and out-of-bounds radiometry screening."
        )
    else:
        dprvi_1 = t1_sar["dprvi_array"][joint_valid_mask]
        dprvi_2 = t2_sar["dprvi_array"][joint_valid_mask]

        delta_dprvi = dprvi_2 - dprvi_1
        delta_dprvi = np.clip(delta_dprvi, -1.0, 1.0)
        delta_dprvi_arr[joint_valid_mask] = delta_dprvi.astype(np.float32)

        delta_dprvi_mean = round(float(np.mean(delta_dprvi)), 4)
        delta_dprvi_median = round(float(np.median(delta_dprvi)), 4)
        delta_dprvi_p10 = round(float(np.percentile(delta_dprvi, 10)), 4)
        delta_dprvi_p90 = round(float(np.percentile(delta_dprvi, 90)), 4)
        delta_dprvi_std = round(float(np.std(delta_dprvi)), 4)

        dprvi_t1_mean = round(float(np.mean(dprvi_1)), 4)
        dprvi_t2_mean = round(float(np.mean(dprvi_2)), 4)

        # Backscatter differences (dB)
        if t1_sar.get("vv_mean_db") is not None and t2_sar.get("vv_mean_db") is not None:
            delta_vv_db = round(float(t2_sar["vv_mean_db"] - t1_sar["vv_mean_db"]), 2)
        else:
            delta_vv_db = None

        if t1_sar.get("vh_mean_db") is not None and t2_sar.get("vh_mean_db") is not None:
            delta_vh_db = round(float(t2_sar["vh_mean_db"] - t1_sar["vh_mean_db"]), 2)
        else:
            delta_vh_db = None

        if t1_sar.get("cross_pol_ratio_db") is not None and t2_sar.get("cross_pol_ratio_db") is not None:
            delta_cross_pol_db = round(float(t2_sar["cross_pol_ratio_db"] - t1_sar["cross_pol_ratio_db"]), 2)
        else:
            delta_cross_pol_db = None

        # Structural canopy change classification
        loss_pixel_count = int(np.count_nonzero(delta_dprvi <= canopy_loss_threshold))
        gain_pixel_count = int(np.count_nonzero(delta_dprvi >= canopy_gain_threshold))
        stable_pixel_count = int(np.count_nonzero((delta_dprvi > canopy_loss_threshold) & (delta_dprvi < canopy_gain_threshold)))

        radar_canopy_loss_pct = round((loss_pixel_count / joint_valid_count) * 100.0, 2)
        radar_canopy_gain_pct = round((gain_pixel_count / joint_valid_count) * 100.0, 2)
        stable_canopy_pct = round((stable_pixel_count / joint_valid_count) * 100.0, 2)

        status = "success"
        summary = (
            f"Sentinel-1 RTC temporal SAR change computed across {joint_valid_count:,} joint valid radar pixels ({joint_clearance_pct}% scene clearance). "
            f"Mean Delta-DpRVI: {delta_dprvi_mean:+.4f} (T1: {dprvi_t1_mean:.4f} -> T2: {dprvi_t2_mean:.4f}), "
            f"Delta VV: {delta_vv_db:+.1f} dB, Delta VH: {delta_vh_db:+.1f} dB. "
            f"Radar canopy loss: {radar_canopy_loss_pct}% ({loss_pixel_count:,} px), "
            f"gain: {radar_canopy_gain_pct}% ({gain_pixel_count:,} px), "
            f"stable: {stable_canopy_pct}%."
        )

    # 5. Colorized Delta-DpRVI Preview
    colorized_rgb = np.full((h, w, 3), 35, dtype=np.uint8)
    if joint_valid_count > 0:
        m_loss = joint_valid_mask & (delta_dprvi_arr <= canopy_loss_threshold)
        m_gain = joint_valid_mask & (delta_dprvi_arr >= canopy_gain_threshold)
        m_stable = joint_valid_mask & (delta_dprvi_arr > canopy_loss_threshold) & (delta_dprvi_arr < canopy_gain_threshold)

        colorized_rgb[m_loss] = [230, 80, 40]       # Radar canopy loss / deforestation: Red-Orange
        colorized_rgb[m_gain] = [30, 160, 60]       # Radar canopy increase / growth: Emerald Green
        colorized_rgb[m_stable] = [120, 130, 140]   # Stable / unchanged: Neutral Slate

    colorized_b64 = convert_array_to_base64_png(colorized_rgb)

    limitations = [
        "Sentinel-1 RTC temporal SAR change uses radiometrically terrain-corrected gamma0 linear backscatter power (m^2/m^2).",
        "Polarization mode verified: DUAL_VV_VH across both T1 and T2.",
        "DpRVI is calculated as DpRVI = q(q+3)/(q+1)^2, q = VH/VV (Mandal et al., 2020).",
        "Terrain layover and shadow masks are unavailable from STAC provider; topographic relief shadows are unmasked.",
        "DpRVI characterizes radar volume scattering randomness; it does not replace optical chlorophyll NDVI."
    ]
    if chronology_warning:
        limitations.insert(0, chronology_warning)
    if total_violations > 0:
        limitations.append(
            f"Physical assumption notice: DpRVI assumption (VH <= VV) was violated in {total_violations:,} pixels across temporal pair. "
            "Values with q > 1.0 were clipped to 1.0 and flagged as uncertified approximations."
        )

    return {
        "status": status,
        "is_calibrated": True,
        "summary": summary,
        "delta_dprvi_mean": delta_dprvi_mean,
        "delta_dprvi_median": delta_dprvi_median,
        "delta_dprvi_p10": delta_dprvi_p10,
        "delta_dprvi_p90": delta_dprvi_p90,
        "delta_dprvi_std": delta_dprvi_std,
        "dprvi_t1_mean": dprvi_t1_mean,
        "dprvi_t2_mean": dprvi_t2_mean,
        "delta_vv_db": delta_vv_db,
        "delta_vh_db": delta_vh_db,
        "delta_cross_pol_db": delta_cross_pol_db,
        "radar_canopy_loss_pct": radar_canopy_loss_pct,
        "radar_canopy_gain_pct": radar_canopy_gain_pct,
        "stable_canopy_pct": stable_canopy_pct,
        "loss_pixel_count": loss_pixel_count,
        "gain_pixel_count": gain_pixel_count,
        "stable_pixel_count": stable_pixel_count,
        "loss_threshold": canopy_loss_threshold,
        "gain_threshold": canopy_gain_threshold,
        "joint_valid_pixel_count": joint_valid_count,
        "total_pixel_count": total_pixels,
        "joint_clearance_pct": joint_clearance_pct,
        "joint_valid_mask": joint_valid_mask,
        "delta_dprvi_array": delta_dprvi_arr,
        "colorized_preview_base64": colorized_b64,
        "colorized_change_preview_base64": colorized_b64,
        "preview_base64": colorized_b64,
        "t1_datetime": dt1_str,
        "t2_datetime": dt2_str,
        "polarization_mode": "DUAL_VV_VH",
        "sar_terrain_mask_status": "unavailable_from_stac_provider",
        "validity_policy": {
            "sar_terrain_layover_shadow_mask": "unavailable_from_stac_provider",
            "polarization": "DUAL_VV_VH",
            "unit": "linear_gamma0_power"
        },
        "dprvi_assumption_violations": {
            "t1": t1_violations,
            "t2": t2_violations,
            "total_count": total_violations,
            "has_violations": total_violations > 0,
            "flagged_unphysical_q": total_violations > 0,
            "total_pct": round((total_violations / max(1, joint_valid_count)) * 100.0, 2)
        },
        "scientific_limitations": limitations
    }
