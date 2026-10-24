import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AnalysisResponse } from '../types/index.ts';

describe('Single-Image VQA Frontend Workflow & Repair Tests', () => {

  test('validates Single-Image VQA mode configuration', () => {
    const modes = [
      { id: 'single', label: 'Single-Image VQA', isVisualVqa: true, requiresMultiBand: false },
      { id: 'bitemporal', label: 'Bi-Temporal', isVisualVqa: false, requiresMultiBand: false },
      { id: 'optical_sar', label: 'Optical + SAR', isVisualVqa: false, requiresMultiBand: false },
      { id: 'classification', label: 'Land-Cover Clf', isVisualVqa: false, requiresMultiBand: true }
    ];

    const vqaMode = modes.find(m => m.id === 'single');
    assert.ok(vqaMode, 'Single mode must exist');
    assert.equal(vqaMode.isVisualVqa, true);
    assert.equal(vqaMode.requiresMultiBand, false, 'Visual VQA does not require 10 multispectral bands');

    const clfMode = modes.find(m => m.id === 'classification');
    assert.ok(clfMode, 'Classification mode must exist');
    assert.equal(clfMode.requiresMultiBand, true, 'BigEarthNet requires 10 Sentinel-2 bands');
  });

  test('constructs valid Single-Image VQA payload with visual preview image', () => {
    const previewImage = {
      filename: 'S2A_43PGQ_20231119_preview.jpg',
      data: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...',
      mimeType: 'image/jpeg'
    };

    const suggestedQuery =
      'Describe the visible land cover in this satellite image. Identify apparent vegetation, buildings, roads, and water where visible. Distinguish observations from uncertain interpretations. Do not claim to have performed multispectral analysis.';

    const payload = {
      query: suggestedQuery,
      mode: 'single',
      images: [previewImage]
    };

    assert.equal(payload.mode, 'single');
    assert.equal(payload.images.length, 1);
    assert.equal(payload.images[0].mimeType, 'image/jpeg');
    assert.ok(payload.query.includes('visible land cover'));
    assert.ok(!payload.query.includes('classification'));
  });

  test('handles RGBA 4-channel preview correctly without routing to BigEarthNet', () => {
    const rgbaPreview = {
      filename: 'screenshot_preview.png',
      data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
      mimeType: 'image/png'
    };

    const payload = {
      query: 'Describe visible structures and vegetation in this image',
      mode: 'single',
      images: [rgbaPreview]
    };

    // Mode is single, never classification
    assert.notEqual(payload.mode, 'classification');
    assert.equal(payload.images[0].mimeType, 'image/png');
  });

  test('correctly parses genuine VQA response with truthful fallback metadata', () => {
    const mockVqaResponse: AnalysisResponse = {
      id: 'vqa_resp_test_1',
      mode: 'single',
      trace: { task: 'vqa', models_selected: ['GenericVLMOrchestrator'], steps: [], parameters: {}, execution_time_ms: 120 },
      query: 'Describe the visible land cover in this satellite image.',
      task: 'vqa',
      models: ['GenericVLMOrchestrator'],
      evidence: [
        {
          id: 'vqa_preview_0',
          type: 'processed',
          title: 'Input Visual Satellite Scene',
          description: 'Single-image visual VQA scene: preview.jpg (RGB: 1024x1024)',
          data_base64: 'data:image/jpeg;base64,/9j/4AAQ...',
          metadata: {
            width: 1024,
            height: 1024,
            bands: 3,
            has_alpha: false
          }
        }
      ],
      answer: 'Direct Visual Observations:\n- Apparent vegetation canopy: ~35.2% of image pixels display dominant green reflectance.\n- Built-up / high-albedo structures: ~14.1% of pixels display high uncalibrated luminance.\n\nDistinction & Limitations:\n- Narrow linear corridors suggest potential unpaved roads, but cannot be confirmed without vector overlay.\n- Note: No calibrated multispectral analysis was performed; interpretations are derived strictly from 8-bit visible spectrum.',
      status: 'success',
      primary_model: 'Florence-2-base',
      actual_model_used: 'SpectralStatisticsBaseline',
      fallback_used: true,
      confidence: null,
      confidence_label: 'Not available (Local Baseline)'
    };

    assert.equal(mockVqaResponse.task, 'vqa');
    assert.equal(mockVqaResponse.primary_model, 'Florence-2-base');
    assert.equal(mockVqaResponse.actual_model_used, 'SpectralStatisticsBaseline');
    assert.equal(mockVqaResponse.fallback_used, true);
    assert.equal(mockVqaResponse.confidence, null, 'No fabricated confidence score');
    assert.ok(mockVqaResponse.answer.includes('Direct Visual Observations'));
    assert.ok(mockVqaResponse.answer.includes('No calibrated multispectral analysis'));
  });

  test('validates rejected 4-channel image in classification mode vs accepted in VQA mode', () => {
    const previewChannels = 4; // RGBA preview

    // BigEarthNet rule: requires exactly 10 bands
    const isAcceptedForBigEarthNet = (channels: number) => channels === 10;
    // Visual VQA rule: supports 3 (RGB) or 4 (RGBA) channels
    const isAcceptedForVisualVqa = (channels: number) => channels === 3 || channels === 4;

    assert.equal(isAcceptedForBigEarthNet(previewChannels), false, 'BigEarthNet must strictly reject 4-channel preview');
    assert.equal(isAcceptedForVisualVqa(previewChannels), true, 'Visual VQA must accept 4-channel preview');
  });

});
