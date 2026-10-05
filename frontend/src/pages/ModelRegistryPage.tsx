import React, { useEffect, useState } from 'react';
import { Cpu, CheckCircle2, Layers, ShieldCheck, Zap, AlertCircle, Info, Sparkles } from 'lucide-react';
import { fetchLoadedModels, ModelDetail } from '../services/api';

export const ModelRegistryPage: React.FC = () => {
  const [models, setModels] = useState<ModelDetail[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    fetchLoadedModels()
      .then((data) => {
        if (data.models && data.models.length > 0) {
          setModels(data.models);
        } else {
          // Truthful default manifest if offline
          setModels([
            {
              name: 'GenericVLMOrchestrator',
              task: 'Single-Image VQA',
              implementation: 'GenericVLMSynthesisAdapter (Gemini 2.5 Flash / Local Spectral Baseline)',
              version: '1.1.0',
              model_source: 'google/gemini-2.5-flash + local heuristics',
              license: 'Google Gemini API Terms',
              modality: 'OPTICAL / MULTISPECTRAL',
              input_requirements: 'Single satellite raster (1+ bands)',
              device_requirements: 'CPU / Network API',
              status: 'demo',
              implementation_status: 'demo',
              is_trained: false,
              is_remote_sensing_adapted: false
            },
            {
              name: 'ClassicalSpectralCaptionerBaseline',
              task: 'Image Captioning',
              implementation: 'ClassicalSpectralCaptioner (Band statistics and albedo dispersion)',
              version: '1.1.0',
              model_source: 'Local procedural spectral heuristics',
              license: 'Apache-2.0',
              modality: 'OPTICAL / MULTISPECTRAL',
              input_requirements: 'Single satellite raster (1+ bands)',
              device_requirements: 'CPU',
              status: 'baseline',
              implementation_status: 'baseline',
              is_trained: false,
              is_remote_sensing_adapted: false
            },
            {
              name: 'ClassicalBaselineGrounder',
              task: 'Visual Grounding',
              implementation: 'ClassicalBaselineGrounder (Spectral thresholding + contours)',
              version: '1.1.0',
              model_source: 'OpenCV / SciPy connected components',
              license: 'Apache-2.0',
              modality: 'OPTICAL / MULTISPECTRAL',
              input_requirements: 'Single satellite raster + target query string',
              device_requirements: 'CPU',
              status: 'baseline',
              implementation_status: 'baseline',
              is_trained: false,
              is_remote_sensing_adapted: false
            },
            {
              name: 'PixelDifferenceChangeBaseline',
              task: 'Change Detection',
              implementation: 'PixelDifferenceChangeBaseline (Spectral difference magnitude)',
              version: '1.1.0',
              model_source: 'NumPy / Rasterio co-registration baseline',
              license: 'Apache-2.0',
              modality: 'BI-TEMPORAL OPTICAL / SAR',
              input_requirements: '2 co-registered or rescaled rasters (T1 & T2)',
              device_requirements: 'CPU',
              status: 'baseline',
              implementation_status: 'baseline',
              is_trained: false,
              is_remote_sensing_adapted: false
            },
            {
              name: 'EvidenceGroundedChangeVQA',
              task: 'Change VQA',
              implementation: 'EvidenceGroundedChangeVQA (Consumes difference evidence)',
              version: '1.1.0',
              model_source: 'Structured evidence synthesis pipeline',
              license: 'Apache-2.0',
              modality: 'BI-TEMPORAL OPTICAL / SAR',
              input_requirements: '2 rasters (T1 & T2) + change query string',
              device_requirements: 'CPU',
              status: 'baseline',
              implementation_status: 'baseline',
              is_trained: false,
              is_remote_sensing_adapted: false
            },
            {
              name: 'OpticalSARVisualizationBaseline',
              task: 'Optical+SAR Fusion',
              implementation: 'OpticalSARVisualizationBaseline (Linear composite & backscatter slicing)',
              version: '1.1.0',
              model_source: 'Radiometric thresholding baseline',
              license: 'Apache-2.0',
              modality: 'OPTICAL + SAR DUAL MODALITY',
              input_requirements: '2 rasters (Optical reflectance + SAR backscatter)',
              device_requirements: 'CPU',
              status: 'baseline',
              implementation_status: 'baseline',
              is_trained: false,
              is_remote_sensing_adapted: false
            }
          ]);
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'loaded':
      case 'available':
        return (
          <span className="inline-flex items-center gap-1 text-emerald-400 font-mono text-[11px] font-bold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            AVAILABLE
          </span>
        );
      case 'baseline':
        return (
          <span className="inline-flex items-center gap-1 text-cyan-400 font-mono text-[11px] font-bold">
            <ShieldCheck className="w-3.5 h-3.5" />
            BASELINE
          </span>
        );
      case 'demo':
        return (
          <span className="inline-flex items-center gap-1 text-amber-400 font-mono text-[11px] font-bold">
            <Sparkles className="w-3.5 h-3.5" />
            DEMO
          </span>
        );
      case 'unavailable':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-slate-500 font-mono text-[11px] font-bold">
            <AlertCircle className="w-3.5 h-3.5" />
            UNAVAILABLE
          </span>
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-6">
      
      {/* Page Header */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 bg-slate-900/60 shadow-xl space-y-2">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-950 text-cyan-400 border border-cyan-800/50">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100 uppercase tracking-wider font-mono">
              SATQUERY SPECIALIST MODEL REGISTRY
            </h2>
            <p className="text-xs text-slate-400">
              Verified registry of remote sensing models, classical baselines, and API orchestrators. Status reflects authentic weight availability.
            </p>
          </div>
        </div>
      </div>

      {/* Model Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {models.map((m, idx) => (
          <div key={idx} className="glass-panel rounded-2xl p-5 border border-slate-800 bg-slate-900/50 hover:border-cyan-500/40 transition-all flex flex-col justify-between space-y-4">
            
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 uppercase">
                  {m.task}
                </span>
                <span className="text-[10px] font-mono text-slate-500">{m.modality}</span>
              </div>

              <div>
                <h3 className="text-sm font-bold font-mono text-slate-100">{m.name}</h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{m.implementation}</p>
              </div>

              <div className="space-y-1.5 pt-1 text-[11px] font-mono text-slate-400 border-t border-slate-800/60">
                <div className="flex justify-between">
                  <span className="text-slate-500">Source:</span>
                  <span className="text-slate-300 truncate max-w-[180px]">{m.model_source}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">License:</span>
                  <span className="text-slate-300">{m.license}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Trained RS Weights:</span>
                  <span className={m.is_trained ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                    {m.is_trained ? 'YES' : 'NO (Heuristic / API)'}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs font-mono">
              <span className="text-slate-500 uppercase text-[10px]">Registry Status:</span>
              {getStatusBadge(m.status)}
            </div>

          </div>
        ))}
      </div>

    </div>
  );
};
