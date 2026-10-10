import test, { describe } from 'node:test';
import assert from 'node:assert';
import type { AnalysisResponse, VerificationResponse, ClaimVerificationItem } from '../types/index.ts';

describe('Stage 7 Evidence-Grounded Scientific Verification', () => {

  test('validates fully supported verification structure with grounded claims', () => {
    const mockVerification: VerificationResponse = {
      verification_status: 'supported',
      deterministic_passed: true,
      deterministic_failures: [],
      claims: [
        {
          claim_text: 'Sentinel-2 BOA surface reflectance mean is 0.1298.',
          claim_type: 'measurement',
          status: 'supported',
          cited_artifact_ids: ['optical_input'],
          evidence_found: 'optical_mean_boa_reflectance=0.1298',
          reason: 'Matches physical measurement within joint valid mask.'
        },
        {
          claim_text: 'Sentinel-1 RTC mean linear power is 0.7417.',
          claim_type: 'measurement',
          status: 'supported',
          cited_artifact_ids: ['sar_input'],
          evidence_found: 'sar_mean_linear_power=0.7417 linear power',
          reason: 'Matches calibrated linear gamma0.'
        }
      ],
      contradictions: [],
      unsupported_claims: [],
      missing_evidence: [],
      scientific_limitations: ['Known residual cloud shadows in optical imagery.'],
      recommended_checks: ['Verify acquisition timestamp on STAC item.'],
      summary_explanation: 'All claims are fully grounded in computed empirical evidence.',
      is_interpretive_only: true,
      interpretive_statement: 'The LLM verifier is strictly an interpretive and explanatory layer based solely on computed evidence.',
      llm_model_used: 'mock-local-llm',
      llm_run: true,
      execution_time_ms: 12.5
    };

    assert.strictEqual(mockVerification.verification_status, 'supported');
    assert.strictEqual(mockVerification.deterministic_passed, true);
    assert.strictEqual(mockVerification.claims?.length, 2);
    assert.strictEqual(mockVerification.is_interpretive_only, true);
    assert.deepStrictEqual(mockVerification.claims?.[0].cited_artifact_ids, ['optical_input']);
  });

  test('validates partially supported verification with missing evidence', () => {
    const mockVerification: VerificationResponse = {
      verification_status: 'partially_supported',
      deterministic_passed: true,
      claims: [
        {
          claim_text: 'Radar backscatter was recorded.',
          claim_type: 'measurement',
          status: 'supported',
          cited_artifact_ids: ['sar_input']
        },
        {
          claim_text: 'Soil moisture is 35%.',
          claim_type: 'general',
          status: 'unsupported',
          cited_artifact_ids: [],
          reason: 'No soil moisture sensor data exists in evidence package.'
        }
      ],
      missing_evidence: ['Direct in-situ soil moisture sensor data.'],
      summary_explanation: 'Radar backscatter is verified, but soil moisture is unsupported.',
      is_interpretive_only: true
    };

    assert.strictEqual(mockVerification.verification_status, 'partially_supported');
    assert.strictEqual(mockVerification.claims?.[1].status, 'unsupported');
    assert.strictEqual(mockVerification.missing_evidence?.length, 1);
  });

  test('validates unsupported verification with deterministic contradictions', () => {
    const mockVerification: VerificationResponse = {
      verification_status: 'unsupported',
      deterministic_passed: false,
      deterministic_failures: [
        'SAR gamma-naught backscatter is mislabeled as sigma-naught without supporting calibration provenance.'
      ],
      claims: [
        {
          claim_text: 'Calibrated sigma-0 backscatter is -4.98 dB.',
          claim_type: 'measurement',
          status: 'contradicted',
          cited_artifact_ids: ['sar_input'],
          reason: 'Contradicts asset provenance: asset is RTC gamma-0.'
        }
      ],
      contradictions: [
        'SAR gamma-naught backscatter is mislabeled as sigma-naught without supporting calibration provenance.'
      ],
      summary_explanation: 'Deterministic integrity violation detected.',
      is_interpretive_only: true
    };

    assert.strictEqual(mockVerification.verification_status, 'unsupported');
    assert.strictEqual(mockVerification.deterministic_passed, false);
    assert.strictEqual(mockVerification.contradictions?.length, 1);
  });

  test('validates not_run state when local LLM is offline, preserving deterministic result', () => {
    const mockVerification: VerificationResponse = {
      verification_status: 'not_run',
      deterministic_passed: true,
      deterministic_failures: [],
      claims: [],
      summary_explanation: 'LLM verification was not run: local LLM service is offline or unreachable.',
      is_interpretive_only: true,
      llm_run: false
    };

    assert.strictEqual(mockVerification.verification_status, 'not_run');
    assert.strictEqual(mockVerification.deterministic_passed, true);
    assert.strictEqual(mockVerification.llm_run, false);
  });

  test('integrates cleanly into AnalysisResponse contract', () => {
    const response: AnalysisResponse = {
      id: 'task_001',
      task: 'optical_sar',
      mode: 'optical_sar',
      answer: 'Optical and SAR joint analysis computed.',
      confidence: 0.92,
      confidence_label: 'Calibrated 92%',
      models: ['OpticalSARJointAnalysisProvider'],
      evidence: [],
      trace: {
        task: 'optical_sar',
        models_selected: ['OpticalSARJointAnalysisProvider'],
        steps: [],
        parameters: {},
        execution_time_ms: 120
      },
      verification: {
        verification_status: 'supported',
        deterministic_passed: true,
        summary_explanation: 'All claims grounded.',
        is_interpretive_only: true
      },
      execution_time_ms: 120,
      created_at: '2026-10-11T00:00:00Z'
    };

    assert.strictEqual(response.verification?.verification_status, 'supported');
    assert.strictEqual(response.verification?.is_interpretive_only, true);
  });

});
