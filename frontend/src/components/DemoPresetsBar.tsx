import React, { useState } from 'react';
import { Sparkles, ArrowRight, Loader2 } from 'lucide-react';
import { AnalysisMode } from '../types';
import { UploadedFileState } from './ImageUploader';
import { DEMO_PRESETS, DemoPresetItem } from '../utils/demoPresets';

export { DEMO_PRESETS };
export type { DemoPresetItem };

interface DemoPresetsBarProps {
  onLoadDemo: (config: {
    mode: AnalysisMode;
    query: string;
    files: UploadedFileState[];
    aoi_bbox?: number[];
  }) => void;
}

export const DemoPresetsBar: React.FC<DemoPresetsBarProps> = ({ onLoadDemo }) => {
  const demos = DEMO_PRESETS;
  const [loadingDemoId, setLoadingDemoId] = useState<string | null>(null);

  const handleDemoClick = async (d: DemoPresetItem) => {
    try {
      setLoadingDemoId(d.id);
      const config = await d.load();
      onLoadDemo(config);
    } catch (err) {
      console.error('Failed to load demo preset:', err);
    } finally {
      setLoadingDemoId(null);
    }
  };

  return (
    <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-slate-900/70 shadow-2xl space-y-3">
      
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-mono font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
              FIVE VERIFIED REPRODUCIBLE DEMONSTRATION WORKFLOWS
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-950 text-teal-300 border border-teal-800">
                1-Click Load
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              Deterministic test scenarios covering single-image VQA, captioning, bi-temporal change, Optical+SAR joint analysis, and conflict reanalysis.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {demos.map((d) => (
          <button
            key={d.id}
            onClick={() => handleDemoClick(d)}
            disabled={loadingDemoId !== null}
            className="text-left p-3.5 rounded-xl bg-slate-950/80 hover:bg-slate-900 border border-slate-800/80 hover:border-cyan-500/50 transition-all group flex flex-col justify-between space-y-2 hover:shadow-lg hover:shadow-cyan-500/10 disabled:opacity-60"
          >
            <div>
              <div className="flex items-center justify-between gap-1 mb-1.5">
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                  {d.badge}
                </span>
                {loadingDemoId === d.id ? (
                  <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" />
                ) : (
                  <ArrowRight className="w-3 h-3 text-slate-500 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all" />
                )}
              </div>

              <h4 className="text-xs font-bold text-slate-200 group-hover:text-cyan-300 transition-colors">
                {d.title}
              </h4>
              <p className="text-[10px] text-slate-400 line-clamp-2 mt-0.5">
                "{d.query}"
              </p>
            </div>

            <div className="pt-2 border-t border-slate-900 text-[10px] text-slate-500 font-mono">
              {d.subtitle}
            </div>
          </button>
        ))}
      </div>

    </div>
  );
};
