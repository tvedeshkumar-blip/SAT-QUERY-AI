import test, { describe } from 'node:test';
import assert from 'node:assert';
import type { AnalysisResponse, ScientificReport } from '../types/index.ts';

describe('Stage 8 Scientific Analysis Quality and Evidence Reporting Frontend Contract', () => {
  const sampleReport: ScientificReport = {
    report_id: 'report_analysis_smoke_01',
    report_version: '1.0.0',
    generated_at: '2026-10-11T00:00:00Z',
    provenance: {
      analysis_id: 'analysis_smoke_01',
      task: 'optical_sar',
      query: 'Quantify surface reflectance and radar backscatter over study site',
      mode: 'optical_sar',
      created_at: '2026-10-11T00:00:00Z',
      sensor_identities: ['Sentinel-2', 'Sentinel-1'],
      source_asset_ids: ['S2A_MSIL2A_20240315', 'S1A_IW_GRDH_20240315'],
      acquisition_timestamps: ['2024-03-15T05:30:00Z', '2024-03-15T00:15:00Z'],
      crs: 'EPSG:32643',
      spatial_resolution_m: 10.0,
      dimensions: '512x512',
      registration_status: { co_registered: true, method: 'rasterio_reproject_nearest' },
      valid_pixel_count: 245000,
      total_pixel_count: 262144,
      valid_pixel_percentage: 93.46,
      provider_name: 'DeterministicOpticalSARProvider',
      actual_model_used: 'DeterministicOpticalSARProvider',
      fallback_used: false,
      is_trained_model: false,
      model_status: 'baseline_real_raster'
    },
    physical_measurements: [
      {
        name: 'optical_mean_boa_reflectance',
        value: 0.1298,
        unit: 'unitless ratio [0, 1]',
        statistic_type: 'mean surface reflectance',
        calibration_quantity: 'boa_surface_reflectance',
        mask_applied: 'joint_valid_mask',
        source_artifact_ids: ['optical_input']
      },
      {
        name: 'sar_mean_linear_gamma0',
        value: 0.7417,
        unit: 'linear power ratio',
        statistic_type: 'mean linear gamma-naught power',
        calibration_quantity: 'gamma0',
        mask_applied: 'joint_valid_mask',
        source_artifact_ids: ['sar_input']
      },
      {
        name: 'sar_mean_gamma0_db',
        value: -4.98,
        unit: 'dB',
        statistic_type: 'mean pixel-wise gamma-naught in decibels',
        calibration_quantity: 'gamma0_db',
        mask_applied: 'joint_valid_mask',
        source_artifact_ids: ['sar_input']
      }
    ],
    display_statistics: [
      {
        name: 'optical_display_mean_dn',
        value: 92.8,
        scale: '8-bit uint8 [0, 255]',
        purpose: 'Screen visualization brightness'
      },
      {
        name: 'sar_display_mean_dn',
        value: 105.8,
        scale: '8-bit uint8 [0, 255]',
        purpose: 'Screen visualization intensity'
      }
    ],
    heuristic_indicators: [
      {
        name: 'potential_water_heuristic',
        percentage: 4.88,
        pixel_count: 11956,
        definition: 'Optical reflectance < 0.05 and SAR gamma-0 < 0.1',
        is_certified_classification: false,
        limitations: 'Preliminary uncalibrated threshold proxy'
      }
    ],
    evidence_artifacts: [
      {
        artifact_id: 'optical_input',
        artifact_type: 'source',
        title: 'Calibrated Sentinel-2 B04 Surface Reflectance Window'
      },
      {
        artifact_id: 'sar_input',
        artifact_type: 'source',
        title: 'Calibrated Sentinel-1 RTC VV Window'
      }
    ],
    verification_summary: {
      verification_status: 'supported',
      deterministic_passed: true,
      deterministic_failures: [],
      claims: [
        {
          claim_text: 'SAR linear power was measured at approximately 0.7417',
          claim_type: 'physical_measurement',
          status: 'supported',
          cited_artifact_ids: ['sar_input'],
          evidence_found: 'Value matches calibrated sar_input linear mean within tolerance',
          reason: 'Verified against SAR RTC asset.'
        }
      ],
      contradictions: [],
      unsupported_claims: [],
      missing_evidence: [],
      scientific_limitations: ['Heuristic water is not certified land cover'],
      recommended_checks: [],
      is_interpretive_only: true,
      interpretive_statement: 'Interpretive verification based strictly on computed results.',
      summary_explanation: 'Analysis measurements verified by deterministic cross-check.'
    },
    reproducibility: {
      software_version: 'SatQuery-AI v1.0.0 (ISRO PS 26167 Stage 8 Scientific Reporting)',
      provider_config: {
        provider_name: 'DeterministicOpticalSARProvider',
        fallback_activated: false,
        trained_weights_present: false
      },
      pipeline_steps: [
        'INPUT_VALIDATION',
        'WINDOWED_ACQUISITION',
        'GEO_REGISTRATION',
        'CALIBRATED_RADIOMETRY',
        'SCIENTIFIC_VERIFICATION',
        'STAGE8_REPRODUCIBLE_REPORT'
      ],
      unavailable_fields: []
    },
    executive_summary: 'Optical surface reflectance averaged 0.1298; SAR gamma-0 power averaged 0.7417.',
    integrity_notice: 'This report strictly separates calibrated physical measurements from 8-bit display visualizations.'
  };

  test('validates full reproducible report embedded in AnalysisResponse', () => {
    const response: AnalysisResponse = {
      id: 'analysis_smoke_01',
      task: 'optical_sar',
      mode: 'optical_sar',
      answer: 'Analysis results verified.',
      confidence: 0.95,
      confidence_label: 'Calibrated 95%',
      models: ['DeterministicOpticalSARProvider'],
      evidence: [],
      trace: { steps: [] },
      reproducible_report: sampleReport,
      execution_time_ms: 250,
      created_at: '2026-10-11T00:00:00Z'
    };

    assert.ok(response.reproducible_report);
    assert.strictEqual(response.reproducible_report?.report_id, 'report_analysis_smoke_01');
    assert.strictEqual(response.reproducible_report?.physical_measurements.length, 3);
    assert.strictEqual(response.reproducible_report?.display_statistics.length, 2);
  });

  test('maintains strict separation between physical measurements and display values', () => {
    const physical = sampleReport.physical_measurements;
    const display = sampleReport.display_statistics;

    // Physical measurements have scientific units
    const units = physical.map((p) => p.unit);
    assert.ok(units.includes('unitless ratio [0, 1]'));
    assert.ok(units.includes('linear power ratio'));
    assert.ok(units.includes('dB'));

    // Display values are explicitly 8-bit uint8 screen values
    display.forEach((d) => {
      assert.strictEqual(d.scale, '8-bit uint8 [0, 255]');
      assert.ok(d.purpose.includes('Screen visualization'));
    });

    // Ensure display values (92.8, 105.8) are never in physical measurements
    const physicalVals = physical.map((p) => p.value);
    assert.ok(!physicalVals.includes(92.8));
    assert.ok(!physicalVals.includes(105.8));
  });

  test('enforces heuristic indicators as preliminary uncertified proxies', () => {
    sampleReport.heuristic_indicators.forEach((hi) => {
      assert.strictEqual(hi.is_certified_classification, false);
      assert.ok(hi.limitations.length > 0);
    });
  });

  test('preserves claim verification outcomes and cited artifacts', () => {
    const verif = sampleReport.verification_summary;
    assert.ok(verif);
    assert.strictEqual(verif?.verification_status, 'supported');
    assert.strictEqual(verif?.deterministic_passed, true);
    assert.strictEqual(verif?.claims[0].status, 'supported');
    assert.deepStrictEqual(verif?.claims[0].cited_artifact_ids, ['sar_input']);
  });

  test('preserves reproducibility pipeline steps and honest unavailable fields', () => {
    const repro = sampleReport.reproducibility;
    assert.ok(repro.pipeline_steps.includes('CALIBRATED_RADIOMETRY'));
    assert.ok(repro.pipeline_steps.includes('STAGE8_REPRODUCIBLE_REPORT'));
    assert.strictEqual(repro.provider_config.trained_weights_present, false);
    assert.deepStrictEqual(repro.unavailable_fields, []);
  });
});
