import React, { useState } from 'react';
import { AnalysisMode, AnalysisResponse, PresetPhoto } from '../types';
import { ImageUploader, UploadedFileState } from '../components/ImageUploader';
import { QuestionPanel } from '../components/QuestionPanel';
import { AnalysisResultCard } from '../components/AnalysisResultCard';
import { EvidenceViewer } from '../components/EvidenceViewer';
import { ExecutionTracePanel } from '../components/ExecutionTracePanel';
import { DemoPresetsBar } from '../components/DemoPresetsBar';
import { submitSatQueryAnalysis } from '../services/api';
import { EARTH_OBSERVATION_PRESETS } from '../utils/presetPhotos';
import { Sparkles, AlertCircle } from 'lucide-react';

export const WorkspacePage: React.FC = () => {
  const [mode, setMode] = useState<AnalysisMode>('single');
  const [files, setFiles] = useState<UploadedFileState[]>([]);
  const [query, setQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [response, setResponse] = useState<AnalysisResponse | null>(null);

  // Filter preset sample queries for current mode
  const currentPresets = EARTH_OBSERVATION_PRESETS.filter((p) => p.mode === mode);
  const sampleQueries = currentPresets.flatMap((p) => p.sampleQueries).slice(0, 4);

  const handleLoadDemo = (config: {
    mode: AnalysisMode;
    query: string;
    files: UploadedFileState[];
  }) => {
    setMode(config.mode);
    setQuery(config.query);
    setFiles(config.files);
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
    setIsLoading(true);
    setErrorMsg(null);

    try {
      // Build image payload
      const imagePayloads = files.map((f) => ({
        data: f.dataUrl,
        mimeType: f.isGeoTIFF ? 'image/tiff' : 'image/png',
        filename: f.filename,
        role: f.role
      }));

      // Fallback synthetic preset if no file uploaded
      if (imagePayloads.length === 0) {
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
        mode
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

          {/* Evidence Viewer */}
          <EvidenceViewer
            evidenceList={response.evidence}
            primaryImageUrl={primaryFile?.dataUrl || EARTH_OBSERVATION_PRESETS[0].imageUrl}
            secondaryImageUrl={secondaryFile?.dataUrl || EARTH_OBSERVATION_PRESETS[0].imageUrlSecondary}
            mode={response.mode}
          />

          {/* Collapsible Execution Trace */}
          <ExecutionTracePanel trace={response.trace} />

        </div>
      )}

    </div>
  );
};
