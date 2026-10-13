import logging
import numpy as np
from typing import Tuple, Dict, Any, Optional, List
from PIL import Image

logger = logging.getLogger("satquery.registration")

def compute_bounds_overlap(bounds_a: List[float], bounds_b: List[float]) -> float:
    """
    Computes percentage of spatial overlap between two bounding boxes [left, bottom, right, top].
    Returns overlap percentage (0.0 to 100.0).
    """
    left = max(bounds_a[0], bounds_b[0])
    bottom = max(bounds_a[1], bounds_b[1])
    right = min(bounds_a[2], bounds_b[2])
    top = min(bounds_a[3], bounds_b[3])

    if right <= left or top <= bottom:
        return 0.0

    inter_area = (right - left) * (top - bottom)
    area_a = (bounds_a[2] - bounds_a[0]) * (bounds_a[3] - bounds_a[1])
    area_b = (bounds_b[2] - bounds_b[0]) * (bounds_b[3] - bounds_b[1])

    min_area = min(area_a, area_b)
    if min_area <= 0:
        return 0.0

    return float(round((inter_area / min_area) * 100.0, 2))

def compute_source_valid_mask(arr: np.ndarray, nodata: Optional[Any] = None) -> np.ndarray:
    """
    Computes 2D boolean mask (True = valid data, False = nodata / NaN / Inf).
    A pixel is invalid if ANY channel is nodata, NaN, or non-finite.
    Preserves legitimate zero-valued pixels unless nodata is explicitly set to 0.
    Handles (H, W), (H, W, C), and (C, H, W) array layouts.
    """
    if arr.ndim == 2:
        h, w = arr.shape
        channel_axis = None
    elif arr.ndim == 3:
        # Determine channel axis: if shape[0] is small (<= 16) and shape[2] is larger, it's (C, H, W)
        if arr.shape[0] < min(arr.shape[1], arr.shape[2]) and arr.shape[0] <= 16:
            h, w = arr.shape[1], arr.shape[2]
            channel_axis = 0
        else:
            h, w = arr.shape[0], arr.shape[1]
            channel_axis = -1
    else:
        h, w = arr.shape[:2]
        channel_axis = -1

    mask = np.ones((h, w), dtype=bool)

    # 1. Floating-point NaN / Inf checks
    if np.issubdtype(arr.dtype, np.floating):
        if channel_axis is None:
            mask &= ~(np.isnan(arr) | np.isinf(arr))
        else:
            invalid_floats = np.isnan(arr) | np.isinf(arr)
            mask &= ~np.any(invalid_floats, axis=channel_axis)

    # 2. Source nodata exclusions
    if nodata is not None:
        try:
            nd_val = float(nodata)
            if channel_axis is None:
                mask &= (arr != nd_val)
            else:
                # Pixel is invalid if ANY required channel equals nodata
                mask &= ~np.any(arr == nd_val, axis=channel_axis)
        except Exception:
            pass

    return mask

