import React from 'react';
import { BookOpen, Layers, Cpu, Terminal, ShieldCheck, Zap, FileText } from 'lucide-react';

export const ArchitecturePage: React.FC = () => {
  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-6">
      
      {/* Page Header */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 bg-slate-900/60 shadow-xl space-y-2">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-950 text-cyan-400 border border-cyan-800/50">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100 uppercase tracking-wider font-mono">
              TARGET SYSTEM ARCHITECTURE — SATQUERY AI
            </h2>
            <p className="text-xs text-slate-400">
              Technical specification for ISRO Problem Statement 26167 research prototype
            </p>
          </div>
        </div>
      </div>

      {/* Architecture Flow Diagram Box */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 bg-slate-950 shadow-2xl space-y-4">
        <h3 className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider">
          AGENTIC MULTIMODAL END-TO-END PIPELINE DIAGRAM
        </h3>

        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 font-mono text-xs text-cyan-300 overflow-x-auto whitespace-pre leading-relaxed shadow-inner">
{`SATQUERY AI
│
▼
┌──────────────────────────────┐
│  React + TypeScript Frontend │ (Vercel Deployment)
└──────────────┬───────────────┘
               │ HTTPS REST API
               ▼
┌──────────────────────────────┐
│       FastAPI Backend        │ (Render Deployment)
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│       AGENT CONTROLLER       │ (Query Intent Classifier & Task Router)
└──────────────┬───────────────┘
               │
  ┌────────────┼────────────┬────────────────────────┬────────────────────────┐
  │            │            │                        │                        │
  ▼            ▼            ▼                        ▼                        ▼
┌───┐        ┌───┐        ┌───┐             ┌─────────────────┐      ┌─────────────────┐
│VQA│        │CAP│        │GND│             │ CHANGE ANALYSIS │      │  OPTICAL + SAR  │
└───┘        └───┘        └───┘             └────────┬────────┘      └────────┬────────┘
  │            │            │                        │                        │
  └────────────┴────────────┴────────────────────────┴────────────────────────┘
                                      │
                                      ▼
                        ┌──────────────────────────┐
                        │     EVIDENCE ENGINE      │ (Overlays, Masks, Boxes, Change Maps)
                        └─────────────┬────────────┘
                                      │
                                      ▼
                        ┌──────────────────────────┐
                        │     CONFIDENCE LAYER     │ (Calibrated / Not Available)
                        └─────────────┬────────────┘
                                      │
                                      ▼
                        ┌──────────────────────────┐
                        │    RESPONSE GENERATOR    │ (Answer Synthesis & Report PDF/JSON)
                        └─────────────┬────────────┘
                                      │
                                      ▼
                        ┌──────────────────────────┐
                        │     EXECUTION TRACE      │ (Observable Event Timeline)
                        └──────────────────────────┘`}
        </div>
      </div>

      {/* Architectural Layer Descriptions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-slate-900/50 space-y-2">
          <div className="flex items-center gap-2 text-cyan-400 font-mono font-bold text-sm">
            <Layers className="w-4 h-4" />
            1. Geospatial Raster Engine
          </div>
          <p className="text-xs text-slate-300 leading-relaxed font-sans">
            Built using Rasterio, OpenCV, NumPy, and PIL. Parses GeoTIFF rasters (.tif/.tiff), extracts Coordinate Reference System (CRS) strings, bounding coordinates, multi-bit channel definitions (uint16/float32 to uint8 percentile scaling), and performs spatial affine feature alignment.
          </p>
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-slate-900/50 space-y-2">
          <div className="flex items-center gap-2 text-cyan-400 font-mono font-bold text-sm">
            <Terminal className="w-4 h-4" />
            2. Agent Controller & Router
          </div>
          <p className="text-xs text-slate-300 leading-relaxed font-sans">
            Inspects natural language query intent, number of input images, and detected sensor modalities (Optical, SAR, Multispectral). Auto-routes requests to specialist models while maintaining an observable execution trace log.
          </p>
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-slate-900/50 space-y-2">
          <div className="flex items-center gap-2 text-cyan-400 font-mono font-bold text-sm">
            <Cpu className="w-4 h-4" />
            3. Specialist Model Adapters
          </div>
          <p className="text-xs text-slate-300 leading-relaxed font-sans">
            Decoupled adapters for Remote Sensing VQA, Captioning, Visual Grounding, Bi-temporal Change Detection, Change VQA, and Optical+SAR Cross-Modal Fusion.
          </p>
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-slate-900/50 space-y-2">
          <div className="flex items-center gap-2 text-cyan-400 font-mono font-bold text-sm">
            <ShieldCheck className="w-4 h-4" />
            4. Evidence Engine & Reports
          </div>
          <p className="text-xs text-slate-300 leading-relaxed font-sans">
            Generates pixel-level binary masks, colorized difference maps, bounding box overlays, and derived geospatial statistics. Supports downloadable PDF and JSON summary reports.
          </p>
        </div>

      </div>

    </div>
  );
};
