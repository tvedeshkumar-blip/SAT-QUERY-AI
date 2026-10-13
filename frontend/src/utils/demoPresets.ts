import type { AnalysisMode, UploadedFileState } from '../types/index.ts';
import { generateSyntheticSatelliteScene } from './demoData.ts';

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
    load: () => {
      const t1 = generateSyntheticSatelliteScene('urban_t1');
      const t2 = generateSyntheticSatelliteScene('urban_t2');
      return {
        mode: 'bitemporal',
        query: 'What changed between these two dates?',
        files: [
          {
            dataUrl: t1,
            filename: 'temporal_t1_pre_monsoon.tif',
            role: 'primary',
            isGeoTIFF: true
          },
          {
            dataUrl: t2,
            filename: 'temporal_t2_post_monsoon.tif',
            role: 'secondary',
            isGeoTIFF: true
          }
        ]
      };
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
  }
];
