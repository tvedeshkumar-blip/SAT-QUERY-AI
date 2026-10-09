import { describe, it } from 'node:test';
import assert from 'node:assert';
import { 
  validateBBox, 
  calculateSphericalAreaKm2, 
  formatBBox, 
  DEMO_REGIONS,
  normalizeLongitude 
} from '../utils/geoBounds.ts';

describe('Geospatial AOI Bounding Box Validation (EPSG:4326)', () => {

  it('validates standard valid bounding box in [min_lon, min_lat, max_lon, max_lat] order', () => {
    // Bengaluru region
    const bbox: [number, number, number, number] = [77.45, 12.85, 77.75, 13.15];
    const res = validateBBox(bbox);

    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.crossesAntimeridian, false);
    assert.ok(typeof res.approxAreaKm2 === 'number' && res.approxAreaKm2 > 0);
  });

  it('detects inverted latitude coordinates as invalid', () => {
    // min_lat > max_lat
    const invalidBBox = [77.45, 13.15, 77.75, 12.85];
    const res = validateBBox(invalidBBox);

    assert.strictEqual(res.isValid, false);
    assert.ok(res.error?.includes('Latitude order inverted'));
  });

  it('detects out-of-range latitude values', () => {
    const invalidLat = [0, -95.0, 10, 50.0];
    const res = validateBBox(invalidLat);

    assert.strictEqual(res.isValid, false);
    assert.ok(res.error?.includes('Latitude coordinates out of range'));
  });

  it('detects out-of-range longitude values', () => {
    const invalidLon = [-185.0, 10.0, 10, 20.0];
    const res = validateBBox(invalidLon);

    assert.strictEqual(res.isValid, false);
    assert.ok(res.error?.includes('Longitude coordinates out of range'));
  });

  it('identifies antimeridian-crossing selections without falsifying coordinates', () => {
    // Bounding box crossing 180th meridian from 175°E to -175°W
    const antimeridianBBox: [number, number, number, number] = [175.0, -10.0, -175.0, 10.0];
    const res = validateBBox(antimeridianBBox);

    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.crossesAntimeridian, true);
    assert.ok(typeof res.approxAreaKm2 === 'number' && res.approxAreaKm2 > 0);
  });

  it('correctly calculates spherical area for normal and antimeridian bounding boxes', () => {
    // Normal 1 degree by 1 degree near equator (~111 km x 111 km ~ 12,300 km²)
    const areaNormal = calculateSphericalAreaKm2(0, 0, 1, 1, false);
    assert.ok(areaNormal > 11000 && areaNormal < 13000, `Area ${areaNormal} should be ~12300 km²`);

    // Crossing antimeridian: 179.5 to -179.5 (1 degree delta)
    const areaAntimeridian = calculateSphericalAreaKm2(179.5, 0, -179.5, 1, true);
    assert.strictEqual(Math.round(areaAntimeridian), Math.round(areaNormal));
  });

  it('formats bounding box to required standard order with precision', () => {
    const bbox: [number, number, number, number] = [77.45123, 12.85456, 77.75999, 13.15111];
    const formatted = formatBBox(bbox, 2);
    assert.strictEqual(formatted, '[77.45, 12.85, 77.76, 13.15]');
  });

  it('validates all 3 documented demonstration regions', () => {
    assert.strictEqual(DEMO_REGIONS.length, 3);
    for (const region of DEMO_REGIONS) {
      const res = validateBBox(region.bounds);
      assert.strictEqual(res.isValid, true, `Region ${region.name} must be valid`);
      assert.strictEqual(res.crossesAntimeridian, false);
      assert.ok(res.approxAreaKm2 && res.approxAreaKm2 > 100);
    }
  });

  it('normalizes wrapped longitude coordinates accurately', () => {
    assert.strictEqual(normalizeLongitude(190), -170);
    assert.strictEqual(normalizeLongitude(-190), 170);
    assert.strictEqual(normalizeLongitude(360), 0);
    assert.strictEqual(normalizeLongitude(77.5), 77.5);
  });
});
