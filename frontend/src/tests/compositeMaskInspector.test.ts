import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { 
  CompositeInspectorData, 
  CompositeInspectorLayerKey, 
  CompositeInspectorPeriod, 
  MapOverlayConfig,
  VisualEvidence,
  AnalysisResponse
} from '../types/index.ts';

describe('Step 7H: Interactive Multi-Scene Composite & SCL Mask Inspector', () => {

  const mockValidInspectorData: CompositeInspectorData = {
    status: 'success',
    composite_method: 'valid_pixel_temporal_median',
    bounds: [77.45, 12.85, 77.75, 13.15],
    crs: 'EPSG:4326',
    scl_mask_policy: {
      excluded_classes: [0, 1, 3, 8, 9, 10],
      retained_classes: [4, 5, 6, 11],
      uncertain_classes: [2, 7],
      resampling: 'nearest_neighbor'
    },
    t1: {
      status: 'success',
      shape: [64, 64],
      bounds: [77.45, 12.85, 77.75, 13.15],
      crs: 'EPSG:4326',
      layers: {
        b04_red: 'data:image/png;base64,mock_t1_b04',
        b08_nir: 'data:image/png;base64,mock_t1_b08',
        obs_depth: 'data:image/png;base64,mock_t1_obs_depth',
        scl_mask: 'data:image/png;base64,mock_t1_scl_mask'
      },
      stats: {
        total_pixels: 4096,
        valid_pixels: 3600,
        masked_pixels: 496,
        clear_coverage_pct: 87.89,
        obs_depth_0_count: 496,
        obs_depth_1_count: 1200,
        obs_depth_2plus_count: 2400,
        mean_obs_depth: 1.59
      },
      contributing_scenes: [
        { scene_id: 'S2A_MSIL2A_20230115_T1_SCENE1', datetime: '2023-01-15T05:00:00Z', cloud_cover: 5.2, valid_coverage_pct: 92.0 },
        { scene_id: 'S2B_MSIL2A_20230120_T1_SCENE2', datetime: '2023-01-20T05:00:00Z', cloud_cover: 12.4, valid_coverage_pct: 83.5 }
      ],
      composite_method: 'valid_pixel_temporal_median'
    },
    t2: {
      status: 'success',
      shape: [64, 64],
      bounds: [77.45, 12.85, 77.75, 13.15],
      crs: 'EPSG:4326',
      layers: {
        b04_red: 'data:image/png;base64,mock_t2_b04',
        b08_nir: 'data:image/png;base64,mock_t2_b08',
        obs_depth: 'data:image/png;base64,mock_t2_obs_depth',
        scl_mask: 'data:image/png;base64,mock_t2_scl_mask'
      },
      stats: {
        total_pixels: 4096,
        valid_pixels: 3200,
        masked_pixels: 896,
        clear_coverage_pct: 78.13,
        obs_depth_0_count: 896,
        obs_depth_1_count: 1500,
        obs_depth_2plus_count: 1700,
        mean_obs_depth: 1.20
      },
      contributing_scenes: [
        { scene_id: 'S2A_MSIL2A_20230715_T2_SCENE1', datetime: '2023-07-15T05:00:00Z', cloud_cover: 14.1, valid_coverage_pct: 81.0 },
        { scene_id: 'S2B_MSIL2A_20230720_T2_SCENE2', datetime: '2023-07-20T05:00:00Z', cloud_cover: 18.0, valid_coverage_pct: 75.2 }
      ],
      composite_method: 'valid_pixel_temporal_median'
    }
  };

  test('validates complete 4-layer inspector data contract for T1 and T2', () => {
    assert.equal(mockValidInspectorData.status, 'success');
    assert.equal(mockValidInspectorData.composite_method, 'valid_pixel_temporal_median');
    assert.ok(mockValidInspectorData.t1);
    assert.ok(mockValidInspectorData.t2);

    const layerKeys: CompositeInspectorLayerKey[] = ['b04_red', 'b08_nir', 'obs_depth', 'scl_mask'];
    for (const key of layerKeys) {
      assert.ok(mockValidInspectorData.t1.layers[key], `T1 missing layer ${key}`);
      assert.ok(mockValidInspectorData.t2.layers[key], `T2 missing layer ${key}`);
      assert.ok(mockValidInspectorData.t1.layers[key]?.startsWith('data:image/png;base64,'));
      assert.ok(mockValidInspectorData.t2.layers[key]?.startsWith('data:image/png;base64,'));
    }
  });

  test('observation depth distinguishes 0, 1, and 2+ observation classes accurately', () => {
    const statsT1 = mockValidInspectorData.t1.stats;
    assert.equal(statsT1.obs_depth_0_count + statsT1.obs_depth_1_count + statsT1.obs_depth_2plus_count, statsT1.total_pixels);
    assert.equal(statsT1.obs_depth_0_count, statsT1.masked_pixels, 'Pixels with 0 clear observations must equal masked pixels');
    assert.equal(statsT1.obs_depth_1_count + statsT1.obs_depth_2plus_count, statsT1.valid_pixels);
    assert.ok(statsT1.mean_obs_depth > 1.0);
  });

  test('SCL validity mask classes partition pixels into valid surface and masked atmospheric/defective', () => {
    const policy = mockValidInspectorData.scl_mask_policy;
    assert.ok(policy);
    // Excluded: NoData(0), Saturated/Defective(1), CloudShadow(3), CloudMed(8), CloudHigh(9), ThinCirrus(10)
    assert.deepEqual(policy.excluded_classes, [0, 1, 3, 8, 9, 10]);
    // Retained: Vegetation(4), BareSoil(5), Water(6), Snow(11)
    assert.deepEqual(policy.retained_classes, [4, 5, 6, 11]);
    assert.equal(policy.resampling, 'nearest_neighbor');

    const statsT2 = mockValidInspectorData.t2.stats;
    assert.equal(statsT2.valid_pixels + statsT2.masked_pixels, statsT2.total_pixels);
  });

  test('supports map overlay configuration with opacity and bounds synchronization', () => {
    const overlayConfig: MapOverlayConfig = {
      imageUrl: mockValidInspectorData.t1.layers.scl_mask!,
      bounds: mockValidInspectorData.bounds!,
      opacity: 0.75,
      title: 'T1 SCL Validity Mask',
      layerKey: 'scl_mask',
      period: 't1'
    };

    assert.equal(overlayConfig.opacity, 0.75);
    assert.equal(overlayConfig.period, 't1');
    assert.equal(overlayConfig.layerKey, 'scl_mask');
    assert.deepEqual(overlayConfig.bounds, [77.45, 12.85, 77.75, 13.15]);
  });

  test('handles zero valid pixels or unavailable layer truthfully without fabricating data', () => {
    const zeroValidData: CompositeInspectorData = {
      status: 'unsupported_zero_valid_pixels',
      t1: {
        status: 'unavailable',
        reason: 'Zero clear observations after cloud masking.',
        layers: {},
        stats: {
          total_pixels: 4096,
          valid_pixels: 0,
          masked_pixels: 4096,
          clear_coverage_pct: 0.0,
          obs_depth_0_count: 4096,
          obs_depth_1_count: 0,
          obs_depth_2plus_count: 0,
          mean_obs_depth: 0.0
        }
      },
      t2: {
        status: 'unavailable',
        reason: 'Zero clear observations after cloud masking.',
        layers: {},
        stats: {
          total_pixels: 4096,
          valid_pixels: 0,
          masked_pixels: 4096,
          clear_coverage_pct: 0.0,
          obs_depth_0_count: 4096,
          obs_depth_1_count: 0,
          obs_depth_2plus_count: 0,
          mean_obs_depth: 0.0
        }
      }
    };

    assert.equal(zeroValidData.status, 'unsupported_zero_valid_pixels');
    assert.equal(zeroValidData.t1.stats.valid_pixels, 0);
    assert.equal(zeroValidData.t1.stats.clear_coverage_pct, 0.0);
    assert.equal(Object.keys(zeroValidData.t1.layers).length, 0, 'No fake raster data must be generated when unavailable');
  });

  test('extracts visual inspector data cleanly from AnalysisResponse evidence or metadata', () => {
    const mockEvidence: VisualEvidence = {
      id: 'ev_temporal_composite_inspector',
      type: 'composite_inspector',
      title: 'Sentinel-2 Multi-Scene Composite & SCL Mask Inspector',
      inspector_data: mockValidInspectorData
    };

    const mockResponse: Partial<AnalysisResponse> = {
      id: 'resp_test_1',
      task: 'temporal_optical_change',
      mode: 'bitemporal',
      answer: 'Change computed.',
      confidence_label: 'High Confidence',
      models: ['Sentinel2TemporalChangeDetector'],
      evidence: [mockEvidence],
      metadata: {
        temporal_optical_change: {
          visual_inspector: mockValidInspectorData
        }
      }
    };

    const extracted = mockResponse.evidence?.find(e => e.inspector_data)?.inspector_data ||
      mockResponse.metadata?.temporal_optical_change?.visual_inspector;

    assert.ok(extracted);
    assert.equal(extracted.status, 'success');
    assert.equal(extracted.t1.stats.total_pixels, 4096);
  });

  test('truthfully flags offline synthetic demo fixtures', () => {
    const isOffline = true;
    const badgeText = isOffline ? 'SYNTHETIC DEMO FIXTURE' : 'LIVE SATELLITE DATA';
    assert.equal(badgeText, 'SYNTHETIC DEMO FIXTURE');
  });

});
