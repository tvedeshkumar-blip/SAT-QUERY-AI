from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, field_validator

class STACSearchRequest(BaseModel):
    bbox: List[float] = Field(
        ..., 
        description="Bounding box in EPSG:4326 [min_lon, min_lat, max_lon, max_lat]",
        min_length=4, 
        max_length=4
    )
    start_date: Optional[str] = Field(None, description="Start date (YYYY-MM-DD or ISO 8601)")
    end_date: Optional[str] = Field(None, description="End date (YYYY-MM-DD or ISO 8601)")
    collection: Optional[str] = Field(
        default="sentinel-2-l2a", 
        description="Collection ID: 'sentinel-2-l2a' (Optical), 'sentinel-1-grd' (SAR), or 'all'"
    )
    max_cloud_cover: Optional[float] = Field(
        default=30.0, 
        ge=0.0, 
        le=100.0, 
        description="Maximum cloud cover percentage (0-100) for optical acquisitions"
    )
    limit: Optional[int] = Field(default=10, ge=1, le=50, description="Maximum number of scenes to return")

class STACAssetSummary(BaseModel):
    key: str = Field(..., description="Asset key, e.g. thumbnail, visual, red, vv, etc.")
    title: Optional[str] = Field(None, description="Human-readable title")
    type: str = Field(..., description="MIME type, e.g. image/jpeg, image/tiff")
    roles: List[str] = Field(default_factory=list, description="STAC asset roles")
    category: str = Field(
        default="unsupported",
        description="Scientific category: 'visual_preview', 'scientific_raster', or 'unsupported'"
    )
    href: str = Field(..., description="Safe asset URL or storage reference")
    size_bytes: Optional[int] = Field(None, description="Reported or estimated file size")

class STACSceneSummary(BaseModel):
    id: str = Field(..., description="Unique scene identifier")
    collection: str = Field(..., description="STAC collection name")
    datetime: str = Field(..., description="Acquisition timestamp in UTC")
    bbox: List[float] = Field(..., description="Scene bounding box [min_lon, min_lat, max_lon, max_lat]")
    geometry: Optional[Dict[str, Any]] = Field(None, description="Footprint GeoJSON geometry")
    cloud_cover: Optional[float] = Field(None, description="Cloud cover percentage (None for SAR)")
    modality: str = Field(..., description="Modality: OPTICAL or SAR")
    sensor: str = Field(..., description="Platform / sensor (e.g. Sentinel-2A, Sentinel-1A)")
    platform: Optional[str] = Field(None, description="Spacecraft platform")
    thumbnail_url: Optional[str] = Field(None, description="Direct URL to browse preview if available")
    assets: Dict[str, STACAssetSummary] = Field(default_factory=dict, description="Available assets")
    provenance: Dict[str, Any] = Field(default_factory=dict, description="Catalog provenance metadata")

class STACSearchResponse(BaseModel):
    status: str = Field(..., description="Search status: 'success', 'zero_results', or 'error'")
    provider: str = Field(default="Element84 Earth Search (AWS)")
    catalog_url: str = Field(default="https://earth-search.aws.element84.com/v1")
    search_bbox: List[float]
    search_datetime: Optional[str] = None
    collection_requested: str
    total_results: int
    scenes: List[STACSceneSummary] = Field(default_factory=list)
    message: Optional[str] = None
    error: Optional[str] = None

class STACTaskCompatibility(BaseModel):
    status: str = Field(..., description="'supported', 'supported_with_limitations', or 'rejected'")
    reason: str = Field(..., description="Explanation of compatibility or rejection cause")

class STACValidateAssetRequest(BaseModel):
    scene_id: Optional[str] = None
    asset_key: Optional[str] = None
    filename: Optional[str] = None
    data_base64: Optional[str] = Field(None, description="Base64 encoded asset payload or data URI")
    provenance: Optional[Dict[str, Any]] = Field(default_factory=dict)

class STACValidateAssetResponse(BaseModel):
    status: str = Field(..., description="'valid' or 'invalid'")
    filename: str
    file_format: str = Field(..., description="E.g. GeoTIFF, JPEG, PNG, UNKNOWN")
    asset_category: str = Field(
        ..., 
        description="'visual_preview', 'rgb_visual_raster', 'single_band_spectral', 'multispectral_cube', or 'unsupported'"
    )
    raster_metadata: Dict[str, Any] = Field(default_factory=dict)
    scientific_status: str = Field(
        default="unverified",
        description="'calibrated_surface_reflectance', 'calibrated_sar_backscatter', 'visual_display_only', or 'unverified'"
    )
    analysis_compatibility: Dict[str, STACTaskCompatibility] = Field(default_factory=dict)
    scientific_limitations: List[str] = Field(default_factory=list)
    provenance: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None

