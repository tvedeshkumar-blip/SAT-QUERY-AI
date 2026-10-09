/**
 * Geospatial Bounding Box (AOI) Utilities and Scientific Validation
 * Strictly conforms to EPSG:4326 (WGS84) standard: [min_lon, min_lat, max_lon, max_lat]
 */

export type AOIBounds = [number, number, number, number];

export interface BBoxValidationResult {
  isValid: boolean;
  error?: string;
  crossesAntimeridian: boolean;
  approxAreaKm2?: number;
}

export interface DemoRegion {
  id: string;
  name: string;
  description: string;
  bounds: AOIBounds; // [min_lon, min_lat, max_lon, max_lat]
  modalityTarget: string;
  notes: string;
}

/**
 * 3 Documented Demonstration Regions for Quick Selection
 */
export const DEMO_REGIONS: DemoRegion[] = [
  {
    id: 'bengaluru',
    name: 'Bengaluru Urban Corridor',
    description: 'Karnataka, India (Cartosat Optical Baseline)',
    bounds: [77.4500, 12.8500, 77.7500, 13.1500],
    modalityTarget: 'Optical / Multispectral',
    notes: 'Centers on the Bengaluru metropolitan region and lake networks. Corresponds to Cartosat-2/3 UTM Zone 44N (EPSG:32644) test rasters.'
  },
  {
    id: 'mumbai',
    name: 'Mumbai Coastal & Port Estuary',
    description: 'Maharashtra, India (RISAT SAR Baseline)',
    bounds: [72.7500, 18.8800, 73.0500, 19.2500],
    modalityTarget: 'C-Band SAR Backscatter',
    notes: 'Coastal sea-land interface, tidal mudflats, and urban corner reflectors. Corresponds to RISAT-1A SAR test rasters.'
  },
  {
    id: 'levir_cd',
    name: 'LEVIR-CD Benchmark Region',
    description: 'Standard Bi-Temporal Change Benchmark',
    bounds: [116.2000, 39.8000, 116.5000, 40.1000],
    modalityTarget: 'Bi-Temporal Optical',
    notes: 'Reference urban/suburban building modification zone from the LEVIR-CD change detection benchmark (Chen & Shi, IEEE TGRS 2021).'
  }
];

/**
 * Normalizes longitude to [-180, 180] degrees
 */
export function normalizeLongitude(lon: number): number {
  let normalized = lon % 360;
  if (normalized > 180) {
    normalized -= 360;
  } else if (normalized < -180) {
    normalized += 360;
  }
  return Number(normalized.toFixed(6));
}

/**
 * Validates a WGS84 bounding box [min_lon, min_lat, max_lon, max_lat].
 * 
 * Rules:
 * 1. Must contain exactly 4 numeric values.
 * 2. Latitudes must reside strictly in [-90, 90].
 * 3. min_lat must be <= max_lat (no latitude inversion).
 * 4. Longitudes must reside in [-180, 180] (or normalized).
 * 5. If min_lon > max_lon, the bounding box crosses the 180th meridian (Antimeridian).
 *    In this case, the selection is recognized as antimeridian-crossing rather than invalid.
 * 6. Never silently clamp, invert, or falsify coordinates.
 */
export function validateBBox(bbox: unknown): BBoxValidationResult {
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    return {
      isValid: false,
      crossesAntimeridian: false,
      error: 'Bounding box must be an array of exactly 4 numeric coordinates [min_lon, min_lat, max_lon, max_lat].'
    };
  }

  const [minLon, minLat, maxLon, maxLat] = bbox.map(Number);

  if ([minLon, minLat, maxLon, maxLat].some((n) => typeof n !== 'number' || isNaN(n))) {
    return {
      isValid: false,
      crossesAntimeridian: false,
      error: 'All coordinates in bounding box must be valid numbers.'
    };
  }

  // Latitude checks
  if (minLat < -90 || minLat > 90 || maxLat < -90 || maxLat > 90) {
    return {
      isValid: false,
      crossesAntimeridian: false,
      error: `Latitude coordinates out of range [-90, 90]. Received min_lat=${minLat}, max_lat=${maxLat}.`
    };
  }

  if (minLat > maxLat) {
    return {
      isValid: false,
      crossesAntimeridian: false,
      error: `Latitude order inverted: min_lat (${minLat}) cannot be greater than max_lat (${maxLat}).`
    };
  }

  // Longitude range check
  if (minLon < -180 || minLon > 180 || maxLon < -180 || maxLon > 180) {
    return {
      isValid: false,
      crossesAntimeridian: false,
      error: `Longitude coordinates out of range [-180, 180]. Received min_lon=${minLon}, max_lon=${maxLon}.`
    };
  }

  // Check antimeridian crossing
  const crossesAntimeridian = minLon > maxLon;

  // Approximate surface area calculation (WGS84 spherical approximation)
  const approxAreaKm2 = calculateSphericalAreaKm2(minLon, minLat, maxLon, maxLat, crossesAntimeridian);

  return {
    isValid: true,
    crossesAntimeridian,
    approxAreaKm2
  };
}

/**
 * Calculates approximate surface area of a bounding box on the WGS84 sphere in km²
 */
export function calculateSphericalAreaKm2(
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
  crossesAntimeridian: boolean
): number {
  const EARTH_RADIUS_KM = 6371.0;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const lat1Rad = toRad(minLat);
  const lat2Rad = toRad(maxLat);

  let deltaLonDeg = maxLon - minLon;
  if (crossesAntimeridian) {
    // E.g. minLon = 175, maxLon = -175 -> deltaLon = (180 - 175) + (-175 - (-180)) = 5 + 5 = 10
    deltaLonDeg = (180 - minLon) + (maxLon - (-180));
  }
  const deltaLonRad = toRad(Math.abs(deltaLonDeg));

  const area = Math.pow(EARTH_RADIUS_KM, 2) * deltaLonRad * Math.abs(Math.sin(lat2Rad) - Math.sin(lat1Rad));
  return Math.round(area * 100) / 100;
}

/**
 * Formats bounding box coordinates as a readable string
 */
export function formatBBox(bbox: AOIBounds, precision: number = 4): string {
  return `[${bbox[0].toFixed(precision)}, ${bbox[1].toFixed(precision)}, ${bbox[2].toFixed(precision)}, ${bbox[3].toFixed(precision)}]`;
}
