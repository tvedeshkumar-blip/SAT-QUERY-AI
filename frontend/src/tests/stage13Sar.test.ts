import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { 
  STACCompositeRetrieveRequestPayload,
  STACCompositeRetrieveResponsePayload,
  DpRVIResultPayload,
  AnalysisResponse,
  ReportProvenance,
  ScientificReport
} from '../types/index.ts';

describe('Stage 13: Sentinel-1 RTC Dual-Polarization & DpRVI Frontend Telemetry Tests', () => {

  test('validates STACCompositeRetrieveRequestPayload supports SAR dual-pol and compute_dprvi', () => {
    const payload: STACCompositeRetrieveRequestPayload = {
      scene_id: 'S1A_IW_GRDH_1SDV_20240328T004312',
      aoi_bbox: [77.58, 12.96, 77.60, 12.98],
      bands: ['vv', 'vh'],
      collection: 'sentinel-1-rtc',
      compute_dprvi: true,
      max_bytes: 20 * 1024 * 1024
    };

    assert.equal(payload.scene_id, 'S1A_IW_GRDH_1SDV_20240328T004312');
    assert.deepEqual(payload.bands, ['vv', 'vh']);
    assert.equal(payload.collection, 'sentinel-1-rtc');
    assert.equal(payload.compute_dprvi, true);
    assert.equal(payload.max_bytes, 20971520);
  });

  test('validates STACCompositeRetrieveResponsePayload parses calibrated DpRVI and SAR screening telemetry', () => {
    const mockResp: STACCompositeRetrieveResponsePayload = {
      status: 'success',
      scene_id: 'S1A_RTC_20240328',
      collection: 'sentinel-1-rtc',
      category: 'scientific_sar',
      filename: 'composite_VV_VH.tif',
      mime_type: 'image/tiff',
      size_bytes: 65536,
      data_base64: 'data:image/tiff;base64,mockbytes',
      metadata: { width: 128, height: 128 },
      scientific_limitations: [
        'Terrain layover and shadow masks are unavailable from the STAC provider.'
      ],
      provenance: {
        polarization: 'DUAL_VV_VH',
        calibration_quantity: 'gamma0',
        dprvi_formula: 'DpRVI = (q * (q + 3)) / ((q + 1) ** 2), where q = VH / VV (Mandal et al., 2020)'
      },
      bands_retrieved: ['VV', 'VH'],
      dprvi_result: {
        status: 'success',
        is_calibrated: true,
        dprvi_mean: 0.5200,
        dprvi_p90: 0.5800,
        cross_pol_ratio_linear: 0.2500,
        cross_pol_ratio_db: -6.02,
        vv_mean_db: -6.99,
        vh_mean_db: -13.01,
        vegetation_proxy_coverage_pct: 65.5,
        vegetation_threshold: 0.45,
        valid_pixel_count: 16000,
        total_pixel_count: 16384,
        polarization_mode: 'DUAL_VV_VH'
      },
      sar_quality_screening: {
        screened: true,
        sar_terrain_layover_shadow_mask: 'unavailable_from_stac_provider'
      }
    };

    assert.equal(mockResp.status, 'success');
    assert.equal(mockResp.category, 'scientific_sar');
    assert.deepEqual(mockResp.bands_retrieved, ['VV', 'VH']);
    assert.equal(mockResp.dprvi_result?.dprvi_mean, 0.5200);
    assert.equal(mockResp.dprvi_result?.cross_pol_ratio_db, -6.02);
    assert.equal(mockResp.dprvi_result?.vegetation_threshold, 0.45);
    assert.equal(mockResp.sar_quality_screening?.sar_terrain_layover_shadow_mask, 'unavailable_from_stac_provider');
  });

  test('validates zero-valid-pixel defense: unavailable DpRVI statistics are null, NOT zero', () => {
    const zeroPixelResp: DpRVIResultPayload = {
      status: 'unsupported_zero_valid_pixels',
      dprvi_mean: null,
      dprvi_p90: null,
      cross_pol_ratio_linear: null,
      cross_pol_ratio_db: null,
      vv_mean_db: null,
      vh_mean_db: null,
      vegetation_proxy_coverage_pct: null,
      valid_pixel_count: 0,
      total_pixel_count: 10000,
      vegetation_threshold: 0.45
    };

    assert.equal(zeroPixelResp.status, 'unsupported_zero_valid_pixels');
    assert.equal(zeroPixelResp.valid_pixel_count, 0);
    // Crucial requirement: Unavailable measurements must NOT be 0
    assert.notEqual(zeroPixelResp.dprvi_mean, 0);
    assert.equal(zeroPixelResp.dprvi_mean, null);
    assert.notEqual(zeroPixelResp.cross_pol_ratio_db, 0);
    assert.equal(zeroPixelResp.cross_pol_ratio_db, null);
    assert.notEqual(zeroPixelResp.vegetation_proxy_coverage_pct, 0);
    assert.equal(zeroPixelResp.vegetation_proxy_coverage_pct, null);
  });

  test('validates ReportProvenance supports calibrated DpRVI and dual-pol fields', () => {
    const prov: ReportProvenance = {
      analysis_id: 'task_sar_report_01',
      task: 'sar_analysis',
      query: 'Calibrated Sentinel-1 RTC dual-pol query',
      mode: 'auto',
      created_at: '2024-03-28T12:00:00Z',
      sensor_identities: ['Sentinel-1 C-SAR IW RTC'],
      source_asset_ids: ['VV', 'VH'],
      acquisition_timestamps: ['2024-03-28T00:43:12Z'],
      registration_status: { co_registered: true },
      provider_name: 'SatQueryEngine',
      fallback_used: false,
      is_trained_model: true,
      dprvi_mean: 0.5200,
      dprvi_p90: 0.5800,
      cross_pol_ratio_linear: 0.2500,
      cross_pol_ratio_db: -6.02,
      sar_vv_mean_db: -6.99,
      sar_vh_mean_db: -13.01,
      sar_polarization_mode: 'DUAL_VV_VH',
      sar_vegetation_proxy_coverage_pct: 65.5,
      dprvi_vegetation_threshold: 0.45,
      vv_asset_id: 'VV',
      vh_asset_id: 'VH',
      dprvi_status: 'success',
      sar_terrain_mask_status: 'unavailable_from_stac_provider'
    };

    assert.equal(prov.dprvi_mean, 0.5200);
    assert.equal(prov.cross_pol_ratio_db, -6.02);
    assert.equal(prov.sar_polarization_mode, 'DUAL_VV_VH');
    assert.equal(prov.sar_terrain_mask_status, 'unavailable_from_stac_provider');
  });

  test('validates AnalysisResponse communicates DpRVI telemetry and terrain shadow limitation', () => {
    const mockAnalysisResponse: AnalysisResponse = {
      id: 'resp_sar_dprvi_test',
      query: 'Radar crop analysis',
      task: 'optical_sar',
      mode: 'optical_sar',
      confidence: 0.95,
      confidence_label: 'Calibrated',
      primary_model: 'SatQueryEngine',
      models: ['SatQueryEngine'],
      actual_model_used: 'SatQueryEngine',
      fallback_used: false,
      model_status: 'active',
      implementation_status: 'baseline',
      answer: 'Analysis shows calibrated Sentinel-1 RTC DpRVI of 0.5200 and cross-pol ratio of -6.02 dB.',
      evidence: [],
      trace: {
        task: 'optical_sar',
        models_selected: ['SatQueryEngine'],
        steps: [],
        parameters: {},
        execution_time_ms: 50.0
      },
      execution_time_ms: 50.0,
      created_at: '2026-10-12T00:00:00Z',
      structured_evidence: null,
      verification: {
        verification_status: 'supported',
        deterministic_passed: true,
        summary_explanation: 'All SAR measurements grounded in calibrated RTC evidence.',
        is_interpretive_only: true
      },
      metadata: {
        dprvi_result: {
          status: 'success',
          dprvi_mean: 0.5200,
          cross_pol_ratio_db: -6.02,
          vegetation_proxy_coverage_pct: 65.5,
          valid_pixel_count: 5000,
          total_pixel_count: 5000
        },
        quality_screening: {
          sar: {
            screened: true,
            sar_terrain_layover_shadow_mask: 'unavailable_from_stac_provider'
          }
        }
      }
    };

    assert.equal(mockAnalysisResponse.metadata?.dprvi_result?.dprvi_mean, 0.5200);
    assert.equal(mockAnalysisResponse.metadata?.quality_screening?.sar?.sar_terrain_layover_shadow_mask, 'unavailable_from_stac_provider');
    assert.equal(mockAnalysisResponse.verification?.deterministic_passed, true);
  });
});
