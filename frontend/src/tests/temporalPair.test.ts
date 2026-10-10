import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { 
  STACTemporalPairValidateResponsePayload,
  STACSceneSummary 
} from '../types/index.ts';

describe('Bi-Temporal Scene Selection & Validation Logic', () => {

  test('validates temporal response structure for compatible pair', () => {
    const mockResponse: STACTemporalPairValidateResponsePayload = {
      status: 'compatible',
      is_compatible: true,
      rejection_reason: null,
      t1_datetime: '2023-04-10T05:30:00Z',
      t2_datetime: '2023-11-05T05:30:00Z',
      temporal_delta_days: 209.0,
      chronology_status: 'chronological',
      spatial_overlap_pct: 100.0,
      overlap_detected: true,
      crs_compatible: true,
      resolution_compatible: true,
      modality_compatible: true,
      co_registered: true,
      warnings: [],
      scientific_limitations: [
        'Scientific distinction: Detected differences represent pixel delta, not confirmed real-world change.'
      ],
      candidate_providers: ['BIT-CD', 'PixelDifferenceChangeBaseline'],
      primary_provider: 'BIT-CD',
      fallback_status: 'Loaded and ready',
      recommended_action: 'Temporal pair is compatible. Proceed with bi-temporal change detection.'
    };

    assert.equal(mockResponse.is_compatible, true);
    assert.equal(mockResponse.status, 'compatible');
    assert.equal(mockResponse.chronology_status, 'chronological');
    assert.equal(mockResponse.spatial_overlap_pct, 100.0);
    assert.equal(mockResponse.co_registered, true);
  });

  test('correctly identifies rejected pair with browse-only preview', () => {
    const mockRejection: STACTemporalPairValidateResponsePayload = {
      status: 'rejected',
      is_compatible: false,
      rejection_reason: 'Browse-only preview asset detected in T1. Unprojected 8-bit visual previews are strictly rejected for scientific bi-temporal change detection.',
      t1_datetime: '2023-04-10T05:30:00Z',
      t2_datetime: '2023-11-05T05:30:00Z',
      temporal_delta_days: 209.0,
      chronology_status: 'chronological',
      spatial_overlap_pct: null,
      overlap_detected: false,
      crs_compatible: false,
      resolution_compatible: false,
      modality_compatible: false,
      co_registered: false,
      warnings: ['Browse-only preview thumbnail rejected.'],
      scientific_limitations: ['Browse previews lack calibrated surface reflectance.'],
      candidate_providers: ['PixelDifferenceChangeBaseline'],
      primary_provider: 'PixelDifferenceChangeBaseline',
      fallback_status: 'Active fallback',
      recommended_action: 'Choose alternative acquisitions before proceeding.'
    };

    assert.equal(mockRejection.is_compatible, false);
    assert.equal(mockRejection.status, 'rejected');
    assert.match(mockRejection.rejection_reason || '', /Browse-only preview asset/);
  });

  test('correctly identifies identical timestamp degenerate pair', () => {
    const mockDegenerate: STACTemporalPairValidateResponsePayload = {
      status: 'rejected',
      is_compatible: false,
      rejection_reason: 'Degenerate temporal pair: T1 and T2 have identical acquisition timestamps (2023-05-15T00:00:00Z).',
      t1_datetime: '2023-05-15T00:00:00Z',
      t2_datetime: '2023-05-15T00:00:00Z',
      temporal_delta_days: 0.0,
      chronology_status: 'identical',
      spatial_overlap_pct: null,
      overlap_detected: false,
      crs_compatible: false,
      resolution_compatible: false,
      modality_compatible: false,
      co_registered: false,
      warnings: ['Acquisition dates are identical.'],
      scientific_limitations: ['Zero temporal separation.'],
      candidate_providers: ['PixelDifferenceChangeBaseline'],
      primary_provider: 'PixelDifferenceChangeBaseline',
      fallback_status: 'Active fallback',
      recommended_action: 'Choose distinct acquisition dates.'
    };

    assert.equal(mockDegenerate.is_compatible, false);
    assert.equal(mockDegenerate.chronology_status, 'identical');
    assert.equal(mockDegenerate.temporal_delta_days, 0.0);
  });

});
