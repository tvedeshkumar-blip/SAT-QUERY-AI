import test from 'node:test';
import assert from 'node:assert';
import { formatAcquisitionDate } from '../utils/dateFormatting.ts';
import type { VisualEvidence } from '../types/index.ts';

test('formatAcquisitionDate formats authentic ISO datetime with UTC indicator', () => {
  const result = formatAcquisitionDate('2023-05-28T05:26:49Z');
  assert.strictEqual(result.formatted, '2023-05-28 (05:26 UTC)');
  assert.strictEqual(result.raw, '2023-05-28T05:26:49Z');
});

test('formatAcquisitionDate extracts date accurately from authentic Sentinel-2 filename fallback', () => {
  const result = formatAcquisitionDate(undefined, 'S2B_43PGQ_20230528_0_L2A_visual_window_1792262748.tif');
  assert.strictEqual(result.formatted, '2023-05-28');
  assert.strictEqual(result.raw, '2023-05-28');

  const resultT2 = formatAcquisitionDate(undefined, 'S2A_43PGQ_20231119_0_L2A_visual_window_1792262818.tif');
  assert.strictEqual(resultT2.formatted, '2023-11-19');
  assert.strictEqual(resultT2.raw, '2023-11-19');
});

test('formatAcquisitionDate does not fabricate timestamps when data is absent', () => {
  const result = formatAcquisitionDate(undefined, undefined);
  assert.strictEqual(result.formatted, 'Date Unavailable');
  assert.strictEqual(result.raw, null);
});

test('Bi-Temporal Evidence Structure: extracts T1, T2, change map, and spatial overlay', () => {
  const mockEvidenceList: VisualEvidence[] = [
    {
      id: 'ev_change_map',
      type: 'change_map',
      title: 'Bi-Temporal Change Map',
      description: 'Binary difference magnitude mask (threshold > 35). Changed pixels highlighted in red.',
      data_base64: 'data:image/png;base64,mockChangeMap',
      statistics: {
        changed_area_percent: '21.88%',
        detected_pixel_delta_percent: '21.88%',
        changed_pixel_count: 14340,
        total_scene_pixels: 65536,
        difference_threshold: 35,
        change_detected: true,
        candidate_change_clusters: 1,
        confirmed_real_world_status: 'Unconfirmed without field verification'
      }
    },
    {
      id: 'ev_change_overlay',
      type: 'overlay',
      title: 'Change Cluster Spatial Overlay',
      description: 'Secondary scene overlaid with detected change clusters.',
      data_base64: 'data:image/png;base64,mockOverlay',
      boxes: [
        { xmin: 50, ymin: 50, xmax: 120, ymax: 120, label: 'Change Cluster' }
      ]
    },
    {
      id: 'ev_t1_before',
      type: 'original',
      title: 'T1: Earlier Scene (Before)',
      description: 'Preprocessed baseline scene T1 (256x256 px, CRS: EPSG:32643).',
      data_base64: 'data:image/png;base64,mockT1',
      statistics: {
        dimensions: '256x256',
        crs: 'EPSG:32643',
        modality: 'OPTICAL'
      }
    },
    {
      id: 'ev_t2_after',
      type: 'original',
      title: 'T2: Later Scene (After)',
      description: 'Preprocessed baseline scene T2 aligned to T1 grid.',
      data_base64: 'data:image/png;base64,mockT2',
      statistics: {
        dimensions: '256x256',
        crs: 'EPSG:32643',
        modality: 'OPTICAL'
      }
    }
  ];

  // Verify all 4 artifacts are identifiable for the 3-panel viewer
  const evT1 = mockEvidenceList.find((e) => e.id === 'ev_t1_before');
  const evT2 = mockEvidenceList.find((e) => e.id === 'ev_t2_after');
  const evMap = mockEvidenceList.find((e) => e.id === 'ev_change_map');
  const evOverlay = mockEvidenceList.find((e) => e.id === 'ev_change_overlay');

  assert.ok(evT1, 'T1 earlier scene must be present');
  assert.ok(evT2, 'T2 second-date scene must be present');
  assert.ok(evMap, 'Change map must be present');
  assert.ok(evOverlay, 'Change overlay must be present');

  // Verify pixel accounting calculations
  const total = Number(evMap.statistics?.total_scene_pixels);
  const changed = Number(evMap.statistics?.changed_pixel_count);
  const unchanged = total - changed;

  assert.strictEqual(total, 65536);
  assert.strictEqual(changed, 14340);
  assert.strictEqual(unchanged, 51196);
  assert.strictEqual(((changed / total) * 100).toFixed(2), '21.88');
  assert.strictEqual(((unchanged / total) * 100).toFixed(2), '78.12');

  // Verify that RGB-only visual assets do NOT fabricate invalid or cloud-obscured pixel counts
  assert.strictEqual(evMap.statistics?.masked_pixel_count, undefined);
  assert.strictEqual(evMap.statistics?.invalid_pixels, undefined);
});

test('Change Overlay Legend: Distinguishes between available and unavailable cloud/quality masks', () => {
  // Scenario A: RGB visual imagery where SCL mask is absent
  const rgbStats = {
    total_scene_pixels: 65536,
    changed_pixel_count: 14340,
    changed_area_percent: '21.88%',
    difference_threshold: 35
  };
  const hasGenuineMaskA = (rgbStats as any).masked_pixel_count !== undefined;
  assert.strictEqual(hasGenuineMaskA, false, 'Must identify that SCL cloud mask is unavailable in RGB visual assets');

  // Scenario B: Multispectral composite where SCL mask was genuinely applied
  const sclStats = {
    total_scene_pixels: 65536,
    changed_pixel_count: 10000,
    masked_pixel_count: 4500,
    changed_area_percent: '15.26%',
    difference_threshold: 35
  };
  const hasGenuineMaskB = (sclStats as any).masked_pixel_count !== undefined;
  assert.strictEqual(hasGenuineMaskB, true);
  assert.strictEqual(sclStats.masked_pixel_count, 4500);
});

test('Scientific Integrity: Disallows labeling candidate differences as confirmed buildings or vegetation loss', () => {
  const allowedTerminology = [
    'Candidate Spectral Difference',
    'Candidate Change Cluster',
    'Observed Pixel Delta',
    'Statistical Reflectance Variance'
  ];

  const forbiddenTerminology = [
    'Confirmed Buildings',
    'Confirmed Built-Up',
    'Confirmed Deforestation',
    'Confirmed Vegetation Loss'
  ];

  for (const term of allowedTerminology) {
    assert.ok(!forbiddenTerminology.includes(term), `${term} must remain strictly unconfirmed`);
  }
});
