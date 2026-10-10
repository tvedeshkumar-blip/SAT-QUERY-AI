export type AnalysisMode = 'single' | 'optical_sar' | 'bitemporal';

export type TaskType = 
  | 'vqa' 
  | 'captioning' 
  | 'grounding' 
  | 'change_detection' 
  | 'change_vqa' 
  | 'optical_sar';

export interface BoundingBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  label?: string;
  confidence?: number | null;
}

export type AOIBounds = [number, number, number, number]; // [min_lon, min_lat, max_lon, max_lat] in EPSG:4326

export interface AOISelection {
  bounds: AOIBounds;
  label?: string;
  crossesAntimeridian: boolean;
  approxAreaKm2?: number;
}

export interface GeoTIFFMetadata {
  filename: string;
  crs: string | null;
  bounds: [number, number, number, number] | null;
  width: number;
  height: number;
  bands: number;
  dtype: string;
  nodata: number | null;
  modality: 'OPTICAL' | 'SAR' | 'MULTISPECTRAL' | 'UNKNOWN';
  acquisition_date?: string | null;
  sensor?: string | null;
}

export interface VisualEvidence {
  id: string;
  type: 'original' | 'processed' | 'overlay' | 'mask' | 'boxes' | 'change_map' | 'fused';
  title: string;
  description?: string;
  artifact_url?: string;
  data_base64?: string;
  boxes?: BoundingBox[];
  statistics?: Record<string, number | string>;
}

export interface TraceStep {
  step: string;
  timestamp: string;
  detail: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
}

export interface ExecutionTrace {
  task: TaskType;
  models_selected: string[];
  steps: TraceStep[];
  parameters: Record<string, any>;
  execution_time_ms: number;
}

export interface ConfidenceBreakdown {
  model_confidence?: number | null;
  evidence_confidence?: number | null;
  system_confidence?: number | null;
  evidence_quality?: Record<string, any>;
}

export interface ConflictInfo {
  conflict_detected: boolean;
  conflict_type?: string | null;
  conflict_details?: string | null;
  reanalysis_performed: boolean;
  reanalysis_tool?: string | null;
}

export interface AnalysisResponse {
  id: string;
  task: TaskType;
  mode: AnalysisMode;
  query?: string;
  answer: string;
  confidence: number | null;
  confidence_label: string; // e.g. "Calibrated 92%" or "Not available"
  models: string[];
  implementation_status?: string;
  primary_model?: string;
  actual_model_used?: string;
  fallback_used?: boolean;
  model_status?: string;
  model_provenance?: Record<string, any>;
  evidence: VisualEvidence[];
  trace: ExecutionTrace;
  metadata?: Record<string, any>;
  confidence_breakdown?: ConfidenceBreakdown;
  conflict_info?: ConflictInfo;
  verification?: VerificationResponse | null;
  execution_time_ms: number;
  created_at: string;
}

export type VerificationStatus = 'supported' | 'partially_supported' | 'unsupported' | 'not_run';
export type ClaimStatus = 'supported' | 'partially_supported' | 'unsupported' | 'contradicted';

export interface ClaimVerificationItem {
  claim_text: string;
  claim_type: string;
  status: ClaimStatus;
  cited_artifact_ids: string[];
  evidence_found?: string | null;
  reason?: string | null;
}

export interface VerificationResponse {
  verification_status: VerificationStatus;
  deterministic_passed: boolean;
  deterministic_failures?: string[];
  claims?: ClaimVerificationItem[];
  contradictions?: string[];
  unsupported_claims?: string[];
  missing_evidence?: string[];
  scientific_limitations?: string[];
  recommended_checks?: string[];
  summary_explanation: string;
  is_interpretive_only: boolean;
  interpretive_statement?: string;
  llm_model_used?: string | null;
  llm_run?: boolean;
  execution_time_ms?: number;
}

export interface PresetPhoto {
  id: string;
  title: string;
  mode: AnalysisMode;
  modality: string;
  sensor: string;
  description: string;
  imageUrl: string;
  imageUrlSecondary?: string; // For bi-temporal or optical/sar pairs
  sampleQueries: string[];
  metadata?: Partial<GeoTIFFMetadata>;
}

