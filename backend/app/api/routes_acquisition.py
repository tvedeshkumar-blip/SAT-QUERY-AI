import os
import logging
from datetime import datetime
from fastapi import APIRouter, HTTPException
from app.schemas.acquisition import (
    STACSearchRequest, 
    STACSearchResponse, 
    STACRetrieveRequest, 
    STACRetrieveResponse,
    STACValidateAssetRequest,
    STACValidateAssetResponse,
    STACTemporalPairValidateRequest,
    STACTemporalPairValidateResponse,
    STACTemporalSearchRequest,
    STACTemporalSearchResponse,
    STACOpticalSARPairValidateRequest,
    STACOpticalSARPairValidateResponse,
    STACOpticalSARSearchRequest,
    STACOpticalSARSearchResponse
)
from app.acquisition.stac_service import stac_service
from app.acquisition.asset_validator import AssetValidator
from app.acquisition.temporal_validator import TemporalPairValidator
from app.acquisition.cross_sensor_validator import CrossSensorValidator

logger = logging.getLogger("satquery.api.acquisition")
router = APIRouter()

@router.post("/acquisition/search", response_model=STACSearchResponse)
def search_stac_scenes(request: STACSearchRequest):
    """
    Search satellite acquisitions across public STAC catalogs (Element84 Earth Search AWS)
    by AOI bounds, temporal window, cloud cover threshold, and sensor collection.
    """
    try:
        return stac_service.search(request)
    except Exception as e:
        logger.error(f"Error executing STAC catalog search: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/acquisition/retrieve", response_model=STACRetrieveResponse)
def retrieve_stac_asset(request: STACRetrieveRequest):
    """
    Safely download and inspect a validated satellite asset (visual preview or GeoTIFF)
    from a previously discovered scene. Enforces download size limits, trusted hosts,
    and returns base64 data for immediate workspace ingestion.
    """
    try:
        resp = stac_service.retrieve(request)
        if resp.status == "error":
            raise HTTPException(status_code=400, detail=resp.error or "Failed to retrieve asset.")
        return resp
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving STAC asset: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/acquisition/validate", response_model=STACValidateAssetResponse)
def validate_asset_endpoint(request: STACValidateAssetRequest):
    """
    Physically validates an imported or retrieved asset binary, checking file readability,
    band counts, dimensions, dtype, nodata, CRS, transform, scientific status,
    and analysis task compatibility.
    """
    try:
        data_or_path = request.data_base64
        filename = request.filename or "asset"

        # If data_base64 not provided, search local retrieval storage for the scene/asset
        if not data_or_path and request.scene_id:
            safe_prefix = f"{request.scene_id}_{request.asset_key or 'thumbnail'}"
            if os.path.exists(stac_service.retrieval_dir):
                for fname in os.listdir(stac_service.retrieval_dir):
                    if fname.startswith(safe_prefix):
                        data_or_path = os.path.join(stac_service.retrieval_dir, fname)
                        filename = fname
                        break

        # Also check local samples if local sample ID
        if not data_or_path and request.scene_id and request.scene_id.startswith("local_sample_"):
            name_part = request.scene_id.replace("local_sample_", "") + ".tif"
            sample_p = os.path.join(stac_service.samples_dir, name_part)
            if os.path.exists(sample_p):
                data_or_path = sample_p
                filename = name_part

        if not data_or_path:
            raise HTTPException(
                status_code=400, 
                detail="No asset payload or local file found to validate. Please provide data_base64 or valid scene_id."
            )

        report = AssetValidator.validate_asset(
            data_or_path, 
            filename=filename, 
            provenance=request.provenance
        )
        return report
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error validating asset: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/acquisition/validate-temporal-pair", response_model=STACTemporalPairValidateResponse)
def validate_temporal_pair_endpoint(request: STACTemporalPairValidateRequest):
    """
    Validates physical compatibility of two temporal candidate satellite assets
    prior to bi-temporal change detection inference.
    Inspects readability, CRS, dimensions, resolution, spatial overlap within AOI,
    modality, acquisition chronology, and cloud confounders.
    Strictly rejects browse-only preview assets (thumbnails) for change detection.
    """
    try:
        report = TemporalPairValidator.validate_pair(
            t1_input=request.t1_data_base64,
            t2_input=request.t2_data_base64,
            t1_filename=request.t1_filename,
            t2_filename=request.t2_filename,
            t1_provenance=request.t1_provenance or {"scene_id": request.t1_scene_id, "asset_key": request.t1_asset_key},
            t2_provenance=request.t2_provenance or {"scene_id": request.t2_scene_id, "asset_key": request.t2_asset_key},
            t1_metadata=request.t1_metadata,
            t2_metadata=request.t2_metadata,
            aoi_bbox=request.aoi_bbox,
            retrieval_dir=stac_service.retrieval_dir,
            samples_dir=stac_service.samples_dir
        )
        return report
    except Exception as e:
        logger.error(f"Error validating temporal pair: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/acquisition/search-temporal-pair", response_model=STACTemporalSearchResponse)
