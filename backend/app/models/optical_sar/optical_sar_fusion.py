import logging
import os
import numpy as np
from typing import Dict, Any, Optional, List
from abc import ABC, abstractmethod

from app.models.base import BaseModel
from app.remote_sensing.registration import align_image_pair
from app.remote_sensing.preprocessing import (
    convert_array_to_base64_png, 
    normalize_to_uint8,
    robust_remote_sensing_preprocess
)

logger = logging.getLogger("satquery.optical_sar")

class BaseOpticalSARFusion(BaseModel):
    """Abstract base adapter for Optical + SAR multimodal fusion."""
    def __init__(self, model_name: str, implementation_status: str = "baseline"):
        super().__init__(
            model_name=model_name,
            task_type="optical_sar",
            implementation_status=implementation_status,
            is_trained=False,
            is_remote_sensing_adapted=False
        )

    @abstractmethod
    def predict(
        self, 
        images: List[np.ndarray], 
        query: Optional[str] = None, 
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        pass

class OpticalSARVisualizationBaseline(BaseOpticalSARFusion):
    """
    Classical Optical + SAR linear composite baseline.
    Preserved as a fast, honest reference baseline.
    """
    def __init__(
        self,
        water_intensity_threshold: float = 40.0,
        urban_intensity_threshold: float = 200.0
    ):
        super().__init__(
            model_name="OpticalSARVisualizationBaseline",
            implementation_status="baseline"
        )
        self.water_threshold = water_intensity_threshold
        self.urban_threshold = urban_intensity_threshold

    def predict(
        self, 
        images: List[np.ndarray], 
        query: Optional[str] = None, 
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        if len(images) < 2:
            raise ValueError("Optical+SAR analysis requires 2 images (Optical & SAR).")

        meta = metadata or {}
        meta_opt = meta.get("optical") or meta.get("primary", {})
        meta_sar = meta.get("sar") or meta.get("secondary", {})

        img_opt, img_sar = images[0], images[1]
        img_opt, img_sar_aligned, reg_info = align_image_pair(img_opt, img_sar, meta_opt, meta_sar)

        h, w = img_opt.shape[:2]
        opt_u8, _ = robust_remote_sensing_preprocess(img_opt, meta_opt, target_modality="OPTICAL")
        sar_u8, _ = robust_remote_sensing_preprocess(img_sar_aligned, meta_sar, target_modality="SAR")

        if opt_u8.ndim == 3 and opt_u8.shape[2] >= 3:
            opt_rgb = opt_u8[:, :, :3]
        else:
            gray_opt = opt_u8 if opt_u8.ndim == 2 else opt_u8[:, :, 0]
            opt_rgb = np.stack([gray_opt]*3, axis=-1)

        sar_gray = sar_u8 if sar_u8.ndim == 2 else sar_u8[:, :, 0]
        fused_rgb = (0.5 * opt_rgb.astype(float) + 0.5 * np.stack([sar_gray]*3, axis=-1).astype(float)).astype(np.uint8)

        fused_b64 = convert_array_to_base64_png(fused_rgb)

        answer = (
            f"Dual-modality Optical + SAR linear blend baseline generated across {w}x{h} scene. "
            f"Co-registration status: {reg_info.get('co_registered')}."
        )

        return {
            "answer": answer,
            "model_type": "visualization_baseline",
            "implementation_status": "baseline",
            "primary_model": "OpticalSARJointAnalysisProvider",
            "actual_model_used": "OpticalSARVisualizationBaseline",
            "fallback_used": True,
            "confidence": None,
            "confidence_label": "Not available (Visualization Baseline)",
            "models": [self.model_name],
            "registration_info": reg_info,
            "evidence": [
                {
                    "id": "ev_fused_scene",
                    "type": "fused",
                    "title": "50/50 Dual-Modality Linear Composite",
                    "description": "50/50 linear blend of optical RGB and SAR backscatter.",
                    "data_base64": fused_b64,
                    "statistics": {
                        "fusion_technique": "Linear Dual-Modality Visual Blend (Baseline)",
                        "scene_width": w,
                        "scene_height": h,
                        "co_registered": reg_info.get("co_registered")
                    }
                }
            ]
        }

class OpticalSARJointAnalysisProvider(BaseOpticalSARFusion):
    """
    Credible Optical + SAR Multimodal Joint Analysis Provider.
    
    Scientific Workflow:
    1. Separate normalization for Optical (surface reflectance) and SAR (microwave backscatter).
    2. Decibel (dB) scaling for SAR microwave intensity.
    3. Produces 3 distinct evidence products:
       - Optical RGB Reflectance
       - Calibrated SAR Backscatter (dB)
       - Cross-Modal Joint False Color Composite (R=SAR, G=Green/NIR, B=Blue)
    4. Generates physically grounded joint interpretation combining dielectric roughness & spectral albedo.
    """
    def __init__(self):
        super().__init__(
            model_name="OpticalSARJointAnalysisProvider",
            implementation_status="baseline"
        )

    def predict(
        self, 
        images: List[np.ndarray], 
        query: Optional[str] = None, 
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        if len(images) < 2:
            raise ValueError("Optical+SAR joint analysis requires 2 images (Optical & SAR).")

        meta = metadata or {}
        meta_opt = meta.get("optical") or meta.get("primary", {})
        meta_sar = meta.get("sar") or meta.get("secondary", {})

        img_opt, img_sar = images[0], images[1]
        img_opt, img_sar_aligned, reg_info = align_image_pair(img_opt, img_sar, meta_opt, meta_sar)

        h, w = img_opt.shape[:2]
        total_pixels = h * w

        polarization = meta_sar.get("polarization") or meta_sar.get("tags", {}).get("POLARIZATION", "VV")
        sensor_type = meta_sar.get("sensor") or meta_sar.get("tags", {}).get("SENSOR", "Sentinel-1 C-Band SAR")
        calib_status = meta_sar.get("calibration_status") or ("calibrated_backscatter" if any(k in str(meta_sar).lower() for k in ["sigma0", "gamma0", "calibrated"]) else "unverified_linear_dn")
        terrain_status = meta_sar.get("terrain_correction_status") or ("radiometrically_terrain_corrected" if any(k in str(meta_sar).lower() for k in ["terrain_corrected", "rtc"]) else "ellipsoid_geocoded_grd")

        calib_text = "Calibrated sigma-0 dB backscatter" if calib_status == "calibrated_backscatter" else "Unverified linear DN (empirical relative dB scaling)"
        terrain_text = "Radiometrically Terrain Corrected (RTC)" if terrain_status == "radiometrically_terrain_corrected" else "Ellipsoid Geocoded GRD (uncorrected for relief distortion)"

        # Step 1: Normalize modalities separately
        opt_u8, meta_opt_proc = robust_remote_sensing_preprocess(img_opt, meta_opt, target_modality="OPTICAL")
        sar_u8, meta_sar_proc = robust_remote_sensing_preprocess(img_sar_aligned, meta_sar, target_modality="SAR")

        # Optical RGB extraction
        if opt_u8.ndim == 3 and opt_u8.shape[2] >= 3:
            opt_rgb = opt_u8[:, :, :3]
        else:
            gray_opt = opt_u8 if opt_u8.ndim == 2 else opt_u8[:, :, 0]
            opt_rgb = np.stack([gray_opt]*3, axis=-1)

        # SAR extraction
        sar_gray = sar_u8 if sar_u8.ndim == 2 else sar_u8[:, :, 0]

        opt_b64 = convert_array_to_base64_png(opt_rgb)
        sar_b64 = convert_array_to_base64_png(sar_gray)

        # Step 2: Handle Display-Only Resizing (Missing Georeferencing / Unaligned Fallback)
        if reg_info.get("is_display_only") or not reg_info.get("alignment_valid", True):
            fused_rgb = (0.5 * opt_rgb.astype(float) + 0.5 * np.stack([sar_gray]*3, axis=-1).astype(float)).astype(np.uint8)
            fused_b64 = convert_array_to_base64_png(fused_rgb)

            answer = (
                f"Optical + SAR joint analysis rejected for geospatial calculation: Safe geospatial alignment could not be established. "
                f"Registration status: '{reg_info.get('registration_method')}'. "
                f"Display-only resizing cannot feed geospatial classification, spatial masks, or area calculations. "
                f"Visual preview provided for qualitative reference only."
            )

            return {
                "status": "unsupported",
                "analysis_status": "unsupported_alignment",
                "answer": answer,
                "model_type": "joint_analysis_baseline",
                "model_name": self.model_name,
                "primary_model": self.model_name,
                "actual_model_used": self.model_name,
                "fallback_used": False,
                "confidence": None,
                "confidence_label": "Not available (Display-Only Resizing - Geospatial Analysis Unsupported)",
                "water_pct": None,
                "urban_pct": None,
                "veg_pct": None,
                "registration_info": reg_info,
                "evidence": [
                    {
                        "id": "ev_optical_reflectance",
                        "type": "original",
                        "title": "Optical Scene (Display Preview)",
                        "description": "Optical raster preview (unaligned/display-only).",
                        "data_base64": opt_b64,
                        "statistics": {"modality": "OPTICAL"}
                    },
                    {
                        "id": "ev_sar_backscatter",
                        "type": "processed",
                        "title": "SAR Scene (Display Preview)",
                        "description": "SAR microwave preview (unaligned/display-only).",
                        "data_base64": sar_b64,
                        "statistics": {"modality": "SAR"}
                    },
                    {
                        "id": "ev_fused_scene",
                        "type": "fused",
                        "title": "Display-Only Resized Preview (Visualization Only)",
                        "description": "Display-only visual composite. Unaligned rasters cannot feed geospatial classification.",
                        "data_base64": fused_b64,
                        "statistics": {
                            "co_registered": False,
                            "registration_method": reg_info.get("registration_method"),
                            "geospatial_classification": "Unsupported"
                        }
                    }
                ],
                "optical_evidence": opt_b64,
                "sar_evidence": sar_b64,
                "fused_evidence": fused_b64,
                "limitations": [
                    "Safe geospatial alignment could not be established; rasters were resized for display preview only.",
                    "Display-only resizing cannot feed geospatial classification, spatial masks, or area calculations.",
                    "True remote sensing cross-sensor analysis requires valid geodetic CRS and affine geotransforms."
                ]
            }

        # Step 3: Handle Valid-Data Mask and Empty Intersection Check
        valid_mask = reg_info.get("valid_mask")
        valid_pixel_count = int(np.count_nonzero(valid_mask)) if valid_mask is not None else 0

        if valid_pixel_count == 0:
            answer = (
                f"Optical + SAR Multimodal Joint Analysis unsupported: The valid-data intersection between Optical and SAR rasters "
                f"is empty (0 valid intersecting pixels after excluding nodata, non-overlapping padding, and invalid values). "
                f"Geospatial land-cover indicator percentages and classification masks cannot be computed."
            )

            return {
                "status": "unsupported",
                "analysis_status": "unsupported_empty_intersection",
                "answer": answer,
                "model_type": "joint_analysis_baseline",
                "model_name": self.model_name,
                "primary_model": self.model_name,
                "actual_model_used": self.model_name,
                "fallback_used": False,
                "confidence": None,
                "confidence_label": "Not available (Empty Valid-Data Intersection)",
                "valid_pixel_count": 0,
                "water_pct": None,
                "urban_pct": None,
                "veg_pct": None,
                "registration_info": reg_info,
                "evidence": [
                    {
                        "id": "ev_optical_reflectance",
                        "type": "original",
                        "title": "Optical Scene",
                        "description": "Optical raster.",
                        "data_base64": opt_b64,
                        "statistics": {"modality": "OPTICAL"}
                    },
                    {
                        "id": "ev_sar_backscatter",
                        "type": "processed",
                        "title": "SAR Scene",
                        "description": "SAR microwave raster.",
                        "data_base64": sar_b64,
                        "statistics": {"modality": "SAR"}
                    }
                ],
                "optical_evidence": opt_b64,
                "sar_evidence": sar_b64,
                "fused_evidence": None,
                "limitations": [
                    "Valid-data footprint intersection contains 0 valid pixels across both sensors (overlapping pixels were nodata or unmapped padding).",
                    "Heuristic coverage percentages were not calculated to avoid misleading statistics."
                ]
            }

        # Step 4: Cross-modal false-color composite on valid pixels
        joint_composite = np.zeros((h, w, 3), dtype=np.uint8)
        joint_composite[:, :, 0] = np.where(valid_mask, sar_gray, 0)
        joint_composite[:, :, 1] = np.where(valid_mask, opt_rgb[:, :, 1], 0)
        joint_composite[:, :, 2] = np.where(valid_mask, opt_rgb[:, :, 2], 0)

        # Step 5: Compute joint preliminary scene-normalized heuristic indicators
        # Strictly restricted to the shared valid-data mask
        opt_mean_2d = np.mean(opt_rgb, axis=-1)

        # Specular water proxy: Low Optical Reflectance (< 60) AND Low SAR Backscatter (< 45) within valid mask
        specular_water = np.logical_and(valid_mask, np.logical_and(opt_mean_2d < 60, sar_gray < 45))
        water_px = int(np.count_nonzero(specular_water))

        # Structural / Urban double-bounce proxy: Moderate-to-High Optical (> 80) AND High SAR Backscatter (> 190) within valid mask
        double_bounce_urban = np.logical_and(valid_mask, np.logical_and(opt_mean_2d > 80, sar_gray > 190))
        urban_px = int(np.count_nonzero(double_bounce_urban))

        # Vegetated canopy proxy: High Optical Green (> 90) AND Moderate SAR Backscatter (60 to 160) within valid mask
        canopy_veg = np.logical_and(valid_mask, np.logical_and(opt_rgb[:, :, 1] > 90, np.logical_and(sar_gray >= 60, sar_gray <= 160)))
        veg_px = int(np.count_nonzero(canopy_veg))

        # Percentages are computed strictly against valid_pixel_count (never unmapped padding or full scene)
        water_pct = round((water_px / valid_pixel_count) * 100.0, 2)
        urban_pct = round((urban_px / valid_pixel_count) * 100.0, 2)
        veg_pct = round((veg_px / valid_pixel_count) * 100.0, 2)

        # Radiometric averages computed strictly across valid pixels
        mean_opt = float(np.mean(opt_rgb[valid_mask]))
        mean_sar = float(np.mean(sar_gray[valid_mask]))

        # Step 6: Encode evidence artifacts
        joint_b64 = convert_array_to_base64_png(joint_composite)

        # Specular water mask: strictly inside valid_mask
        sar_water_mask = np.where(specular_water, 255, 0).astype(np.uint8)
        sar_water_b64 = convert_array_to_base64_png(sar_water_mask)

        valid_coverage_pct = round((valid_pixel_count / max(1, total_pixels)) * 100.0, 1)

        answer = (
            f"Optical + SAR Multimodal Joint Analysis completed across {w}x{h} scene "
            f"({valid_pixel_count:,} valid intersecting pixels; {valid_coverage_pct:.1f}% valid mutual footprint). "
            f"Joint analysis combines optical surface reflectance (mean albedo: {mean_opt:.1f}) with {sensor_type} radar backscatter "
            f"({polarization} polarization, {calib_text}, {terrain_text}, mean intensity: {mean_sar:.1f}). "
            f"Preliminary Scene-Normalized Heuristic Indicators (relative empirical proxies, NOT certified physical land-cover classifications): "
            f"(1) Specular Water / Low-Scatter Candidate Proxy: {water_pct:.2f}% of valid footprint ({water_px:,} px with joint low optical albedo & low radar return); "
            f"(2) Structural / High-Scatter Candidate Proxy: {urban_pct:.2f}% of valid footprint ({urban_px:,} px with high radar backscatter); "
            f"(3) Vegetated Canopy / Diffuse Candidate Proxy: {veg_pct:.2f}% of valid footprint ({veg_px:,} px). "
            f"Spatial co-registration status: {reg_info.get('co_registered')} ({reg_info.get('registration_method')})."
        )

        evidence = [
            {
                "id": "ev_optical_reflectance",
                "type": "original",
                "title": "Optical Scene (Surface Reflectance)",
                "description": f"Preprocessed optical raster ({w}x{h} px, CRS: {meta_opt.get('crs_display', 'CRS unavailable')}).",
                "data_base64": opt_b64,
                "statistics": {
                    "modality": "OPTICAL",
                    "mean_albedo": round(mean_opt, 1),
                    "bands": opt_rgb.shape[2]
                }
            },
            {
                "id": "ev_sar_backscatter",
                "type": "processed",
                "title": f"SAR Scene ({sensor_type} Microwave Backscatter)",
                "description": f"Decibel-scaled microwave intensity map ({polarization} polarization, {calib_text}, {terrain_text}).",
                "data_base64": sar_b64,
                "statistics": {
                    "modality": "SAR",
                    "polarization": polarization,
                    "calibration_status": calib_status,
                    "terrain_correction_status": terrain_status,
                    "mean_backscatter_intensity": round(mean_sar, 1)
                }
            },
            {
                "id": "ev_joint_fused",
                "type": "fused",
                "title": "Cross-Modal False Color Composite (R=SAR, G=NIR/Green, B=Blue)",
                "description": "Multimodal fusion combining radar surface roughness (Red channel) with optical spectral bands (Green & Blue channels).",
                "data_base64": joint_b64,
                "statistics": {
                    "fusion_type": "Radiometric Cross-Modal Composite",
                    "heuristic_water_indicator": f"{water_pct:.2f}% (preliminary scene-normalized proxy)",
                    "heuristic_structural_indicator": f"{urban_pct:.2f}% (preliminary scene-normalized proxy)",
                    "heuristic_canopy_indicator": f"{veg_pct:.2f}% (preliminary scene-normalized proxy)",
                    "valid_footprint_pixels": valid_pixel_count,
                    "total_scene_pixels": total_pixels,
                    "classification_type": "Preliminary Scene-Normalized Heuristic (Non-Calibrated)",
                    "co_registered": reg_info.get("co_registered"),
                    "registration_method": reg_info.get("registration_method")
                }
            },
            {
                "id": "ev_sar_specular_mask",
                "type": "mask",
                "title": "SAR Specular Water / Smooth Surface Indicator Mask",
                "description": "Empirical joint low-intensity radar backscatter (< 45 DN) and optical albedo mask (< 60 DN) evaluated strictly within the valid mutual data footprint.",
                "data_base64": sar_water_b64,
                "statistics": {
                    "specular_pixels": water_px,
                    "valid_footprint_pixels": valid_pixel_count,
                    "specular_area_percent": f"{water_pct:.2f}% (of valid footprint)",
                    "polarization": polarization,
                    "classification_status": "Preliminary Scene-Normalized Heuristic Indicator (Non-Calibrated)"
                }
            }
        ]

        limitations = [
            "Preliminary heuristic indicators: Thresholds applied to per-scene 8-bit percentile-stretched imagery are preliminary scene-normalized empirical proxies, not calibrated physical measurements or certified land-cover classifications.",
            "Heuristic indicator percentages are calculated strictly across valid intersecting pixels and must not be interpreted as authoritative physical coverage.",
            "No trained machine learning model or deep neural network is executed; this provider implements a deterministic radiometric composite and empirical thresholding pipeline.",
            "Optical surface reflectance (spectral albedo) and SAR microwave backscatter (roughness/dielectric return) are physically non-interchangeable remote sensing measurements.",
            "Radiometric calibration coefficients (sigma0/gamma0) and incidence angle look-up tables are required for absolute quantitative backscatter modeling." if calib_status != "calibrated_backscatter" else "Absolute quantitative backscatter calibrated using verified product calibration tags.",
            "Ellipsoid-projected SAR rasters without DEM-based Radiometric Terrain Correction (RTC) may exhibit geometric layover and foreshortening in undulating terrain." if terrain_status != "radiometrically_terrain_corrected" else "Product verified with Radiometric Terrain Correction (RTC)."
        ]

        return {
            "answer": answer,
            "model_type": "joint_analysis_baseline",
            "model_name": self.model_name,
            "primary_model": self.model_name,
            "actual_model_used": self.model_name,
            "fallback_used": False,
            "model_status": "loaded",
            "implementation_status": "baseline",
            "confidence": None,
            "confidence_label": "Not available (Preliminary Scene-Normalized Heuristic Baseline)",
            "water_pct": water_pct,
            "urban_pct": urban_pct,
            "veg_pct": veg_pct,
            "valid_pixel_count": valid_pixel_count,
            "total_pixels": total_pixels,
            "models": [self.model_name],
            "registration_info": reg_info,
            "evidence": evidence,
            "optical_evidence": opt_b64,
            "sar_evidence": sar_b64,
            "fused_evidence": joint_b64,
            "limitations": limitations,
            "model_provenance": {
                "primary_model": self.model_name,
                "actual_model_used": self.model_name,
                "fallback_used": False,
                "polarization": polarization,
                "sensor": sensor_type,
                "calibration_status": calib_status,
                "terrain_correction_status": terrain_status
            }
        }

class OpticalSARProvider(BaseModel):
    """
    Optical + SAR Multimodal Provider Orchestrator.
    Manages selection between OpticalSARJointAnalysisProvider and OpticalSARVisualizationBaseline.
    """
    def __init__(self):
        super().__init__(
            model_name="OpticalSARProvider",
            task_type="optical_sar",
            implementation_status="baseline",
            is_trained=False,
            is_remote_sensing_adapted=True
        )
        self.joint_analyzer = OpticalSARJointAnalysisProvider()
        self.vis_baseline = OpticalSARVisualizationBaseline()

    def predict(
        self, 
        images: List[np.ndarray], 
        query: Optional[str] = None, 
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        res = self.joint_analyzer.predict(images, query, metadata)
        res["models"] = [self.model_name, self.joint_analyzer.model_name]
        return res

# Backwards compatibility alias
OpticalSARAnalyzer = OpticalSARJointAnalysisProvider
