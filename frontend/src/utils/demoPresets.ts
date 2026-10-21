import type { AnalysisMode, UploadedFileState } from '../types/index.ts';
import { generateSyntheticSatelliteScene } from './demoData.ts';
import { fetchDemoBitemporalPair } from '../services/api.ts';

export interface DemoPresetItem {
  id: string;
  title: string;
  subtitle: string;
  mode: AnalysisMode;
  query: string;
  badge: string;
  load: () => {
    mode: AnalysisMode;
    query: string;
    files: UploadedFileState[];
    aoi_bbox?: number[];
  } | Promise<{
    mode: AnalysisMode;
    query: string;
    files: UploadedFileState[];
    aoi_bbox?: number[];
  }>;
}

export function getFallbackRealDemo3Preset() {
  return {
    mode: 'bitemporal' as const,
    query: 'What changed between these two dates?',
    aoi_bbox: [77.4491, 13.0597, 77.5444, 13.1531],
    files: [
      {
        dataUrl: 'data:image/tiff;base64,SUkqAAgAAAARAP4ABAABAAAAAAAAAAAB',
        previewUrl: '/api/v1/acquisition/demo-bitemporal-preview/t1',
        filename: 'S2B_43PGQ_20230528_0_L2A_visual_window_1792262748.tif',
        role: 'primary' as const,
        isGeoTIFF: true,
        size: 3149278,
        assetCategory: 'scientific_raster',
        stacProvenance: {
          provider: 'Element84 Earth Search (AWS)',
          catalog_url: 'https://earth-search.aws.element84.com/v1',
          collection: 'sentinel-2-l2a',
          scene_id: 'S2B_43PGQ_20230528_0_L2A',
          datetime: '2023-05-28T05:26:49Z',
          sensor: 'Sentinel-2B MSI Level-2A',
          modality: 'OPTICAL',
          asset_key: 'visual',
          tile: '43PGQ',
          cloud_cover: 0.0
        },
        validation: {
          status: 'valid',
          file_format: 'GeoTIFF',
          asset_category: 'scientific_raster',
          scientific_status: 'calibrated_surface_reflectance',
          raster_metadata: {
            width: 1024,
            height: 1024,
            bands: 3,
            crs: 'EPSG:32643',
            crs_display: 'WGS 84 / UTM zone 43N (EPSG:32643)'
          }
        },
        scientificLimitations: [
          'True-color (RGB) visual Sentinel-2 imagery contains visible reflectance bands (B04, B03, B02).',
          'Calibrated NDVI requires near-infrared Band 8 (B08), which is not present in RGB-only visual assets.'
        ]
      },
      {
        dataUrl: 'data:image/tiff;base64,SUkqAAgAAAARAP4ABAABAAAAAAAAAAAB',
        previewUrl: '/api/v1/acquisition/demo-bitemporal-preview/t2',
        filename: 'S2A_43PGQ_20231119_0_L2A_visual_window_1792262818.tif',
        role: 'secondary' as const,
        isGeoTIFF: true,
        size: 3149278,
        assetCategory: 'scientific_raster',
        stacProvenance: {
          provider: 'Element84 Earth Search (AWS)',
          catalog_url: 'https://earth-search.aws.element84.com/v1',
          collection: 'sentinel-2-l2a',
          scene_id: 'S2A_43PGQ_20231119_0_L2A',
          datetime: '2023-11-19T05:27:01Z',
          sensor: 'Sentinel-2A MSI Level-2A',
          modality: 'OPTICAL',
          asset_key: 'visual',
          tile: '43PGQ',
          cloud_cover: 0.0
        },
        validation: {
          status: 'valid',
          file_format: 'GeoTIFF',
          asset_category: 'scientific_raster',
          scientific_status: 'calibrated_surface_reflectance',
          raster_metadata: {
            width: 1024,
            height: 1024,
            bands: 3,
            crs: 'EPSG:32643',
            crs_display: 'WGS 84 / UTM zone 43N (EPSG:32643)'
          }
        },
        scientificLimitations: [
          'True-color (RGB) visual Sentinel-2 imagery contains visible reflectance bands (B04, B03, B02).',
          'Calibrated NDVI requires near-infrared Band 8 (B08), which is not present in RGB-only visual assets.'
        ]
      }
    ]
  };
}

