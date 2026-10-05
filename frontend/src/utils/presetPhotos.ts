import { PresetPhoto } from '../types';

export const EARTH_OBSERVATION_PRESETS: PresetPhoto[] = [
  {
    id: 'urban-expansion-bitemporal',
    title: 'Urban Built-Up Area Expansion (Bi-Temporal Sentinel-2)',
    mode: 'bitemporal',
    modality: 'OPTICAL (Multispectral)',
    sensor: 'Sentinel-2 MSI (10m Resolution)',
    description: 'Bi-temporal satellite monitoring of rapid urban development and infrastructure expansion across a 3-year period.',
    imageUrl: 'https://images.unsplash.com/photo-1578328819058-b69f3a3b0f6b?auto=format&fit=crop&w=1200&q=80',
    imageUrlSecondary: 'https://images.unsplash.com/photo-1477959858617-67f30ac4ce78?auto=format&fit=crop&w=1200&q=80',
    sampleQueries: [
      'What changed between these two dates?',
      'Has the built-up area increased over time?',
      'Identify where new construction and roads appeared.',
      'Quantify the estimated percentage of agricultural loss to built-up terrain.'
    ],
    metadata: {
      crs: 'EPSG:32644 (UTM Zone 44N)',
      bounds: [77.58, 12.96, 77.65, 13.02],
      bands: 4,
      dtype: 'uint16',
      modality: 'OPTICAL',
      sensor: 'Sentinel-2A'
    }
  },
  {
    id: 'coastal-water-grounding',
    title: 'Coastal Water Body & River Delta (Sentinel-2 L2A)',
    mode: 'single',
    modality: 'OPTICAL (RGB + NIR)',
    sensor: 'Sentinel-2B / Landsat-9 OLI',
    description: 'High-resolution optical image showing river estuarine discharge, coastal bathymetry, and sediment plumes.',
    imageUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
    sampleQueries: [
      'Highlight the water body and shoreline.',
      'Describe the land cover in this satellite scene.',
      'Are there agricultural fields adjacent to the river?',
      'Detect ship wakes or coastal sediment plumes.'
    ],
    metadata: {
      crs: 'EPSG:4326 (WGS 84)',
      bounds: [88.10, 21.50, 88.35, 21.75],
      bands: 3,
      dtype: 'uint8',
      modality: 'OPTICAL',
      sensor: 'Sentinel-2B'
    }
  },
  {
    id: 'agricultural-crop-vqa',
    title: 'Multispectral Crop Canopy & Center-Pivot Agriculture',
    mode: 'single',
    modality: 'MULTISPECTRAL (NIR/Red/Green)',
    sensor: 'Landsat-8 OLI (30m Resolution)',
    description: 'False-color composite emphasizing chlorophyll vitality, crop boundaries, and center-pivot irrigation patterns.',
    imageUrl: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80',
    sampleQueries: [
      'Describe the land cover and crop patterns.',
      'What type of agricultural irrigation is visible?',
      'Identify forest reserves versus active cultivated fields.',
      'Highlight high-vitality vegetation zones.'
    ],
    metadata: {
      crs: 'EPSG:32643 (UTM Zone 43N)',
      bounds: [75.20, 30.10, 75.45, 30.35],
      bands: 8,
      dtype: 'uint16',
      modality: 'MULTISPECTRAL',
      sensor: 'Landsat-8'
    }
  },
  {
    id: 'optical-sar-flood-fusion',
    title: 'Disaster Inundation (Cartosat-Style Optical + RISAT-Style SAR Demonstration)',
    mode: 'optical_sar',
    modality: 'OPTICAL + SAR FUSION',
    sensor: 'Cartosat-Style Optical + RISAT-Style SAR Simulation',
    description: 'Demonstration dual-modality scene combining cloud-penetrating synthetic SAR with optical demonstration imagery.',
    imageUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80',
    imageUrlSecondary: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?auto=format&fit=crop&w=1200&q=80',
    sampleQueries: [
      'Use the optical and SAR images together to identify built-up and water-covered regions.',
      'Map flood extent beneath cloud cover using SAR backscatter.',
      'Compare urban structures in optical vs SAR microwave specular reflection.',
      'Where is soil moisture highest according to SAR intensity?'
    ],
    metadata: {
      crs: 'EPSG:32644 (UTM Zone 44N)',
      bounds: [85.12, 25.55, 85.35, 25.80],
      bands: 4,
      dtype: 'uint16',
      modality: 'SAR',
      sensor: 'Synthetic Simulation (RISAT + Cartosat Style)'
    }
  }
];