class STACRetrieveRequest(BaseModel):
    scene_id: str = Field(..., description="ID of the scene to retrieve")
    asset_key: str = Field(default="thumbnail", description="Asset key to fetch (e.g. thumbnail, visual)")
    collection: Optional[str] = Field(None, description="Collection name if known")
    target_role: Optional[str] = Field(default="primary", description="Workspace role: primary, secondary, optical, sar")

class STACWindowedRetrieveRequest(BaseModel):
    scene_id: str = Field(..., description="ID of the scene to retrieve")
    asset_key: str = Field(..., description="Asset key to fetch (e.g. B04, vv, visual)")
    aoi_bbox: List[float] = Field(
        ...,
        description="Bounding box in EPSG:4326 [min_lon, min_lat, max_lon, max_lat]",
        min_length=4,
        max_length=4
    )
    collection: Optional[str] = Field(None, description="Collection name if known")
    target_role: Optional[str] = Field(default="primary", description="Workspace role: primary, secondary, optical, sar")
    asset_url: Optional[str] = Field(None, description="Direct asset URL if already known from search")
    max_bytes: Optional[int] = Field(None, description="Optional custom byte limit <= safety limit")

    @field_validator("aoi_bbox")
    @classmethod
    def validate_aoi_bbox(cls, v: List[float]) -> List[float]:
        if len(v) != 4:
            raise ValueError("aoi_bbox must have exactly 4 coordinates [min_lon, min_lat, max_lon, max_lat]")
        min_lon, min_lat, max_lon, max_lat = v
        if min_lat > max_lat:
            raise ValueError("Invalid AOI bbox: min_lat cannot be greater than max_lat.")
        if not (-90.0 <= min_lat <= 90.0 and -90.0 <= max_lat <= 90.0):
            raise ValueError("Latitude values must be between -90 and 90 degrees.")
        if not (-180.0 <= min_lon <= 180.0 and -180.0 <= max_lon <= 180.0):
            raise ValueError("Longitude values must be between -180 and 180 degrees.")
        return v


class STACRetrieveResponse(BaseModel):
    status: str = Field(..., description="Retrieval status: 'success' or 'error'")
    scene_id: str
    asset_key: str
    category: str = Field(..., description="'visual_preview', 'scientific_raster', or 'unsupported'")
    filename: str
    mime_type: str
    size_bytes: int
    data_base64: str = Field(..., description="Base64 encoded data ready for display/workspace ingestion")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Extracted raster / image metadata")
    scientific_limitations: List[str] = Field(
        default_factory=list, 
        description="Explicit caveats regarding scientific readiness (e.g. browse preview vs calibrated raster)"
    )
    validation: Optional[STACValidateAssetResponse] = Field(
        default=None, 
        description="Comprehensive physical validation report including band count, CRS, and task compatibility"
    )
    provenance: Dict[str, Any] = Field(
        default_factory=dict, 
        description="STAC scene and asset catalog provenance metadata"
    )
    error: Optional[str] = None


class STACTemporalPairValidateRequest(BaseModel):
    t1_scene_id: Optional[str] = None
    t2_scene_id: Optional[str] = None
    t1_asset_key: Optional[str] = None
    t2_asset_key: Optional[str] = None
    t1_filename: Optional[str] = None
    t2_filename: Optional[str] = None
    t1_data_base64: Optional[str] = Field(None, description="T1 base64 image data or data URI")
    t2_data_base64: Optional[str] = Field(None, description="T2 base64 image data or data URI")
    t1_provenance: Optional[Dict[str, Any]] = Field(default_factory=dict)
    t2_provenance: Optional[Dict[str, Any]] = Field(default_factory=dict)
    t1_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)
    t2_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)
    aoi_bbox: Optional[List[float]] = Field(None, description="User selected AOI in [min_lon, min_lat, max_lon, max_lat]")


class STACTemporalPairValidateResponse(BaseModel):
    status: str = Field(..., description="'compatible', 'compatible_with_limitations', or 'rejected'")
    is_compatible: bool = Field(..., description="True only if temporal pair can be scientifically processed")
    rejection_reason: Optional[str] = Field(None, description="Explicit scientific cause if rejected")
    t1_validation: Optional[STACValidateAssetResponse] = None
    t2_validation: Optional[STACValidateAssetResponse] = None
    t1_datetime: Optional[str] = None
    t2_datetime: Optional[str] = None
    temporal_delta_days: Optional[float] = None
    chronology_status: str = Field(default="unknown", description="'chronological', 'inverted', 'identical', or 'unknown'")
    spatial_overlap_pct: Optional[float] = None
    overlap_detected: bool = False
    crs_compatible: bool = False
    resolution_compatible: bool = False
    modality_compatible: bool = False
    co_registered: bool = False
    warnings: List[str] = Field(default_factory=list)
    scientific_limitations: List[str] = Field(default_factory=list)
    candidate_providers: List[str] = Field(default_factory=list)
    primary_provider: str = Field(default="PixelDifferenceChangeBaseline")
    fallback_status: str = Field(default="Active fallback")
    recommended_action: str = Field(..., description="Actionable recommendation for the user or pipeline")


