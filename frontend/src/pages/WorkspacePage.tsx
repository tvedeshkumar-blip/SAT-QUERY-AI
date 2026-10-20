import React, { useState, useMemo } from 'react';
import { AnalysisMode, AnalysisResponse, PresetPhoto, AOIBounds, AOIAnalysisConfig, MapOverlayConfig, CompositeInspectorData } from '../types';
import { ImageUploader, UploadedFileState } from '../components/ImageUploader';
import { QuestionPanel } from '../components/QuestionPanel';
import { AnalysisResultCard } from '../components/AnalysisResultCard';
import { EvidenceViewer } from '../components/EvidenceViewer';
import { ExecutionTracePanel } from '../components/ExecutionTracePanel';
import { DemoPresetsBar } from '../components/DemoPresetsBar';
import { MapViewer } from '../components/MapViewer';
import { AcquisitionPanel } from '../components/AcquisitionPanel';
import { CompositeMaskInspector } from '../components/CompositeMaskInspector';
import { submitSatQueryAnalysis, AnalyzePayload } from '../services/api';
import { EARTH_OBSERVATION_PRESETS } from '../utils/presetPhotos';
import { validateBiTemporalDateRanges } from '../utils/dateValidation';
import { buildWorkspaceContext } from '../utils/workspaceContext';

import { Sparkles, AlertCircle } from 'lucide-react';

