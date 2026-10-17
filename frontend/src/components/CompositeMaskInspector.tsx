import React, { useState, useEffect } from 'react';
import { 
  Eye, 
  Layers, 
  Sparkles, 
  Sliders, 
  CheckCircle2, 
  AlertTriangle, 
  Info, 
  Globe2, 
  Maximize2,
  Calendar,
  Cloud,
  ChevronRight,
  ShieldCheck,
  ShieldAlert
} from 'lucide-react';
import { 
  CompositeInspectorData, 
  CompositeInspectorLayerKey, 
  CompositeInspectorPeriod, 
  MapOverlayConfig,
  AOIBounds
} from '../types';

export interface CompositeMaskInspectorProps {
  inspectorData?: CompositeInspectorData | null;
  activeOverlay?: MapOverlayConfig | null;
  onOverlayChange?: (overlay: MapOverlayConfig | null) => void;
  isOfflineDemo?: boolean;
  className?: string;
}

export const CompositeMaskInspector: React.FC<CompositeMaskInspectorProps> = ({
  inspectorData,
  activeOverlay,
  onOverlayChange,
  isOfflineDemo = false,
  className = ''
}) => {
  const [selectedPeriod, setSelectedPeriod] = useState<CompositeInspectorPeriod>('t1');
  const [selectedLayer, setSelectedLayer] = useState<CompositeInspectorLayerKey>('scl_mask');
  const [opacity, setOpacity] = useState<number>(0.75);
  const [isOverlayOnMap, setIsOverlayOnMap] = useState<boolean>(false);

  // Synchronize onOverlayChange when layer, period, or opacity changes
  useEffect(() => {
    if (!isOverlayOnMap || !onOverlayChange) return;

    if (!inspectorData) {
      onOverlayChange(null);
      return;
    }

    const currentPeriodData = selectedPeriod === 't1' ? inspectorData.t1 : inspectorData.t2;
    const layerImg = currentPeriodData?.layers?.[selectedLayer];
    const bounds = currentPeriodData?.bounds || inspectorData.bounds;

    if (!layerImg || !bounds) {
      onOverlayChange(null);
      return;
    }

    const layerTitle = selectedLayer === 'b04_red'
      ? `${selectedPeriod.toUpperCase()} Red Reflectance (B04)`
      : selectedLayer === 'b08_nir'
      ? `${selectedPeriod.toUpperCase()} NIR Reflectance (B08)`
      : selectedLayer === 'obs_depth'
      ? `${selectedPeriod.toUpperCase()} Observation Depth`
      : `${selectedPeriod.toUpperCase()} SCL Validity Mask`;

    onOverlayChange({
      imageUrl: layerImg,
      bounds: bounds as AOIBounds,
      opacity: opacity,
      title: layerTitle,
      layerKey: selectedLayer,
      period: selectedPeriod
    });
  }, [isOverlayOnMap, selectedPeriod, selectedLayer, opacity, inspectorData, onOverlayChange]);

  const handleToggleMapOverlay = () => {
    const nextState = !isOverlayOnMap;
    setIsOverlayOnMap(nextState);
    if (!nextState && onOverlayChange) {
      onOverlayChange(null);
    }
  };

  if (!inspectorData) {
    return (
      <div className={`glass-panel rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-center ${className}`}>
        <div className="flex flex-col items-center justify-center gap-2 text-slate-400">
          <Layers className="w-8 h-8 text-slate-500 stroke-[1.5]" />
          <h4 className="text-sm font-semibold text-slate-300">Composite & Mask Inspector Awaiting Data</h4>
          <p className="text-xs text-slate-500 max-w-md">
            Execute a bi-temporal Sentinel-2 optical change analysis or load a multi-scene acquisition to inspect per-pixel reflectance, observation depth, and SCL cloud masking.
          </p>
        </div>
      </div>
    );
  }

  const periodData = selectedPeriod === 't1' ? inspectorData.t1 : inspectorData.t2;
  const isPeriodAvailable = periodData && periodData.status === 'success';
  const activeImage = periodData?.layers?.[selectedLayer];
  const stats = periodData?.stats;

  return (
    <div className={`glass-panel rounded-2xl border border-slate-800 bg-slate-900/85 shadow-2xl flex flex-col overflow-hidden ${className}`}>
      
      {/* Top Header */}
      <div className="p-4 border-b border-slate-800/80 bg-slate-950/70 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-cyan-950 text-cyan-400 border border-cyan-800/80 shadow-sm">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-mono font-bold text-slate-100 uppercase tracking-wider">
                SENTINEL-2 MULTI-SCENE COMPOSITE & SCL MASK INSPECTOR
              </h3>
              {isOfflineDemo && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800/70">
                  SYNTHETIC DEMO FIXTURE
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              Interactive per-pixel inspection of BOA reflectance, observation depth, and SCL cloud/shadow masking
            </p>
          </div>
        </div>

        {/* Global Map Overlay Button */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleMapOverlay}
            disabled={!isPeriodAvailable || !activeImage}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition-all flex items-center gap-1.5 ${
              isOverlayOnMap
                ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold shadow-md shadow-cyan-500/20'
                : 'bg-slate-800/80 hover:bg-slate-800 text-slate-200 border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            <Globe2 className="w-3.5 h-3.5" />
            {isOverlayOnMap ? 'Overlay Visible on Map' : 'Show on Global Map'}
          </button>
        </div>
      </div>

      {/* Main Grid: Controls & Visual Canvas */}
      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-800/80">
        
        {/* Left Column: Period & Layer Switchers */}
        <div className="lg:col-span-4 p-4 space-y-5 bg-slate-950/30">
          
          {/* 1. Period Selector (T1 vs T2) */}
          <div className="space-y-2">
            <label className="text-[11px] font-mono font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-cyan-400" />
              TEMPORAL ACQUISITION PERIOD
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setSelectedPeriod('t1')}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  selectedPeriod === 't1'
                    ? 'bg-cyan-950/50 border-cyan-500/60 text-cyan-200 shadow-sm'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <div className="text-xs font-bold font-mono">T1: Pre-Event</div>
                <div className="text-[10px] text-slate-400 truncate">
                  {inspectorData.t1?.contributing_scenes?.length || 0} Scene(s)
                </div>
              </button>

              <button
                onClick={() => setSelectedPeriod('t2')}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  selectedPeriod === 't2'
                    ? 'bg-cyan-950/50 border-cyan-500/60 text-cyan-200 shadow-sm'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <div className="text-xs font-bold font-mono">T2: Post-Event</div>
                <div className="text-[10px] text-slate-400 truncate">
                  {inspectorData.t2?.contributing_scenes?.length || 0} Scene(s)
                </div>
              </button>
            </div>
          </div>

          {/* 2. Visualization Mode Selector */}
          <div className="space-y-2">
            <label className="text-[11px] font-mono font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              VISUALIZATION LAYER MODE
            </label>
            <div className="space-y-1.5">
              
              {/* SCL Validity Mask */}
              <button
                onClick={() => setSelectedLayer('scl_mask')}
                className={`w-full px-3 py-2.5 rounded-xl border text-left transition-all flex items-center justify-between ${
                  selectedLayer === 'scl_mask'
                    ? 'bg-cyan-500/15 border-cyan-500/60 text-cyan-200 shadow-sm'
                    : 'bg-slate-900/80 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
                  <div>
                    <div className="text-xs font-semibold">SCL Validity Mask</div>
                    <div className="text-[10px] text-slate-400">Clear valid surface vs. cloud/shadow masked</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500" />
              </button>

              {/* Observation Depth */}
              <button
                onClick={() => setSelectedLayer('obs_depth')}
                className={`w-full px-3 py-2.5 rounded-xl border text-left transition-all flex items-center justify-between ${
                  selectedLayer === 'obs_depth'
                    ? 'bg-cyan-500/15 border-cyan-500/60 text-cyan-200 shadow-sm'
                    : 'bg-slate-900/80 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-sm shadow-amber-400/50" />
                  <div>
                    <div className="text-xs font-semibold">Observation Depth (0, 1, 2+)</div>
                    <div className="text-[10px] text-slate-400">Clear observations contributing per pixel</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500" />
              </button>

              {/* Red Reflectance (B04) */}
              <button
                onClick={() => setSelectedLayer('b04_red')}
                className={`w-full px-3 py-2.5 rounded-xl border text-left transition-all flex items-center justify-between ${
                  selectedLayer === 'b04_red'
                    ? 'bg-cyan-500/15 border-cyan-500/60 text-cyan-200 shadow-sm'
                    : 'bg-slate-900/80 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-400 shadow-sm shadow-rose-400/50" />
                  <div>
                    <div className="text-xs font-semibold">Red Reflectance (B04)</div>
                    <div className="text-[10px] text-slate-400">Composite Red BOA surface reflectance (665 nm)</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500" />
              </button>

              {/* NIR Reflectance (B08) */}
              <button
                onClick={() => setSelectedLayer('b08_nir')}
                className={`w-full px-3 py-2.5 rounded-xl border text-left transition-all flex items-center justify-between ${
                  selectedLayer === 'b08_nir'
                    ? 'bg-cyan-500/15 border-cyan-500/60 text-cyan-200 shadow-sm'
                    : 'bg-slate-900/80 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-sm shadow-cyan-400/50" />
                  <div>
                    <div className="text-xs font-semibold">Near-Infrared (B08)</div>
                    <div className="text-[10px] text-slate-400">Composite NIR BOA surface reflectance (842 nm)</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500" />
              </button>

            </div>
          </div>

          {/* 3. Opacity Slider */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-mono text-[11px]">OVERLAY OPACITY:</span>
              <span className="font-mono font-bold text-cyan-400">{Math.round(opacity * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
              className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* 4. Contributing Scenes List */}
          <div className="pt-2 border-t border-slate-800/80">
            <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              CONTRIBUTING SCENES ({selectedPeriod.toUpperCase()}):
            </div>
            <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
              {periodData?.contributing_scenes && periodData.contributing_scenes.length > 0 ? (
                periodData.contributing_scenes.map((s, idx) => (
                  <div key={idx} className="p-1.5 rounded-lg bg-slate-900/90 border border-slate-800/70 text-[10px] font-mono flex items-center justify-between">
                    <span className="text-slate-200 truncate max-w-[170px]" title={s.scene_id}>
                      {s.scene_id}
                    </span>
                    <span className="text-cyan-400 shrink-0 font-semibold">
                      {s.valid_coverage_pct ?? 100}% clear
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-[11px] text-slate-500 italic">No scenes contributing.</div>
              )}
            </div>
          </div>

        </div>

        {/* Right Column: Visual Canvas & Scientific Legend */}
        <div className="lg:col-span-8 p-4 flex flex-col justify-between space-y-4">
          
          {/* Raster Visual Viewport */}
          <div className="flex-1 flex flex-col items-center justify-center min-h-[300px] rounded-xl bg-slate-950/80 border border-slate-800/80 p-3 relative overflow-hidden">
            
            {!isPeriodAvailable ? (
              <div className="text-center p-6 space-y-2">
                <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
                <h5 className="text-xs font-semibold text-slate-300">Composite Layer Unavailable</h5>
                <p className="text-[11px] text-slate-500 max-w-sm">
                  {periodData?.reason || 'Zero valid clear pixels were found for this period after cloud masking.'}
                </p>
              </div>
            ) : activeImage ? (
              <div className="relative max-w-full max-h-[360px] flex items-center justify-center">
                <img
                  src={activeImage}
                  alt={`${selectedPeriod} ${selectedLayer}`}
                  style={{ opacity }}
                  className="max-h-[340px] max-w-full rounded-lg object-contain shadow-lg [image-rendering:pixelated]"
                />
                
                {/* Visual Overlay Tag */}
                <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-slate-950/80 border border-slate-700/80 text-[10px] font-mono text-slate-300 shadow">
                  {selectedPeriod.toUpperCase()} &bull; {selectedLayer.toUpperCase()} &bull; {periodData?.shape ? `${periodData.shape[0]}x${periodData.shape[1]} px` : ''}
                </div>
              </div>
            ) : (
              <div className="text-center p-6 text-slate-500 text-xs">
                Layer preview unavailable.
              </div>
            )}

          </div>

          {/* Scientific Legend Panel */}
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-cyan-400" />
                SCIENTIFIC LEGEND & CLASS DEFINITIONS
              </span>
              {stats && (
                <span className="text-[10px] font-mono text-slate-400">
                  Valid Coverage: <strong className="text-emerald-400">{stats.clear_coverage_pct}%</strong> ({stats.valid_pixels.toLocaleString()} / {stats.total_pixels.toLocaleString()} px)
                </span>
              )}
            </div>

            {/* Legend Content Based on Active Mode */}
            {selectedLayer === 'scl_mask' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-950/30 border border-emerald-800/40">
                  <span className="w-3.5 h-3.5 rounded bg-emerald-500 shrink-0" />
                  <div>
                    <span className="font-bold text-emerald-300 block">Clear Valid Surface (Retained)</span>
                    <span className="text-[10px] text-slate-400">SCL 4 (Veg), 5 (Non-veg), 6 (Water), 11 (Snow)</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-lg bg-rose-950/30 border border-rose-800/40">
                  <span className="w-3.5 h-3.5 rounded bg-rose-500 shrink-0" />
                  <div>
                    <span className="font-bold text-rose-300 block">Masked Atmospheric / Defective</span>
                    <span className="text-[10px] text-slate-400">SCL 1 (Defect), 3 (Shadow), 8-9 (Cloud), 10 (Cirrus), 0</span>
                  </div>
                </div>
              </div>
            )}

            {selectedLayer === 'obs_depth' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                <div className="flex items-center gap-2 p-2 rounded-lg bg-rose-950/30 border border-rose-800/40">
                  <span className="w-3.5 h-3.5 rounded bg-rose-600 shrink-0" />
                  <div>
                    <span className="font-bold text-rose-300 block">0 Observations ({stats?.obs_depth_0_count ?? 0} px)</span>
                    <span className="text-[10px] text-slate-400">Unobserved (Cloud/Shadow in all scenes)</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-950/30 border border-amber-800/40">
                  <span className="w-3.5 h-3.5 rounded bg-amber-500 shrink-0" />
                  <div>
                    <span className="font-bold text-amber-300 block">1 Observation ({stats?.obs_depth_1_count ?? 0} px)</span>
                    <span className="text-[10px] text-slate-400">Single clear observation</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-950/30 border border-emerald-800/40">
                  <span className="w-3.5 h-3.5 rounded bg-emerald-500 shrink-0" />
                  <div>
                    <span className="font-bold text-emerald-300 block">2+ Observations ({stats?.obs_depth_2plus_count ?? 0} px)</span>
                    <span className="text-[10px] text-slate-400">Multi-scene median composite</span>
                  </div>
                </div>
              </div>
            )}

            {(selectedLayer === 'b04_red' || selectedLayer === 'b08_nir') && (
              <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px]">
                <div className="flex items-center gap-3">
                  <div className="h-3 w-28 rounded bg-gradient-to-r from-black via-slate-500 to-white border border-slate-700" />
                  <span className="text-slate-300">
                    BOA Surface Reflectance Scale: <strong>0.0 (Black) &rarr; {selectedLayer === 'b04_red' ? '0.30' : '0.60'} (White)</strong>
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-400 text-[10px]">
                  <span className="w-2.5 h-2.5 rounded bg-slate-800 border border-slate-700" />
                  <span>Masked/NoData: Dark Slate Transparent</span>
                </div>
              </div>
            )}

          </div>

        </div>

      </div>

    </div>
  );
};
