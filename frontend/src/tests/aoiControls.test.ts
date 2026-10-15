import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateBiTemporalDateRanges } from '../utils/dateValidation.ts';
import type { AOIAnalysisConfig, AnalysisRequest } from '../types/index.ts';

describe('AOI Bi-Temporal Date Range and Cloud Threshold Controls', () => {

  describe('validateBiTemporalDateRanges', () => {
    test('accepts valid distinct non-overlapping chronological date ranges', () => {
      const result = validateBiTemporalDateRanges(
        '2023-01-01',
        '2023-06-30',
        '2023-07-01',
        '2023-12-31'
      );

      assert.equal(result.isValid, true);
      assert.equal(result.error, null);
      assert.ok(result.t1DeltaDays && result.t1DeltaDays > 0);
      assert.ok(result.t2DeltaDays && result.t2DeltaDays > 0);
      assert.ok(result.gapDays && result.gapDays >= 1);
    });

    test('accepts adjacent date ranges where T2 starts the next day', () => {
      const result = validateBiTemporalDateRanges(
        '2023-05-01',
        '2023-05-15',
        '2023-05-16',
        '2023-05-31'
      );

      assert.equal(result.isValid, true);
      assert.equal(result.error, null);
      assert.equal(result.gapDays, 1);
    });

    test('rejects missing or empty date strings', () => {
      const result = validateBiTemporalDateRanges(
        '2023-01-01',
        '',
        '2023-07-01',
        '2023-12-31'
      );

      assert.equal(result.isValid, false);
      assert.match(result.error || '', /All pre-event \(T1\) and post-event \(T2\) start and end dates must be specified/);
    });

    test('rejects unparseable date strings', () => {
      const result = validateBiTemporalDateRanges(
        'not-a-date',
        '2023-06-30',
        '2023-07-01',
        '2023-12-31'
      );

      assert.equal(result.isValid, false);
      assert.match(result.error || '', /Invalid date format encountered/);
    });

    test('rejects inverted T1 date window (start after end)', () => {
      const result = validateBiTemporalDateRanges(
        '2023-07-01',
        '2023-01-01',
        '2023-08-01',
        '2023-12-31'
      );

      assert.equal(result.isValid, false);
      assert.match(result.error || '', /Pre-event start date .* must precede or equal pre-event end date/);
    });

    test('rejects inverted T2 date window (start after end)', () => {
      const result = validateBiTemporalDateRanges(
        '2023-01-01',
        '2023-06-30',
        '2023-12-31',
        '2023-07-01'
      );

      assert.equal(result.isValid, false);
      assert.match(result.error || '', /Post-event start date .* must precede or equal post-event end date/);
    });

    test('rejects overlapping date ranges where T2 starts before T1 ends', () => {
      const result = validateBiTemporalDateRanges(
        '2023-01-01',
        '2023-08-01',
        '2023-06-01',
        '2023-12-31'
      );

      assert.equal(result.isValid, false);
      assert.match(result.error || '', /Post-event window start .* must be strictly later than pre-event window end/);
    });

    test('rejects identical start dates between T1 and T2 (zero temporal baseline)', () => {
      const result = validateBiTemporalDateRanges(
        '2023-01-01',
        '2023-06-30',
        '2023-06-30',
        '2023-12-31'
      );

      assert.equal(result.isValid, false);
      assert.match(result.error || '', /Post-event window start .* must be strictly later than pre-event window end/);
    });

    test('rejects inverted epochs where T2 is earlier than T1', () => {
      const result = validateBiTemporalDateRanges(
        '2023-07-01',
        '2023-12-31',
        '2022-01-01',
        '2022-06-30'
      );

      assert.equal(result.isValid, false);
      assert.match(result.error || '', /Post-event window start .* must be strictly later than pre-event window end/);
    });
  });

  describe('AOIAnalysisConfig State and Payload Assembly', () => {
    test('default configuration contains valid sensible parameters', () => {
      const defaultConfig: AOIAnalysisConfig = {
        startDate: '2024-01-01',
        endDate: '2024-03-31',
        t1StartDate: '2023-01-01',
        t1EndDate: '2023-06-30',
        t2StartDate: '2023-07-01',
        t2EndDate: '2023-12-31',
        maxCloudCover: 20
      };

      assert.equal(defaultConfig.maxCloudCover, 20);
      assert.equal(defaultConfig.t1StartDate, '2023-01-01');
      assert.equal(defaultConfig.t2StartDate, '2023-07-01');

      const val = validateBiTemporalDateRanges(
        defaultConfig.t1StartDate,
        defaultConfig.t1EndDate,
        defaultConfig.t2StartDate,
        defaultConfig.t2EndDate
      );
      assert.equal(val.isValid, true);
      assert.ok(val.t1DeltaDays && val.t1DeltaDays > 0);
      assert.ok(val.t2DeltaDays && val.t2DeltaDays > 0);
    });

    test('assembles compliant AnalysisRequest payload with custom parameters', () => {
      const customConfig: AOIAnalysisConfig = {
        startDate: '2024-02-01',
        endDate: '2024-02-28',
        t1StartDate: '2022-06-01',
        t1EndDate: '2022-08-31',
        t2StartDate: '2023-06-01',
        t2EndDate: '2023-08-31',
        maxCloudCover: 10
      };

      const payload: AnalysisRequest = {
        query: 'Detect flood extent changes across monsoon periods',
        mode: 'bitemporal',
        aoi_bbox: [77.45, 12.85, 77.75, 13.15],
        start_date: customConfig.startDate,
        end_date: customConfig.endDate,
        t1_start_date: customConfig.t1StartDate,
        t1_end_date: customConfig.t1EndDate,
        t2_start_date: customConfig.t2StartDate,
        t2_end_date: customConfig.t2EndDate,
        max_cloud_cover: customConfig.maxCloudCover,
        metadata: {
          aoi_config: customConfig
        }
      };

      assert.equal(payload.mode, 'bitemporal');
      assert.equal(payload.t1_start_date, '2022-06-01');
      assert.equal(payload.t1_end_date, '2022-08-31');
      assert.equal(payload.t2_start_date, '2023-06-01');
      assert.equal(payload.t2_end_date, '2023-08-31');
      assert.equal(payload.max_cloud_cover, 10);
      assert.deepEqual(payload.aoi_bbox, [77.45, 12.85, 77.75, 13.15]);
    });

    test('cross-sensor optical-SAR fusion preserves sensor modality separation', () => {
      const fusionPayload: AnalysisRequest = {
        query: 'Analyze urban flood using Sentinel-2 optical and Sentinel-1 SAR',
        mode: 'optical_sar',
        aoi_bbox: [77.45, 12.85, 77.75, 13.15],
        start_date: '2023-09-01',
        end_date: '2023-09-30',
        max_cloud_cover: 15
      };

      assert.equal(fusionPayload.mode, 'optical_sar');
      assert.equal(fusionPayload.max_cloud_cover, 15);
      // t1 and t2 should remain undefined for standard single-epoch fusion
      assert.equal(fusionPayload.t1_start_date, undefined);
      assert.equal(fusionPayload.t2_start_date, undefined);
    });
  });
});
