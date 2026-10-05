import React from 'react';
import { Sparkles, Layers, ArrowRight, Eye, Split, Cpu, AlertTriangle } from 'lucide-react';
import { AnalysisMode } from '../types';
import { UploadedFileState } from './ImageUploader';
import { generateSyntheticSatelliteScene } from '../utils/demoData';

interface DemoPresetsBarProps {
  onLoadDemo: (config: {
    mode: AnalysisMode;
    query: string;
    files: UploadedFileState[];
  }) => void;
}

export const DemoPresetsBar: React.FC<DemoPresetsBarProps> = ({ onLoadDemo }) => {
  const demos = [
    {
      id: 'demo1',
      title: 'Demo 1: Single-Image VQA',
      subtitle: 'Multimodal terrain question answering',
      mode: 'single' as AnalysisMode,
      query: 'What type of surface feature dominates this scene?',
      badge: 'VQA',
      load: () => {
        const img = generateSyntheticSatelliteScene('agricultural');
        return {
          mode: 'single' as AnalysisMode,
          query: 'What type of surface feature dominates this scene?',
          files: [
            {
              dataUrl: img,
              filename: 'cartosat_optical_canopy.tif',
              role: 'primary' as const,
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
      mode: 'single' as AnalysisMode,
      query: 'Describe this satellite image and summarize its land cover layout.',
      badge: 'CAPTION',
      load: () => {
        const img = generateSyntheticSatelliteScene('optical');
        return {
          mode: 'single' as AnalysisMode,
          query: 'Describe this satellite image and summarize its land cover layout.',
          files: [
            {
              dataUrl: img,
              filename: 'cartosat_multispectral_scene.tif',
              role: 'primary' as const,
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
      mode: 'bitemporal' as AnalysisMode,
      query: 'What changed between these two dates?',
      badge: 'CHANGE DETECT',
      load: () => {
        const t1 = generateSyntheticSatelliteScene('urban_t1');
        const t2 = generateSyntheticSatelliteScene('urban_t2');
        return {
          mode: 'bitemporal' as AnalysisMode,
          query: 'What changed between these two dates?',
          files: [
            {
              dataUrl: t1,
              filename: 'temporal_t1_pre_monsoon.tif',
              role: 'primary' as const,
              isGeoTIFF: true
            },
            {
              dataUrl: t2,
              filename: 'temporal_t2_post_monsoon.tif',
              role: 'secondary' as const,
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
      mode: 'optical_sar' as AnalysisMode,
      query: 'Use optical reflectance and SAR backscatter to identify water and urban structures.',
      badge: 'OPTICAL+SAR',
      load: () => {
        const opt = generateSyntheticSatelliteScene('optical');
        const sar = generateSyntheticSatelliteScene('sar');
        return {
          mode: 'optical_sar' as AnalysisMode,
          query: 'Use optical reflectance and SAR backscatter to identify water and urban structures.',
          files: [
            {
              dataUrl: opt,
              filename: 'cartosat_optical_bengaluru.tif',
              role: 'optical' as const,
              isGeoTIFF: true
            },
            {
              dataUrl: sar,
              filename: 'risat_sar_mumbai.tif',
              role: 'sar' as const,
              isGeoTIFF: true
            }
          ]
        };
      }
    },
    {
      id: 'demo5',
      title: 'Demo 5: Conflict & Reanalysis',
      subtitle: 'Contradiction trigger & automated reanalysis',
      mode: 'single' as AnalysisMode,
      query: 'Locate and outline all urban building structures with bounding boxes.',
      badge: 'REANALYSIS',
      load: () => {
        const img = generateSyntheticSatelliteScene('coastal');
        return {
          mode: 'single' as AnalysisMode,
          query: 'Locate and outline all urban building structures with bounding boxes.',
          files: [
            {
              dataUrl: img,
              filename: 'coastal_estuary_test.tif',
              role: 'primary' as const,
              isGeoTIFF: true
            }
          ]
        };
      }
    }
  ];

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
            onClick={() => onLoadDemo(d.load())}
            className="text-left p-3.5 rounded-xl bg-slate-950/80 hover:bg-slate-900 border border-slate-800/80 hover:border-cyan-500/50 transition-all group flex flex-col justify-between space-y-2 hover:shadow-lg hover:shadow-cyan-500/10"
          >
            <div>
              <div className="flex items-center justify-between gap-1 mb-1.5">
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                  {d.badge}
                </span>
                <ArrowRight className="w-3 h-3 text-slate-500 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all" />
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
