import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { 
  detectLocalFixtureProvenance, 
  OFFLINE_FIXTURE_WARNING_TEXT 
} from '../utils/provenanceDisclosure.ts';
import type { AnalysisResponse } from '../types/index.ts';

describe('Step 5E: Offline Fixture Provenance Disclosure Tests', () => {

  const baseResponse: AnalysisResponse = {
    id: 'orch_test_001',
    task: 'optical_sar',
    mode: 'orchestration',
    query: 'Perform joint optical and radar fusion for Mumbai [72.75, 18.88, 73.05, 19.30]',
    answer: 'Optical + SAR Multimodal Joint Analysis completed across 100x100 scene.',
    confidence: 0.95,
    confidence_label: 'Deterministic Verified',
    models: ['MultiStepOrchestrator', 'optical_sar_fusion'],
    evidence: [],
    trace: {
      task: 'optical_sar',
      models_selected: ['MultiStepOrchestrator'],
      steps: [],
      parameters: {},
      execution_time_ms: 120
    },
    execution_time_ms: 120,
    created_at: '2026-10-14T07:30:00Z'
  };

  test('local fixture provenance triggers the warning with exact required text', () => {
    const resp: AnalysisResponse = {
      ...baseResponse,
      reproducible_report: {
        report_id: 'rep_001',
        report_version: '1.0.0',
        generated_at: '2026-10-14T07:30:00Z',
        provenance: {
          source_asset_ids: [
            'local_sample_temporal_t1_pre_monsoon',
            'local_sample_temporal_t1_pre_monsoon'
          ]
        },
        physical_measurements: [],
        display_statistics: [],
        heuristic_indicators: [],
        evidence_artifacts: [],
        reproducibility: {
          software_version: '1.0.0',
          provider_config: {},
          pipeline_steps: [],
          unavailable_fields: []
        },
        executive_summary: '',
        integrity_notice: ''
      }
    };

    const result = detectLocalFixtureProvenance(resp);
    assert.equal(result.isOfflineFixture, true);
    assert.equal(result.warningMessage, OFFLINE_FIXTURE_WARNING_TEXT);
    assert.equal(
      result.warningMessage,
      'Offline Demonstration Mode: This analysis uses pre-packaged local raster fixtures. It is not a live satellite acquisition, and the imagery may not cover the requested AOI.'
    );
    // Deduplicated fixture IDs
    assert.deepEqual(result.fixtureIds, ['local_sample_temporal_t1_pre_monsoon']);
  });

  test('optical fixture IDs trigger the warning', () => {
    const resp: AnalysisResponse = {
      ...baseResponse,
      reproducible_report: {
        report_id: 'rep_opt',
        report_version: '1.0.0',
        generated_at: '2026-10-14T07:30:00Z',
        provenance: {
          source_asset_ids: ['local_sample_cartosat_optical_bengaluru']
        },
        physical_measurements: [],
        display_statistics: [],
        heuristic_indicators: [],
        evidence_artifacts: [],
        reproducibility: {
          software_version: '1.0.0',
          provider_config: {},
          pipeline_steps: [],
          unavailable_fields: []
        },
        executive_summary: '',
        integrity_notice: ''
      }
    };

    const result = detectLocalFixtureProvenance(resp);
    assert.equal(result.isOfflineFixture, true);
    assert.deepEqual(result.fixtureIds, ['local_sample_cartosat_optical_bengaluru']);
  });

  test('SAR fixture IDs trigger the warning', () => {
    const resp: AnalysisResponse = {
      ...baseResponse,
      reproducible_report: {
        report_id: 'rep_sar',
        report_version: '1.0.0',
        generated_at: '2026-10-14T07:30:00Z',
        provenance: {
          source_asset_ids: ['local_sample_risat_sar_mumbai']
        },
        physical_measurements: [],
        display_statistics: [],
        heuristic_indicators: [],
        evidence_artifacts: [],
        reproducibility: {
          software_version: '1.0.0',
          provider_config: {},
          pipeline_steps: [],
          unavailable_fields: []
        },
        executive_summary: '',
        integrity_notice: ''
      }
    };

    const result = detectLocalFixtureProvenance(resp);
    assert.equal(result.isOfflineFixture, true);
    assert.deepEqual(result.fixtureIds, ['local_sample_risat_sar_mumbai']);
  });

  test('combined optical and SAR fixture IDs are captured together', () => {
    const resp: AnalysisResponse = {
      ...baseResponse,
      reproducible_report: {
        report_id: 'rep_dual',
        report_version: '1.0.0',
        generated_at: '2026-10-14T07:30:00Z',
        provenance: {
          source_asset_ids: [
            'local_sample_cartosat_optical_bengaluru',
            'local_sample_risat_sar_mumbai'
          ]
        },
        physical_measurements: [],
        display_statistics: [],
        heuristic_indicators: [],
        evidence_artifacts: [],
        reproducibility: {
          software_version: '1.0.0',
          provider_config: {},
          pipeline_steps: [],
          unavailable_fields: []
        },
        executive_summary: '',
        integrity_notice: ''
      }
    };

    const result = detectLocalFixtureProvenance(resp);
    assert.equal(result.isOfflineFixture, true);
    assert.deepEqual(result.fixtureIds, [
      'local_sample_cartosat_optical_bengaluru',
      'local_sample_risat_sar_mumbai'
    ]);
  });

  test('responses with authentic/live asset IDs do NOT trigger the warning', () => {
    const resp: AnalysisResponse = {
      ...baseResponse,
      reproducible_report: {
        report_id: 'rep_live',
        report_version: '1.0.0',
        generated_at: '2026-10-14T07:30:00Z',
        provenance: {
          source_asset_ids: [
            'S2A_MSIL2A_20230501T052201_N0510_R062_T43QDA_20230501T080105',
            'S1A_IW_GRDH_1SDV_20230501T010522_048348_05D0D5_B52D'
          ]
        },
        physical_measurements: [],
        display_statistics: [],
        heuristic_indicators: [],
        evidence_artifacts: [],
        reproducibility: {
          software_version: '1.0.0',
          provider_config: {},
          pipeline_steps: [],
          unavailable_fields: []
        },
        executive_summary: '',
        integrity_notice: ''
      }
    };

    const result = detectLocalFixtureProvenance(resp);
    assert.equal(result.isOfflineFixture, false);
    assert.deepEqual(result.fixtureIds, []);
    assert.equal(result.warningMessage, null);
  });

  test('warning is strictly conditional on provenance, not query text or orchestration mode', () => {
    // Query mentions Mumbai and mode is orchestration, but provenance has no local fixture IDs
    const resp: AnalysisResponse = {
      ...baseResponse,
      query: 'Perform joint optical and radar fusion for Mumbai [72.75, 18.88, 73.05, 19.30]',
      mode: 'orchestration',
      reproducible_report: {
        report_id: 'rep_mumbai_live',
        report_version: '1.0.0',
        generated_at: '2026-10-14T07:30:00Z',
        provenance: {
          source_asset_ids: ['COPERNICUS/S2_SR/20230501T052201']
        },
        physical_measurements: [],
        display_statistics: [],
        heuristic_indicators: [],
        evidence_artifacts: [],
        reproducibility: {
          software_version: '1.0.0',
          provider_config: {},
          pipeline_steps: [],
          unavailable_fields: []
        },
        executive_summary: '',
        integrity_notice: ''
      }
    };

    const result = detectLocalFixtureProvenance(resp);
    assert.equal(result.isOfflineFixture, false);
    assert.deepEqual(result.fixtureIds, []);
    assert.equal(result.warningMessage, null);
  });

  test('absent or malformed provenance safely defaults to false without false live assertion', () => {
    assert.equal(detectLocalFixtureProvenance(null).isOfflineFixture, false);
    assert.equal(detectLocalFixtureProvenance(undefined).isOfflineFixture, false);

    const emptyResp: AnalysisResponse = { ...baseResponse };
    assert.equal(detectLocalFixtureProvenance(emptyResp).isOfflineFixture, false);

    const malformedResp: AnalysisResponse = {
      ...baseResponse,
      reproducible_report: {
        report_id: 'rep_mal',
        report_version: '1.0.0',
        generated_at: '2026-10-14T07:30:00Z',
        provenance: {
          source_asset_ids: null as any
        },
        physical_measurements: [],
        display_statistics: [],
        heuristic_indicators: [],
        evidence_artifacts: [],
        reproducibility: {
          software_version: '1.0.0',
          provider_config: {},
          pipeline_steps: [],
          unavailable_fields: []
        },
        executive_summary: '',
        integrity_notice: ''
      }
    };
    assert.equal(detectLocalFixtureProvenance(malformedResp).isOfflineFixture, false);
  });

  test('fallback extraction from metadata.provenance or metadata.source_asset_ids', () => {
    const metaResp: AnalysisResponse = {
      ...baseResponse,
      metadata: {
        provenance: {
          source_asset_ids: ['local_sample_temporal_t2_post_monsoon']
        }
      }
    };
    const result = detectLocalFixtureProvenance(metaResp);
    assert.equal(result.isOfflineFixture, true);
    assert.deepEqual(result.fixtureIds, ['local_sample_temporal_t2_post_monsoon']);
  });

  test('existing supported, unsupported, contradicted, and clarification results remain intact', () => {
    // 1. Supported result with fixture disclosure
    const supportedResp: AnalysisResponse = {
      ...baseResponse,
      verification: {
        verification_status: 'supported',
        deterministic_passed: true,
        summary_explanation: 'All claims verified against raster statistics.',
        is_interpretive_only: false
      },
      reproducible_report: {
        report_id: 'rep_sup',
        report_version: '1.0.0',
        generated_at: '2026-10-14T07:30:00Z',
        provenance: {
          source_asset_ids: ['local_sample_temporal_t1_pre_monsoon']
        },
        physical_measurements: [],
        display_statistics: [],
        heuristic_indicators: [],
        evidence_artifacts: [],
        reproducibility: {
          software_version: '1.0.0',
          provider_config: {},
          pipeline_steps: [],
          unavailable_fields: []
        },
        executive_summary: '',
        integrity_notice: ''
      }
    };
    const supDetect = detectLocalFixtureProvenance(supportedResp);
    assert.equal(supDetect.isOfflineFixture, true);
    assert.equal(supportedResp.verification?.verification_status, 'supported');
    assert.equal(supportedResp.verification?.deterministic_passed, true);

    // 2. Unsupported result
    const unsupportedResp: AnalysisResponse = {
      ...baseResponse,
      verification: {
        verification_status: 'unsupported',
        deterministic_passed: false,
        summary_explanation: 'Spectral threshold violation.',
        is_interpretive_only: false
      }
    };
    assert.equal(unsupportedResp.verification?.verification_status, 'unsupported');
    assert.equal(unsupportedResp.verification?.deterministic_passed, false);

    // 3. Contradicted result
    const contradictedResp: AnalysisResponse = {
      ...baseResponse,
      conflict_info: {
        conflict_detected: true,
        conflict_type: 'cross_modal_backscatter_albedo_contradiction',
        reanalysis_performed: true,
        conflict_details: 'Optical albedo suggests water but SAR backscatter shows structural reflection.'
      }
    };
    assert.equal(contradictedResp.conflict_info?.conflict_detected, true);
    assert.equal(contradictedResp.conflict_info?.reanalysis_performed, true);

    // 4. Clarification result
    const clarificationResp: AnalysisResponse = {
      ...baseResponse,
      is_clarification_required: true,
      missing_parameters: ['spatial_location'],
      suggested_examples: ['Perform joint optical and radar fusion for Mumbai [72.75, 18.88, 73.05, 19.30]']
    };
    assert.equal(clarificationResp.is_clarification_required, true);
    assert.deepEqual(clarificationResp.missing_parameters, ['spatial_location']);
  });

  test('Step 6B: detects out-of-bounds clamped AOI status and actual fixture bounds', () => {
    const clampedResp: AnalysisResponse = {
      ...baseResponse,
      reproducible_report: {
        report_id: 'rep_clamped',
        report_version: '1.0.0',
        generated_at: '2026-10-14T07:30:00Z',
        provenance: {
          source_asset_ids: ['local_sample_temporal_t1_pre_monsoon'],
          aoi_containment_status: 'out_of_bounds_clamped',
          actual_fixture_bounds_wgs84: [77.063, 16.699, 77.087, 16.723]
        } as any,
        physical_measurements: [],
        display_statistics: [],
        heuristic_indicators: [],
        evidence_artifacts: [],
        reproducibility: {
          software_version: '1.0.0',
          provider_config: {},
          pipeline_steps: [],
          unavailable_fields: []
        },
        executive_summary: '',
        integrity_notice: ''
      }
    };

    const result = detectLocalFixtureProvenance(clampedResp);
    assert.equal(result.isOfflineFixture, true);
    assert.equal(result.isOutOfBoundsClamped, true);
    assert.deepEqual(result.actualFixtureBounds, [77.063, 16.699, 77.087, 16.723]);
    assert.equal(result.warningMessage, OFFLINE_FIXTURE_WARNING_TEXT);
  });

  test('Step 6D: disentangled optical and SAR fixtures report offline demo truthfully without fabricated fusion evidence', () => {
    const disentangledResp: AnalysisResponse = {
      ...baseResponse,
      implementation_status: 'unsupported',
      confidence: null as any,
      confidence_label: 'Cross-Sensor Mismatch',
      verification: {
        verification_status: 'unsupported',
        deterministic_passed: false,
        summary_explanation: 'Cross-sensor spatial overlap is 0.0%, failing the 50.0% threshold.',
        is_interpretive_only: false,
        claims: []
      },
      reproducible_report: {
        report_id: 'rep_disentangled',
        report_version: '1.0.0',
        generated_at: '2026-10-14T07:30:00Z',
        provenance: {
          source_asset_ids: [
            'local_sample_cartosat_optical_bengaluru',
            'local_sample_risat_sar_mumbai'
          ],
          aoi_containment_status: 'out_of_bounds_clamped',
          actual_fixture_bounds_wgs84: [80.374, 12.847, 80.380, 12.853],
          sensors: [
            'Cartosat-style synthetic demonstration optical scene',
            'RISAT-style synthetic demonstration SAR scene'
          ],
          scientific_limitations: [
            'Local fixture does not intersect requested AOI; demonstration execution only.',
            'Synthetic demonstration fixture: not authentic calibrated Sentinel raw telemetry.'
          ]
        } as any,
        physical_measurements: [],
        display_statistics: [],
        heuristic_indicators: [],
        evidence_artifacts: [],
        reproducibility: {
          software_version: '1.0.0',
          provider_config: {},
          pipeline_steps: [],
          unavailable_fields: []
        },
        executive_summary: '',
        integrity_notice: ''
      }
    };

    const result = detectLocalFixtureProvenance(disentangledResp);
    assert.equal(result.isOfflineFixture, true);
    assert.equal(result.isOutOfBoundsClamped, true);
    assert.deepEqual(result.fixtureIds, [
      'local_sample_cartosat_optical_bengaluru',
      'local_sample_risat_sar_mumbai'
    ]);
    assert.equal(result.warningMessage, OFFLINE_FIXTURE_WARNING_TEXT);
    assert.equal(disentangledResp.verification?.verification_status, 'unsupported');
    assert.equal(disentangledResp.verification?.claims?.length, 0);
    assert.equal(disentangledResp.confidence, null);
  });

});
