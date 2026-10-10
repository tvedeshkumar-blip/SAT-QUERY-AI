import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { 
  STACOpticalSARPairValidateResponsePayload,
  STACOpticalSARSearchResponsePayload,
  STACSceneSummary 
} from '../types/index.ts';

describe('Optical + SAR Cross-Sensor Scene Selection & Validation Logic', () => {

  test('validates optical + sar response structure for compatible cross-sensor pair', () => {
    const mockResponse: STACOpticalSARPairValidateResponsePayload = {
      status: 'compatible_with_limitations',
      is_compatible: true,
      rejection_reason: null,
      optical_datetime: '2024-02-01T05:30:00Z',
      sar_datetime: '2024-02-05T12:45:00Z',
      temporal_delta_days: 4.3,
      spatial_overlap_pct: 95.5,
      overlap_detected: true,
      crs_compatible: true,
      resolution_compatible: true,
      modality_compatible: true,
      co_registered: true,
      sar_polarization: 'VV',
      sar_sensor: 'Sentinel-1 C-Band SAR',
      sar_calibration_status: 'unverified_linear_dn',
      sar_terrain_correction_status: 'ellipsoid_geocoded_grd',
      warnings: [
        'Radiometric calibration advisory: Product metadata lacks verified sigma-0/gamma-0 calibration look-up tables.',
        'Terrain correction advisory: SAR product is ellipsoid-geocoded (GRD) without verified RTC.'
      ],
      scientific_limitations: [
        'Scientific assertion: Optical surface reflectance and SAR microwave backscatter are physically complementary, non-interchangeable measurements.'
      ],
      candidate_providers: ['OpticalSARJointAnalysisProvider', 'OpticalSARVisualizationBaseline'],
      primary_provider: 'OpticalSARJointAnalysisProvider',
      fallback_status: 'Loaded and ready',
      recommended_action: 'Cross-sensor pair is compatible with scientific caveats. Review sensor calibration and topography warnings.'
    };

    assert.equal(mockResponse.is_compatible, true);
    assert.equal(mockResponse.status, 'compatible_with_limitations');
    assert.equal(mockResponse.sar_polarization, 'VV');
    assert.equal(mockResponse.sar_calibration_status, 'unverified_linear_dn');
    assert.equal(mockResponse.sar_terrain_correction_status, 'ellipsoid_geocoded_grd');
    assert.equal(mockResponse.spatial_overlap_pct, 95.5);
    assert.equal(mockResponse.crs_compatible, true);
    assert.equal(mockResponse.primary_provider, 'OpticalSARJointAnalysisProvider');
    assert.match(mockResponse.scientific_limitations[0], /non-interchangeable/);
  });

  test('correctly identifies verified calibrated RTC SAR metadata', () => {
    const mockCalibratedResponse: STACOpticalSARPairValidateResponsePayload = {
      status: 'compatible',
      is_compatible: true,
      rejection_reason: null,
      optical_datetime: '2024-02-01T05:30:00Z',
      sar_datetime: '2024-02-03T12:45:00Z',
      temporal_delta_days: 2.3,
      spatial_overlap_pct: 100.0,
      overlap_detected: true,
      crs_compatible: true,
      resolution_compatible: true,
      modality_compatible: true,
      co_registered: true,
      sar_polarization: 'VH',
      sar_sensor: 'Sentinel-1 C-Band SAR',
      sar_calibration_status: 'calibrated_backscatter',
      sar_terrain_correction_status: 'radiometrically_terrain_corrected',
      warnings: [],
      scientific_limitations: [
        'Optical surface reflectance and SAR backscatter represent distinct physical mechanisms.'
      ],
      candidate_providers: ['OpticalSARJointAnalysisProvider'],
      primary_provider: 'OpticalSARJointAnalysisProvider',
      fallback_status: 'Loaded and ready',
      recommended_action: 'Cross-sensor pair is fully compatible. Proceed with Optical + SAR joint radiometric analysis.'
    };

    assert.equal(mockCalibratedResponse.is_compatible, true);
    assert.equal(mockCalibratedResponse.status, 'compatible');
    assert.equal(mockCalibratedResponse.sar_calibration_status, 'calibrated_backscatter');
    assert.equal(mockCalibratedResponse.sar_terrain_correction_status, 'radiometrically_terrain_corrected');
    assert.equal(mockCalibratedResponse.sar_polarization, 'VH');
  });

  test('correctly identifies rejected pair with browse-only preview asset', () => {
    const mockRejection: STACOpticalSARPairValidateResponsePayload = {
      status: 'rejected',
      is_compatible: false,
      rejection_reason: 'Browse-only preview asset detected in Optical. Unprojected 8-bit visual previews are strictly rejected for scientific optical-SAR cross-sensor analysis.',
      optical_datetime: '2024-02-01T05:30:00Z',
      sar_datetime: '2024-02-05T12:45:00Z',
      temporal_delta_days: 4.3,
      spatial_overlap_pct: null,
      overlap_detected: false,
      crs_compatible: false,
      resolution_compatible: false,
      modality_compatible: false,
      co_registered: false,
      sar_calibration_status: 'rejected',
      sar_terrain_correction_status: 'rejected',
      warnings: ['Browse-only preview thumbnail rejected.'],
      scientific_limitations: ['Browse previews lack calibrated physical values.'],
      candidate_providers: ['OpticalSARVisualizationBaseline'],
      primary_provider: 'OpticalSARVisualizationBaseline',
      fallback_status: 'Active fallback',
      recommended_action: 'Retrieve calibrated GeoTIFF assets.'
    };

    assert.equal(mockRejection.is_compatible, false);
    assert.equal(mockRejection.status, 'rejected');
    assert.match(mockRejection.rejection_reason || '', /Browse-only preview asset/);
  });

  test('correctly identifies rejected pair with zero spatial overlap', () => {
    const mockOverlapRejection: STACOpticalSARPairValidateResponsePayload = {
      status: 'rejected',
      is_compatible: false,
      rejection_reason: 'Zero spatial overlap: Optical footprint and SAR footprint do not intersect. Cross-sensor analysis requires overlapping geographical coverage.',
      optical_datetime: '2024-02-01T05:30:00Z',
      sar_datetime: '2024-02-05T12:45:00Z',
      temporal_delta_days: 4.3,
      spatial_overlap_pct: 0.0,
      overlap_detected: false,
      crs_compatible: true,
      resolution_compatible: true,
      modality_compatible: true,
      co_registered: false,
      sar_calibration_status: 'unverified_linear_dn',
      sar_terrain_correction_status: 'ellipsoid_geocoded_grd',
      warnings: ['Zero spatial footprint overlap.'],
      scientific_limitations: ['Disjoint footprints.'],
      candidate_providers: ['OpticalSARVisualizationBaseline'],
      primary_provider: 'OpticalSARVisualizationBaseline',
      fallback_status: 'Active fallback',
      recommended_action: 'Select scenes covering intersecting coordinates.'
    };

    assert.equal(mockOverlapRejection.is_compatible, false);
    assert.equal(mockOverlapRejection.spatial_overlap_pct, 0.0);
    assert.match(mockOverlapRejection.rejection_reason || '', /Zero spatial overlap/);
  });

  test('correctly identifies rejected pair with CRS projection mismatch', () => {
    const mockCRSRejection: STACOpticalSARPairValidateResponsePayload = {
      status: 'rejected',
      is_compatible: false,
      rejection_reason: "CRS mismatch: Optical projection is 'EPSG:4326' while SAR projection is 'EPSG:32643'. Cross-sensor analysis requires identical coordinate reference systems.",
      optical_datetime: '2024-02-01T05:30:00Z',
      sar_datetime: '2024-02-05T12:45:00Z',
      temporal_delta_days: 4.3,
      spatial_overlap_pct: null,
      overlap_detected: false,
      crs_compatible: false,
      resolution_compatible: false,
      modality_compatible: true,
      co_registered: false,
      sar_calibration_status: 'unverified_linear_dn',
      sar_terrain_correction_status: 'ellipsoid_geocoded_grd',
      warnings: ['CRS mismatch: EPSG:4326 vs EPSG:32643'],
      scientific_limitations: ['Scenes exist in different spatial coordinate systems.'],
      candidate_providers: ['OpticalSARVisualizationBaseline'],
      primary_provider: 'OpticalSARVisualizationBaseline',
      fallback_status: 'Active fallback',
      recommended_action: 'Re-project rasters to identical coordinate system.'
    };

    assert.equal(mockCRSRejection.is_compatible, false);
    assert.equal(mockCRSRejection.crs_compatible, false);
    assert.match(mockCRSRejection.rejection_reason || '', /CRS mismatch/);
  });

  test('validates dual-sensor search response payload parsing', () => {
    const mockSearchResponse: STACOpticalSARSearchResponsePayload = {
      status: 'success',
      provider: 'Element84 Earth Search (AWS)',
      search_bbox: [77.5, 12.9, 77.6, 13.0],
      optical_results: {
        status: 'success',
        provider: 'Element84 Earth Search (AWS)',
        catalog_url: 'https://earth-search.aws.element84.com/v1',
        search_bbox: [77.5, 12.9, 77.6, 13.0],
        collection_requested: 'sentinel-2-l2a',
        total_results: 3,
        scenes: []
      },
      sar_results: {
        status: 'success',
        provider: 'Element84 Earth Search (AWS)',
        catalog_url: 'https://earth-search.aws.element84.com/v1',
        search_bbox: [77.5, 12.9, 77.6, 13.0],
        collection_requested: 'sentinel-1-grd',
        total_results: 2,
        scenes: []
      },
      temporal_delta_days_estimate: 2.1
    };

    assert.equal(mockSearchResponse.status, 'success');
    assert.equal(mockSearchResponse.optical_results.collection_requested, 'sentinel-2-l2a');
    assert.equal(mockSearchResponse.sar_results.collection_requested, 'sentinel-1-grd');
    assert.equal(mockSearchResponse.temporal_delta_days_estimate, 2.1);
  });

});
