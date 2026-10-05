import type { AnalysisResponse } from '../types/index.ts';

/**
 * Extracts structured empirical telemetry from an active AnalysisResponse.
 * Strictly adheres to scientific integrity: extracts ONLY data that was
 * actually computed and present in the analysis response.
 */
export function extractStructuredEvidence(response: AnalysisResponse | null): Record<string, any> | null {
  if (!response) return null;

  const evidence: Record<string, any> = {
    task: response.task,
    mode: response.mode,
    model_selected: response.primary_model || response.models[0],
    model_used: response.actual_model_used || response.models[0],
    fallback_used: Boolean(response.fallback_used),
    confidence_label: response.confidence_label,
    execution_time_ms: response.execution_time_ms,
  };

  // 1. BIT-CD Neural Change Detection Evidence
  if (response.task === 'change_detection' || response.task === 'change_vqa') {
    const changeEv = response.evidence.find(
      (e) => e.type === 'change_map' || e.id === 'ev_change_map'
    );
    const overlayEv = response.evidence.find(
      (e) => e.type === 'overlay' || e.id === 'ev_change_overlay'
    );

    const changeData: Record<string, any> = {
      model_name: response.actual_model_used || 'BIT-CD',
      implementation_status: response.implementation_status,
      fallback_used: response.fallback_used,
    };

    if (changeEv?.statistics) {
      Object.assign(changeData, changeEv.statistics);
    }
    if (overlayEv?.boxes && overlayEv.boxes.length > 0) {
      changeData.change_clusters = overlayEv.boxes.length;
      changeData.sample_cluster_bounds = overlayEv.boxes.slice(0, 5).map((b) => ({
        label: b.label || 'Change Cluster',
        box: [b.xmin, b.ymin, b.xmax, b.ymax],
      }));
    }

    evidence.bit_cd_change_detection = changeData;
  }

  // 2. OWL-ViT Open-Vocabulary Grounding Evidence
  if (response.task === 'grounding') {
    const maskEv = response.evidence.find(
      (e) => e.type === 'mask' || e.id === 'ev_grounding_mask'
    );
    const overlayEv = response.evidence.find(
      (e) => e.type === 'overlay' || e.id === 'ev_grounding_overlay'
    );

    const groundingData: Record<string, any> = {
      model_name: response.actual_model_used || 'google/owlvit-base-patch32',
      implementation_status: response.implementation_status,
      fallback_used: response.fallback_used,
    };

    if (maskEv?.statistics) {
      Object.assign(groundingData, maskEv.statistics);
    }
    if (overlayEv?.boxes) {
      groundingData.detection_count = overlayEv.boxes.length;
      groundingData.detections = overlayEv.boxes.slice(0, 10).map((b) => ({
        label: b.label,
        confidence: b.confidence !== null && b.confidence !== undefined ? round(b.confidence, 4) : null,
        bbox: [b.xmin, b.ymin, b.xmax, b.ymax],
      }));
    }

    evidence.owlvit_visual_grounding = groundingData;
  }

  // 3. Spectral Indices & Radiometric Evidence
  const spectralEv = response.evidence.find(
    (e) => e.id === 'ev_spectral_profile' || e.type === 'processed'
  );
  if (spectralEv?.statistics && Object.keys(spectralEv.statistics).length > 0) {
    evidence.spectral_analysis = spectralEv.statistics;
  }

  // 4. Optical + SAR Joint Analysis Evidence
  if (response.task === 'optical_sar') {
    const fusedEv = response.evidence.find(
      (e) => e.type === 'fused' || e.id === 'ev_joint_fused'
    );
    const sarEv = response.evidence.find(
      (e) => e.id === 'ev_sar_backscatter'
    );

    evidence.optical_sar_joint = {
      model_name: response.actual_model_used,
      fused_statistics: fusedEv?.statistics || {},
      sar_backscatter: sarEv?.statistics || {},
    };
  }

  // 5. Geospatial & Sensor Metadata
  if (response.metadata && Object.keys(response.metadata).length > 0) {
    const m = response.metadata;
    evidence.geospatial_metadata = {
      crs: m.crs_display || m.crs || 'CRS unavailable',
      dimensions: m.width && m.height ? `${m.width}x${m.height}` : undefined,
      bands: m.bands,
      modality: m.modality,
      sensor: m.sensor,
    };
  }

  // 6. Conflict & Calibration Diagnostics
  if (response.conflict_info?.conflict_detected) {
    evidence.conflict_diagnostic = {
      conflict_type: response.conflict_info.conflict_type,
      conflict_details: response.conflict_info.conflict_details,
      reanalysis_performed: response.conflict_info.reanalysis_performed,
    };
  }

  return evidence;
}

function round(val: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}