def align_image_pair(
    img_a: np.ndarray,
    img_b: np.ndarray,
    meta_a: Optional[Dict[str, Any]] = None,
    meta_b: Optional[Dict[str, Any]] = None
) -> Tuple[np.ndarray, np.ndarray, Dict[str, Any]]:
    """
    Performs rigorous geospatial compatibility check, CRS alignment, and resampling
    between two satellite scenes (Bi-temporal or Optical + SAR).

    Strict Scientific Rules:
    1. Zero-padding and margins: Rasterio reprojection tracks valid data footprints explicitly;
       zero-padded margins and non-overlapping pixels are never treated as observed data.
    2. Valid-data mask: Produces an explicit shared boolean mask combining source nodata,
       mutual footprint intersection, and validity across both modalities.
    3. Missing georeferencing: When affine transforms or adequate geospatial metadata are missing,
       does NOT claim geographic alignment. Resizing is labeled strictly as display-only.
    4. Genuine zeros: Legitimate zero measurements within valid footprints are strictly preserved.
    """
    h_a, w_a = img_a.shape[:2]
    h_b, w_b = img_b.shape[:2]

    meta_a = meta_a or {}
    meta_b = meta_b or {}

    crs_a = meta_a.get("crs")
    crs_b = meta_b.get("crs")
    bounds_a = meta_a.get("bounds")
    bounds_b = meta_b.get("bounds")
    transform_a = meta_a.get("transform")
    transform_b = meta_b.get("transform")
    if not transform_a and crs_a and bounds_a and len(bounds_a) == 4 and w_a > 0 and h_a > 0:
        try:
            from rasterio.transform import from_bounds
            transform_a = list(from_bounds(*bounds_a, w_a, h_a))[:6]
        except Exception:
            pass
    if not transform_b and crs_b and bounds_b and len(bounds_b) == 4 and w_b > 0 and h_b > 0:
        try:
            from rasterio.transform import from_bounds
            transform_b = list(from_bounds(*bounds_b, w_b, h_b))[:6]
        except Exception:
            pass
    nodata_a = meta_a.get("nodata")
    nodata_b = meta_b.get("nodata")

    # Compute source validity masks
    src_valid_a = compute_source_valid_mask(img_a, nodata_a)
    src_valid_b = compute_source_valid_mask(img_b, nodata_b)

    # Stage 10: Integrate radiometric quality masks if present
    q_mask_a = meta_a.get("quality_mask")
    if q_mask_a is None:
        q_mask_a = meta_a.get("scl_mask")
    if q_mask_a is None and isinstance(meta_a.get("quality_screening"), dict):
        q_mask_a = meta_a["quality_screening"].get("clear_mask")
    if q_mask_a is not None and isinstance(q_mask_a, np.ndarray) and q_mask_a.shape[:2] == (h_a, w_a):
        src_valid_a = src_valid_a & q_mask_a

    q_mask_b = meta_b.get("quality_mask")
    if q_mask_b is None:
        q_mask_b = meta_b.get("sar_valid_mask")
    if q_mask_b is None and isinstance(meta_b.get("quality_screening"), dict):
        q_mask_b = meta_b["quality_screening"].get("valid_mask")
    if q_mask_b is not None and isinstance(q_mask_b, np.ndarray) and q_mask_b.shape[:2] == (h_b, w_b):
        src_valid_b = src_valid_b & q_mask_b

    # Case 1: Both images have authentic CRS, bounds, and affine transforms
    if crs_a and crs_b and bounds_a and bounds_b and transform_a and transform_b:
        crs_matched = (crs_a == crs_b)
        overlap_pct = 0.0

        # Transform bounds_b to crs_a if coordinate systems differ to compute true geospatial overlap
        bounds_b_in_crs_a = bounds_b
        if not crs_matched:
            try:
                from rasterio.warp import transform_bounds
                bounds_b_in_crs_a = list(transform_bounds(crs_b, crs_a, *bounds_b))
            except Exception as tb_err:
                logger.warning(f"Could not transform bounds from {crs_b} to {crs_a}: {tb_err}")
                bounds_b_in_crs_a = None

        if bounds_b_in_crs_a:
            overlap_pct = compute_bounds_overlap(bounds_a, bounds_b_in_crs_a)

        # 1a. Explicit rejection if no mutual geospatial overlap exists
        if overlap_pct <= 0.0:
            logger.warning(
                f"Zero spatial overlap detected between scenes: primary={crs_a}, secondary={crs_b}."
            )
            try:
                import cv2
                img_b_aligned = cv2.resize(img_b, (w_a, h_a), interpolation=cv2.INTER_LINEAR)
            except ImportError:
                pil_b = Image.fromarray(img_b)
                img_b_aligned = np.array(pil_b.resize((w_a, h_a), Image.Resampling.BILINEAR))

            registration_info = {
                "georeferenced": True,
                "co_registered": False,
                "alignment_valid": False,
                "is_display_only": True,
                "crs_matched": crs_matched,
                "primary_crs": crs_a,
                "secondary_crs": crs_b,
                "spatial_overlap_percent": 0.0,
                "primary_dimensions": [w_a, h_a],
                "secondary_original_dimensions": [w_b, h_b],
                "registration_method": "no_spatial_overlap",
                "valid_mask": None,
                "valid_pixel_count": 0,
                "total_pixel_count": int(w_a * h_a),
                "notes": (
                    "Zero spatial overlap between scene footprints. "
                    "Rasters do not intersect geographically and cannot be co-registered or analyzed jointly."
                )
            }
            return img_a, img_b_aligned, registration_info

        # 1b. Check if grids are already identical
        same_dims = (h_a, w_a) == (h_b, w_b)
        same_bounds = (bounds_a == bounds_b)
        same_transforms = (transform_a == transform_b and transform_a is not None)

        if crs_matched and same_dims and (same_transforms or same_bounds):
            img_b_aligned = img_b.copy()
            shared_valid_mask = src_valid_a & src_valid_b
            valid_px = int(np.count_nonzero(shared_valid_mask))
            is_co_reg = bool(overlap_pct > 0.0 and valid_px > 0)
            registration_info = {
                "georeferenced": True,
                "co_registered": is_co_reg,
                "alignment_valid": True,
                "is_display_only": False,
                "crs_matched": True,
                "primary_crs": crs_a,
                "secondary_crs": crs_b,
                "target_crs": crs_a,
                "target_transform": transform_a,
                "target_shape": [h_a, w_a],
                "spatial_overlap_percent": overlap_pct,
                "primary_dimensions": [w_a, h_a],
                "secondary_original_dimensions": [w_b, h_b],
                "registration_method": "identical_grid_co_registered",
                "valid_mask": shared_valid_mask,
                "valid_pixel_count": valid_px,
                "total_pixel_count": int(w_a * h_a),
                "notes": "Verified identical pixel grid co-registration and CRS matching."
            }
            return img_a, img_b_aligned, registration_info

        # 1c. Geospatial reprojection onto primary target grid
        try:
            import rasterio
            from rasterio.warp import reproject, Resampling
            from rasterio.transform import Affine

            aff_a = Affine(*transform_a[:6])
            aff_b = Affine(*transform_b[:6])

            # Determine appropriate resampling method:
            # Nearest for integer/categorical masks, bilinear for continuous observations
            is_int_dtype = issubclass(img_b.dtype.type, (np.integer, np.unsignedinteger, np.bool_))
            data_resampling = Resampling.nearest if is_int_dtype else Resampling.bilinear

            # 1. Reproject data
            if img_b.ndim == 2:
                src = img_b[np.newaxis, :, :]
                dst = np.zeros((1, h_a, w_a), dtype=img_b.dtype)
            else:
                src = np.transpose(img_b, (2, 0, 1))
                dst = np.zeros((img_b.shape[2], h_a, w_a), dtype=img_b.dtype)

            reproject(
                source=src,
                destination=dst,
                src_transform=aff_b,
                src_crs=crs_b,
                dst_transform=aff_a,
                dst_crs=crs_a,
                resampling=data_resampling,
                src_nodata=nodata_b,
                dst_nodata=nodata_b
            )

            # 2. Reproject validity mask of secondary image
            src_mask_u8 = (src_valid_b.astype(np.uint8) * 255)[np.newaxis, :, :]
            dst_mask_u8 = np.zeros((1, h_a, w_a), dtype=np.uint8)

            reproject(
                source=src_mask_u8,
                destination=dst_mask_u8,
                src_transform=aff_b,
                src_crs=crs_b,
                dst_transform=aff_a,
                dst_crs=crs_a,
                resampling=Resampling.nearest,
                src_nodata=0,
                dst_nodata=0
            )

            dst_valid_b = (dst_mask_u8[0] == 255)
            shared_valid_mask = src_valid_a & dst_valid_b

            if img_b.ndim == 2:
                img_b_aligned = dst[0]
            else:
                img_b_aligned = np.transpose(dst, (1, 2, 0))

            valid_px = int(np.count_nonzero(shared_valid_mask))
            is_co_reg = bool(overlap_pct > 0.0 and valid_px > 0)

            registration_info = {
                "georeferenced": True,
                "co_registered": is_co_reg,
                "alignment_valid": True,
                "is_display_only": False,
                "crs_matched": crs_matched,
                "primary_crs": crs_a,
                "secondary_crs": crs_b,
                "target_crs": crs_a,
                "target_transform": transform_a,
                "target_shape": [h_a, w_a],
                "spatial_overlap_percent": overlap_pct,
                "primary_dimensions": [w_a, h_a],
                "secondary_original_dimensions": [w_b, h_b],
                "registration_method": "geospatial_rasterio_reprojected",
                "valid_mask": shared_valid_mask,
                "valid_pixel_count": valid_px,
                "total_pixel_count": int(w_a * h_a),
                "notes": (
                    f"Rasterio reprojection succeeded onto {crs_a} target grid. Overlap: {overlap_pct}%, "
                    f"Valid intersecting pixels: {valid_px:,} of {w_a * h_a:,}."
                )
            }
            return img_a, img_b_aligned, registration_info
        except Exception as e:
            logger.warning(f"Rasterio reprojection failed ({e}).")

        # Reprojection could not be performed (reprojection error)
        try:
            import cv2
            img_b_aligned = cv2.resize(img_b, (w_a, h_a), interpolation=cv2.INTER_LINEAR)
        except ImportError:
            pil_b = Image.fromarray(img_b)
            img_b_aligned = np.array(pil_b.resize((w_a, h_a), Image.Resampling.BILINEAR))

        notes_reason = "Reprojection failed or affine transform incompatible"
        registration_info = {
            "georeferenced": True,
            "co_registered": False,
            "alignment_valid": False,
            "is_display_only": True,
            "crs_matched": crs_matched,
            "primary_crs": crs_a,
            "secondary_crs": crs_b,
            "spatial_overlap_percent": overlap_pct,
            "primary_dimensions": [w_a, h_a],
            "secondary_original_dimensions": [w_b, h_b],
            "registration_method": "unreferenced_visual_resize_only",
            "valid_mask": None,
            "valid_pixel_count": 0,
            "total_pixel_count": int(w_a * h_a),
            "notes": (
                f"{notes_reason}. Resizing is strictly display-only. "
                "Safe geospatial alignment was NOT established and cannot be used for spatial masks or area calculations."
            )
        }
        return img_a, img_b_aligned, registration_info

    # Case 2: One or both images lack georeferencing
    # Perform pixel array rescaling only for display preview
    if (h_a, w_a) != (h_b, w_b):
        try:
            import cv2
            img_b_aligned = cv2.resize(img_b, (w_a, h_a), interpolation=cv2.INTER_LINEAR)
        except ImportError:
            pil_b = Image.fromarray(img_b)
            img_b_aligned = np.array(pil_b.resize((w_a, h_a), Image.Resampling.BILINEAR))
        align_method = "unreferenced_visual_resize_only"
    else:
        # Same dimension unreferenced arrays
        img_b_aligned = img_b.copy()
        align_method = "unreferenced_same_dimensions_display_only"

    notes = (
        "CRS, affine geotransforms, or spatial bounds unavailable for one or both inputs. "
        "Rasters were scaled for visual display preview only; true physical geospatial co-registration was NOT established. "
        "Display-only resizing cannot be used for spatial masks, area calculations, or geospatial conclusions."
    )

    registration_info = {
        "georeferenced": False,
        "co_registered": False,
        "alignment_valid": False,
        "is_display_only": True,
        "crs_matched": False,
        "primary_crs": crs_a or "CRS unavailable",
        "secondary_crs": crs_b or "CRS unavailable",
        "spatial_overlap_percent": None,
        "primary_dimensions": [w_a, h_a],
        "secondary_original_dimensions": [w_b, h_b],
        "registration_method": align_method,
        "valid_mask": None,
        "valid_pixel_count": 0,
        "total_pixel_count": int(w_a * h_a),
        "notes": notes
    }
    return img_a, img_b_aligned, registration_info
