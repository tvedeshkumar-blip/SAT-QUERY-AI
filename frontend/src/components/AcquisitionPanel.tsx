import React, { useState } from 'react';
import { 
  Satellite, 
  Search, 
  Calendar, 
  Cloud, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink, 
  Loader2, 
  Layers, 
  FileText, 
  Radio, 
  Sparkles, 
  Info,
  ChevronDown,
  ChevronUp,
  Clock,
  GitCompare,
  ArrowRight,
  ShieldAlert,
  Check,
  XCircle
} from 'lucide-react';
import { 
  AOIBounds, 
  STACSceneSummary, 
  STACSearchResponsePayload,
  STACRetrieveResponsePayload,
  STACTemporalPairValidateResponsePayload,
  STACOpticalSARPairValidateResponsePayload 
} from '../types';
import { 
  searchSTACScenes, 
  retrieveSTACAsset, 
  validateTemporalPair,
  searchTemporalPair,
  searchOpticalSARPair,
  validateOpticalSARPair 
} from '../services/api';
import { UploadedFileState } from './ImageUploader';
import { formatBBox } from '../utils/geoBounds';

export interface AcquisitionPanelProps {
  selectedAOI: AOIBounds | null;
  onImportScene: (file: UploadedFileState) => void;
  onImportPair?: (t1: UploadedFileState, t2: UploadedFileState) => void;
  onImportOpticalSARPair?: (optical: UploadedFileState, sar: UploadedFileState) => void;
  className?: string;
}

