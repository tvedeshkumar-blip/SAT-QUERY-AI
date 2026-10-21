import test, { describe } from 'node:test';
import assert from 'node:assert';
import { runSyntheticValidation, runOfficialEvaluation } from '../services/api.ts';

describe('Local Synthetic Pipeline Validation Page Placement and Contracts', () => {

  test('verifies synthetic pipeline validation metrics are deterministic and computed at runtime', async () => {
    const data = await runSyntheticValidation(42);

    assert.ok(data, 'Synthetic validation response should exist');
    assert.strictEqual(data.is_official_isro_evaluation, false, 'Must not claim to be official ISRO evaluation');
    assert.strictEqual(data.validation_status, 'completed');

    const metrics = data.metrics;
    assert.ok(metrics, 'Metrics object must be returned');

    // Expected mathematical test pattern arithmetic results:
    assert.strictEqual(metrics.spatial_ncc_correlation, 0.9726, 'Cross-Modal NCC must equal 0.9726');
    assert.strictEqual(metrics.mask_iou, 0.9245, 'Binary Mask IoU must equal 0.9245');
    assert.strictEqual(metrics.mask_f1_score, 0.9608, 'Mask F1-Score must equal 0.9608');
    assert.strictEqual(metrics.bounding_box_mean_iou, 0.9245, 'Bounding Box Mean IoU must equal 0.9245');
    assert.strictEqual(metrics.evaluated_pixel_count, 65536, '256x256 test pattern evaluates 65,536 pixels');
  });

  test('verifies scientific disclaimer prominently distinguishes synthetic arithmetic from official evaluation', async () => {
    const data = await runSyntheticValidation(42);

    const requiredDisclaimer = 
      'SYNTHETIC LOCAL PIPELINE VALIDATION ONLY. Computed on test patterns to verify pipeline arithmetic (Mask IoU, Bounding Box IoU, Cross-Modal NCC). This does NOT represent official ISRO / SAC Cartosat-2S or RISAT-1A evaluation scores.';

    assert.ok(data.disclaimer, 'Disclaimer must be present');
    assert.strictEqual(data.disclaimer, requiredDisclaimer, 'Disclaimer text must match the required scientific integrity wording');
  });

  test('verifies official ISRO evaluation workflow reports not_mounted when unmounted without fabricated scores', async () => {
    const officialData = await runOfficialEvaluation();

    assert.ok(officialData, 'Official evaluation response must exist');
    assert.strictEqual(officialData.is_official_evaluation, true);
    assert.strictEqual(officialData.status, 'not_mounted', 'Status must be not_mounted when data/official_isro is unmounted');
    assert.ok(officialData.metrics === null || officialData.metrics === undefined, 'Must never fabricate evaluation metrics');
    assert.ok(officialData.message.includes('Cartosat-2S and RISAT-1A'), 'Must explain the authorized sensor requirements');
  });

  test('verifies distinct separation between synthetic math validation and official evaluation suites', async () => {
    const [synthetic, official] = await Promise.all([
      runSyntheticValidation(42),
      runOfficialEvaluation()
    ]);

    // Synthetic has metrics for pipeline math verification
    assert.strictEqual(typeof synthetic.metrics.spatial_ncc_correlation, 'number');
    assert.strictEqual(synthetic.is_official_isro_evaluation, false);

    // Official has null/undefined metrics because no authorized ground-truth package is mounted
    assert.ok(official.metrics === null || official.metrics === undefined);
    assert.strictEqual(official.status, 'not_mounted');
  });
});