def search_temporal_pair_endpoint(request: STACTemporalSearchRequest):
    """
    Simultaneously queries satellite acquisitions across two distinct temporal windows
    (Pre-Event T1 and Post-Event T2) for the same AOI.
    """
    try:
        # Search T1
        req_1 = STACSearchRequest(
            bbox=request.bbox,
            start_date=request.t1_start_date,
            end_date=request.t1_end_date,
            collection=request.collection,
            max_cloud_cover=request.max_cloud_cover,
            limit=request.limit
        )
        t1_resp = stac_service.search(req_1)

        # Search T2
        req_2 = STACSearchRequest(
            bbox=request.bbox,
            start_date=request.t2_start_date,
            end_date=request.t2_end_date,
            collection=request.collection,
            max_cloud_cover=request.max_cloud_cover,
            limit=request.limit
        )
        t2_resp = stac_service.search(req_2)

        # Determine overall status
        if t1_resp.total_results > 0 and t2_resp.total_results > 0:
            status = "success"
            msg = f"Discovered {t1_resp.total_results} pre-event (T1) and {t2_resp.total_results} post-event (T2) candidate acquisitions."
        elif t1_resp.total_results > 0 or t2_resp.total_results > 0:
            status = "partial"
            msg = f"Partial match: T1 yielded {t1_resp.total_results} scene(s), T2 yielded {t2_resp.total_results} scene(s)."
        else:
            status = "zero_results"
            msg = "No satellite scenes found intersecting the active AOI in either temporal window."

        # Estimate delta days from median timestamps if available
        delta_days_est = None
        try:
            if t1_resp.scenes and t2_resp.scenes:
                d1 = datetime.fromisoformat(t1_resp.scenes[0].datetime.replace("Z", "+00:00"))
                d2 = datetime.fromisoformat(t2_resp.scenes[0].datetime.replace("Z", "+00:00"))
                delta_days_est = round(abs((d2 - d1).total_seconds()) / 86400.0, 1)
        except Exception:
            pass

        return STACTemporalSearchResponse(
            status=status,
            provider=t1_resp.provider or "Element84 Earth Search (AWS)",
            search_bbox=request.bbox,
            t1_results=t1_resp,
            t2_results=t2_resp,
            temporal_delta_days_estimate=delta_days_est,
            message=msg
        )
    except Exception as e:
        logger.error(f"Error executing temporal pair search: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/acquisition/validate-optical-sar-pair", response_model=STACOpticalSARPairValidateResponse)
