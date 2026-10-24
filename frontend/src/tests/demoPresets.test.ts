import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_PRESETS } from '../utils/demoPresets.ts';
import type { AnalyzePayload } from '../services/api.ts';
import type { AnalysisMode } from '../types/index.ts';

describe('Demo Presets: Dynamic Orchestration & Preset Verification', () => {

  test('verifies all required ISRO demonstration presets and Demo 6 BigEarthNet are registered', () => {
    assert.equal(DEMO_PRESETS.length, 6);
    const ids = DEMO_PRESETS.map((p) => p.id);
    assert.deepEqual(ids, ['demo1', 'demo2', 'demo3', 'demo4', 'demo5', 'demo6']);
  });

  test('Demo 6 is configured for BigEarthNetv2 10-band land-cover classification', () => {
    const demo6 = DEMO_PRESETS.find((p) => p.id === 'demo6');
    assert.ok(demo6, 'Demo 6 must exist');
    assert.equal(demo6.id, 'demo6');
    assert.equal(demo6.mode, 'classification');
    assert.equal(demo6.badge, 'BIGEARTHNET-V2');
    const cfg = demo6.load() as any;
    assert.equal(cfg.mode, 'classification');
    assert.equal(cfg.files.length, 1);
    assert.equal(cfg.files[0].isGeoTIFF, true);
    assert.equal(cfg.files[0].validation.raster_metadata.bands, 10);
  });

  test('Demo 4 is configured for dynamic multi-step orchestration with verified Mumbai query', () => {
    const demo4 = DEMO_PRESETS.find((p) => p.id === 'demo4');
    assert.ok(demo4, 'Demo 4 must exist');

    assert.equal(demo4.id, 'demo4');
    assert.equal(demo4.title, 'Demo 4: Optical + SAR Joint Analysis');
    assert.equal(demo4.subtitle, 'Reflectance + C-Band SAR backscatter');
    assert.equal(demo4.badge, 'OPTICAL+SAR');
    assert.equal(demo4.mode, 'orchestration');
    assert.equal(
      demo4.query,
      'Perform joint optical and radar fusion for Mumbai [72.75, 18.88, 73.05, 19.30]'
    );
  });

  test('Demo 4 load() returns orchestration mode, verified query, and empty files list without synthetic PNGs', async () => {
    const demo4 = DEMO_PRESETS.find((p) => p.id === 'demo4');
    assert.ok(demo4);

    const config = await demo4.load();
    assert.equal(config.mode, 'orchestration');
    assert.equal(
      config.query,
      'Perform joint optical and radar fusion for Mumbai [72.75, 18.88, 73.05, 19.30]'
    );
    assert.equal(config.files.length, 0);
    assert.deepEqual(config.files, []);

    // Ensure no synthetic canvas PNGs or pretend GeoTIFFs were generated
    const files = config.files as (typeof config.files[number])[];
    assert.equal(files.length, 0);
    const hasCanvasPng = (config.files as any[]).some(
      (f) => f.dataUrl && f.dataUrl.startsWith('data:image/png')
    );
    assert.equal(hasCanvasPng, false);

    const hasFabricatedTif = (config.files as any[]).some(
      (f) => f.filename === 'cartosat_optical_bengaluru.tif' || f.filename === 'risat_sar_mumbai.tif'
    );
    assert.equal(hasFabricatedTif, false);
  });

  test('preserves behavior of Demo 1 (Single-Image VQA)', async () => {
    const demo1 = DEMO_PRESETS.find((p) => p.id === 'demo1');
    assert.ok(demo1);
    assert.equal(demo1.mode, 'single');
    assert.equal(demo1.badge, 'VQA');
    assert.equal(demo1.query, 'What type of surface feature dominates this scene?');

    const config = await demo1.load();
    assert.equal(config.mode, 'single');
    assert.equal(config.files.length, 1);
    assert.equal(config.files[0].filename, 'cartosat_optical_canopy.tif');
    assert.equal(config.files[0].role, 'primary');
    assert.equal(config.files[0].isGeoTIFF, true);
  });

  test('preserves behavior of Demo 2 (Single-Image Captioning)', async () => {
    const demo2 = DEMO_PRESETS.find((p) => p.id === 'demo2');
    assert.ok(demo2);
    assert.equal(demo2.mode, 'single');
    assert.equal(demo2.badge, 'CAPTION');
    assert.equal(demo2.query, 'Describe this satellite image and summarize its land cover layout.');

    const config = await demo2.load();
    assert.equal(config.mode, 'single');
    assert.equal(config.files.length, 1);
    assert.equal(config.files[0].filename, 'cartosat_multispectral_scene.tif');
    assert.equal(config.files[0].role, 'primary');
    assert.equal(config.files[0].isGeoTIFF, true);
  });

  test('loads authentic Sentinel-2 GeoTIFF pair and STAC provenance for Demo 3 (Bi-Temporal Change)', async () => {
    const demo3 = DEMO_PRESETS.find((p) => p.id === 'demo3');
    assert.ok(demo3);
    assert.equal(demo3.mode, 'bitemporal');
    assert.equal(demo3.badge, 'CHANGE DETECT');
    assert.equal(demo3.query, 'What changed between these two dates?');

    const config = await demo3.load();
    assert.equal(config.mode, 'bitemporal');
    assert.equal(config.files.length, 2);

    // Verify authentic Sentinel-2 GeoTIFF filenames
    assert.equal(config.files[0].filename, 'S2B_43PGQ_20230528_0_L2A_visual_window_1792262748.tif');
    assert.equal(config.files[0].role, 'primary');
    assert.equal(config.files[0].isGeoTIFF, true);

    assert.equal(config.files[1].filename, 'S2A_43PGQ_20231119_0_L2A_visual_window_1792262818.tif');
    assert.equal(config.files[1].role, 'secondary');
    assert.equal(config.files[1].isGeoTIFF, true);

    // Verify authentic STAC provenance
    assert.equal(config.files[0].stacProvenance?.scene_id, 'S2B_43PGQ_20230528_0_L2A');
    assert.equal(config.files[0].stacProvenance?.tile, '43PGQ');
    assert.equal(config.files[0].stacProvenance?.sensor, 'Sentinel-2B MSI Level-2A');
    assert.equal(config.files[1].stacProvenance?.scene_id, 'S2A_43PGQ_20231119_0_L2A');
    assert.equal(config.files[1].stacProvenance?.tile, '43PGQ');
    assert.equal(config.files[1].stacProvenance?.sensor, 'Sentinel-2A MSI Level-2A');

    // Verify authentic CRS & spatial bounds
    assert.equal(config.files[0].validation?.raster_metadata?.crs, 'EPSG:32643');
    assert.equal(config.files[1].validation?.raster_metadata?.crs, 'EPSG:32643');
    assert.deepEqual(config.aoi_bbox, [77.4491, 13.0597, 77.5444, 13.1531]);

    // Verify honest scientific limitations regarding NDVI and RGB
    assert.ok(
      config.files[0].scientificLimitations?.some((l) => l.includes('NDVI') && l.includes('Band 8')),
      'Must honestly state calibrated NDVI requires near-infrared Band 8'
    );
  });

  test('preserves behavior of Demo 5 (Conflict & Reanalysis)', async () => {
    const demo5 = DEMO_PRESETS.find((p) => p.id === 'demo5');
    assert.ok(demo5);
    assert.equal(demo5.mode, 'single');
    assert.equal(demo5.badge, 'REANALYSIS');
    assert.equal(demo5.query, 'Locate and outline all urban building structures with bounding boxes.');

    const config = await demo5.load();
    assert.equal(config.mode, 'single');
    assert.equal(config.files.length, 1);
    assert.equal(config.files[0].filename, 'coastal_estuary_test.tif');
    assert.equal(config.files[0].role, 'primary');
  });

  test('simulates WorkspacePage submission payload for Demo 4 (empty files & orchestration mode)', async () => {
    const demo4 = DEMO_PRESETS.find((p) => p.id === 'demo4');
    assert.ok(demo4);
    const config = await demo4.load();

    // Replicate WorkspacePage.handleSubmitAnalysis payload construction
    const imagePayloads: AnalyzePayload['images'] = config.files.map((f: any) => ({
      data: f.dataUrl,
      mimeType: f.isGeoTIFF ? 'image/tiff' : 'image/png',
      filename: f.filename,
      role: f.role
    }));

    // Fallback guard: only inject dummy preset if mode is not orchestration or temporal
    if (imagePayloads.length === 0 && config.mode !== 'orchestration' && config.mode !== 'temporal') {
      imagePayloads.push({
        data: 'dummy_image_data',
        mimeType: 'image/png',
        filename: 'dummy.png',
        role: 'primary'
      });
    }

    const payload: AnalyzePayload = {
      images: imagePayloads,
      query: config.query,
      mode: config.mode
    };

    // Assert images is strictly empty for orchestration mode
    assert.deepEqual(payload.images, []);
    assert.equal(payload.images.length, 0);
    assert.equal(payload.mode, 'orchestration');
    assert.equal(payload.query, 'Perform joint optical and radar fusion for Mumbai [72.75, 18.88, 73.05, 19.30]');
  });

  test('simulates fallback synthetic preset injection for single mode when files are empty', () => {
    function injectFallbackIfEmpty(m: AnalysisMode, payloads: AnalyzePayload['images']) {
      if (payloads.length === 0 && m !== 'orchestration' && m !== 'temporal') {
        payloads.push({
          data: 'dummy_image_data',
          mimeType: 'image/png',
          filename: 'dummy.png',
          role: 'primary'
        });
      }
    }

    const singlePayloads: AnalyzePayload['images'] = [];
    injectFallbackIfEmpty('single', singlePayloads);
    assert.equal(singlePayloads.length, 1);
    assert.equal(singlePayloads[0].role, 'primary');

    const orchPayloads: AnalyzePayload['images'] = [];
    injectFallbackIfEmpty('orchestration', orchPayloads);
    assert.equal(orchPayloads.length, 0);
  });

});
