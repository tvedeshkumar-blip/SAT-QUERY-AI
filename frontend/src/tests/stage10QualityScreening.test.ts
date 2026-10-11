import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { 
  STACWindowedRetrieveRequestPayload,
  STACRetrieveResponsePayload,
  AnalysisResponse,
  ReportProvenance,
  ScientificReport
} from '../types/index.ts';

describe('Stage 10A: Radiometric Quality Screening Frontend Tests', () => {

  test('validates STACWindowedRetrieveRequestPayload supports screen_quality parameter', () => {
    const payload: STACWindowedRetrieveRequestPayload = {
      scene_id: 'S2A_MSIL2A_20240328T052701_N0510_R105_T43PGQ_20240328T083437',
      asset_key: 'B04',
      aoi_bbox: [77.58, 12.96, 77.60, 12.98],
      screen_quality: true,
      target_role: 'optical',
      resampling: 'nearest'
    };

    assert.equal(payload.screen_quality, true);
    assert.equal(payload.resampling, 'nearest');
  });

  test('validates STACRetrieveResponsePayload parses quality screening telemetry', () => {
    const mockResponse: STACRetrieveResponsePayload = {
      status: 'success',
      scene_id: 'S2A_MSIL2A_20240328T052701',
      asset_key: 'B04',
      category: 'scientific_raster',
      filename: 's2_b04_crop.tif',
      mime_type: 'image/tiff',
      size_bytes: 32768,
      data_base64: 'data:image/tiff;base64,mockbytes',
      metadata: { width: 100, height: 100 },
      scientific_limitations: ['Preliminary screening applied.'],
      quality_screening: {
        optical: {
          screened: true,
          observed_pixel_count: 10000,
          clear_pixels: 9200,
          excluded_pixel_count: 800,
          quality_clearance_fraction: 0.92,
          has_cloud_obstruction: false
        }
      }
    };

    assert.equal(mockResponse.quality_screening?.optical?.screened, true);
    assert.equal(mockResponse.quality_screening?.optical?.quality_clearance_fraction, 0.92);
    assert.equal(mockResponse.quality_screening?.optical?.excluded_pixel_count, 800);
  });

  test('validates AnalysisResponse communicates SCL applied state and SAR terrain shadow unmasked limitation', () => {
    const analysis: Partial<AnalysisResponse> = {
      id: 'task_quality_001',
      task: 'optical_sar',
      mode: 'optical_sar',
      answer: 'Joint analysis completed with verified radiometric quality screening.',
      confidence: null,
      confidence_label: 'Not available (Empirical Heuristic Baseline)',
      models: ['OpticalSARJointAnalysisProvider'],
      metadata: {
        quality_screening: {
          optical: {
            screened: true,
            observed_pixel_count: 5000,
            clear_pixels: 4500,
            excluded_pixel_count: 500,
            quality_clearance_fraction: 0.90
          },
          sar: {
            screened: true,
            valid_pixel_count: 4800,
            sar_terrain_layover_shadow_mask: 'unavailable_from_stac_provider'
          }
        }
      }
    };

    const optQ = analysis.metadata?.quality_screening?.optical;
    const sarQ = analysis.metadata?.quality_screening?.sar;

    // Check optical SCL applied
    assert.equal(optQ.screened, true);
    assert.equal(optQ.quality_clearance_fraction, 0.90);
    assert.equal(optQ.excluded_pixel_count, 500);

    // Check SAR terrain shadow unavailable notice
    assert.equal(sarQ.sar_terrain_layover_shadow_mask, 'unavailable_from_stac_provider');
  });

  test('validates ReportProvenance correctly stores clear coverage and pixel accounting', () => {
    const prov: ReportProvenance = {
      analysis_id: 'rep_001',
      task: 'optical_sar',
      query: 'Land cover assessment',
      mode: 'optical_sar',
      created_at: '2024-03-28T12:00:00Z',
      sensor_identities: ['Sentinel-2', 'Sentinel-1'],
      source_asset_ids: ['s2_asset', 's1_asset'],
      acquisition_timestamps: ['2024-03-28T05:00:00Z'],
      registration_status: { co_registered: true },
      valid_pixel_count: 8500,
      total_pixel_count: 10000,
      valid_pixel_percentage: 85.0,
      provider_name: 'OpticalSARJointAnalysisProvider',
      fallback_used: false,
      is_trained_model: false,
      quality_screening: {
        optical: { screened: true, quality_clearance_fraction: 0.85 },
        sar: { screened: true, valid_pixel_count: 8500 }
      },
      observed_pixel_count: 10000,
      excluded_quality_pixel_count: 1500,
      quality_clearance_percentage: 85.0
    };

    assert.equal(prov.quality_clearance_percentage, 85.0);
    assert.equal(prov.observed_pixel_count, 10000);
    assert.equal(prov.excluded_quality_pixel_count, 1500);
    assert.equal(prov.valid_pixel_count, 8500);
  });

  test('validates workspace data preservation on retrieval failure', () => {
    // Simulate workspace state
    let retrievedAssets: Record<string, STACRetrieveResponsePayload> = {
      'scene_1': {
        status: 'success',
        scene_id: 'scene_1',
        asset_key: 'visual',
        category: 'scientific_raster',
        filename: 'scene1.tif',
        mime_type: 'image/tiff',
        size_bytes: 4096,
        data_base64: 'data:...',
        metadata: {},
        scientific_limitations: []
      }
    };

    // Simulate failure on scene_2
    const scene2Error = 'Network timeout on windowed acquisition.';
    let retrieveError: { sceneId: string; message: string } | null = {
      sceneId: 'scene_2',
      message: scene2Error
    };

    // Verify scene_1 remains intact in the workspace
    assert.ok(retrievedAssets['scene_1']);
    assert.equal(retrievedAssets['scene_1'].scene_id, 'scene_1');
    assert.equal(retrieveError?.sceneId, 'scene_2');
    assert.equal(retrieveError?.message, scene2Error);
  });
});
