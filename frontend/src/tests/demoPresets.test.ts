import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_PRESETS } from '../utils/demoPresets.ts';
import type { AnalyzePayload } from '../services/api.ts';

describe('Demo Presets: Dynamic Orchestration & Preset Verification', () => {

  test('verifies all 5 required ISRO demonstration presets are registered', () => {
    assert.equal(DEMO_PRESETS.length, 5);
    const ids = DEMO_PRESETS.map((p) => p.id);
    assert.deepEqual(ids, ['demo1', 'demo2', 'demo3', 'demo4', 'demo5']);
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

  test('Demo 4 load() returns orchestration mode, verified query, and empty files list without synthetic PNGs', () => {
    const demo4 = DEMO_PRESETS.find((p) => p.id === 'demo4');
    assert.ok(demo4);

    const config = demo4.load();
    assert.equal(config.mode, 'orchestration');
    assert.equal(
      config.query,
      'Perform joint optical and radar fusion for Mumbai [72.75, 18.88, 73.05, 19.30]'
    );
    assert.equal(config.files.length, 0);
    assert.deepEqual(config.files, []);

    // Ensure no synthetic canvas PNGs or pretend GeoTIFFs were generated
    const hasCanvasPng = config.files.some(
      (f) => f.dataUrl && f.dataUrl.startsWith('data:image/png')
    );
    assert.equal(hasCanvasPng, false);

    const hasFabricatedTif = config.files.some(
      (f) => f.filename === 'cartosat_optical_bengaluru.tif' || f.filename === 'risat_sar_mumbai.tif'
    );
    assert.equal(hasFabricatedTif, false);
  });

  test('preserves behavior of Demo 1 (Single-Image VQA)', () => {
    const demo1 = DEMO_PRESETS.find((p) => p.id === 'demo1');
    assert.ok(demo1);
    assert.equal(demo1.mode, 'single');
    assert.equal(demo1.badge, 'VQA');
    assert.equal(demo1.query, 'What type of surface feature dominates this scene?');

    const config = demo1.load();
    assert.equal(config.mode, 'single');
    assert.equal(config.files.length, 1);
    assert.equal(config.files[0].filename, 'cartosat_optical_canopy.tif');
    assert.equal(config.files[0].role, 'primary');
    assert.equal(config.files[0].isGeoTIFF, true);
  });

  test('preserves behavior of Demo 2 (Single-Image Captioning)', () => {
    const demo2 = DEMO_PRESETS.find((p) => p.id === 'demo2');
    assert.ok(demo2);
    assert.equal(demo2.mode, 'single');
    assert.equal(demo2.badge, 'CAPTION');
    assert.equal(demo2.query, 'Describe this satellite image and summarize its land cover layout.');

    const config = demo2.load();
    assert.equal(config.mode, 'single');
    assert.equal(config.files.length, 1);
    assert.equal(config.files[0].filename, 'cartosat_multispectral_scene.tif');
    assert.equal(config.files[0].role, 'primary');
    assert.equal(config.files[0].isGeoTIFF, true);
  });

  test('preserves behavior of Demo 3 (Bi-Temporal Change Detection)', () => {
    const demo3 = DEMO_PRESETS.find((p) => p.id === 'demo3');
    assert.ok(demo3);
    assert.equal(demo3.mode, 'bitemporal');
    assert.equal(demo3.badge, 'CHANGE DETECT');
    assert.equal(demo3.query, 'What changed between these two dates?');

    const config = demo3.load();
    assert.equal(config.mode, 'bitemporal');
    assert.equal(config.files.length, 2);
    assert.equal(config.files[0].filename, 'temporal_t1_pre_monsoon.tif');
    assert.equal(config.files[0].role, 'primary');
    assert.equal(config.files[1].filename, 'temporal_t2_post_monsoon.tif');
    assert.equal(config.files[1].role, 'secondary');
  });

  test('preserves behavior of Demo 5 (Conflict & Reanalysis)', () => {
    const demo5 = DEMO_PRESETS.find((p) => p.id === 'demo5');
    assert.ok(demo5);
    assert.equal(demo5.mode, 'single');
    assert.equal(demo5.badge, 'REANALYSIS');
    assert.equal(demo5.query, 'Locate and outline all urban building structures with bounding boxes.');

    const config = demo5.load();
    assert.equal(config.mode, 'single');
    assert.equal(config.files.length, 1);
    assert.equal(config.files[0].filename, 'coastal_estuary_test.tif');
    assert.equal(config.files[0].role, 'primary');
  });

  test('simulates WorkspacePage submission payload for Demo 4 (empty files & orchestration mode)', () => {
    const demo4 = DEMO_PRESETS.find((p) => p.id === 'demo4');
    assert.ok(demo4);
    const config = demo4.load();

    // Replicate WorkspacePage.handleSubmitAnalysis payload construction
    const imagePayloads: AnalyzePayload['images'] = config.files.map((f) => ({
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
    const mode = 'single';
    const query = 'Analyze scene';
    const imagePayloads: AnalyzePayload['images'] = [];

    if (imagePayloads.length === 0 && mode !== 'orchestration' && mode !== 'temporal') {
      imagePayloads.push({
        data: 'dummy_image_data',
        mimeType: 'image/png',
        filename: 'dummy.png',
        role: 'primary'
      });
    }

    assert.equal(imagePayloads.length, 1);
    assert.equal(imagePayloads[0].role, 'primary');
  });

});