def validate_optical_sar_pair_endpoint(request: STACOpticalSARPairValidateRequest):
    """
    Validates physical compatibility of an Optical reflectance scene and a SAR microwave backscatter scene
    prior to cross-sensor joint analysis.
    Inspects:
    1. Readability and raster data suitability (rejects browse previews / unprojected thumbnails).
    2. Modality verification (ensures exactly 1 Optical and 1 SAR; rejects optical+optical or sar+sar).
    3. Coordinate Reference System (CRS) matching and georeferencing.
    4. Mutual spatial footprint overlap (rejects 0% or <10% overlap).
    5. Resolution compatibility and temporal baseline separation.
    6. SAR product processing metadata (polarization, calibration status, terrain correction status).
    """
    try:
        report = CrossSensorValidator.validate_pair(
            optical_input=request.optical_data_base64,
            sar_input=request.sar_data_base64,
            optical_filename=request.optical_filename,
            sar_filename=request.sar_filename,
            optical_provenance=request.optical_provenance or {"scene_id": request.optical_scene_id, "asset_key": request.optical_asset_key},
            sar_provenance=request.sar_provenance or {"scene_id": request.sar_scene_id, "asset_key": request.sar_asset_key},
            optical_metadata=request.optical_metadata,
            sar_metadata=request.sar_metadata,
            aoi_bbox=request.aoi_bbox,
            retrieval_dir=stac_service.retrieval_dir,
            samples_dir=stac_service.samples_dir
        )
        return report
    except Exception as e:
        logger.error(f"Error validating optical+SAR cross-sensor pair: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/acquisition/search-optical-sar-pair", response_model=STACOpticalSARSearchResponse)
def search_optical_sar_pair_endpoint(request: STACOpticalSARSearchRequest):
    """
    Simultaneously queries satellite acquisitions across complementary sensor modalities:
    Optical (Sentinel-2 L2A BOA reflectance) and SAR (Sentinel-1 GRD microwave radar) for the same AOI.
    """
    try:
        # Search Optical (Sentinel-2 L2A)
        req_opt = STACSearchRequest(
            bbox=request.bbox,
            start_date=request.optical_start_date,
            end_date=request.optical_end_date,
            collection="sentinel-2-l2a",
            max_cloud_cover=request.max_cloud_cover,
            limit=request.limit
        )
        opt_resp = stac_service.search(req_opt)

        # Search SAR (Sentinel-1 GRD)
        req_sar = STACSearchRequest(
            bbox=request.bbox,
            start_date=request.sar_start_date,
            end_date=request.sar_end_date,
            collection="sentinel-1-grd",
            max_cloud_cover=None,
            limit=request.limit
        )
        sar_resp = stac_service.search(req_sar)

        # Determine overall status
        if opt_resp.total_results > 0 and sar_resp.total_results > 0:
            status = "success"
            msg = f"Discovered {opt_resp.total_results} Optical (Sentinel-2) and {sar_resp.total_results} SAR (Sentinel-1) candidate acquisitions for the active AOI."
        elif opt_resp.total_results > 0 or sar_resp.total_results > 0:
            status = "partial"
            msg = f"Partial cross-sensor match: Optical yielded {opt_resp.total_results} scene(s), SAR yielded {sar_resp.total_results} scene(s)."
        else:
            status = "zero_results"
            msg = "No satellite scenes found intersecting the active AOI in either sensor modality."

        # Estimate delta days between best candidates
        delta_days_est = None
        try:
            if opt_resp.scenes and sar_resp.scenes:
                d_opt = datetime.fromisoformat(opt_resp.scenes[0].datetime.replace("Z", "+00:00"))
                d_sar = datetime.fromisoformat(sar_resp.scenes[0].datetime.replace("Z", "+00:00"))
                delta_days_est = round(abs((d_sar - d_opt).total_seconds()) / 86400.0, 1)
        except Exception:
            pass

        return STACOpticalSARSearchResponse(
            status=status,
            provider=opt_resp.provider or "Element84 Earth Search (AWS)",
            search_bbox=request.bbox,
            optical_results=opt_resp,
            sar_results=sar_resp,
            temporal_delta_days_estimate=delta_days_est,
            message=msg
        )
    except Exception as e:
        logger.error(f"Error executing optical+SAR cross-sensor search: {e}")
        raise HTTPException(status_code=500, detail=str(e))



