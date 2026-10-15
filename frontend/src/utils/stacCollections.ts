export interface STACCollectionOption {
  id: string;
  label: string;
  modality: 'OPTICAL' | 'SAR';
  provider: string;
  catalogUrl: string;
  description: string;
}

export const SUPPORTED_STAC_COLLECTIONS: STACCollectionOption[] = [
  {
    id: 'sentinel-2-l2a',
    label: 'Sentinel-2 L2A (Optical BOA Reflectance)',
    modality: 'OPTICAL',
    provider: 'Element84 Earth Search (AWS)',
    catalogUrl: 'https://earth-search.aws.element84.com/v1',
    description: 'Element84 Earth Search (AWS) — BOA Surface Reflectance'
  },
  {
    id: 'sentinel-1-rtc',
    label: 'Sentinel-1 RTC (Terrain-Corrected SAR)',
    modality: 'SAR',
    provider: 'Microsoft Planetary Computer',
    catalogUrl: 'https://planetarycomputer.microsoft.com/api/stac/v1',
    description: 'Planetary Computer (Microsoft) — Terrain-Corrected Backscatter'
  }
];

/**
 * Returns true if the collection represents SAR radar data where
 * cloud cover constraints do not physically apply.
 */
export const isSarCollection = (col?: string | null): boolean => {
  if (!col) return false;
  const lower = col.toLowerCase();
  return lower === 'sentinel-1-rtc' || lower === 'sentinel-1-grd' || lower.includes('sar') || lower.includes('rtc');
};

/**
 * Derives the authentic primary STAC catalog provider for a given collection ID.
 */
export const getCollectionProvider = (col?: string | null): string => {
  return isSarCollection(col) ? 'Microsoft Planetary Computer' : 'Element84 Earth Search (AWS)';
};
