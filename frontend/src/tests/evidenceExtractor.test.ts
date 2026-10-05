import test from 'node:test';
import assert from 'node:assert';
import { extractStructuredEvidence } from '../utils/evidenceExtractor.ts';
import type { AnalysisResponse } from '../types/index.ts';

test('extractStructuredEvidence returns null when no response provided', () => {
  const result = extractStructuredEvidence(null);
  assert.strictEqual(result, null);
});

test('extractStructuredEvidence extracts BIT-CD change detection telemetry', () => {
  const mockResponse: AnalysisResponse = {
    id: 'test_resp_1',
    task: 'change_detection',
    mode: 'bitemporal',
    answer: 'Change detected in 21.88% of the scene.',
    confidence: null,
    confidence_label: 'Uncalibrated',
    models: ['BIT-CD'],
    actual_model_used: 'BIT-CD',
    primary_model: 'BIT-CD',
    fallback_used: false,
    implementation_status: 'real_model',
    evidence: [
      {
        id: 'ev_change_map',
        type: 'change_map',
        title: 'BIT-CD Neural Change Map',
        statistics: {
          changed_area_percent: '21.88%',
          changed_pixel_count: 14340,
        },
      },
      {
        id: 'ev_change_overlay',
        type: 'overlay',
        title: 'Overlay',
        boxes: [
          { xmin: 10, ymin: 10, xmax: 50, ymax: 50, label: 'Change Cluster' },
        ],
      },
    ],
    trace: {
      task: 'change_detection',
      models_selected: ['BIT-CD'],
      steps: [],
      parameters: {},
      execution_time_ms: 120,
    },
    metadata: {
      crs_display: 'EPSG:32644',
      width: 256,
      height: 256,
      modality: 'OPTICAL',
    },
    execution_time_ms: 120,
    created_at: new Date().toISOString(),
  };

  const evidence = extractStructuredEvidence(mockResponse);
  assert.notStrictEqual(evidence, null);
  assert.strictEqual(evidence?.task, 'change_detection');
  assert.strictEqual(evidence?.model_used, 'BIT-CD');
  assert.strictEqual(evidence?.fallback_used, false);
  assert.strictEqual(evidence?.bit_cd_change_detection?.changed_area_percent, '21.88%');
  assert.strictEqual(evidence?.bit_cd_change_detection?.change_clusters, 1);
  assert.strictEqual(evidence?.geospatial_metadata?.crs, 'EPSG:32644');
});

test('extractStructuredEvidence extracts OWL-ViT visual grounding telemetry', () => {
  const mockResponse: AnalysisResponse = {
    id: 'test_resp_2',
    task: 'grounding',
    mode: 'single',
    answer: 'Localized 2 ships.',
    confidence: null,
    confidence_label: 'Uncalibrated',
    models: ['google/owlvit-base-patch32'],
    actual_model_used: 'google/owlvit-base-patch32',
    primary_model: 'google/owlvit-base-patch32',
    fallback_used: false,
    implementation_status: 'real_model',
    evidence: [
      {
        id: 'ev_grounding_mask',
        type: 'mask',
        title: 'Grounding Mask',
        statistics: {
          grounded_area_percent: '4.50%',
          detection_count: 2,
        },
      },
      {
        id: 'ev_grounding_overlay',
        type: 'overlay',
        title: 'Overlay',
        boxes: [
          { xmin: 20, ymin: 30, xmax: 80, ymax: 90, label: 'ship', confidence: 0.9123 },
          { xmin: 100, ymin: 110, xmax: 150, ymax: 160, label: 'boat', confidence: 0.8542 },
        ],
      },
    ],
    trace: {
      task: 'grounding',
      models_selected: ['google/owlvit-base-patch32'],
      steps: [],
      parameters: {},
      execution_time_ms: 250,
    },
    metadata: {
      crs_display: 'EPSG:32643',
    },
    execution_time_ms: 250,
    created_at: new Date().toISOString(),
  };

  const evidence = extractStructuredEvidence(mockResponse);
  assert.notStrictEqual(evidence, null);
  assert.strictEqual(evidence?.task, 'grounding');
  assert.strictEqual(evidence?.model_used, 'google/owlvit-base-patch32');
  assert.strictEqual(evidence?.owlvit_visual_grounding?.detection_count, 2);
  assert.strictEqual(evidence?.owlvit_visual_grounding?.detections[0].label, 'ship');
  assert.strictEqual(evidence?.owlvit_visual_grounding?.detections[0].confidence, 0.9123);
});
