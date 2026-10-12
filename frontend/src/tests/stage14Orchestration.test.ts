import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { 
  AnalysisRequest,
  AnalysisResponse,
  ReportProvenance,
  ScientificReport,
  TemporalOpticalChangePayload,
  TemporalSARChangePayload,
  ExecutionTraceStep
} from '../types/index.ts';

describe('Stage 14: Dynamic Multi-Step Agent Orchestration and Multimodal Temporal Analysis Tests', () => {

  test('validates AnalysisRequest supports orchestration and temporal modes with optional images', () => {
    const req1: AnalysisRequest = {
      query: 'Analyze vegetation change in Mumbai between 2023-01-01 and 2024-01-01',
      mode: 'orchestration',
      images: []
    };
    assert.equal(req1.mode, 'orchestration');
    assert.deepEqual(req1.images, []);

    const req2: AnalysisRequest = {
      query: 'Evaluate SAR canopy change in Delhi from 2023 to 2024',
      mode: 'temporal'
    };
    assert.equal(req2.mode, 'temporal');
    assert.equal(req2.images, undefined);
  });

  test('validates AnalysisResponse parses ambiguity clarification prompt and guidance', () => {
    const resp: AnalysisResponse = {
      id: 'orch_clarify_001',
      task: 'temporal_multimodal_clarification',
      mode: 'orchestration',
      answer: 'Clarification required: Missing spatial location and temporal date range.',
      confidence: 0.2,
      confidence_label: 'Ambiguous Query - Clarification Required',
      models: ['MultiStepOrchestrator'],
      evidence: [],
      trace: {
        task: 'temporal_multimodal_clarification',
        models_selected: ['MultiStepOrchestrator'],
        steps: [],
        parameters: {},
        execution_time_ms: 15.2
      },
      execution_time_ms: 15.2,
      created_at: '2026-10-12T12:00:00Z',
      is_clarification_required: true,
      missing_parameters: ['spatial_location', 'temporal_date_range'],
      suggested_examples: [
        'Analyze vegetation change in Mumbai between 2023-01-01 and 2024-01-01',
        'Evaluate Sentinel-1 SAR change in Delhi between January 2023 and March 2024'
      ]
    };

    assert.equal(resp.is_clarification_required, true);
    assert.ok(resp.missing_parameters?.includes('spatial_location'));
    assert.ok(resp.missing_parameters?.includes('temporal_date_range'));
    assert.equal(resp.suggested_examples?.length, 2);
  });

  test('validates Sentinel-2 bi-temporal optical change telemetry contract', () => {
    const optChange: TemporalOpticalChangePayload = {
      status: 'success',
      is_calibrated: true,
      summary: 'Temporal Sentinel-2 optical change analysis computed across 15,200 joint clear pixels.',
      delta_ndvi_mean: -0.0482,
      delta_ndvi_median: -0.0410,
      delta_ndvi_p10: -0.1820,
      delta_ndvi_p90: 0.0810,
      delta_ndvi_std: 0.0950,
      ndvi_t1_mean: 0.5820,
      ndvi_t2_mean: 0.5338,
      vegetation_loss_pct: 14.8,
      vegetation_gain_pct: 6.2,
      stable_vegetation_pct: 79.0,
      loss_pixel_count: 2250,
      gain_pixel_count: 942,
      stable_pixel_count: 12008,
      loss_threshold: -0.15,
      gain_threshold: 0.15,
      joint_valid_pixel_count: 15200,
      total_pixel_count: 16384,
      joint_clearance_pct: 92.8,
      colorized_preview_base64: 'data:image/png;base64,mockpreview',
      t1_datetime: '2023-01-15T05:30:00Z',
      t2_datetime: '2024-01-15T05:30:00Z',
      scl_filtering_applied: true,
      scientific_limitations: [
        'Scene Classification Layer (SCL) atmospheric filtering applied to both T1 and T2: cloud, shadow, and cirrus pixels excluded.'
      ]
    };

    assert.equal(optChange.status, 'success');
    assert.equal(optChange.scl_filtering_applied, true);
    assert.equal(optChange.delta_ndvi_mean, -0.0482);
    assert.equal(optChange.vegetation_loss_pct, 14.8);
    assert.equal(optChange.vegetation_gain_pct, 6.2);
    assert.equal(optChange.joint_valid_pixel_count, 15200);
  });

  test('validates Sentinel-1 RTC bi-temporal SAR change telemetry and assumption violation tracking', () => {
    const sarChange: TemporalSARChangePayload = {
      status: 'success',
      is_calibrated: true,
      summary: 'Temporal Sentinel-1 RTC dual-pol change computed across 16,384 valid pixels.',
      delta_dprvi_mean: -0.0350,
      delta_dprvi_median: -0.0310,
      delta_dprvi_p10: -0.1650,
      delta_dprvi_p90: 0.0920,
      radar_canopy_loss_pct: 11.2,
      radar_canopy_gain_pct: 5.8,
      stable_canopy_pct: 83.0,
      delta_vv_db: -1.20,
      delta_vh_db: -1.85,
      t1_dprvi_mean: 0.5400,
      t2_dprvi_mean: 0.5050,
      dprvi_assumption_violations: {
        t1_violations: {
          assumption_violation_count: 24,
          assumption_violation_pct: 0.15,
          flagged_unphysical_q: true
        },
        t2_violations: {
          assumption_violation_count: 18,
          assumption_violation_pct: 0.11,
          flagged_unphysical_q: true
        }
      },
      polarization_mode: 'DUAL_VV_VH',
      calibration_quantity: 'rtc_gamma0_linear_power',
      sar_terrain_layover_shadow_mask: 'unavailable_from_stac_provider',
      scientific_limitations: [
        'Terrain layover and shadow masks are unavailable from the STAC provider; topographic relief shadows are not masked.',
        'Mandal et al. (2020) dominant co-polarized power assumption violations (q > 1.0) were flagged and clipped to 1.0.'
      ]
    };

    assert.equal(sarChange.polarization_mode, 'DUAL_VV_VH');
    assert.equal(sarChange.sar_terrain_layover_shadow_mask, 'unavailable_from_stac_provider');
    assert.equal(sarChange.dprvi_assumption_violations?.t1_violations?.flagged_unphysical_q, true);
    assert.equal(sarChange.delta_vv_db, -1.20);
    assert.equal(sarChange.delta_vh_db, -1.85);
  });

  test('validates multi-step execution trace DAG structure and transfer budget telemetry', () => {
    const traceSteps: ExecutionTraceStep[] = [
      {
        step_number: 1,
        tool: 'stac_composite_retrieve',
        status: 'completed',
        latency_ms: 24.5,
        summary: 'Acquire Pre-Event (T1) Sentinel-2 optical composite with SCL'
      },
      {
        step_number: 2,
        tool: 'stac_composite_retrieve',
        status: 'completed',
        latency_ms: 22.1,
        summary: 'Acquire Post-Event (T2) Sentinel-2 optical composite with SCL'
      },
      {
        step_number: 3,
        tool: 'temporal_optical_change',
        status: 'completed',
        latency_ms: 18.2,
        summary: 'Compute bi-temporal Sentinel-2 optical change and SCL filtering'
      }
    ];

    const resp: AnalysisResponse = {
      id: 'orch_trace_001',
      task: 'temporal_optical_change',
      mode: 'orchestration',
      answer: 'Temporal Sentinel-2 optical change analysis complete.',
      confidence: 0.95,
      confidence_label: 'Deterministic Verified',
      models: ['MultiStepOrchestrator'],
      evidence: [],
      execution_time_ms: 64.8,
      created_at: '2026-10-12T12:00:00Z',
      trace: {
        task: 'temporal_optical_change',
        models_selected: ['MultiStepOrchestrator'],
        steps: [
          { step_name: 'QUERY_PARSED', details: 'Spatial: Mumbai, Dates: 2023 to 2024', timestamp: '2026-10-12T12:00:00Z', status: 'completed' },
          { step_name: 'PLAN_FORMULATED', details: 'Formulated 3 execution steps', timestamp: '2026-10-12T12:00:01Z', status: 'completed' },
          { step_name: 'TOOL_STAC_COMPOSITE_RETRIEVE', details: 'Acquired T1', timestamp: '2026-10-12T12:00:02Z', status: 'completed' },
          { step_name: 'TOOL_STAC_COMPOSITE_RETRIEVE', details: 'Acquired T2', timestamp: '2026-10-12T12:00:03Z', status: 'completed' },
          { step_name: 'TOOL_TEMPORAL_OPTICAL_CHANGE', details: 'Computed change', timestamp: '2026-10-12T12:00:04Z', status: 'completed' }
        ],
        parameters: {},
        execution_time_ms: 64.8,
        execution_steps: traceSteps,
        cumulative_transfer_bytes: 4587520,
        transfer_budget_bytes: 20971520
      }
    };

    assert.equal(resp.trace?.execution_steps?.length, 3);
    assert.equal(resp.trace?.cumulative_transfer_bytes, 4587520);
    assert.equal(resp.trace?.transfer_budget_bytes, 20971520);
    assert.ok(resp.trace!.cumulative_transfer_bytes! <= resp.trace!.transfer_budget_bytes!);
  });

  test('validates scientific report provenance preserves temporal multimodal sections', () => {
    const prov: ReportProvenance = {
      provider: 'Sentinel-2 L2A & Sentinel-1 RTC Multimodal Catalog',
      modality: 'MULTIMODAL',
      temporal_optical_provenance: {
        t1_collection: 'sentinel-2-l2a',
        t2_collection: 'sentinel-2-l2a',
        t1_datetime: '2023-01-15T05:30:00Z',
        t2_datetime: '2024-01-15T05:30:00Z',
        scl_atmospheric_mask_applied: true,
        joint_clear_pixel_count: 15200,
        delta_ndvi_formula: 'Delta-NDVI = NDVI_T2 - NDVI_T1, where NDVI = (B08 - B04) / (B08 + B04)'
      },
      temporal_sar_provenance: {
        t1_collection: 'sentinel-1-rtc',
        t2_collection: 'sentinel-1-rtc',
        t1_datetime: '2023-01-10T00:43:12Z',
        t2_datetime: '2024-01-10T00:43:12Z',
        polarization: 'DUAL_VV_VH',
        calibration_quantity: 'rtc_gamma0_linear_power',
        sar_terrain_layover_shadow_mask: 'unavailable_from_stac_provider',
        delta_dprvi_formula: 'Delta-DpRVI = DpRVI_T2 - DpRVI_T1, where DpRVI = (q * (q + 3)) / ((q + 1) ** 2)'
      }
    };

    assert.equal(prov.temporal_optical_provenance?.scl_atmospheric_mask_applied, true);
    assert.equal(prov.temporal_sar_provenance?.sar_terrain_layover_shadow_mask, 'unavailable_from_stac_provider');
    assert.equal(prov.temporal_sar_provenance?.polarization, 'DUAL_VV_VH');
  });

  test('validates blocked, retrying, and failed execution trace step statuses', () => {
    const steps: ExecutionTraceStep[] = [
      {
        step_number: 1,
        tool: 'stac_composite_retrieve',
        status: 'retrying',
        latency_ms: 50.0,
        summary: 'Retrying transient connection failure'
      },
      {
        step_number: 2,
        tool: 'temporal_optical_change',
        status: 'blocked',
        latency_ms: 0.0,
        summary: 'Blocked due to upstream retrieval failure',
        error: 'Missing upstream rasters'
      },
      {
        step_number: 3,
        tool: 'deterministic_verifier',
        status: 'failed',
        latency_ms: 12.0,
        summary: 'Verification failed'
      }
    ];

    assert.equal(steps[0].status, 'retrying');
    assert.equal(steps[1].status, 'blocked');
    assert.equal(steps[2].status, 'failed');
    assert.equal(steps[1].error, 'Missing upstream rasters');
  });

  test('validates optical-SAR cross-sensor fusion response structure', () => {
    const fusionResp: AnalysisResponse = {
      id: 'fusion_test_001',
      task: 'optical_sar',
      mode: 'orchestration',
      answer: 'Multimodal optical and SAR cross-sensor alignment and fusion completed successfully.',
      confidence: 0.95,
      confidence_label: 'Deterministic Verified',
      models: ['MultiStepOrchestrator', 'optical_sar_fusion'],
      evidence: [
        {
          id: 'ev_optical_sar_fused_composite',
          type: 'fused',
          title: 'Sentinel-2 & Sentinel-1 RTC Optical-SAR Cross-Sensor Composite',
          description: 'Co-registered multimodal optical surface reflectance and calibrated RTC SAR backscatter',
          data_base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
        }
      ],
      execution_time_ms: 120.0,
      created_at: '2026-10-12T12:00:00Z',
      trace: {
        task: 'optical_sar',
        models_selected: ['stac_composite_retrieve', 'optical_sar_fusion'],
        steps: [],
        parameters: {},
        execution_time_ms: 120.0,
        execution_steps: [
          { step_number: 1, tool: 'stac_composite_retrieve', status: 'completed', latency_ms: 40.0, summary: 'Acquire Optical' },
          { step_number: 2, tool: 'stac_composite_retrieve', status: 'completed', latency_ms: 45.0, summary: 'Acquire SAR' },
          { step_number: 3, tool: 'optical_sar_fusion', status: 'completed', latency_ms: 35.0, summary: 'Execute Fusion' }
        ],
        cumulative_transfer_bytes: 8192000,
        transfer_budget_bytes: 20971520
      }
    };

    assert.equal(fusionResp.task, 'optical_sar');
    assert.equal(fusionResp.trace.execution_steps?.length, 3);
    assert.equal(fusionResp.evidence[0].type, 'fused');
  });

});