export const AcquisitionPanel: React.FC<AcquisitionPanelProps> = ({
  selectedAOI,
  onImportScene,
  onImportPair,
  onImportOpticalSARPair,
  className = ''
}) => {
  // Panel mode: 'single' | 'temporal_pair' | 'optical_sar_pair'
  const [panelMode, setPanelMode] = useState<'single' | 'temporal_pair' | 'optical_sar_pair'>('optical_sar_pair');

  // Single Search filter parameters
  const [startDate, setStartDate] = useState<string>('2024-01-01');
  const [endDate, setEndDate] = useState<string>('2024-03-31');
  const [collection, setCollection] = useState<string>('sentinel-2-l2a');
  const [maxCloudCover, setMaxCloudCover] = useState<number>(25);
  const [searchLimit, setSearchLimit] = useState<number>(6);

  // Bi-Temporal Pair Search parameters
  const [t1StartDate, setT1StartDate] = useState<string>('2023-01-01');
  const [t1EndDate, setT1EndDate] = useState<string>('2023-06-30');
  const [t2StartDate, setT2StartDate] = useState<string>('2023-07-01');
  const [t2EndDate, setT2EndDate] = useState<string>('2023-12-31');

  // Optical + SAR Cross-Sensor Search parameters
  const [opticalStartDate, setOpticalStartDate] = useState<string>('2024-01-01');
  const [opticalEndDate, setOpticalEndDate] = useState<string>('2024-03-31');
  const [sarStartDate, setSarStartDate] = useState<string>('2024-01-01');
  const [sarEndDate, setSarEndDate] = useState<string>('2024-03-31');

  // Search states
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchResponse, setSearchResponse] = useState<STACSearchResponsePayload | null>(null);
  const [t1SearchResponse, setT1SearchResponse] = useState<STACSearchResponsePayload | null>(null);
  const [t2SearchResponse, setT2SearchResponse] = useState<STACSearchResponsePayload | null>(null);
  const [opticalSearchResponse, setOpticalSearchResponse] = useState<STACSearchResponsePayload | null>(null);
  const [sarSearchResponse, setSARSearchResponse] = useState<STACSearchResponsePayload | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Selected candidate scenes for temporal pair
  const [selectedT1Scene, setSelectedT1Scene] = useState<STACSceneSummary | null>(null);
  const [selectedT2Scene, setSelectedT2Scene] = useState<STACSceneSummary | null>(null);

  // Selected candidate scenes for Optical + SAR pair
  const [selectedOpticalScene, setSelectedOpticalScene] = useState<STACSceneSummary | null>(null);
  const [selectedSARScene, setSelectedSARScene] = useState<STACSceneSummary | null>(null);

  // Asset retrieval and validation state tracking by scene ID
  const [retrievingSceneId, setRetrievingSceneId] = useState<string | null>(null);
  const [selectedAssetKeys, setSelectedAssetKeys] = useState<Record<string, string>>({});
  const [retrievedAssets, setRetrievedAssets] = useState<Record<string, STACRetrieveResponsePayload>>({});
  const [importedSceneIds, setImportedSceneIds] = useState<Set<string>>(new Set());
  const [retrieveError, setRetrieveError] = useState<{ sceneId: string; message: string } | null>(null);

  // Temporal Pair Compatibility Validation State
  const [isValidatingPair, setIsValidatingPair] = useState<boolean>(false);
  const [pairValidationResult, setPairValidationResult] = useState<STACTemporalPairValidateResponsePayload | null>(null);
  const [pairValidationError, setPairValidationError] = useState<string | null>(null);

  // Optical + SAR Cross-Sensor Compatibility Validation State
  const [isValidatingOpticalSARPair, setIsValidatingOpticalSARPair] = useState<boolean>(false);
  const [opticalSARValidationResult, setOpticalSARValidationResult] = useState<STACOpticalSARPairValidateResponsePayload | null>(null);
  const [opticalSARValidationError, setOpticalSARValidationError] = useState<string | null>(null);

  const [isPanelCollapsed, setIsPanelCollapsed] = useState<boolean>(false);

  // Execute Single STAC Catalog Search
  const handleSingleSearch = async () => {
    if (!selectedAOI) {
      setSearchError('Please select an Area of Interest (AOI) on the map above before searching.');
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    setRetrieveError(null);

    try {
      const resp = await searchSTACScenes({
        bbox: selectedAOI,
        start_date: startDate,
        end_date: endDate,
        collection,
        max_cloud_cover: collection === 'sentinel-1-grd' ? undefined : maxCloudCover,
        limit: searchLimit
      });

      setSearchResponse(resp);
      if (resp.status === 'error') {
        setSearchError(resp.error || 'Failed to search catalog.');
      }
    } catch (err: any) {
      console.error('STAC search error:', err);
      setSearchError(err.message || 'Error communicating with STAC catalog service.');
    } finally {
      setIsSearching(false);
    }
  };

  // Execute Bi-Temporal Search (T1 Pre-Event & T2 Post-Event)
  const handleTemporalPairSearch = async () => {
    if (!selectedAOI) {
      setSearchError('Please select an Area of Interest (AOI) on the map above before searching.');
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    setRetrieveError(null);
    setPairValidationResult(null);

    try {
      const resp = await searchTemporalPair({
        bbox: selectedAOI,
        t1_start_date: t1StartDate,
        t1_end_date: t1EndDate,
        t2_start_date: t2StartDate,
        t2_end_date: t2EndDate,
        collection,
        max_cloud_cover: collection === 'sentinel-1-grd' ? undefined : maxCloudCover,
        limit: searchLimit
      });

      setT1SearchResponse(resp.t1_results);
      setT2SearchResponse(resp.t2_results);

      // Auto-select first scene if available
      if (resp.t1_results.scenes.length > 0 && !selectedT1Scene) {
        setSelectedT1Scene(resp.t1_results.scenes[0]);
      }
      if (resp.t2_results.scenes.length > 0 && !selectedT2Scene) {
        setSelectedT2Scene(resp.t2_results.scenes[0]);
      }

    } catch (err: any) {
      console.error('Temporal pair search error:', err);
      setSearchError(err.message || 'Error executing temporal catalog search.');
    } finally {
      setIsSearching(false);
    }
  };

  // Execute Optical + SAR Cross-Sensor Search (Sentinel-2 Optical & Sentinel-1 SAR)
  const handleOpticalSARSearch = async () => {
    if (!selectedAOI) {
      setSearchError('Please select an Area of Interest (AOI) on the map above before searching.');
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    setRetrieveError(null);
    setOpticalSARValidationResult(null);

    try {
      const resp = await searchOpticalSARPair({
        bbox: selectedAOI,
        optical_start_date: opticalStartDate,
        optical_end_date: opticalEndDate,
        sar_start_date: sarStartDate,
        sar_end_date: sarEndDate,
        max_cloud_cover: maxCloudCover,
        limit: searchLimit
      });

      setOpticalSearchResponse(resp.optical_results);
      setSARSearchResponse(resp.sar_results);

      // Auto-select first scene if available
      if (resp.optical_results.scenes.length > 0 && !selectedOpticalScene) {
        setSelectedOpticalScene(resp.optical_results.scenes[0]);
      }
      if (resp.sar_results.scenes.length > 0 && !selectedSARScene) {
        setSelectedSARScene(resp.sar_results.scenes[0]);
      }
    } catch (err: any) {
      console.error('Optical + SAR search error:', err);
      setSearchError(err.message || 'Error executing Optical + SAR catalog search.');
    } finally {
      setIsSearching(false);
    }
  };

  // Safely Retrieve and Physically Validate Asset
  const handleRetrieveAsset = async (scene: STACSceneSummary, targetAssetKey?: string) => {
    const assetKey = targetAssetKey || selectedAssetKeys[scene.id] || (scene.assets['visual'] ? 'visual' : Object.keys(scene.assets)[0]);
    setRetrievingSceneId(scene.id);
    setRetrieveError(null);

    try {
      const resp = await retrieveSTACAsset({
        scene_id: scene.id,
        asset_key: assetKey,
        collection: scene.collection,
        target_role: scene.modality === 'SAR' ? 'sar' : 'primary'
      });

      if (resp.status === 'error') {
        throw new Error(resp.error || 'Asset retrieval failed.');
      }

      setRetrievedAssets((prev) => ({ ...prev, [scene.id]: resp }));

    } catch (err: any) {
      console.error('Asset retrieval error:', err);
      setRetrieveError({
        sceneId: scene.id,
        message: err.message || 'Failed to download asset from catalog.'
      });
    } finally {
      setRetrievingSceneId(null);
    }
  };

  // Run Temporal Pair Compatibility Validation
  const handleValidatePairCompatibility = async () => {
    if (!selectedT1Scene || !selectedT2Scene) {
      setPairValidationError('Please select both a pre-event scene (T1) and a post-event scene (T2).');
      return;
    }

    const t1Retrieved = retrievedAssets[selectedT1Scene.id];
    const t2Retrieved = retrievedAssets[selectedT2Scene.id];

    setIsValidatingPair(true);
    setPairValidationError(null);

    try {
      const resp = await validateTemporalPair({
        t1_scene_id: selectedT1Scene.id,
        t2_scene_id: selectedT2Scene.id,
        t1_filename: t1Retrieved?.filename || `${selectedT1Scene.id}.tif`,
        t2_filename: t2Retrieved?.filename || `${selectedT2Scene.id}.tif`,
        t1_data_base64: t1Retrieved?.data_base64,
        t2_data_base64: t2Retrieved?.data_base64,
        t1_asset_key: t1Retrieved?.asset_key || selectedAssetKeys[selectedT1Scene.id] || 'visual',
        t2_asset_key: t2Retrieved?.asset_key || selectedAssetKeys[selectedT2Scene.id] || 'visual',
        t1_provenance: {
          scene_id: selectedT1Scene.id,
          collection: selectedT1Scene.collection,
          datetime: selectedT1Scene.datetime,
          modality: selectedT1Scene.modality,
          sensor: selectedT1Scene.sensor,
          cloud_cover: selectedT1Scene.cloud_cover,
          asset_key: t1Retrieved?.asset_key || 'visual'
        },
        t2_provenance: {
          scene_id: selectedT2Scene.id,
          collection: selectedT2Scene.collection,
          datetime: selectedT2Scene.datetime,
          modality: selectedT2Scene.modality,
          sensor: selectedT2Scene.sensor,
          cloud_cover: selectedT2Scene.cloud_cover,
          asset_key: t2Retrieved?.asset_key || 'visual'
        },
        aoi_bbox: selectedAOI || undefined
      });

      setPairValidationResult(resp);
    } catch (err: any) {
      console.error('Pair validation error:', err);
      setPairValidationError(err.message || 'Error validating temporal pair compatibility.');
    } finally {
      setIsValidatingPair(false);
    }
  };

  // Import Validated Temporal Pair into Workspace
  const handleImportPairToWorkspace = () => {
    if (!selectedT1Scene || !selectedT2Scene) return;
    const t1Retrieved = retrievedAssets[selectedT1Scene.id];
    const t2Retrieved = retrievedAssets[selectedT2Scene.id];

    if (!t1Retrieved || !t2Retrieved) {
      setPairValidationError('Both scenes must be retrieved before importing to workspace.');
      return;
    }

    const t1File: UploadedFileState = {
      dataUrl: t1Retrieved.data_base64,
      filename: t1Retrieved.filename,
      size: t1Retrieved.size_bytes,
      role: 'primary',
      isGeoTIFF: t1Retrieved.validation?.file_format === 'GeoTIFF' || t1Retrieved.category !== 'visual_preview',
      assetCategory: t1Retrieved.validation?.asset_category || t1Retrieved.category,
      stacProvenance: {
        provider: searchResponse?.provider || 'Element84 Earth Search (AWS)',
        collection: selectedT1Scene.collection,
        scene_id: selectedT1Scene.id,
        datetime: selectedT1Scene.datetime,
        asset_key: t1Retrieved.asset_key,
        sensor: selectedT1Scene.sensor,
        modality: selectedT1Scene.modality,
        cloud_cover: selectedT1Scene.cloud_cover
      },
      validation: t1Retrieved.validation,
      scientificLimitations: t1Retrieved.scientific_limitations
    };

    const t2File: UploadedFileState = {
      dataUrl: t2Retrieved.data_base64,
      filename: t2Retrieved.filename,
      size: t2Retrieved.size_bytes,
      role: 'secondary',
      isGeoTIFF: t2Retrieved.validation?.file_format === 'GeoTIFF' || t2Retrieved.category !== 'visual_preview',
      assetCategory: t2Retrieved.validation?.asset_category || t2Retrieved.category,
      stacProvenance: {
        provider: searchResponse?.provider || 'Element84 Earth Search (AWS)',
        collection: selectedT2Scene.collection,
        scene_id: selectedT2Scene.id,
        datetime: selectedT2Scene.datetime,
        asset_key: t2Retrieved.asset_key,
        sensor: selectedT2Scene.sensor,
        modality: selectedT2Scene.modality,
        cloud_cover: selectedT2Scene.cloud_cover
      },
      validation: t2Retrieved.validation,
      scientificLimitations: t2Retrieved.scientific_limitations
    };

    if (onImportPair) {
      onImportPair(t1File, t2File);
    } else {
      onImportScene(t1File);
      onImportScene(t2File);
    }

    setImportedSceneIds((prev) => new Set(prev).add(selectedT1Scene.id).add(selectedT2Scene.id));
  };

  // Run Optical + SAR Cross-Sensor Compatibility Validation
  const handleValidateOpticalSARCompatibility = async () => {
    if (!selectedOpticalScene || !selectedSARScene) {
      setOpticalSARValidationError('Please select both an Optical scene and a SAR scene.');
      return;
    }

    const optRetrieved = retrievedAssets[selectedOpticalScene.id];
    const sarRetrieved = retrievedAssets[selectedSARScene.id];

    setIsValidatingOpticalSARPair(true);
    setOpticalSARValidationError(null);

    try {
      const resp = await validateOpticalSARPair({
        optical_scene_id: selectedOpticalScene.id,
        sar_scene_id: selectedSARScene.id,
        optical_filename: optRetrieved?.filename || `${selectedOpticalScene.id}.tif`,
        sar_filename: sarRetrieved?.filename || `${selectedSARScene.id}.tif`,
        optical_data_base64: optRetrieved?.data_base64,
        sar_data_base64: sarRetrieved?.data_base64,
        optical_asset_key: optRetrieved?.asset_key || selectedAssetKeys[selectedOpticalScene.id] || 'visual',
        sar_asset_key: sarRetrieved?.asset_key || selectedAssetKeys[selectedSARScene.id] || 'visual',
        optical_provenance: {
          scene_id: selectedOpticalScene.id,
          collection: selectedOpticalScene.collection,
          datetime: selectedOpticalScene.datetime,
          modality: selectedOpticalScene.modality,
          sensor: selectedOpticalScene.sensor,
          cloud_cover: selectedOpticalScene.cloud_cover,
          asset_key: optRetrieved?.asset_key || 'visual'
        },
        sar_provenance: {
          scene_id: selectedSARScene.id,
          collection: selectedSARScene.collection,
          datetime: selectedSARScene.datetime,
          modality: selectedSARScene.modality,
          sensor: selectedSARScene.sensor,
          cloud_cover: selectedSARScene.cloud_cover,
          asset_key: sarRetrieved?.asset_key || 'visual'
        },
        aoi_bbox: selectedAOI || undefined
      });

      setOpticalSARValidationResult(resp);
    } catch (err: any) {
      console.error('Optical+SAR validation error:', err);
      setOpticalSARValidationError(err.message || 'Error validating Optical+SAR compatibility.');
    } finally {
      setIsValidatingOpticalSARPair(false);
    }
  };

  // Import Validated Optical + SAR Pair into Workspace
  const handleImportOpticalSARPairToWorkspace = () => {
    if (!selectedOpticalScene || !selectedSARScene) return;
    const optRetrieved = retrievedAssets[selectedOpticalScene.id];
    const sarRetrieved = retrievedAssets[selectedSARScene.id];

    if (!optRetrieved || !sarRetrieved) {
      setOpticalSARValidationError('Both scenes must be retrieved and physically validated before importing to workspace.');
      return;
    }

    const optFile: UploadedFileState = {
      dataUrl: optRetrieved.data_base64,
      filename: optRetrieved.filename,
      size: optRetrieved.size_bytes,
      role: 'optical',
      isGeoTIFF: optRetrieved.validation?.file_format === 'GeoTIFF' || optRetrieved.category !== 'visual_preview',
      assetCategory: optRetrieved.validation?.asset_category || optRetrieved.category,
      stacProvenance: {
        provider: searchResponse?.provider || 'Element84 Earth Search (AWS)',
        collection: selectedOpticalScene.collection,
        scene_id: selectedOpticalScene.id,
        datetime: selectedOpticalScene.datetime,
        asset_key: optRetrieved.asset_key,
        sensor: selectedOpticalScene.sensor,
        modality: selectedOpticalScene.modality,
        cloud_cover: selectedOpticalScene.cloud_cover
      },
      validation: optRetrieved.validation,
      scientificLimitations: optRetrieved.scientific_limitations
    };

    const sarFile: UploadedFileState = {
      dataUrl: sarRetrieved.data_base64,
      filename: sarRetrieved.filename,
      size: sarRetrieved.size_bytes,
      role: 'sar',
      isGeoTIFF: sarRetrieved.validation?.file_format === 'GeoTIFF' || sarRetrieved.category !== 'visual_preview',
      assetCategory: sarRetrieved.validation?.asset_category || sarRetrieved.category,
      stacProvenance: {
        provider: searchResponse?.provider || 'Element84 Earth Search (AWS)',
        collection: selectedSARScene.collection,
        scene_id: selectedSARScene.id,
        datetime: selectedSARScene.datetime,
        asset_key: sarRetrieved.asset_key,
        sensor: selectedSARScene.sensor,
        modality: selectedSARScene.modality,
        cloud_cover: selectedSARScene.cloud_cover
      },
      validation: sarRetrieved.validation,
      scientificLimitations: sarRetrieved.scientific_limitations
    };

    if (onImportOpticalSARPair) {
      onImportOpticalSARPair(optFile, sarFile);
    } else if (onImportPair) {
      onImportPair(optFile, sarFile);
    } else {
      onImportScene(optFile);
      onImportScene(sarFile);
    }

    setImportedSceneIds((prev) => new Set(prev).add(selectedOpticalScene.id).add(selectedSARScene.id));
  };

  // Import Single Scene into Workspace
  const handleImportSingleToWorkspace = (scene: STACSceneSummary, role: 'primary' | 'secondary' = 'primary') => {
    const retrieved = retrievedAssets[scene.id];
    if (!retrieved) return;

    const importedFile: UploadedFileState = {
      dataUrl: retrieved.data_base64,
      filename: retrieved.filename,
      size: retrieved.size_bytes,
      role: scene.modality === 'SAR' ? 'sar' : role,
      isGeoTIFF: retrieved.validation?.file_format === 'GeoTIFF' || retrieved.category !== 'visual_preview',
      assetCategory: retrieved.validation?.asset_category || retrieved.category,
      stacProvenance: retrieved.provenance || {
        provider: searchResponse?.provider || 'Element84 Earth Search (AWS)',
        collection: scene.collection,
        scene_id: scene.id,
        datetime: scene.datetime,
        asset_key: retrieved.asset_key,
        sensor: scene.sensor,
        modality: scene.modality,
        cloud_cover: scene.cloud_cover
      },
      validation: retrieved.validation,
      scientificLimitations: retrieved.scientific_limitations
    };

    onImportScene(importedFile);
    setImportedSceneIds((prev) => new Set(prev).add(scene.id));
  };

  // Render a Single Scene Card
  const renderSceneCard = (
    scene: STACSceneSummary, 
    roleTag?: 'T1' | 'T2' | 'OPTICAL' | 'SAR', 
    isSelectedAsPrimary?: boolean, 
    isSelectedAsSecondary?: boolean
  ) => {
    const isRetrieving = retrievingSceneId === scene.id;
    const isImported = importedSceneIds.has(scene.id);
    const retrieved = retrievedAssets[scene.id];

    return (
      <div 
        key={scene.id} 
        className={`rounded-xl border bg-slate-950/80 overflow-hidden flex flex-col justify-between transition-all ${
          isSelectedAsPrimary 
            ? 'border-cyan-500 shadow-lg shadow-cyan-950/50 ring-1 ring-cyan-500/50' 
            : isSelectedAsSecondary 
            ? 'border-purple-500 shadow-lg shadow-purple-950/50 ring-1 ring-purple-500/50' 
            : 'border-slate-800 hover:border-slate-700'
        }`}
      >
        <div>
          {/* Card Thumbnail / Header */}
          <div className="relative h-32 bg-slate-900 border-b border-slate-800/80 flex items-center justify-center overflow-hidden">
            {scene.thumbnail_url ? (
              <img 
                src={scene.thumbnail_url} 
                alt={`Preview for ${scene.id}`}
                className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
                loading="lazy"
              />
            ) : (
              <div className="flex flex-col items-center gap-1 text-slate-600 text-xs">
                <Satellite className="w-6 h-6" />
                <span>Preview Not Available</span>
              </div>
            )}

            {/* Role Badge */}
            {roleTag && (
              <div className={`absolute top-2 left-2 z-10 px-2 py-0.5 rounded font-mono font-bold text-[10px] ${
                roleTag === 'T1' 
                  ? 'bg-cyan-950/90 text-cyan-300 border border-cyan-700' 
                  : roleTag === 'T2' 
                  ? 'bg-indigo-950/90 text-indigo-300 border border-indigo-700'
                  : roleTag === 'OPTICAL'
                  ? 'bg-cyan-950/90 text-cyan-300 border border-cyan-700'
                  : 'bg-purple-950/90 text-purple-300 border border-purple-700'
              }`}>
                {roleTag === 'T1' ? 'T1: PRE-EVENT' : roleTag === 'T2' ? 'T2: POST-EVENT' : roleTag === 'OPTICAL' ? 'OPTICAL SENSOR' : 'SAR SENSOR'}
              </div>
            )}

            {/* Modality Badge */}
            <div className="absolute top-2 right-2 z-10">
              {scene.modality === 'SAR' ? (
                <span className="px-2 py-0.5 rounded bg-purple-950/90 border border-purple-700 text-[10px] font-mono font-bold text-purple-300">
                  C-Band SAR
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-cyan-950/90 border border-cyan-700 text-[10px] font-mono font-bold text-cyan-300">
                  Optical RGB
                </span>
              )}
            </div>

            {/* Cloud Cover */}
            {scene.cloud_cover !== null && (
              <div className="absolute bottom-2 left-2 z-10 px-2 py-0.5 rounded bg-slate-950/80 border border-slate-800 text-[10px] font-mono text-slate-300 flex items-center gap-1">
                <Cloud className="w-3 h-3 text-cyan-400" />
                <span>{scene.cloud_cover}% Cloud</span>
              </div>
            )}
          </div>

          {/* Card Body */}
          <div className="p-3 space-y-2.5 text-xs font-mono">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-semibold text-slate-200">{scene.sensor}</span>
              <span className="flex items-center gap-1 text-slate-300">
                <Clock className="w-3 h-3 text-cyan-400" />
                {new Date(scene.datetime).toLocaleDateString()}
              </span>
            </div>

            <h5 className="font-bold text-slate-200 break-all text-[11px] line-clamp-1" title={scene.id}>
              {scene.id}
            </h5>

            <p className="text-[10px] text-slate-400">
              Collection: {scene.collection}
            </p>

            {/* Asset Selection Buttons */}
            <div className="space-y-1 pt-1 border-t border-slate-900">
              <span className="text-[10px] text-slate-400 flex items-center justify-between">
                <span>AVAILABLE ASSETS:</span>
                <span className="text-slate-500">{Object.keys(scene.assets).length} items</span>
              </span>
              <div className="flex flex-wrap gap-1">
                {Object.entries(scene.assets).map(([key, asset]) => {
                  const activeKey = selectedAssetKeys[scene.id] || (scene.assets['visual'] ? 'visual' : Object.keys(scene.assets)[0]);
                  const isSelected = activeKey === key;
                  const isVisualPreview = asset.category === 'visual_preview';

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedAssetKeys((prev) => ({ ...prev, [scene.id]: key }))}
                      className={`px-1.5 py-0.5 rounded text-[9px] border transition-all ${
                        isSelected
                          ? 'bg-cyan-950 text-cyan-300 border-cyan-700 shadow-sm'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                      }`}
                      title={`${asset.title || key} (${asset.type})`}
                    >
                      {key} {isVisualPreview ? '📷' : '🛰️'}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Validated Telemetry Card */}
            {retrieved && (
              <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1.5 text-[9px]">
                <div className="flex items-center justify-between">
                  <span className="text-teal-400 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-teal-400" />
                    VALIDATED ASSET
                  </span>
                  <span className={`px-1.5 py-0.2 rounded font-bold ${
                    retrieved.category === 'visual_preview'
                      ? 'bg-amber-950 text-amber-300 border border-amber-800'
                      : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  }`}>
                    {retrieved.category.toUpperCase()}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-slate-300">
                  <div>Format: <span className="text-slate-100">{retrieved.validation?.file_format || 'Raster'}</span></div>
                  <div>Bands: <span className="text-slate-100">{retrieved.validation?.raster_metadata?.bands || 3}</span></div>
                  <div>Dims: <span className="text-slate-100">{retrieved.validation?.raster_metadata?.width}x{retrieved.validation?.raster_metadata?.height}</span></div>
                  <div className="truncate" title={retrieved.validation?.raster_metadata?.crs_display}>
                    CRS: <span className="text-slate-100">{retrieved.validation?.raster_metadata?.crs_display || 'Unprojected'}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-3 pt-0 space-y-1.5 border-t border-slate-900/80 mt-2">
          {!retrieved ? (
            <button
              onClick={() => handleRetrieveAsset(scene)}
              disabled={isRetrieving}
              className="w-full py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-cyan-600 hover:text-slate-950 text-slate-200 font-mono text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
            >
              {isRetrieving ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                  <span>Downloading & Validating...</span>
                </>
              ) : (
                <>
                  <Download className="w-3 h-3" />
                  <span>Retrieve & Validate Asset</span>
                </>
              )}
            </button>
          ) : (
            <div className="space-y-1">
              {panelMode === 'temporal_pair' ? (
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => setSelectedT1Scene(scene)}
                    className={`py-1 px-1.5 rounded text-[10px] font-mono font-bold border transition-all ${
                      selectedT1Scene?.id === scene.id
                        ? 'bg-cyan-950 text-cyan-300 border-cyan-500 shadow-sm'
                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-cyan-700'
                    }`}
                  >
                    {selectedT1Scene?.id === scene.id ? '✓ Active T1' : 'Set as T1'}
                  </button>
                  <button
                    onClick={() => setSelectedT2Scene(scene)}
                    className={`py-1 px-1.5 rounded text-[10px] font-mono font-bold border transition-all ${
                      selectedT2Scene?.id === scene.id
                        ? 'bg-indigo-950 text-indigo-300 border-indigo-500 shadow-sm'
                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-indigo-700'
                    }`}
                  >
                    {selectedT2Scene?.id === scene.id ? '✓ Active T2' : 'Set as T2'}
                  </button>
                </div>
              ) : panelMode === 'optical_sar_pair' ? (
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => setSelectedOpticalScene(scene)}
                    className={`py-1 px-1.5 rounded text-[10px] font-mono font-bold border transition-all ${
                      selectedOpticalScene?.id === scene.id
                        ? 'bg-cyan-950 text-cyan-300 border-cyan-500 shadow-sm'
                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-cyan-700'
                    }`}
                  >
                    {selectedOpticalScene?.id === scene.id ? '✓ Optical' : 'Set as Optical'}
                  </button>
                  <button
                    onClick={() => setSelectedSARScene(scene)}
                    className={`py-1 px-1.5 rounded text-[10px] font-mono font-bold border transition-all ${
                      selectedSARScene?.id === scene.id
                        ? 'bg-purple-950 text-purple-300 border-purple-500 shadow-sm'
                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-purple-700'
                    }`}
                  >
                    {selectedSARScene?.id === scene.id ? '✓ SAR' : 'Set as SAR'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleImportSingleToWorkspace(scene, 'primary')}
                  className="w-full py-1.5 px-2.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-slate-950 font-bold font-mono text-[11px] flex items-center justify-center gap-1 transition-all"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Import to Workspace</span>
                </button>
              )}
            </div>
          )}

          {retrieveError && retrieveError.sceneId === scene.id && (
            <p className="text-[10px] text-rose-400 font-mono mt-1">
              {retrieveError.message}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`glass-panel rounded-2xl border border-slate-800 bg-slate-900/80 shadow-2xl overflow-hidden ${className}`}>
      
      {/* Header Bar */}
      <div className="p-4 border-b border-slate-800/80 bg-slate-950/70 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-teal-950 text-teal-400 border border-teal-800">
            <Satellite className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-mono font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
              SATELLITE IMAGERY ACQUISITION & STAC CATALOG SEARCH
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-950 text-teal-300 border border-teal-800 font-mono">
                Earth Search (AWS)
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              Query open Sentinel-2 (Optical) and Sentinel-1 (SAR) acquisitions intersecting your active AOI
            </p>
          </div>
        </div>

        {/* Acquisition Mode Switch */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 font-mono text-xs">
            <button
              onClick={() => setPanelMode('optical_sar_pair')}
              className={`px-3 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                panelMode === 'optical_sar_pair'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Optical + SAR (Cross-Sensor)</span>
            </button>
            <button
              onClick={() => setPanelMode('temporal_pair')}
              className={`px-3 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                panelMode === 'temporal_pair'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <GitCompare className="w-3.5 h-3.5" />
              <span>Bi-Temporal Pair (T1 / T2)</span>
            </button>
            <button
              onClick={() => setPanelMode('single')}
              className={`px-3 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                panelMode === 'single'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Satellite className="w-3.5 h-3.5" />
              <span>Single Scene</span>
            </button>
          </div>

          <button
            onClick={() => setIsPanelCollapsed(!isPanelCollapsed)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all"
            title={isPanelCollapsed ? "Expand acquisition panel" : "Collapse acquisition panel"}
          >
            {isPanelCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {!isPanelCollapsed && (
        <div className="p-5 space-y-5">
          
          {/* Active AOI Notice & Search Filters */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
            
            {/* Filter 1: Active AOI Coordinates */}
            <div className="lg:col-span-4 space-y-1.5">
              <label className="text-[11px] font-mono font-bold text-slate-300 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                ACTIVE AOI BOUNDS (EPSG:4326)
              </label>
              <div className="text-xs font-mono px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 flex items-center justify-between">
                {selectedAOI ? (
                  <span className="text-cyan-300 font-semibold">{formatBBox(selectedAOI, 3)}</span>
                ) : (
                  <span className="text-slate-500 italic text-[11px]">Draw rectangle on map first</span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 font-mono">Coordinates automatically linked from the map viewer</p>
            </div>

            {/* Filter 2: Collection / Sensor */}
            <div className="lg:col-span-3 space-y-1.5">
              <label className="text-[11px] font-mono font-bold text-slate-300 flex items-center gap-1.5">
                <Layers className="w-3 h-3 text-cyan-400" />
                COLLECTION / SENSOR
              </label>
              {panelMode === 'optical_sar_pair' ? (
                <div className="w-full text-xs font-mono px-3 py-2 rounded-lg bg-slate-900 border border-purple-800/60 text-purple-300 flex items-center gap-2">
                  <span className="font-bold">Sentinel-2 (Opt) + Sentinel-1 (SAR)</span>
                </div>
              ) : (
                <select
                  value={collection}
                  onChange={(e) => setCollection(e.target.value)}
                  className="w-full text-xs font-mono px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="sentinel-2-l2a">Sentinel-2 L2A (Optical)</option>
                  <option value="sentinel-1-grd">Sentinel-1 GRD (SAR C-Band)</option>
                </select>
              )}
              <p className="text-[10px] text-slate-500 font-mono">
                {panelMode === 'optical_sar_pair'
                  ? 'Stage 6: Multi-sensor optical reflectance & SAR backscatter'
                  : 'Stage 5: Bi-temporal analysis requires matching modalities'}
              </p>
            </div>

            {/* Filter 3: Cloud Cover Threshold */}
            <div className="lg:col-span-2 space-y-1.5">
              <label className="text-[11px] font-mono font-bold text-slate-300 flex items-center gap-1.5">
                <Cloud className="w-3 h-3 text-cyan-400" />
                MAX CLOUD COVER
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={maxCloudCover}
                  disabled={collection === 'sentinel-1-grd' && panelMode !== 'optical_sar_pair'}
                  onChange={(e) => setMaxCloudCover(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 disabled:opacity-30"
                />
                <span className="text-xs font-mono font-bold text-cyan-300 w-9 text-right">
                  {collection === 'sentinel-1-grd' && panelMode !== 'optical_sar_pair' ? 'N/A' : `${maxCloudCover}%`}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 font-mono">Threshold for optical scenes</p>
            </div>

            {/* Search Trigger Button */}
            <div className="lg:col-span-3 flex flex-col justify-end">
              {panelMode === 'optical_sar_pair' ? (
                <button
                  onClick={handleOpticalSARSearch}
                  disabled={isSearching || !selectedAOI}
                  className="w-full py-2 px-4 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-400 hover:to-indigo-400 text-white font-bold font-mono text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-purple-950/40 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSearching ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>Searching Both Sensors...</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      <span>Search Optical + SAR</span>
                    </>
                  )}
                </button>
              ) : panelMode === 'temporal_pair' ? (
                <button
                  onClick={handleTemporalPairSearch}
                  disabled={isSearching || !selectedAOI}
                  className="w-full py-2 px-4 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-400 hover:to-cyan-400 text-slate-950 font-bold font-mono text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-cyan-950/40 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSearching ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                      <span>Searching Both Windows...</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      <span>Search Temporal Pair</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={handleSingleSearch}
                  disabled={isSearching || !selectedAOI}
                  className="w-full py-2 px-4 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-400 hover:to-cyan-400 text-slate-950 font-bold font-mono text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-cyan-950/40 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSearching ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                      <span>Searching STAC...</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      <span>Search Acquisitions</span>
                    </>
                  )}
                </button>
              )}
            </div>

          </div>

          {/* Temporal Windows Configuration (Visible in Bi-Temporal Mode) */}
          {panelMode === 'temporal_pair' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950/40 p-4 rounded-xl border border-slate-800/80">
              {/* Window 1: Pre-Event (T1) */}
              <div className="space-y-2 p-3 rounded-lg bg-slate-900/60 border border-cyan-900/40">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-cyan-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-cyan-400" />
                    TIME WINDOW 1: PRE-EVENT (T1)
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">Baseline Window</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">START DATE</label>
                    <input 
                      type="date"
                      value={t1StartDate}
                      onChange={(e) => setT1StartDate(e.target.value)}
                      className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">END DATE</label>
                    <input 
                      type="date"
                      value={t1EndDate}
                      onChange={(e) => setT1EndDate(e.target.value)}
                      className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
              </div>

              {/* Window 2: Post-Event (T2) */}
              <div className="space-y-2 p-3 rounded-lg bg-slate-900/60 border border-indigo-900/40">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-indigo-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-400" />
                    TIME WINDOW 2: POST-EVENT (T2)
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">Changed State Window</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">START DATE</label>
                    <input 
                      type="date"
                      value={t2StartDate}
                      onChange={(e) => setT2StartDate(e.target.value)}
                      className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">END DATE</label>
                    <input 
                      type="date"
                      value={t2EndDate}
                      onChange={(e) => setT2EndDate(e.target.value)}
                      className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Optical + SAR Time Windows (Visible in Optical + SAR Mode) */}
          {panelMode === 'optical_sar_pair' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950/40 p-4 rounded-xl border border-slate-800/80">
              {/* Window 1: Optical (Sentinel-2 L2A) */}
              <div className="space-y-2 p-3 rounded-lg bg-slate-900/60 border border-cyan-900/40">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-cyan-300 flex items-center gap-1.5">
                    <Satellite className="w-3.5 h-3.5 text-cyan-400" />
                    OPTICAL TIME WINDOW (SENTINEL-2 L2A)
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">BOA Surface Reflectance</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">START DATE</label>
                    <input 
                      type="date"
                      value={opticalStartDate}
                      onChange={(e) => setOpticalStartDate(e.target.value)}
                      className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">END DATE</label>
                    <input 
                      type="date"
                      value={opticalEndDate}
                      onChange={(e) => setOpticalEndDate(e.target.value)}
                      className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
              </div>

              {/* Window 2: SAR (Sentinel-1 GRD) */}
              <div className="space-y-2 p-3 rounded-lg bg-slate-900/60 border border-purple-900/40">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-purple-300 flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-purple-400" />
                    SAR TIME WINDOW (SENTINEL-1 GRD)
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">C-Band Microwave Backscatter</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">START DATE</label>
                    <input 
                      type="date"
                      value={sarStartDate}
                      onChange={(e) => setSarStartDate(e.target.value)}
                      className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">END DATE</label>
                    <input 
                      type="date"
                      value={sarEndDate}
                      onChange={(e) => setSarEndDate(e.target.value)}
                      className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {searchError && (
            <div className="p-3.5 rounded-xl bg-rose-950/70 border border-rose-800/80 text-rose-200 text-xs font-mono flex items-center gap-3">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{searchError}</span>
            </div>
          )}

          {/* Interactive Temporal Compatibility Validator Card */}
          {panelMode === 'temporal_pair' && (selectedT1Scene || selectedT2Scene) && (
            <div className="p-4 rounded-xl bg-slate-950/90 border border-cyan-800/60 space-y-3 font-mono">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <GitCompare className="w-4 h-4 text-cyan-400" />
                  <h4 className="text-xs font-bold text-slate-100 uppercase tracking-wider">
                    TEMPORAL PAIR COMPATIBILITY VERIFIER
                  </h4>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleValidatePairCompatibility}
                    disabled={isValidatingPair || !selectedT1Scene || !selectedT2Scene}
                    className="py-1.5 px-3 rounded-lg bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-700 text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50"
                  >
                    {isValidatingPair ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                        <span>Verifying Raster Geometry...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Run Pre-Inference Compatibility Check</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleImportPairToWorkspace}
                    disabled={!pairValidationResult?.is_compatible || !retrievedAssets[selectedT1Scene?.id || ''] || !retrievedAssets[selectedT2Scene?.id || '']}
                    className="py-1.5 px-3 rounded-lg bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-400 hover:to-cyan-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Import Pair to Workspace</span>
                  </button>
                </div>
              </div>

              {/* Selected Scenes Overview */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {/* T1 Summary */}
                <div className="p-2.5 rounded-lg bg-slate-900 border border-cyan-900/50 space-y-1">
                  <div className="flex items-center justify-between text-cyan-400 font-bold">
                    <span>T1 (PRE-EVENT)</span>
                    <span className="text-[10px] text-slate-400">{selectedT1Scene?.datetime ? new Date(selectedT1Scene.datetime).toLocaleDateString() : 'Not Selected'}</span>
                  </div>
                  <p className="text-slate-300 truncate" title={selectedT1Scene?.id}>
                    {selectedT1Scene ? selectedT1Scene.id : 'No pre-event scene selected'}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Retrieval: {selectedT1Scene && retrievedAssets[selectedT1Scene.id] ? '✓ Downloaded & Validated' : 'Pending download'}
                  </p>
                </div>

                {/* T2 Summary */}
                <div className="p-2.5 rounded-lg bg-slate-900 border border-indigo-900/50 space-y-1">
                  <div className="flex items-center justify-between text-indigo-400 font-bold">
                    <span>T2 (POST-EVENT)</span>
                    <span className="text-[10px] text-slate-400">{selectedT2Scene?.datetime ? new Date(selectedT2Scene.datetime).toLocaleDateString() : 'Not Selected'}</span>
                  </div>
                  <p className="text-slate-300 truncate" title={selectedT2Scene?.id}>
                    {selectedT2Scene ? selectedT2Scene.id : 'No post-event scene selected'}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Retrieval: {selectedT2Scene && retrievedAssets[selectedT2Scene.id] ? '✓ Downloaded & Validated' : 'Pending download'}
                  </p>
                </div>
              </div>

              {/* Validation Result Display */}
              {pairValidationResult && (
                <div className={`p-3 rounded-xl border space-y-2 text-xs ${
                  pairValidationResult.status === 'compatible'
                    ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-200'
                    : pairValidationResult.status === 'compatible_with_limitations'
                    ? 'bg-amber-950/40 border-amber-800/80 text-amber-200'
                    : 'bg-rose-950/50 border-rose-800/80 text-rose-200'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold flex items-center gap-1.5 uppercase">
                      {pairValidationResult.is_compatible ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-400" />
                      )}
                      STATUS: {pairValidationResult.status.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-900/80 border border-slate-700">
                      Provider: {pairValidationResult.primary_provider}
                    </span>
                  </div>

                  {pairValidationResult.rejection_reason && (
                    <div className="p-2 rounded bg-rose-950/80 border border-rose-800 text-[11px] text-rose-300">
                      <span className="font-bold block">REJECTION CAUSE:</span>
                      {pairValidationResult.rejection_reason}
                    </div>
                  )}

                  {/* Telemetry Metrics Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] text-slate-300 pt-1 border-t border-slate-800/60">
                    <div>
                      <span className="text-slate-400 block">TEMPORAL DELTA:</span>
                      <span className="font-bold text-slate-100">
                        {pairValidationResult.temporal_delta_days !== null ? `${pairValidationResult.temporal_delta_days} days` : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">SPATIAL OVERLAP:</span>
                      <span className="font-bold text-slate-100">
                        {pairValidationResult.spatial_overlap_pct !== null ? `${pairValidationResult.spatial_overlap_pct}%` : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">CRS COMPATIBILITY:</span>
                      <span className="font-bold text-slate-100">
                        {pairValidationResult.crs_compatible ? '✓ Matching CRS' : '✗ CRS Mismatch'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">CO-REGISTRATION:</span>
                      <span className="font-bold text-slate-100">
                        {pairValidationResult.co_registered ? '✓ Verified (>=90%)' : 'Grid Resampled'}
                      </span>
                    </div>
                  </div>

                  {/* Scientific Caveats & Warnings */}
                  {pairValidationResult.warnings.length > 0 && (
                    <div className="space-y-1 pt-1 border-t border-slate-800/60 text-[10px]">
                      <span className="font-bold text-amber-300 block">CONFOUNDER ADVISORIES:</span>
                      {pairValidationResult.warnings.map((w, i) => (
                        <div key={i} className="flex items-start gap-1 text-slate-300">
                          <span className="text-amber-400">•</span>
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Scientific Distinction Notice */}
                  <div className="p-2 rounded bg-slate-950 border border-slate-800 text-[10px] text-slate-400">
                    <span className="font-bold text-slate-300 block mb-0.5">SCIENTIFIC OBSERVATION STANDARD:</span>
                    Detected differences represent pixel reflectance deltas and candidate model clusters. They do not constitute confirmed real-world land cover alterations without independent ground verification.
                  </div>
                </div>
              )}

              {pairValidationError && (
                <div className="p-2.5 rounded bg-rose-950/70 border border-rose-800 text-[11px] text-rose-300">
                  {pairValidationError}
                </div>
              )}
            </div>
          )}

          {/* Interactive Optical + SAR Cross-Sensor Compatibility Validator Card */}
          {panelMode === 'optical_sar_pair' && (selectedOpticalScene || selectedSARScene) && (
            <div className="p-4 rounded-xl bg-slate-950/90 border border-purple-800/60 space-y-3 font-mono">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-purple-400" />
                  <h4 className="text-xs font-bold text-slate-100 uppercase tracking-wider">
                    OPTICAL + SAR CROSS-SENSOR COMPATIBILITY VERIFIER
                  </h4>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleValidateOpticalSARCompatibility}
                    disabled={isValidatingOpticalSARPair || !selectedOpticalScene || !selectedSARScene}
                    className="py-1.5 px-3 rounded-lg bg-purple-950 hover:bg-purple-900 text-purple-300 border border-purple-700 text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50"
                  >
                    {isValidatingOpticalSARPair ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                        <span>Verifying Cross-Sensor Rasters...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                        <span>Run Cross-Sensor Pre-Inference Compatibility Check</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleImportOpticalSARPairToWorkspace}
                    disabled={!opticalSARValidationResult?.is_compatible || !retrievedAssets[selectedOpticalScene?.id || ''] || !retrievedAssets[selectedSARScene?.id || '']}
                    className="py-1.5 px-3 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-400 hover:to-indigo-400 text-white text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Import Optical + SAR Pair to Workspace</span>
                  </button>
                </div>
              </div>

              {/* Selected Scenes Overview */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {/* Optical Summary */}
                <div className="p-2.5 rounded-lg bg-slate-900 border border-cyan-900/50 space-y-1">
                  <div className="flex items-center justify-between text-cyan-400 font-bold">
                    <span>OPTICAL SENSOR (SENTINEL-2 L2A)</span>
                    <span className="text-[10px] text-slate-400">{selectedOpticalScene?.datetime ? new Date(selectedOpticalScene.datetime).toLocaleDateString() : 'Not Selected'}</span>
                  </div>
                  <p className="text-slate-300 truncate" title={selectedOpticalScene?.id}>
                    {selectedOpticalScene ? selectedOpticalScene.id : 'No optical scene selected'}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Retrieval: {selectedOpticalScene && retrievedAssets[selectedOpticalScene.id] ? '✓ Downloaded & Validated' : 'Pending download'}
                  </p>
                </div>

                {/* SAR Summary */}
                <div className="p-2.5 rounded-lg bg-slate-900 border border-purple-900/50 space-y-1">
                  <div className="flex items-center justify-between text-purple-400 font-bold">
                    <span>SAR SENSOR (SENTINEL-1 GRD)</span>
                    <span className="text-[10px] text-slate-400">{selectedSARScene?.datetime ? new Date(selectedSARScene.datetime).toLocaleDateString() : 'Not Selected'}</span>
                  </div>
                  <p className="text-slate-300 truncate" title={selectedSARScene?.id}>
                    {selectedSARScene ? selectedSARScene.id : 'No SAR scene selected'}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Retrieval: {selectedSARScene && retrievedAssets[selectedSARScene.id] ? '✓ Downloaded & Validated' : 'Pending download'}
                  </p>
                </div>
              </div>

              {/* Validation Result Display */}
              {opticalSARValidationResult && (
                <div className={`p-3 rounded-xl border space-y-2 text-xs ${
                  opticalSARValidationResult.status === 'compatible'
                    ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-200'
                    : opticalSARValidationResult.status === 'compatible_with_limitations'
                    ? 'bg-amber-950/40 border-amber-800/80 text-amber-200'
                    : 'bg-rose-950/50 border-rose-800/80 text-rose-200'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold flex items-center gap-1.5 uppercase">
                      {opticalSARValidationResult.is_compatible ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-400" />
                      )}
                      STATUS: {opticalSARValidationResult.status.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-900/80 border border-slate-700">
                      Provider: {opticalSARValidationResult.primary_provider}
                    </span>
                  </div>

                  {opticalSARValidationResult.rejection_reason && (
                    <div className="p-2 rounded bg-rose-950/80 border border-rose-800 text-[11px] text-rose-300">
                      <span className="font-bold block">REJECTION CAUSE:</span>
                      {opticalSARValidationResult.rejection_reason}
                    </div>
                  )}

                  {/* Telemetry Metrics Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] text-slate-300 pt-1 border-t border-slate-800/60">
                    <div>
                      <span className="text-slate-400 block">TEMPORAL DELTA:</span>
                      <span className="font-bold text-slate-100">
                        {opticalSARValidationResult.temporal_delta_days !== null ? `${opticalSARValidationResult.temporal_delta_days} days` : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">SPATIAL OVERLAP:</span>
                      <span className="font-bold text-slate-100">
                        {opticalSARValidationResult.spatial_overlap_pct !== null ? `${opticalSARValidationResult.spatial_overlap_pct}%` : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">RESOLUTION COMPATIBILITY:</span>
                      <span className="font-bold text-slate-100">
                        {opticalSARValidationResult.resolution_compatible ? '✓ Compatible Grid' : 'Disparity (>10x)'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">CRS COMPATIBILITY:</span>
                      <span className="font-bold text-slate-100">
                        {opticalSARValidationResult.crs_compatible ? '✓ Matching CRS' : '✗ CRS Mismatch'}
                      </span>
                    </div>
                  </div>

                  {/* Radiometric & Calibration Telemetry */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] text-slate-300 pt-1 border-t border-slate-800/60">
                    <div>
                      <span className="text-slate-400 block">SAR POLARIZATION:</span>
                      <span className="font-bold text-purple-300">{opticalSARValidationResult.sar_polarization}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">CALIBRATION STATUS:</span>
                      <span className="font-bold text-slate-100">{opticalSARValidationResult.sar_calibration_status}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">TERRAIN CORRECTION:</span>
                      <span className="font-bold text-slate-100">{opticalSARValidationResult.sar_terrain_correction_status}</span>
                    </div>
                  </div>

                  {/* Scientific Caveats & Warnings */}
                  {opticalSARValidationResult.warnings.length > 0 && (
                    <div className="space-y-1 pt-1 border-t border-slate-800/60 text-[10px]">
                      <span className="font-bold text-amber-300 block">PHYSICAL ADVISORIES & CONSTRAINTS:</span>
                      {opticalSARValidationResult.warnings.map((w, i) => (
                        <div key={i} className="flex items-start gap-1 text-slate-300">
                          <span className="text-amber-400">•</span>
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Non-Interchangeability Physical Standard */}
                  <div className="p-2 rounded bg-slate-950 border border-slate-800 text-[10px] text-slate-400">
                    <span className="font-bold text-purple-300 block mb-0.5">PHYSICAL NON-INTERCHANGEABILITY STANDARD:</span>
                    Optical surface reflectance (solar optical scattering) and SAR microwave backscatter (radar surface roughness/dielectric permittivity) represent independent electromagnetic phenomena. SAR amplitude DN values are never treated as optical reflectance.
                  </div>
                </div>
              )}

              {opticalSARValidationError && (
                <div className="p-2.5 rounded bg-rose-950/70 border border-rose-800 text-[11px] text-rose-300">
                  {opticalSARValidationError}
                </div>
              )}
            </div>
          )}

          {/* Results Display: Bi-Temporal Windows */}
          {panelMode === 'temporal_pair' && (t1SearchResponse || t2SearchResponse) && (
            <div className="space-y-6 pt-2">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Column 1: Pre-Event Scenes (T1) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h4 className="text-xs font-mono font-bold text-cyan-300 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-cyan-400" />
                      PRE-EVENT CANDIDATES (T1)
                      <span className="text-[10px] text-slate-400 font-normal">
                        ({t1SearchResponse?.total_results || 0} scenes)
                      </span>
                    </h4>
                  </div>

                  {t1SearchResponse && t1SearchResponse.scenes.length === 0 ? (
                    <div className="p-6 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-xs font-mono text-slate-400">
                      No suitable scenes found in T1 time window for this AOI.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {t1SearchResponse?.scenes.map((scene) => 
                        renderSceneCard(scene, 'T1', selectedT1Scene?.id === scene.id, false)
                      )}
                    </div>
                  )}
                </div>

                {/* Column 2: Post-Event Scenes (T2) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h4 className="text-xs font-mono font-bold text-indigo-300 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-indigo-400" />
                      POST-EVENT CANDIDATES (T2)
                      <span className="text-[10px] text-slate-400 font-normal">
                        ({t2SearchResponse?.total_results || 0} scenes)
                      </span>
                    </h4>
                  </div>

                  {t2SearchResponse && t2SearchResponse.scenes.length === 0 ? (
                    <div className="p-6 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-xs font-mono text-slate-400">
                      No suitable scenes found in T2 time window for this AOI.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {t2SearchResponse?.scenes.map((scene) => 
                        renderSceneCard(scene, 'T2', false, selectedT2Scene?.id === scene.id)
                      )}
                    </div>
                  )}
                </div>

              </div>
            </div>
          )}

          {/* Results Display: Optical + SAR Mode */}
          {panelMode === 'optical_sar_pair' && (opticalSearchResponse || sarSearchResponse) && (
            <div className="space-y-6 pt-2">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Column 1: Optical Scenes (Sentinel-2 L2A) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h4 className="text-xs font-mono font-bold text-cyan-300 flex items-center gap-1.5">
                      <Satellite className="w-3.5 h-3.5 text-cyan-400" />
                      OPTICAL CANDIDATES (SENTINEL-2 L2A)
                      <span className="text-[10px] text-slate-400 font-normal">
                        ({opticalSearchResponse?.total_results || 0} scenes)
                      </span>
                    </h4>
                  </div>

                  {opticalSearchResponse && opticalSearchResponse.scenes.length === 0 ? (
                    <div className="p-6 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-xs font-mono text-slate-400">
                      No suitable Sentinel-2 optical scenes found for this AOI and window.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {opticalSearchResponse?.scenes.map((scene) => 
                        renderSceneCard(scene, 'OPTICAL', selectedOpticalScene?.id === scene.id, false)
                      )}
                    </div>
                  )}
                </div>

                {/* Column 2: SAR Scenes (Sentinel-1 GRD) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h4 className="text-xs font-mono font-bold text-purple-300 flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 text-purple-400" />
                      SAR CANDIDATES (SENTINEL-1 GRD)
                      <span className="text-[10px] text-slate-400 font-normal">
                        ({sarSearchResponse?.total_results || 0} scenes)
                      </span>
                    </h4>
                  </div>

                  {sarSearchResponse && sarSearchResponse.scenes.length === 0 ? (
                    <div className="p-6 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-xs font-mono text-slate-400">
                      No suitable Sentinel-1 SAR scenes found for this AOI and window.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {sarSearchResponse?.scenes.map((scene) => 
                        renderSceneCard(scene, 'SAR', false, selectedSARScene?.id === scene.id)
                      )}
                    </div>
                  )}
                </div>

              </div>
            </div>
          )}

          {/* Results Display: Single Scene Mode */}
          {panelMode === 'single' && searchResponse && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between text-xs font-mono text-slate-300 border-b border-slate-800 pb-2">
                <span className="font-bold flex items-center gap-1.5">
                  <Satellite className="w-3.5 h-3.5 text-teal-400" />
                  CATALOG RESULTS ({searchResponse.total_results} SCENES FOUND)
                </span>
                <span className="text-[11px] text-slate-400">
                  Provider: {searchResponse.provider}
                </span>
              </div>

              {searchResponse.scenes.length === 0 ? (
                <div className="p-6 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-xs font-mono text-slate-400">
                  {searchResponse.message || 'No satellite acquisitions matched the specified spatial and temporal filters.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {searchResponse.scenes.map((scene) => renderSceneCard(scene))}
                </div>
              )}
            </div>
          )}

        </div>
      )}

    </div>
  );
};
