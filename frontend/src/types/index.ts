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
  execution_time_ms: number;
  created_at: string;
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