export const DEMO_PRESETS: DemoPresetItem[] = [
  {
    id: 'demo1',
    title: 'Demo 1: Single-Image VQA',
    subtitle: 'Multimodal terrain question answering',
    mode: 'single',
    query: 'What type of surface feature dominates this scene?',
    badge: 'VQA',
    load: () => {
      const img = generateSyntheticSatelliteScene('agricultural');
      return {
        mode: 'single',
        query: 'What type of surface feature dominates this scene?',
        files: [
          {
            dataUrl: img,
            filename: 'cartosat_optical_canopy.tif',
            role: 'primary',
            isGeoTIFF: true
          }
        ]
      };
    }
  },
  {
    id: 'demo2',
    title: 'Demo 2: Single-Image Captioning',
    subtitle: 'Procedural spectral scene description',
    mode: 'single',
    query: 'Describe this satellite image and summarize its land cover layout.',
    badge: 'CAPTION',
    load: () => {
      const img = generateSyntheticSatelliteScene('optical');
      return {
        mode: 'single',
        query: 'Describe this satellite image and summarize its land cover layout.',
        files: [
          {
            dataUrl: img,
            filename: 'cartosat_multispectral_scene.tif',
            role: 'primary',
            isGeoTIFF: true
          }
        ]
      };
    }
  },
  {
    id: 'demo3',
    title: 'Demo 3: Bi-Temporal Change',
    subtitle: 'T1 vs T2 difference map & quantification',
    mode: 'bitemporal',
    query: 'What changed between these two dates?',
    badge: 'CHANGE DETECT',
    load: async () => {
      try {
        if (typeof window !== 'undefined') {
          const resp = await fetchDemoBitemporalPair();
          return {
            mode: resp.mode,
            query: resp.query,
            files: resp.files,
            aoi_bbox: resp.aoi_bbox
          };
        }
        return getFallbackRealDemo3Preset();
      } catch (err) {
        console.warn('Backend bi-temporal demo fetch fallback:', err);
        return getFallbackRealDemo3Preset();
      }
    }
  },
  {
    id: 'demo4',
    title: 'Demo 4: Optical + SAR Joint Analysis',
    subtitle: 'Reflectance + C-Band SAR backscatter',
    mode: 'orchestration',
    query: 'Perform joint optical and radar fusion for Mumbai [72.75, 18.88, 73.05, 19.30]',
    badge: 'OPTICAL+SAR',
    load: () => ({
      mode: 'orchestration',
      query: 'Perform joint optical and radar fusion for Mumbai [72.75, 18.88, 73.05, 19.30]',
      files: []
    })
  },
  {
    id: 'demo5',
    title: 'Demo 5: Conflict & Reanalysis',
    subtitle: 'Contradiction trigger & automated reanalysis',
    mode: 'single',
    query: 'Locate and outline all urban building structures with bounding boxes.',
    badge: 'REANALYSIS',
    load: () => {
      const img = generateSyntheticSatelliteScene('coastal');
      return {
        mode: 'single',
        query: 'Locate and outline all urban building structures with bounding boxes.',
        files: [
          {
            dataUrl: img,
            filename: 'coastal_estuary_test.tif',
            role: 'primary',
            isGeoTIFF: true
          }
        ]
      };
    }
  },
  {
    id: 'demo6',
    title: 'Demo 6: BigEarthNet Land Cover',
    subtitle: '10-Band Sentinel-2 ResNet-50 CORINE Multi-Label',
    mode: 'classification',
    query: 'Classify 19-class CORINE land-cover categories for this Sentinel-2 multispectral scene',
    badge: 'BIGEARTHNET-V2',
    load: () => {
      const img = generateSyntheticSatelliteScene('agricultural');
      return {
        mode: 'classification' as const,
        query: 'Classify 19-class CORINE land-cover categories for this Sentinel-2 multispectral scene',
        files: [
          {
            dataUrl: img,
            filename: 'sentinel2_10band_multispectral_patch.tif',
            role: 'primary',
            isGeoTIFF: true,
            assetCategory: 'multispectral_cube',
            validation: {
              status: 'valid',
              file_format: 'GeoTIFF',
              asset_category: 'multispectral_cube',
              scientific_status: 'calibrated_surface_reflectance',
              raster_metadata: {
                width: 120,
                height: 120,
                bands: 10,
                band_names: ['B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B8A', 'B11', 'B12'],
                crs: 'EPSG:32643',
                crs_display: 'WGS 84 / UTM zone 43N (EPSG:32643)'
              }
            },
            scientificLimitations: [
              'BigEarthNetv2 ResNet-50 requires exactly 10 Sentinel-2 bands in ESA/reBEN order.',
              'Visual RGB screenshots lack multispectral bands B05-B12 and cannot be processed by this specialist model.'
            ]
          }
        ]
      };
    }
  }
];
