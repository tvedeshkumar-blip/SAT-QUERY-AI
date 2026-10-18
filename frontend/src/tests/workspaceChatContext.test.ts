import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaceContext } from '../utils/workspaceContext.ts';
import type { UploadedFileState, ChatRequestPayload } from '../types/index.ts';

describe('Workspace Scene Context Construction & Chat Grounding Tests', () => {

  test('returns null when no files are uploaded or staged', () => {
    assert.equal(buildWorkspaceContext([], 'single'), null);
    assert.equal(buildWorkspaceContext(undefined as unknown as UploadedFileState[], 'bitemporal'), null);
  });

  test('correctly constructs structured WorkspaceContext from imported T1 and T2 scenes', () => {
    const t1: UploadedFileState = {
      filename: 'S2A_20230601_T43PGQ_B04.tif',
      dataUrl: 'data:image/tiff;base64,AA==',
      role: 'primary',
      isGeoTIFF: true,
      assetCategory: 'scientific_raster',
      stacProvenance: {
        provider: 'AWS Earth Search',
        collection: 'sentinel-2-l2a',
        scene_id: 'S2A_MSIL2A_20230601T052651_N0509_R105_T43PGQ',
        datetime: '2023-06-01T05:26:51Z',
        sensor: 'MSI (Multi-Spectral Instrument)',
        modality: 'OPTICAL',
        asset_key: 'B04',
        cloud_cover: 4.2
      },
      validation: {
        file_format: 'GeoTIFF',
        raster_metadata: {
          crs: 'EPSG:32643',
          crs_display: 'WGS 84 / UTM zone 43N',
          width: 512,
          height: 512,
          bounds: [72.8, 18.9, 73.0, 19.1]
        }
      },
      scientificLimitations: ['Surface reflectance calibrated via Sen2Cor']
    };

    const t2: UploadedFileState = {
      filename: 'S2B_20231201_T43PGQ_B04.tif',
      dataUrl: 'data:image/tiff;base64,BB==',
      role: 'secondary',
      isGeoTIFF: true,
      assetCategory: 'scientific_raster',
      stacProvenance: {
        provider: 'AWS Earth Search',
        collection: 'sentinel-2-l2a',
        scene_id: 'S2B_MSIL2A_20231201T052709_N0510_R105_T43PGQ',
        datetime: '2023-12-01T05:27:09Z',
        sensor: 'MSI (Multi-Spectral Instrument)',
        modality: 'OPTICAL',
        asset_key: 'B04',
        cloud_cover: 1.8
      },
      validation: {
        file_format: 'GeoTIFF',
        raster_metadata: {
          crs: 'EPSG:32643',
          crs_display: 'WGS 84 / UTM zone 43N',
          width: 512,
          height: 512,
          bounds: [72.8, 18.9, 73.0, 19.1]
        }
      }
    };

    const context = buildWorkspaceContext([t1, t2], 'bitemporal', [72.8, 18.9, 73.0, 19.1]);

    assert.ok(context);
    assert.equal(context.mode, 'bitemporal');
    assert.equal(context.scene_count, 2);
    assert.deepEqual(context.aoi_bbox, [72.8, 18.9, 73.0, 19.1]);

    const s1 = context.scenes[0];
    assert.equal(s1.role, 'primary');
    assert.equal(s1.scene_id, 'S2A_MSIL2A_20230601T052651_N0509_R105_T43PGQ');
    assert.equal(s1.platform, 'Sentinel-2');
    assert.equal(s1.datetime, '2023-06-01T05:26:51Z');
    assert.equal(s1.crs, 'WGS 84 / UTM zone 43N');
    assert.deepEqual(s1.dimensions, { width: 512, height: 512 });
    assert.equal(s1.is_geotiff, true);
    assert.equal(s1.cloud_cover, 4.2);
    assert.deepEqual(s1.scientific_limitations, ['Surface reflectance calibrated via Sen2Cor']);

    const s2 = context.scenes[1];
    assert.equal(s2.role, 'secondary');
    assert.equal(s2.scene_id, 'S2B_MSIL2A_20231201T052709_N0510_R105_T43PGQ');
    assert.equal(s2.platform, 'Sentinel-2');
    assert.equal(s2.datetime, '2023-12-01T05:27:09Z');
    assert.equal(s2.cloud_cover, 1.8);
  });

  test('does not invent missing metadata for scenes with partial provenance', () => {
    const rawFile: UploadedFileState = {
      filename: 'local_upload.tif',
      dataUrl: 'data:image/tiff;base64,XX==',
      role: 'primary',
      isGeoTIFF: true
    };

    const context = buildWorkspaceContext([rawFile], 'single');

    assert.ok(context);
    assert.equal(context.scene_count, 1);
    const s = context.scenes[0];
    assert.equal(s.filename, 'local_upload.tif');
    assert.equal(s.role, 'primary');
    assert.equal(s.scene_id, undefined);
    assert.equal(s.datetime, undefined);
    assert.equal(s.crs, undefined);
    assert.equal(s.dimensions, undefined);
    assert.equal(s.spatial_extent, undefined);
    assert.equal(context.aoi_bbox, undefined);
  });

  test('assembles compliant ChatRequestPayload with workspace_context', () => {
    const payload: ChatRequestPayload = {
      message: 'What scenes are loaded in the workspace?',
      conversation_id: 'conv_12345',
      history: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Welcome to SatQuery AI.' }
      ],
      workspace_context: {
        mode: 'bitemporal',
        scene_count: 2,
        scenes: [
          { role: 'primary', filename: 't1.tif', scene_id: 'T1_ID' },
          { role: 'secondary', filename: 't2.tif', scene_id: 'T2_ID' }
        ]
      }
    };

    const serialized = JSON.stringify(payload);
    const parsed = JSON.parse(serialized);

    assert.equal(parsed.message, 'What scenes are loaded in the workspace?');
    assert.equal(parsed.conversation_id, 'conv_12345');
    assert.equal(parsed.workspace_context.scene_count, 2);
    assert.equal(parsed.workspace_context.scenes[0].scene_id, 'T1_ID');
    assert.equal(parsed.workspace_context.scenes[1].scene_id, 'T2_ID');
    assert.equal(parsed.evidence, undefined);
  });

});