export const WorkspacePage: React.FC = () => {
  const [mode, setMode] = useState<AnalysisMode>('single');
  const [files, setFiles] = useState<UploadedFileState[]>([]);
  const [query, setQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [response, setResponse] = useState<AnalysisResponse | null>(null);
  const [selectedAOI, setSelectedAOI] = useState<AOIBounds | null>(null);
  const [activeOverlay, setActiveOverlay] = useState<MapOverlayConfig | null>(null);
  const [aoiConfig, setAoiConfig] = useState<AOIAnalysisConfig>({
    startDate: '2024-01-01',
    endDate: '2024-03-31',
    t1StartDate: '2023-01-01',
    t1EndDate: '2023-06-30',
    t2StartDate: '2023-07-01',
    t2EndDate: '2023-12-31',
    maxCloudCover: 20
  });

  // Filter preset sample queries for current mode
  const currentPresets = EARTH_OBSERVATION_PRESETS.filter((p) => p.mode === mode);
  const sampleQueries = currentPresets.flatMap((p) => p.sampleQueries).slice(0, 4);

  // Structured summary of imported scenes and spatial extent for chatbot grounding
  const workspaceContext = useMemo(() => {
    const aoiCoords = selectedAOI
      ? [selectedAOI[0], selectedAOI[1], selectedAOI[2], selectedAOI[3]]
      : undefined;
    return buildWorkspaceContext(files, mode, aoiCoords);
  }, [files, mode, selectedAOI]);

  const handleLoadDemo = (config: {
    mode: AnalysisMode;
    query: string;
    files: UploadedFileState[];
    aoi_bbox?: number[];
  }) => {
    setMode(config.mode);
    setQuery(config.query);
    setFiles(config.files);
    if (config.aoi_bbox && config.aoi_bbox.length === 4) {
      const bounds = config.aoi_bbox as AOIBounds;
      setSelectedAOI(bounds);
      const primary = config.files.find((f) => f.role === 'primary' || f.role === 'optical');
      if (primary && (primary.previewDataUrl || primary.previewUrl)) {
        setActiveOverlay({
          imageUrl: primary.previewDataUrl || primary.previewUrl || primary.dataUrl,
          bounds: bounds,
          opacity: 0.85,
          title: `Sentinel-2 T1 (${primary.stacProvenance?.datetime?.split('T')[0] || 'Pre-Monsoon'})`,
          layerKey: 'scl_mask',
          period: 't1'
        });
      } else {
        setActiveOverlay(null);
      }
    } else {
      setActiveOverlay(null);
    }
    setResponse(null);
    setErrorMsg(null);
  };

  const handleImportScene = (importedFile: UploadedFileState) => {
    setFiles((prev) => {
      const filtered = prev.filter((f) => f.role !== importedFile.role);
      return [...filtered, importedFile];
    });
    setResponse(null);
    setErrorMsg(null);
  };

  const handleImportPair = (t1File: UploadedFileState, t2File: UploadedFileState) => {
    setMode('bitemporal');
    setFiles([t1File, t2File]);
    setResponse(null);
    setErrorMsg(null);
  };

  const handleImportOpticalSARPair = (opticalFile: UploadedFileState, sarFile: UploadedFileState) => {
    setMode('optical_sar');
    setFiles([opticalFile, sarFile]);
    setResponse(null);
    setErrorMsg(null);
  };

  const handleClearFiles = () => {
    setFiles([]);
    setResponse(null);
    setErrorMsg(null);
  };

  const handleSubmitAnalysis = async () => {
    if (!query.trim()) return;

    // Validate bi-temporal windows if mode is bitemporal
    if (mode === 'bitemporal') {
      const val = validateBiTemporalDateRanges(
        aoiConfig.t1StartDate,
        aoiConfig.t1EndDate,
        aoiConfig.t2StartDate,
        aoiConfig.t2EndDate
      );
      if (!val.isValid) {
        setErrorMsg(`Bi-temporal date validation error: ${val.error}`);
        return;
      }
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      // Build image payload
      const imagePayloads: AnalyzePayload['images'] = files.map((f) => ({
        data: f.dataUrl,

        mimeType: f.isGeoTIFF ? 'image/tiff' : (f.filename.endsWith('.jpg') || f.filename.endsWith('.jpeg') ? 'image/jpeg' : 'image/png'),
        filename: f.filename,
        role: f.role,
        asset_category: f.assetCategory,
        provenance: f.stacProvenance,
        scientific_limitations: f.scientificLimitations
      }));


      const aoiCoords = selectedAOI
        ? [selectedAOI[0], selectedAOI[1], selectedAOI[2], selectedAOI[3]]
        : undefined;

      // Fallback synthetic preset only if no file uploaded, no AOI selected, and mode is single
      if (imagePayloads.length === 0 && !selectedAOI && mode === 'single') {
        const dummyPreset = currentPresets[0] || EARTH_OBSERVATION_PRESETS[0];
        imagePayloads.push({
          data: dummyPreset.imageUrl,
          mimeType: 'image/png',
          filename: `${dummyPreset.id}.png`,
          role: 'primary'
        });
      }

      const result = await submitSatQueryAnalysis({
        images: imagePayloads,
        query,
        mode,
        aoi_bbox: aoiCoords,
        start_date: aoiConfig.startDate,
        end_date: aoiConfig.endDate,
        t1_start_date: aoiConfig.t1StartDate,
        t1_end_date: aoiConfig.t1EndDate,
        t2_start_date: aoiConfig.t2StartDate,
        t2_end_date: aoiConfig.t2EndDate,
        max_cloud_cover: aoiConfig.maxCloudCover,
        metadata: {
          aoi_bbox: aoiCoords,
          selected_aoi: selectedAOI,
          aoi_config: aoiConfig
        }
      });

      setResponse(result);
    } catch (err: any) {
      console.error('SatQuery Analysis Error:', err);
      setErrorMsg(err.message || 'An unexpected error occurred during remote sensing analysis.');
    } finally {
      setIsLoading(false);
    }
  };

  const primaryFile = files.find((f) => f.role === 'primary' || f.role === 'optical');
  const secondaryFile = files.find((f) => f.role === 'secondary' || f.role === 'sar');

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-6">
      
      {/* 5 Required ISRO Demonstrations Bar */}
      <DemoPresetsBar onLoadDemo={handleLoadDemo} />

      {/* Global Interactive Satellite Map & AOI Selection */}
      <MapViewer 
        selectedAOI={selectedAOI} 
        onAOIChange={setSelectedAOI} 
        aoiConfig={aoiConfig}
        onAOIConfigChange={setAoiConfig}
        activeOverlay={activeOverlay}
        onClearOverlay={() => setActiveOverlay(null)}
      />

      {/* Satellite Imagery Acquisition & STAC Catalog Search */}
      <AcquisitionPanel 
        selectedAOI={selectedAOI} 
        onImportScene={handleImportScene} 
        onImportPair={handleImportPair} 
        onImportOpticalSARPair={handleImportOpticalSARPair}
      />

      {/* Primary Ingestion & Query Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 space-y-6">
          <ImageUploader
            mode={mode}
            setMode={setMode}
            files={files}
            setFiles={setFiles}
            onClear={handleClearFiles}
          />
        </div>

        <div className="lg:col-span-6 space-y-6">
          <QuestionPanel
            query={query}
            setQuery={setQuery}
            onSubmit={handleSubmitAnalysis}
            isLoading={isLoading}
            mode={mode}
            presetQueries={sampleQueries}
            analysisResponse={response}
            workspaceContext={workspaceContext}
          />
        </div>
      </div>

      {/* Error Banner */}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800/80 text-rose-200 text-xs font-mono flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <div>
            <span className="font-bold block">Analysis Failed:</span>
            {errorMsg}
          </div>
        </div>
      )}

      {/* Analysis Output Section */}
      {response && (
        <div className="space-y-6">
          
          {/* Answer Card */}
          <AnalysisResultCard response={response} />

          {/* Step 7H: Interactive Multi-Scene Composite & SCL Mask Inspector */}
          {(() => {
            const compositeInspectorData: CompositeInspectorData | null =
              (response.evidence?.find((e) => e.inspector_data)?.inspector_data as CompositeInspectorData | undefined) ||
              (response.metadata?.temporal_optical_change?.visual_inspector as CompositeInspectorData | undefined) ||
              null;
            if (!compositeInspectorData) return null;
            return (
              <CompositeMaskInspector
                inspectorData={compositeInspectorData}
                activeOverlay={activeOverlay}
                onOverlayChange={setActiveOverlay}
                isOfflineDemo={Boolean(response.metadata?.use_offline_fixtures || (response.mode as string) === 'offline')}
              />
            );
          })()}

          {/* Evidence Viewer */}
          <EvidenceViewer
            evidenceList={response.evidence}
            primaryImageUrl={primaryFile?.previewDataUrl || primaryFile?.previewUrl || primaryFile?.dataUrl || EARTH_OBSERVATION_PRESETS[0].imageUrl}
            secondaryImageUrl={secondaryFile?.previewDataUrl || secondaryFile?.previewUrl || secondaryFile?.dataUrl || EARTH_OBSERVATION_PRESETS[0].imageUrlSecondary}
            mode={response.mode}
            t1Date={primaryFile?.stacProvenance?.datetime || (response.metadata?.temporal_provenance?.t1?.datetime as string | undefined)}
            t2Date={secondaryFile?.stacProvenance?.datetime || (response.metadata?.temporal_provenance?.t2?.datetime as string | undefined)}
            t1Label={primaryFile?.stacProvenance?.scene_id || primaryFile?.filename}
            t2Label={secondaryFile?.stacProvenance?.scene_id || secondaryFile?.filename}
            metadata={response.metadata}
          />

          {/* Collapsible Execution Trace */}
          <ExecutionTracePanel trace={response.trace} />

        </div>
      )}

    </div>
  );
};