class STACTemporalSearchRequest(BaseModel):
    bbox: List[float] = Field(..., min_length=4, max_length=4, description="Bounding box in EPSG:4326")
    t1_start_date: str
    t1_end_date: str
    t2_start_date: str
    t2_end_date: str
    collection: Optional[str] = Field(default="sentinel-2-l2a")
    max_cloud_cover: Optional[float] = Field(default=30.0, ge=0.0, le=100.0)
    limit: Optional[int] = Field(default=6, ge=1, le=20)


class STACTemporalSearchResponse(BaseModel):
    status: str = Field(..., description="'success', 'partial', or 'zero_results'")
    provider: str = Field(default="Element84 Earth Search (AWS)")
    search_bbox: List[float]
    t1_results: STACSearchResponse
    t2_results: STACSearchResponse
    temporal_delta_days_estimate: Optional[float] = None
    message: Optional[str] = None


class STACOpticalSARPairValidateRequest(BaseModel):
    optical_scene_id: Optional[str] = None
    sar_scene_id: Optional[str] = None
    optical_asset_key: Optional[str] = None
    sar_asset_key: Optional[str] = None
    optical_filename: Optional[str] = None
    sar_filename: Optional[str] = None
    optical_data_base64: Optional[str] = Field(None, description="Optical base64 image data or data URI")
    sar_data_base64: Optional[str] = Field(None, description="SAR base64 image data or data URI")
    optical_provenance: Optional[Dict[str, Any]] = Field(default_factory=dict)
    sar_provenance: Optional[Dict[str, Any]] = Field(default_factory=dict)
    optical_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)
    sar_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)
    aoi_bbox: Optional[List[float]] = Field(None, description="Active AOI in [min_lon, min_lat, max_lon, max_lat]")


class STACOpticalSARPairValidateResponse(BaseModel):
    status: str = Field(..., description="'compatible', 'compatible_with_limitations', or 'rejected'")
    is_compatible: bool = Field(..., description="True only if Optical+SAR pair meets scientific cross-sensor criteria")
    rejection_reason: Optional[str] = Field(None, description="Explicit scientific cause if rejected")
    optical_validation: Optional[STACValidateAssetResponse] = None
    sar_validation: Optional[STACValidateAssetResponse] = None
    optical_datetime: Optional[str] = None
    sar_datetime: Optional[str] = None
    temporal_delta_days: Optional[float] = None
    spatial_overlap_pct: Optional[float] = None
    overlap_detected: bool = False
    crs_compatible: bool = False
    resolution_compatible: bool = False
    modality_compatible: bool = False
    co_registered: bool = False
    sar_polarization: Optional[str] = Field(default="VV", description="SAR polarization mode")
    sar_sensor: Optional[str] = Field(default="Sentinel-1", description="SAR platform / sensor")
    sar_calibration_status: str = Field(default="unverified_linear_dn", description="'calibrated_backscatter', 'unverified_linear_dn', or 'rejected'")
    sar_terrain_correction_status: str = Field(default="ellipsoid_geocoded_grd", description="'radiometrically_terrain_corrected', 'ellipsoid_geocoded_grd', or 'rejected'")
    warnings: List[str] = Field(default_factory=list)
    scientific_limitations: List[str] = Field(default_factory=list)
    candidate_providers: List[str] = Field(default_factory=list)
    primary_provider: str = Field(default="OpticalSARJointAnalysisProvider")
    fallback_status: str = Field(default="Loaded and ready")
    recommended_action: str = Field(..., description="Actionable recommendation for the user or pipeline")


class STACOpticalSARSearchRequest(BaseModel):
    bbox: List[float] = Field(..., min_length=4, max_length=4, description="Bounding box in EPSG:4326")
    optical_start_date: Optional[str] = None
    optical_end_date: Optional[str] = None
    sar_start_date: Optional[str] = None
    sar_end_date: Optional[str] = None
    max_cloud_cover: Optional[float] = Field(default=25.0, ge=0.0, le=100.0)
    limit: Optional[int] = Field(default=6, ge=1, le=20)


class STACOpticalSARSearchResponse(BaseModel):
    status: str = Field(..., description="'success', 'partial', or 'zero_results'")
    provider: str = Field(default="Element84 Earth Search (AWS)")
    search_bbox: List[float]
    optical_results: STACSearchResponse
    sar_results: STACSearchResponse
    temporal_delta_days_estimate: Optional[float] = None
    message: Optional[str] = None



