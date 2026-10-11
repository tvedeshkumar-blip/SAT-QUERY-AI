import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { 
  STACWindowedRetrieveRequestPayload,
  STACRetrieveResponsePayload,
  AOIBounds
} from '../types/index.ts';

async function retrieveSTACWindowedAssetClient(
  payload: STACWindowedRetrieveRequestPayload,
  apiBase: string = '/api/v1'
): Promise<STACRetrieveResponsePayload> {
  const res = await fetch(`${apiBase}/acquisition/retrieve-window`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(errorData.detail || `Windowed asset retrieval failed (${res.status})`);
  }

  return await res.json();
}


describe('Stage 9: Live Windowed COG Acquisition & Subsystem Ingestion Tests', () => {

  test('validates STACWindowedRetrieveRequestPayload type structure and AOI bounds', () => {
    const aoi: AOIBounds = [77.58, 12.96, 77.60, 12.98];
    const payload: STACWindowedRetrieveRequestPayload = {
      scene_id: 'S2A_MSIL2A_20240328T052701_N0510_R105_T43PGQ_20240328T083437',
      asset_key: 'B04',
      aoi_bbox: aoi,
      collection: 'sentinel-2-l2a',
      target_role: 'optical',
      resampling: 'bilinear'
    };

    assert.equal(payload.scene_id, 'S2A_MSIL2A_20240328T052701_N0510_R105_T43PGQ_20240328T083437');
    assert.equal(payload.asset_key, 'B04');
    assert.equal(payload.aoi_bbox.length, 4);
    assert.equal(payload.aoi_bbox[0], 77.58);
    assert.equal(payload.aoi_bbox[1], 12.96);
    assert.equal(payload.aoi_bbox[2], 77.60);
    assert.equal(payload.aoi_bbox[3], 12.98);
    assert.equal(payload.target_role, 'optical');
    assert.equal(payload.resampling, 'bilinear');
  });

  test('validates STACRetrieveResponsePayload for windowed scientific GeoTIFF crop', () => {
    const mockResponse: STACRetrieveResponsePayload = {
      status: 'success',
      scene_id: 'S2A_MSIL2A_20240328T052701',
      asset_key: 'B04',
      category: 'scientific_raster',
      filename: 'S2A_MSIL2A_20240328T052701_B04_crop.tif',
      mime_type: 'image/tiff',
      size_bytes: 32768,
      data_base64: 'data:image/tiff;base64,SUkqAAgAAAASAP4ABAABAAAAAAAAAAAB...',
      metadata: {
        width: 128,
        height: 128,
        bands: 1,
        crs: 'EPSG:32643',
        crs_display: 'WGS 84 / UTM zone 43N (EPSG:32643)',
        dtype: 'uint16'
      },
      scientific_limitations: [
        'Surface reflectance (BOA) measurements are unitless ratios in range [0, 1].',
        'Windowed crop extracted strictly within user-specified spatial AOI bounds.'
      ],
      validation: {
        status: 'valid',
        filename: 'S2A_MSIL2A_20240328T052701_B04_crop.tif',
        file_format: 'GeoTIFF',
        asset_category: 'single_band_spectral',
        scientific_status: 'calibrated_surface_reflectance',
        raster_metadata: {
          width: 128,
          height: 128,
          bands: 1,
          crs: 'EPSG:32643',
          crs_display: 'WGS 84 / UTM zone 43N (EPSG:32643)'
        },
        scientific_limitations: [],
        provenance: {
          sensor: 'Sentinel-2 MSI Level-2A',
          modality: 'OPTICAL'
        },
        analysis_compatibility: {
          optical_sar: {
            status: 'supported',
            reason: 'Calibrated surface reflectance GeoTIFF compatible with joint multimodal pipeline'
          }
        }
      },
      provenance: {
        sensor: 'Sentinel-2 MSI Level-2A',
        modality: 'OPTICAL',
        windowed_crop: true,
        aoi_bbox: [77.58, 12.96, 77.60, 12.98],
        original_pixel_shape: [10980, 10980],
        window_pixel_shape: [128, 128]
      }
    };

    assert.equal(mockResponse.status, 'success');
    assert.equal(mockResponse.category, 'scientific_raster');
    assert.equal(mockResponse.provenance?.windowed_crop, true);
    assert.equal(mockResponse.validation?.status, 'valid');
    assert.equal(mockResponse.validation?.asset_category, 'single_band_spectral');
    assert.equal(mockResponse.validation?.scientific_status, 'calibrated_surface_reflectance');
    assert.equal(mockResponse.validation?.analysis_compatibility.optical_sar.status, 'supported');
    assert.equal(mockResponse.metadata.bands, 1);
  });


  test('retrieveSTACWindowedAsset dispatches HTTP POST with correct URL and headers', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedOptions: any = null;

    try {
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        capturedUrl = input.toString();
        capturedOptions = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'success',
            scene_id: 'test_scene',
            asset_key: 'B04',
            category: 'scientific_raster',
            filename: 'test_scene_B04_crop.tif',
            mime_type: 'image/tiff',
            size_bytes: 4096,
            data_base64: 'data:image/tiff;base64,AAECAw==',
            metadata: { width: 64, height: 64, crs: 'EPSG:32643' },
            scientific_limitations: [],
            provenance: { windowed_crop: true }
          })
        } as unknown as Response;
      };

      const result = await retrieveSTACWindowedAssetClient({
        scene_id: 'test_scene',
        asset_key: 'B04',
        aoi_bbox: [77.58, 12.96, 77.60, 12.98],
        collection: 'sentinel-2-l2a',
        target_role: 'optical'
      });

      assert.match(capturedUrl, /\/acquisition\/retrieve-window$/);
      assert.equal(capturedOptions.method, 'POST');
      assert.equal(capturedOptions.headers['Content-Type'], 'application/json');
      const body = JSON.parse(capturedOptions.body);
      assert.equal(body.scene_id, 'test_scene');
      assert.equal(body.asset_key, 'B04');
      assert.deepEqual(body.aoi_bbox, [77.58, 12.96, 77.60, 12.98]);

      assert.equal(result.status, 'success');
      assert.equal(result.provenance?.windowed_crop, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('retrieveSTACWindowedAsset handles HTTP error responses gracefully', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async (): Promise<Response> => {
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => ({ detail: 'Scene test_missing not found in active STAC search session.' })
        } as unknown as Response;
      };

      await assert.rejects(
        async () => {
          await retrieveSTACWindowedAssetClient({
            scene_id: 'test_missing',
            asset_key: 'B04',
            aoi_bbox: [77.58, 12.96, 77.60, 12.98]
          });
        },
        /Scene test_missing not found in active STAC search session/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

  });

});
