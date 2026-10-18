import type { UploadedFileState, WorkspaceContext, WorkspaceSceneSummary } from '../types';

/**
 * Safely extracts structured metadata from imported workspace scenes (T1/T2)
 * without including heavy base64 dataUrls or raw raster arrays.
 */
export function buildWorkspaceContext(
  files: UploadedFileState[],
  mode: string,
  aoiBbox?: number[]
): WorkspaceContext | null {
  if (!files || files.length === 0) {
    return null;
  }

  const scenes: WorkspaceSceneSummary[] = files.map((f) => {
    const prov = f.stacProvenance || {};
    const val = f.validation || {};
    const rasterMeta = val.raster_metadata || {};

    const summary: WorkspaceSceneSummary = {
      role: f.role,
      filename: f.filename,
    };

    if (prov.scene_id) summary.scene_id = String(prov.scene_id);
    else if (prov.id) summary.scene_id = String(prov.id);

    if (prov.datetime) summary.datetime = String(prov.datetime);
    if (prov.collection) summary.collection = String(prov.collection);
    if (prov.sensor) summary.sensor = String(prov.sensor);

    if (prov.platform) {
      summary.platform = String(prov.platform);
    } else {
      const hint = `${prov.sensor || ''} ${prov.collection || ''} ${prov.scene_id || ''}`.toLowerCase();
      if (hint.includes('sentinel-2') || hint.includes('s2a') || hint.includes('s2b')) {
        summary.platform = 'Sentinel-2';
      } else if (hint.includes('sentinel-1') || hint.includes('s1a') || hint.includes('s1b')) {
        summary.platform = 'Sentinel-1';
      } else if (hint.includes('landsat')) {
        summary.platform = 'Landsat';
      }
    }

    if (prov.modality) summary.modality = String(prov.modality);
    if (prov.asset_key) summary.asset_key = String(prov.asset_key);
    if (f.assetCategory) summary.asset_category = String(f.assetCategory);
    if (typeof f.isGeoTIFF === 'boolean') summary.is_geotiff = f.isGeoTIFF;

    const crs = rasterMeta.crs_display || rasterMeta.crs || val.crs;
    if (crs) summary.crs = String(crs);

    const width = rasterMeta.width ?? val.width;
    const height = rasterMeta.height ?? val.height;
    if (typeof width === 'number' && typeof height === 'number') {
      summary.dimensions = { width, height };
    }

    const extent = rasterMeta.bounds || rasterMeta.bbox || val.bounds || val.spatial_extent;
    if (extent) summary.spatial_extent = extent;

    if (typeof prov.cloud_cover === 'number') {
      summary.cloud_cover = prov.cloud_cover;
    }

    if (Array.isArray(f.scientificLimitations) && f.scientificLimitations.length > 0) {
      summary.scientific_limitations = f.scientificLimitations;
    }

    return summary;
  });

  return {
    mode,
    scene_count: scenes.length,
    scenes,
    ...(aoiBbox && aoiBbox.length === 4 ? { aoi_bbox: aoiBbox } : {}),
  };
}
