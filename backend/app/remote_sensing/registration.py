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
    Preserves legitimate zero-valued pixels unless nodata is explicitly set to 0.
    """
    h, w = arr.shape[:2]
    mask = np.ones((h, w), dtype=bool)

    # 1. Floating-point NaN / Inf checks
    if np.issubdtype(arr.dtype, np.floating):
        if arr.ndim == 2:
            mask &= ~(np.isnan(arr) | np.isinf(arr))
        else:
            mask &= ~(np.isnan(arr).any(axis=-1) | np.isinf(arr).any(axis=-1))

    # 2. Source nodata exclusions
    if nodata is not None:
        try:
            nd_val = float(nodata)
            if arr.ndim == 2:
                mask &= (arr != nd_val)
            else:
                mask &= ~np.all(arr == nd_val, axis=-1)
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
    nodata_a = meta_a.get("nodata")
    nodata_b = meta_b.get("nodata")

    # Compute source validity masks
    src_valid_a = compute_source_valid_mask(img_a, nodata_a)
    src_valid_b = compute_source_valid_mask(img_b, nodata_b)

    # Case 1: Both images have authentic CRS and bounds
    if crs_a and crs_b and bounds_a and bounds_b:
        overlap_pct = 0.0
        crs_matched = (crs_a == crs_b)

        if crs_matched:
            overlap_pct = compute_bounds_overlap(bounds_a, bounds_b)
        else:
            logger.warning(
                f"CRS mismatch detected between scenes: primary={crs_a}, secondary={crs_b}. "
                "Different UTM zones/projections cannot be assumed aligned."
            )

        # Check if grids are already identical
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

        # Attempt Rasterio reprojection if transforms and CRS match
        if crs_matched and transform_a and transform_b:
            try:
                import rasterio
                from rasterio.warp import reproject, Resampling
                from rasterio.transform import Affine

                aff_a = Affine(*transform_a[:6])
                aff_b = Affine(*transform_b[:6])

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
                    resampling=Resampling.bilinear
                )

                # 2. Reproject validity mask of secondary image
                # Map valid pixels to 255; unmapped / outside pixels remain 0
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
                    "crs_matched": True,
                    "primary_crs": crs_a,
                    "secondary_crs": crs_b,
                    "spatial_overlap_percent": overlap_pct,
                    "primary_dimensions": [w_a, h_a],
                    "secondary_original_dimensions": [w_b, h_b],
                    "registration_method": "geospatial_rasterio_reprojected",
                    "valid_mask": shared_valid_mask,
                    "valid_pixel_count": valid_px,
                    "total_pixel_count": int(w_a * h_a),
                    "notes": (
                        f"Rasterio reprojection succeeded. Overlap: {overlap_pct}%, "
                        f"Valid intersecting pixels: {valid_px:,} of {w_a * h_a:,}."
                    )
                }
                return img_a, img_b_aligned, registration_info
            except Exception as e:
                logger.warning(f"Rasterio reprojection failed ({e}).")

        # Reprojection could not be performed (missing transform, CRS mismatch, or error)
        # Rescaling secondary image for display only
        try:
            import cv2
            img_b_aligned = cv2.resize(img_b, (w_a, h_a), interpolation=cv2.INTER_LINEAR)
        except ImportError:
            pil_b = Image.fromarray(img_b)
            img_b_aligned = np.array(pil_b.resize((w_a, h_a), Image.Resampling.BILINEAR))

        notes_reason = (
            f"CRS mismatch ({crs_a} vs {crs_b})" if not crs_matched
            else "Missing affine transform or reprojection failed"
        )
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
        is_display_only = True
        align_method = "unreferenced_visual_resize_only"
        notes = (
            "CRS or geospatial bounds unavailable for one or both inputs. "
            "Rasters were dimensionally rescaled for display only; true physical geodetic co-registration was NOT established. "
            "Display-only resizing cannot be used for spatial masks, area calculations, or geospatial conclusions."
        )
        shared_valid_mask = None
        alignment_valid = False
    else:
        # Same dimension unreferenced arrays
        img_b_aligned = img_b.copy()
        shared_valid_mask = src_valid_a & src_valid_b
        is_display_only = False
        alignment_valid = True
        align_method = "identical_grid_unreferenced"
        notes = (
            "Unreferenced pixel arrays with identical dimensions. "
            "Processed on pixel grid; absolute geodetic coordinates unavailable."
        )

    valid_px = int(np.count_nonzero(shared_valid_mask)) if shared_valid_mask is not None else 0
    registration_info = {
        "georeferenced": False,
        "co_registered": False,
        "alignment_valid": alignment_valid,
        "is_display_only": is_display_only,
        "crs_matched": False,
        "primary_crs": crs_a or "CRS unavailable",
        "secondary_crs": crs_b or "CRS unavailable",
        "spatial_overlap_percent": None,
        "primary_dimensions": [w_a, h_a],
        "secondary_original_dimensions": [w_b, h_b],
        "registration_method": align_method,
        "valid_mask": shared_valid_mask,
        "valid_pixel_count": valid_px,
        "total_pixel_count": int(w_a * h_a),
        "notes": notes
    }
    return img_a, img_b_aligned, registration_info
