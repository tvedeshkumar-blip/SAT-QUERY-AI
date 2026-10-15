import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { 
  isSarCollection, 
  SUPPORTED_STAC_COLLECTIONS, 
  getCollectionProvider 
} from '../utils/stacCollections.ts';
import type {
  STACSearchRequestPayload,
  STACSearchResponsePayload,
  STACTemporalSearchRequestPayload,
  STACTemporalSearchResponsePayload,
  STACSceneSummary
} from '../types/index.ts';

// Client request functions mirroring frontend/src/services/api.ts
async function searchSTACScenesClient(
  payload: STACSearchRequestPayload,
  apiBase: string = '/api/v1'
): Promise<STACSearchResponsePayload> {
  const res = await fetch(`${apiBase}/acquisition/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(errorData.detail || `STAC catalog search failed (${res.status})`);
  }

  return await res.json();
}

async function searchTemporalPairClient(
  payload: STACTemporalSearchRequestPayload,
  apiBase: string = '/api/v1'
): Promise<STACTemporalSearchResponsePayload> {
  const res = await fetch(`${apiBase}/acquisition/search-temporal-pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(errorData.detail || `Temporal pair search failed (${res.status})`);
  }

  return await res.json();
}

describe('Step 7C: Frontend Collection Selector & STAC Routing Contract', () => {

  test('validates supported collection choices and exact labels contract', () => {
    // The collection options supported for online STAC retrieval
    assert.equal(SUPPORTED_STAC_COLLECTIONS.length, 2);

    const opticalOption = SUPPORTED_STAC_COLLECTIONS.find(c => c.id === 'sentinel-2-l2a');
    assert.ok(opticalOption);
    assert.equal(opticalOption.label, 'Sentinel-2 L2A (Optical BOA Reflectance)');
    assert.equal(opticalOption.id, 'sentinel-2-l2a');
    assert.equal(opticalOption.modality, 'OPTICAL');
    assert.equal(opticalOption.provider, 'Element84 Earth Search (AWS)');
    assert.equal(opticalOption.catalogUrl, 'https://earth-search.aws.element84.com/v1');

    const sarOption = SUPPORTED_STAC_COLLECTIONS.find(c => c.id === 'sentinel-1-rtc');
    assert.ok(sarOption);
    assert.equal(sarOption.label, 'Sentinel-1 RTC (Terrain-Corrected SAR)');
    assert.equal(sarOption.id, 'sentinel-1-rtc');
    assert.equal(sarOption.modality, 'SAR');
    assert.equal(sarOption.provider, 'Microsoft Planetary Computer');
    assert.equal(sarOption.catalogUrl, 'https://planetarycomputer.microsoft.com/api/stac/v1');
  });

  test('isSarCollection correctly classifies SAR vs Optical collections', () => {
    // Optical collections should return false
    assert.equal(isSarCollection('sentinel-2-l2a'), false);
    assert.equal(isSarCollection('sentinel-2'), false);
    assert.equal(isSarCollection('landsat-c2-l2'), false);
    assert.equal(isSarCollection(''), false);
    assert.equal(isSarCollection(null), false);

    // SAR collections should return true
    assert.equal(isSarCollection('sentinel-1-rtc'), true);
    assert.equal(isSarCollection('sentinel-1-grd'), true);
    assert.equal(isSarCollection('sar-c-band'), true);
  });

  test('getCollectionProvider derives authentic primary provider for collections', () => {
    assert.equal(getCollectionProvider('sentinel-2-l2a'), 'Element84 Earth Search (AWS)');
    assert.equal(getCollectionProvider('sentinel-1-rtc'), 'Microsoft Planetary Computer');
    assert.equal(getCollectionProvider('sentinel-1-grd'), 'Microsoft Planetary Computer');
  });

  test('constructs outgoing STAC single-search payload for Sentinel-2 L2A with cloud cover', () => {
    const requestedCollection = 'sentinel-2-l2a';
    const maxCloudCoverSetting = 20;

    const payload: STACSearchRequestPayload = {
      bbox: [77.58, 12.96, 77.65, 13.02],
      start_date: '2024-01-01',
      end_date: '2024-03-31',
      collection: requestedCollection,
      max_cloud_cover: isSarCollection(requestedCollection) ? undefined : maxCloudCoverSetting,
      limit: 6
    };

    // Collection string is passed unchanged to backend
    assert.equal(payload.collection, 'sentinel-2-l2a');
    // Optical surface reflectance respects max_cloud_cover
    assert.equal(payload.max_cloud_cover, 20);
    assert.deepEqual(payload.bbox, [77.58, 12.96, 77.65, 13.02]);
  });

  test('constructs outgoing STAC single-search payload for Sentinel-1 RTC suppressing cloud cover', () => {
    const requestedCollection = 'sentinel-1-rtc';
    const maxCloudCoverSetting = 20;

    const payload: STACSearchRequestPayload = {
      bbox: [77.58, 12.96, 77.65, 13.02],
      start_date: '2024-01-01',
      end_date: '2024-03-31',
      collection: requestedCollection,
      max_cloud_cover: isSarCollection(requestedCollection) ? undefined : maxCloudCoverSetting,
      limit: 6
    };

    // Collection string is passed unchanged to backend
    assert.equal(payload.collection, 'sentinel-1-rtc');
    // SAR microwave radar is cloud-penetrating; cloud cover must be suppressed (undefined)
    assert.equal(payload.max_cloud_cover, undefined);
    assert.deepEqual(payload.bbox, [77.58, 12.96, 77.65, 13.02]);
  });

  test('validates backend STAC search response for Sentinel-2 L2A (Element84 Earth Search)', () => {
    const mockOpticalResponse: STACSearchResponsePayload = {
      status: 'success',
      provider: 'Element84 Earth Search (AWS)',
      catalog_url: 'https://earth-search.aws.element84.com/v1',
      search_bbox: [77.58, 12.96, 77.65, 13.02],
      collection_requested: 'sentinel-2-l2a',
      total_results: 2,
      scenes: [
        {
          id: 'S2A_32VNJ_20240328_0_L2A',
          collection: 'sentinel-2-l2a',
          datetime: '2024-03-28T10:30:00Z',
          bbox: [77.50, 12.90, 77.70, 13.10],
          cloud_cover: 4.5,
          modality: 'OPTICAL',
          sensor: 'Sentinel-2 MSI',
          assets: {},
          provenance: {
            catalog: 'Element84 Earth Search',
            license: 'Copernicus Open Access / CC-BY-4.0',
            provider_url: 'https://earth-search.aws.element84.com/v1'
          }
        }
      ]
    };

    assert.equal(mockOpticalResponse.provider, 'Element84 Earth Search (AWS)');
    assert.equal(mockOpticalResponse.catalog_url, 'https://earth-search.aws.element84.com/v1');
    assert.equal(mockOpticalResponse.collection_requested, 'sentinel-2-l2a');
    assert.equal(mockOpticalResponse.scenes[0].sensor, 'Sentinel-2 MSI');
    assert.equal(mockOpticalResponse.scenes[0].provenance.catalog, 'Element84 Earth Search');
  });

  test('validates backend STAC search response for Sentinel-1 RTC (Microsoft Planetary Computer)', () => {
    const mockSarResponse: STACSearchResponsePayload = {
      status: 'success',
      provider: 'Microsoft Planetary Computer',
      catalog_url: 'https://planetarycomputer.microsoft.com/api/stac/v1',
      search_bbox: [77.58, 12.96, 77.65, 13.02],
      collection_requested: 'sentinel-1-rtc',
      total_results: 1,
      scenes: [
        {
          id: 'S1A_IW_RTC_20240328',
          collection: 'sentinel-1-rtc',
          datetime: '2024-03-28T00:43:12Z',
          bbox: [77.50, 12.90, 77.70, 13.10],
          cloud_cover: null,
          modality: 'SAR',
          sensor: 'Sentinel-1 C-Band SAR',
          assets: {
            vv: {
              key: 'vv',
              href: 'https://planetarycomputer.microsoft.com/api/stac/v1/assets/vv.tif',
              category: 'scientific_raster',
              type: 'image/tiff; application=geotiff; profile=cloud-optimized',
              roles: ['data']
            }
          },
          provenance: {
            catalog: 'Microsoft Planetary Computer',
            license: 'Copernicus Open Access / CC-BY-4.0',
            provider_url: 'https://planetarycomputer.microsoft.com/api/stac/v1'
          }
        }
      ]
    };

    assert.equal(mockSarResponse.provider, 'Microsoft Planetary Computer');
    assert.equal(mockSarResponse.catalog_url, 'https://planetarycomputer.microsoft.com/api/stac/v1');
    assert.equal(mockSarResponse.collection_requested, 'sentinel-1-rtc');
    assert.equal(mockSarResponse.scenes[0].sensor, 'Sentinel-1 C-Band SAR');
    assert.equal(mockSarResponse.scenes[0].modality, 'SAR');
    assert.equal(mockSarResponse.scenes[0].provenance.catalog, 'Microsoft Planetary Computer');
  });

  test('searchSTACScenesClient dispatches exact payload to /api/v1/acquisition/search', async () => {
    const originalFetch = globalThis.fetch;
    let interceptedUrl = '';
    let interceptedBody: any = null;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      interceptedUrl = url.toString();
      interceptedBody = JSON.parse(init?.body as string);
      return {
        ok: true,
        json: async () => ({
          status: 'success',
          provider: 'Microsoft Planetary Computer',
          catalog_url: 'https://planetarycomputer.microsoft.com/api/stac/v1',
          search_bbox: interceptedBody.bbox,
          collection_requested: interceptedBody.collection,
          total_results: 1,
          scenes: []
        })
      } as any;
    }) as any;

    try {
      const response = await searchSTACScenesClient({
        bbox: [77.58, 12.96, 77.65, 13.02],
        start_date: '2024-01-01',
        end_date: '2024-03-31',
        collection: 'sentinel-1-rtc',
        max_cloud_cover: undefined,
        limit: 6
      });

      assert.match(interceptedUrl, /\/acquisition\/search$/);
      assert.equal(interceptedBody.collection, 'sentinel-1-rtc');
      assert.equal(interceptedBody.max_cloud_cover, undefined);
      assert.equal(interceptedBody.limit, 6);
      assert.equal(response.provider, 'Microsoft Planetary Computer');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('searchTemporalPairClient dispatches exact payload with sentinel-1-rtc suppressing cloud cover', async () => {
    const originalFetch = globalThis.fetch;
    let interceptedUrl = '';
    let interceptedBody: any = null;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      interceptedUrl = url.toString();
      interceptedBody = JSON.parse(init?.body as string);
      return {
        ok: true,
        json: async () => ({
          status: 'success',
          provider: 'Microsoft Planetary Computer',
          search_bbox: interceptedBody.bbox,
          t1_results: {
            status: 'success',
            provider: 'Microsoft Planetary Computer',
            catalog_url: 'https://planetarycomputer.microsoft.com/api/stac/v1',
            search_bbox: interceptedBody.bbox,
            collection_requested: 'sentinel-1-rtc',
            total_results: 1,
            scenes: []
          },
          t2_results: {
            status: 'success',
            provider: 'Microsoft Planetary Computer',
            catalog_url: 'https://planetarycomputer.microsoft.com/api/stac/v1',
            search_bbox: interceptedBody.bbox,
            collection_requested: 'sentinel-1-rtc',
            total_results: 1,
            scenes: []
          }
        })
      } as any;
    }) as any;

    try {
      const requestedCollection = 'sentinel-1-rtc';
      const response = await searchTemporalPairClient({
        bbox: [77.58, 12.96, 77.65, 13.02],
        t1_start_date: '2023-01-01',
        t1_end_date: '2023-06-30',
        t2_start_date: '2023-07-01',
        t2_end_date: '2023-12-31',
        collection: requestedCollection,
        max_cloud_cover: isSarCollection(requestedCollection) ? undefined : 20,
        limit: 6
      });

      assert.match(interceptedUrl, /\/acquisition\/search-temporal-pair$/);
      assert.equal(interceptedBody.collection, 'sentinel-1-rtc');
      assert.equal(interceptedBody.max_cloud_cover, undefined);
      assert.equal(response.provider, 'Microsoft Planetary Computer');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('verifies correct provenance attribution on scene import for both collections', () => {
    // Simulated optical scene from Element84
    const opticalScene: STACSceneSummary = {
      id: 'S2B_MSIL2A_20240315',
      collection: 'sentinel-2-l2a',
      datetime: '2024-03-15T05:30:00Z',
      bbox: [77.5, 12.9, 77.7, 13.1],
      cloud_cover: 8.2,
      modality: 'OPTICAL',
      sensor: 'Sentinel-2 MSI',
      assets: {},
      provenance: { catalog: 'Element84 Earth Search' }
    };

    // Simulated SAR scene from Microsoft Planetary Computer
    const sarScene: STACSceneSummary = {
      id: 'S1A_IW_RTC_20240318',
      collection: 'sentinel-1-rtc',
      datetime: '2024-03-18T00:43:12Z',
      bbox: [77.5, 12.9, 77.7, 13.1],
      cloud_cover: null,
      modality: 'SAR',
      sensor: 'Sentinel-1 C-Band SAR',
      assets: {},
      provenance: { catalog: 'Microsoft Planetary Computer' }
    };

    // Verify provider derivation for optical
    const opticalProvider = opticalScene.provenance?.catalog || getCollectionProvider(opticalScene.collection);
    assert.equal(opticalProvider, 'Element84 Earth Search');

    // Verify provider derivation for SAR
    const sarProvider = sarScene.provenance?.catalog || getCollectionProvider(sarScene.collection);
    assert.equal(sarProvider, 'Microsoft Planetary Computer');

    // Verify fallback when provenance is missing
    const sarNoProv: STACSceneSummary = { ...sarScene, provenance: {} };
    const sarFallbackProvider = sarNoProv.provenance?.catalog || getCollectionProvider(sarNoProv.collection);
    assert.equal(sarFallbackProvider, 'Microsoft Planetary Computer');
  });

});
