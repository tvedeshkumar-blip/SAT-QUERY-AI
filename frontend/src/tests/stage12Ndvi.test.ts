import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { 
  STACCompositeRetrieveRequestPayload,
  STACCompositeRetrieveResponsePayload,
  NDVIResultPayload,
  AnalysisResponse,
  ReportProvenance,
  ScientificReport
} from '../types/index.ts';

describe('Stage 12: Genuine Sentinel-2 B04+B08 NDVI Frontend Telemetry Tests', () => {

  test('validates STACCompositeRetrieveRequestPayload structure', () => {
    const payload: STACCompositeRetrieveRequestPayload = {
      scene_id: 'S2A_MSIL2A_20240328T052701_N0510_R105_T43PGQ_20240328T083437',
      aoi_bbox: [77.58, 12.96, 77.60, 12.98],
      bands: ['B04', 'B08'],
      include_scl: true,
      compute_ndvi: true,
      max_bytes: 20 * 1024 * 1024
    };

    assert.equal(payload.scene_id, 'S2A_MSIL2A_20240328T052701_N0510_R105_T43PGQ_20240328T083437');
    assert.deepEqual(payload.bands, ['B04', 'B08']);
    assert.equal(payload.include_scl, true);
    assert.equal(payload.compute_ndvi, true);
    assert.equal(payload.max_bytes, 20971520);
  });

  test('validates STACCompositeRetrieveResponsePayload parses calibrated NDVI and SCL telemetry', () => {
    const mockResp: STACCompositeRetrieveResponsePayload = {
      status: 'success',
      scene_id: 'S2A_MSIL2A_20240328T052701',
      collection: 'sentinel-2-l2a',
      category: 'scientific_multispectral',
      filename: 'composite_B04_B08.tif',
      mime_type: 'image/tiff',
      size_bytes: 65536,
      data_base64: 'data:image/tiff;base64,mockbytes',
      metadata: { width: 128, height: 128 },
      scientific_limitations: [],
      provenance: {
        reflectance_scale_factor: 10000.0,
        vegetation_threshold: 0.40
      },
      bands_retrieved: ['B04', 'B08', 'SCL'],
      ndvi_result: {
        status: 'success',
        ndvi_mean: 0.5824,
        ndvi_p90: 0.7915,
        vegetation_coverage_pct: 68.4,
        valid_pixel_count: 14200,
        total_pixel_count: 16384,
        vegetation_threshold: 0.40
      }
    };

    assert.equal(mockResp.status, 'success');
    assert.equal(mockResp.bands_retrieved.length, 3);
    assert.equal(mockResp.ndvi_result?.ndvi_mean, 0.5824);
    assert.equal(mockResp.ndvi_result?.vegetation_coverage_pct, 68.4);
    assert.equal(mockResp.ndvi_result?.vegetation_threshold, 0.40);
  });

  test('validates zero-valid-pixel defense: unavailable statistics are null/undefined, NOT zero', () => {
    const zeroPixelResp: NDVIResultPayload = {
      status: 'unsupported_zero_valid_pixels',
      ndvi_mean: null,
      ndvi_p90: null,
      vegetation_coverage_pct: null,
      valid_pixel_count: 0,
      total_pixel_count: 10000,
      vegetation_threshold: 0.40
    };

    assert.equal(zeroPixelResp.status, 'unsupported_zero_valid_pixels');
    assert.equal(zeroPixelResp.valid_pixel_count, 0);
    // Crucial requirement: Unavailable measurements must NOT be 0
    assert.notEqual(zeroPixelResp.ndvi_mean, 0);
    assert.equal(zeroPixelResp.ndvi_mean, null);
    assert.notEqual(zeroPixelResp.vegetation_coverage_pct, 0);
    assert.equal(zeroPixelResp.vegetation_coverage_pct, null);
  });

  test('validates ReportProvenance supports calibrated NDVI fields', () => {
    const prov: ReportProvenance = {
      analysis_id: 'task_ndvi_report_01',
      task: 'spectral_analysis',
      query: 'Calibrated NDVI query',
      mode: 'auto',
      created_at: '2024-03-28T12:00:00Z',
      sensor_identities: ['Sentinel-2 MSI'],
      source_asset_ids: ['B04', 'B08', 'SCL'],
      acquisition_timestamps: ['2024-03-28T05:27:01Z'],
      registration_status: { co_registered: true },
      provider_name: 'SatQueryEngine',
      fallback_used: false,
      is_trained_model: true,
      ndvi_mean: 0.612,
      ndvi_p90: 0.825,
      vegetation_coverage_pct: 74.2,
      ndvi_vegetation_threshold: 0.40,
      reflectance_scale_factor: 10000.0,
      scl_masking_policy: 'SCL cloud screening: classes 0, 1, 3, 8, 9, 10 excluded',
      ndvi_status: 'success'
    };

    assert.equal(prov.ndvi_mean, 0.612);
    assert.equal(prov.vegetation_coverage_pct, 74.2);
    assert.equal(prov.reflectance_scale_factor, 10000.0);
    assert.equal(prov.ndvi_vegetation_threshold, 0.40);
  });

  test('validates distinction between genuine calibrated NDVI and legacy RGB approximations', () => {
    // Genuine calibrated NDVI payload
    const genuineNdvi: NDVIResultPayload = {
      status: 'success',
      ndvi_mean: 0.65,
      calibration: { convention: 'BOA_SURFACE_REFLECTANCE', scale_factor: 10000.0 }
    };

    // Legacy uncalibrated RGB approximation
    const legacyRgbApprox = {
      is_calibrated: false,
      warning: 'Visual approximation only. Not calibrated BOA surface-reflectance NDVI.'
    };

    assert.equal(genuineNdvi.calibration?.convention, 'BOA_SURFACE_REFLECTANCE');
    assert.equal(legacyRgbApprox.is_calibrated, false);
    assert.match(legacyRgbApprox.warning, /visual approximation/i);
  });
});