export interface BenchmarkResult {
  dataset: string;
  task: string;
  model: string;
  metric: string;
  score: string;
  date: string;
}

export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: string;
  status?: 'success' | 'unavailable' | 'error' | 'generating';
  model?: string;
  provider?: string;
  error?: string | null;
}

export interface ChatRequestPayload {
  message: string;
  conversation_id?: string;
  history?: { role: 'system' | 'user' | 'assistant'; content: string }[];
  evidence?: Record<string, any> | any[] | null;
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface ChatResponsePayload {
  response: string;
  model: string;
  provider: string;
  status: 'success' | 'unavailable' | 'error';
  conversation_id?: string;
  error?: string | null;
}

export interface ChatHealthResponse {
  status: 'online' | 'offline';
  available: boolean;
  provider: string;
  base_url: string;
  configured_model: string;
}

export interface STACAssetSummary {
  key: string;
  title?: string;
  type: string;
  roles: string[];
  category: 'visual_preview' | 'scientific_raster' | 'unsupported';
  href: string;
  size_bytes?: number;
}

export interface STACSceneSummary {
  id: string;
  collection: string;
  datetime: string;
  bbox: [number, number, number, number];
  cloud_cover?: number | null;
  modality: 'OPTICAL' | 'SAR';
  sensor: string;
  platform?: string;
  thumbnail_url?: string;
  assets: Record<string, STACAssetSummary>;
  provenance: Record<string, any>;
}

export interface STACSearchRequestPayload {
  bbox: [number, number, number, number];
  start_date?: string;
  end_date?: string;
  collection?: string;
  max_cloud_cover?: number;
  limit?: number;
}

export interface STACSearchResponsePayload {
  status: 'success' | 'zero_results' | 'error';
  provider: string;
  catalog_url: string;
  search_bbox: [number, number, number, number];
  search_datetime?: string;
  collection_requested: string;
  total_results: number;
  scenes: STACSceneSummary[];
  message?: string;
  error?: string;
}

export interface STACTaskCompatibility {
  status: 'supported' | 'supported_with_limitations' | 'rejected';
  reason: string;
}

export interface STACValidateAssetRequestPayload {
  scene_id?: string;
  asset_key?: string;
  filename?: string;
  data_base64?: string;
  provenance?: Record<string, any>;
}

export interface STACValidateAssetResponsePayload {
  status: 'valid' | 'invalid';
  filename: string;
  file_format: string;
  asset_category: 'visual_preview' | 'rgb_visual_raster' | 'single_band_spectral' | 'multispectral_cube' | 'unsupported';
  raster_metadata: Record<string, any>;
  scientific_status: 'calibrated_surface_reflectance' | 'calibrated_sar_backscatter' | 'visual_display_only' | 'unverified';
  analysis_compatibility: Record<string, STACTaskCompatibility>;
  scientific_limitations: string[];
  provenance: Record<string, any>;
  error?: string | null;
}

export interface STACRetrieveRequestPayload {
  scene_id: string;
  asset_key: string;
  collection?: string;
  target_role?: 'primary' | 'secondary' | 'optical' | 'sar';
}

export interface STACRetrieveResponsePayload {
  status: 'success' | 'error';
  scene_id: string;
  asset_key: string;
  category: 'visual_preview' | 'scientific_raster' | 'unsupported';
  filename: string;
  mime_type: string;
  size_bytes: number;
  data_base64: string;
  metadata: Record<string, any>;
  scientific_limitations: string[];
  validation?: STACValidateAssetResponsePayload;
  provenance?: Record<string, any>;
  error?: string;
}

export interface STACTemporalPairValidateRequestPayload {
  t1_scene_id?: string;
  t2_scene_id?: string;
  t1_asset_key?: string;
  t2_asset_key?: string;
  t1_filename?: string;
  t2_filename?: string;
  t1_data_base64?: string;
  t2_data_base64?: string;
  t1_provenance?: Record<string, any>;
  t2_provenance?: Record<string, any>;
  t1_metadata?: Record<string, any>;
  t2_metadata?: Record<string, any>;
  aoi_bbox?: [number, number, number, number];
}

export interface STACTemporalPairValidateResponsePayload {
  status: 'compatible' | 'compatible_with_limitations' | 'rejected';
  is_compatible: boolean;
  rejection_reason?: string | null;
  t1_validation?: STACValidateAssetResponsePayload;
  t2_validation?: STACValidateAssetResponsePayload;
  t1_datetime?: string | null;
  t2_datetime?: string | null;
  temporal_delta_days?: number | null;
  chronology_status: 'chronological' | 'inverted' | 'identical' | 'unknown';
  spatial_overlap_pct?: number | null;
  overlap_detected: boolean;
  crs_compatible: boolean;
  resolution_compatible: boolean;
  modality_compatible: boolean;
  co_registered: boolean;
  warnings: string[];
  scientific_limitations: string[];
  candidate_providers: string[];
  primary_provider: string;
  fallback_status: string;
  recommended_action: string;
}

export interface STACTemporalSearchRequestPayload {
  bbox: [number, number, number, number];
  t1_start_date: string;
  t1_end_date: string;
  t2_start_date: string;
  t2_end_date: string;
  collection?: string;
  max_cloud_cover?: number;
  limit?: number;
}

export interface STACTemporalSearchResponsePayload {
  status: 'success' | 'partial' | 'zero_results';
  provider: string;
  search_bbox: [number, number, number, number];
  t1_results: STACSearchResponsePayload;
  t2_results: STACSearchResponsePayload;
  temporal_delta_days_estimate?: number | null;
  message?: string;
}

export interface STACOpticalSARPairValidateRequestPayload {
  optical_scene_id?: string;
  sar_scene_id?: string;
  optical_asset_key?: string;
  sar_asset_key?: string;
  optical_filename?: string;
  sar_filename?: string;
  optical_data_base64?: string;
  sar_data_base64?: string;
  optical_provenance?: Record<string, any>;
  sar_provenance?: Record<string, any>;
  optical_metadata?: Record<string, any>;
  sar_metadata?: Record<string, any>;
  aoi_bbox?: [number, number, number, number];
}

export interface STACOpticalSARPairValidateResponsePayload {
  status: 'compatible' | 'compatible_with_limitations' | 'rejected';
  is_compatible: boolean;
  rejection_reason?: string | null;
  optical_validation?: STACValidateAssetResponsePayload;
  sar_validation?: STACValidateAssetResponsePayload;
  optical_datetime?: string | null;
  sar_datetime?: string | null;
  temporal_delta_days?: number | null;
  spatial_overlap_pct?: number | null;
  overlap_detected: boolean;
  crs_compatible: boolean;
  resolution_compatible: boolean;
  modality_compatible: boolean;
  co_registered: boolean;
  sar_polarization?: string;
  sar_sensor?: string;
  sar_calibration_status: 'calibrated_backscatter' | 'unverified_linear_dn' | 'rejected';
  sar_terrain_correction_status: 'radiometrically_terrain_corrected' | 'ellipsoid_geocoded_grd' | 'rejected';
  warnings: string[];
  scientific_limitations: string[];
  candidate_providers: string[];
  primary_provider: string;
  fallback_status: string;
  recommended_action: string;
}

export interface STACOpticalSARSearchRequestPayload {
  bbox: [number, number, number, number];
  optical_start_date?: string;
  optical_end_date?: string;
  sar_start_date?: string;
  sar_end_date?: string;
  max_cloud_cover?: number;
  limit?: number;
}

export interface STACOpticalSARSearchResponsePayload {
  status: 'success' | 'partial' | 'zero_results';
  provider: string;
  search_bbox: [number, number, number, number];
  optical_results: STACSearchResponsePayload;
  sar_results: STACSearchResponsePayload;
  temporal_delta_days_estimate?: number | null;
  message?: string;
}


