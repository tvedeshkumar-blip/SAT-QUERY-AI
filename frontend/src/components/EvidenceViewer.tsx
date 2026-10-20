import React, { useEffect, useState } from 'react';
import { 
  Layers, 
  ZoomIn, 
  ZoomOut, 
  Split, 
  Sliders, 
  Sparkles, 
  Loader2,
  Calendar,
  AlertTriangle,
  Info,
  Maximize2,
  Columns3,
  Square,
  ShieldAlert,
  CheckCircle2
} from 'lucide-react';
import { VisualEvidence } from '../types';
import { API_BASE } from '../services/api';

export interface EvidenceViewerProps {
  evidenceList: VisualEvidence[];
  primaryImageUrl?: string;
  secondaryImageUrl?: string;
  mode: string;
  t1Date?: string;
  t2Date?: string;
  t1Label?: string;
  t2Label?: string;
  metadata?: Record<string, any>;
}

import { formatAcquisitionDate } from '../utils/dateFormatting.ts';
export { formatAcquisitionDate };

export const EvidenceViewer: React.FC<EvidenceViewerProps> = ({
  evidenceList,
  primaryImageUrl,
  secondaryImageUrl,
  mode,
  t1Date,
  t2Date,
  t1Label,
  t2Label,
  metadata,
}) => {
  const isBiTemporal = mode === 'bitemporal' || evidenceList.some((e) => e.type === 'change_map' || e.id === 'ev_change_map');

  // Initial layer selection
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string>(
    evidenceList.length > 0 ? evidenceList[0].id : 'original'
  );

  // View layout mode: 'tri' (T1 + T2 + Change), 'split' (Dual), or 'single'
  const [viewMode, setViewMode] = useState<'tri' | 'split' | 'single'>(
    isBiTemporal ? 'tri' : (secondaryImageUrl && mode !== 'single' ? 'split' : 'single')
  );

  // Toggle between change map (binary difference) and spatial overlay in 3rd panel
  const [activeChangeDisplay, setActiveChangeDisplay] = useState<'map' | 'overlay'>('map');

  const [opacity, setOpacity] = useState<number>(0.75);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [activeSpectralView, setActiveSpectralView] = useState<string>('natural');
  const [spectralOverlayData, setSpectralOverlayData] = useState<string | null>(null);
  const [spectralStats, setSpectralStats] = useState<Record<string, string | number> | null>(null);
  const [isComputingIndices, setIsComputingIndices] = useState<boolean>(false);
  const [indexNotice, setIndexNotice] = useState<string | null>(null);

  useEffect(() => {
    if (evidenceList.length > 0) {
      setSelectedEvidenceId(evidenceList[0].id);
    } else {
      setSelectedEvidenceId('original');
    }

    setSpectralOverlayData(null);
    setActiveSpectralView('natural');
    setIndexNotice(null);

    if (isBiTemporal) {
      setViewMode('tri');
    }
  }, [evidenceList, isBiTemporal]);

  // Extract individual artifacts from evidenceList
  const evT1Before = evidenceList.find((e) => e.id === 'ev_t1_before' || e.title?.toLowerCase().includes('before') || e.title?.toLowerCase().includes('t1'));
  const evT2After = evidenceList.find((e) => e.id === 'ev_t2_after' || e.title?.toLowerCase().includes('after') || e.title?.toLowerCase().includes('t2'));
  const evChangeMap = evidenceList.find((e) => e.id === 'ev_change_map' || e.type === 'change_map');
  const evChangeOverlay = evidenceList.find((e) => e.id === 'ev_change_overlay' || (e.type === 'overlay' && isBiTemporal));

  // Resolved image sources
  const t1ImageSrc = evT1Before?.data_base64 || evT1Before?.artifact_url || primaryImageUrl;
  const t2ImageSrc = evT2After?.data_base64 || evT2After?.artifact_url || secondaryImageUrl;
  const changeMapSrc = activeChangeDisplay === 'overlay'
    ? (evChangeOverlay?.data_base64 || evChangeOverlay?.artifact_url || evChangeMap?.data_base64 || evChangeMap?.artifact_url)
    : (evChangeMap?.data_base64 || evChangeMap?.artifact_url || evChangeOverlay?.data_base64 || evChangeOverlay?.artifact_url);

  // Extract acquisition dates from props, metadata, or evidence
  const rawT1Date = t1Date || 
    metadata?.temporal_provenance?.t1?.datetime || 
    metadata?.provenance?.temporal_t1_datetime || 
    (evT1Before?.statistics?.datetime as string | undefined);
  const rawT2Date = t2Date || 
    metadata?.temporal_provenance?.t2?.datetime || 
    metadata?.provenance?.temporal_t2_datetime || 
    (evT2After?.statistics?.datetime as string | undefined);

  const t1DateInfo = formatAcquisitionDate(rawT1Date, metadata?.temporal_provenance?.t1?.catalog_id);
  const t2DateInfo = formatAcquisitionDate(rawT2Date, metadata?.temporal_provenance?.t2?.catalog_id);

  // Band and sensor source checks
  const metaBands = metadata?.bands || metadata?.band_names || [];
  const hasNIR = Boolean(
    (Array.isArray(metaBands) && (metaBands.includes('B08') || metaBands.includes('NIR') || metaBands.includes('nir'))) ||
    metadata?.has_nir ||
    metadata?.modality === 'MULTISPECTRAL'
  );
  const hasSAR = Boolean(
    mode === 'optical_sar' ||
    metadata?.modality === 'SAR' ||
    metadata?.sensor?.includes?.('Sentinel-1') ||
    metadata?.sensor?.includes?.('C-Band')
  );

  // Handle spectral index requests
  const handleSpectralIndexClick = async (type: 'natural' | 'cir' | 'ndvi' | 'ndwi' | 'sar_db') => {
    setActiveSpectralView(type);
    setIndexNotice(null);

    if (type === 'natural') {
      setSpectralOverlayData(null);
      setSpectralStats(null);
      return;
    }

    // Enforce scientific integrity: strictly forbid generating NDVI, NDWI, or CIR without NIR Band 8
    if ((type === 'ndvi' || type === 'ndwi' || type === 'cir') && !hasNIR) {
      setSpectralOverlayData(null);
      setSpectralStats(null);
      setIndexNotice(
        `Spectral calculation withheld: Calibrated ${type.toUpperCase()} requires Sentinel-2 Near-Infrared Band 8 (B08). ` +
        `The loaded imagery contains visual RGB reflectance (B04, B03, B02) only. ` +
        `Pseudo-index calculation from RGB is withheld to prevent ungrounded measurements.`
      );
      return;
    }

    // Enforce scientific integrity: strictly forbid generating SAR backscatter metrics on optical imagery
    if (type === 'sar_db' && !hasSAR) {
      setSpectralOverlayData(null);
      setSpectralStats(null);
      setIndexNotice(
        `SAR measurement withheld: Calibrated radar sigma-0 backscatter requires Sentinel-1 C-band microwave data. ` +
        `The loaded scene is optical reflectance imagery.`
      );
      return;
    }

    try {
      setIsComputingIndices(true);
      const targetImg = (mode === 'optical_sar' && type === 'sar_db' && secondaryImageUrl) 
        ? secondaryImageUrl 
        : (primaryImageUrl || '');

      const res = await fetch(`${API_BASE}/analyze/spectral-indices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: [{ data: targetImg, mimeType: 'image/png', filename: 'raster.png' }],
          query: 'Compute indices',
          mode: 'single',
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(errJson.detail || 'Spectral index calculation failed');
      }

      const data = await res.json();
      const indices = data.indices || {};

      if (type === 'ndvi' && indices.ndvi) {
        setSpectralOverlayData(indices.ndvi.data_base64);
        setSpectralStats({
          'Mean NDVI': indices.ndvi.mean_ndvi,
          'Max Canopy Density': indices.ndvi.max_ndvi,
          'Index Formula': '(NIR - Red) / (NIR + Red)'
        });
      } else if (type === 'ndwi' && indices.ndwi) {
        setSpectralOverlayData(indices.ndwi.data_base64);
        setSpectralStats({
          'Mean NDWI': indices.ndwi.mean_ndwi,
          'Index Formula': '(Green - NIR) / (Green + NIR)',
          'Target Feature': 'Open Water Specular Reflection'
        });
      } else if (type === 'cir' && indices.cir) {
        setSpectralOverlayData(indices.cir.data_base64);
        setSpectralStats({
          'Composite Type': 'Color Infrared (CIR)',
          'Band Mapping': 'Red=NIR, Green=Red, Blue=Green',
          'Application': 'Chlorophyll & Biomass Vitality'
        });
      } else if (type === 'sar_db' && indices.sar_db) {
        setSpectralOverlayData(indices.sar_db.data_base64);
        setSpectralStats(indices.sar_db.stats || { 'Calibration': 'Decibel (dB) Sigma-0' });
      }
    } catch (err: any) {
      setSpectralOverlayData(null);
      setSpectralStats(null);
      setIndexNotice(`Spectral index calculation unavailable: ${err?.message || 'Source bands missing or incompatible.'}`);
    } finally {
      setIsComputingIndices(false);
    }
  };

  const selectedEvidence = evidenceList.find((e) => e.id === selectedEvidenceId) || evidenceList[0];
  const currentDisplayImage = spectralOverlayData || selectedEvidence?.data_base64 || selectedEvidence?.artifact_url || primaryImageUrl;

  // Pixel Accounting Statistics for explicit legend
  const stats = evChangeMap?.statistics || selectedEvidence?.statistics || {};
  const totalPixels = typeof stats.total_scene_pixels === 'number' ? stats.total_scene_pixels : 65536;
  const changedPixels = typeof stats.changed_pixel_count === 'number' ? stats.changed_pixel_count : (typeof stats.changed_pixels === 'number' ? stats.changed_pixels : 0);
  const changedPctStr = stats.changed_area_percent ? String(stats.changed_area_percent) : (totalPixels > 0 ? `${((changedPixels / totalPixels) * 100).toFixed(2)}%` : '0%');
  const changedPctNum = parseFloat(changedPctStr.replace('%', '')) || 0;
  const unchangedPixels = Math.max(0, totalPixels - changedPixels);
  const unchangedPctStr = `${(100 - changedPctNum).toFixed(2)}%`;
  const diffThreshold = stats.difference_threshold ?? 35;

  // Genuine cloud / invalid mask check
  const rawInvalidPixels = stats.masked_pixel_count ?? stats.invalid_pixels;
  const hasGenuineCloudMask = rawInvalidPixels !== undefined && rawInvalidPixels !== null;
  const invalidPixels = hasGenuineCloudMask ? Number(rawInvalidPixels) : 0;
  const invalidPctStr = hasGenuineCloudMask && totalPixels > 0 ? `${((invalidPixels / totalPixels) * 100).toFixed(2)}%` : '0%';

  return (
    <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-slate-900/60 shadow-xl space-y-4">
      
      {/* Evidence Toolbar Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800/50">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider font-mono">
              VISUAL EVIDENCE & TEMPORAL COMPARISON VIEWER
            </h3>
            <p className="text-xs text-slate-400">
              {isBiTemporal 
                ? 'Side-by-Side Bi-Temporal Acquisition Comparison with Spectral Difference Map'
                : 'Interactive Remote Sensing Artifact & Spectral Layer Explorer'}
            </p>
          </div>
        </div>

        {/* Layer Selector Pills */}
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
          {evidenceList.map((ev) => (
            <button
              key={ev.id}
              onClick={() => {
                setSelectedEvidenceId(ev.id);
                setSpectralOverlayData(null);
                setActiveSpectralView('natural');
                setIndexNotice(null);
              }}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all ${
                selectedEvidenceId === ev.id && !spectralOverlayData
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {ev.title}
            </button>
          ))}
        </div>
      </div>

      {/* Atmospheric & Phenological Confounders Warning Banner */}
      {isBiTemporal && (
        <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-700/60 text-amber-200 text-xs flex items-start gap-3 shadow-lg">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1.5 flex-1">
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-amber-300 uppercase tracking-wide text-xs">
                SCIENTIFIC INTEGRITY NOTICE: ATMOSPHERIC & PHENOLOGICAL CONSTRAINTS
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-900/60 border border-amber-600/40 text-amber-200">
                SPECTRAL DELTA ONLY
              </span>
            </div>
            <p className="text-[11px] text-amber-100/90 leading-relaxed">
              <strong>Atmospheric & Environmental Factors:</strong> Observed pixel differences measure raw numerical spectral reflectance variance between acquisition dates. Clouds, thin cirrus, atmospheric haze, solar illumination geometry, and seasonal vegetation phenology directly contribute to pixel-difference results.
            </p>
            <p className="text-[11px] text-amber-200/80 leading-relaxed font-mono">
              <strong>Classification Restriction:</strong> Candidate differences are statistical spectral anomalies only. They must <strong>NOT</strong> be labeled or interpreted as confirmed buildings, vegetation loss, or real-world land-cover alterations without independent multi-spectral cloud screening or in-situ ground-truth verification.
            </p>
          </div>
        </div>
      )}

      {/* Notice if an unavailable spectral index was requested */}
      {indexNotice && (
        <div className="p-3 rounded-xl bg-slate-950 border border-amber-800/60 text-amber-200 text-xs font-mono flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-amber-300 block mb-0.5">Scientific Limitation:</span>
            {indexNotice}
          </div>
        </div>
      )}

      {/* Multispectral & Radar Composite Band Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800/90 text-xs font-mono">
        <div className="flex items-center gap-2 text-slate-300">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">Spectral Composites:</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => handleSpectralIndexClick('natural')}
            className={`px-2.5 py-1 rounded-md text-[11px] transition-all ${
              activeSpectralView === 'natural'
                ? 'bg-slate-800 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Natural RGB
          </button>

          <button
            onClick={() => handleSpectralIndexClick('cir')}
            title={hasNIR ? 'Color Infrared (NIR-Red-Green)' : 'Unavailable: Requires Near-Infrared Band 8 (B08)'}
            className={`px-2.5 py-1 rounded-md text-[11px] transition-all flex items-center gap-1 ${
              activeSpectralView === 'cir'
                ? 'bg-rose-950/80 text-rose-300 border border-rose-600/50'
                : hasNIR
                ? 'text-slate-400 hover:text-slate-200'
                : 'text-slate-500 opacity-60 hover:opacity-100'
            }`}
          >
            False Color (CIR)
            {!hasNIR && <span className="text-[9px] text-amber-400 font-mono">(No NIR)</span>}
          </button>

          <button
            onClick={() => handleSpectralIndexClick('ndvi')}
            title={hasNIR ? 'Normalized Difference Vegetation Index' : 'Unavailable: Requires Near-Infrared Band 8 (B08)'}
            className={`px-2.5 py-1 rounded-md text-[11px] transition-all flex items-center gap-1 ${
              activeSpectralView === 'ndvi'
                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-600/50'
                : hasNIR
                ? 'text-slate-400 hover:text-slate-200'
                : 'text-slate-500 opacity-60 hover:opacity-100'
            }`}
          >
            NDVI Vegetation
            {!hasNIR && <span className="text-[9px] text-amber-400 font-mono">(No NIR)</span>}
          </button>

          <button
            onClick={() => handleSpectralIndexClick('ndwi')}
            title={hasNIR ? 'Normalized Difference Water Index' : 'Unavailable: Requires Near-Infrared Band 8 (B08)'}
            className={`px-2.5 py-1 rounded-md text-[11px] transition-all flex items-center gap-1 ${
              activeSpectralView === 'ndwi'
                ? 'bg-sky-950/80 text-sky-300 border border-sky-600/50'
                : hasNIR
                ? 'text-slate-400 hover:text-slate-200'
                : 'text-slate-500 opacity-60 hover:opacity-100'
            }`}
          >
            NDWI Water Map
            {!hasNIR && <span className="text-[9px] text-amber-400 font-mono">(No NIR)</span>}
          </button>

          <button
            onClick={() => handleSpectralIndexClick('sar_db')}
            title={hasSAR ? 'SAR Calibrated Backscatter' : 'Unavailable: Requires Radar Microwave data'}
            className={`px-2.5 py-1 rounded-md text-[11px] transition-all flex items-center gap-1 ${
              activeSpectralView === 'sar_db'
                ? 'bg-amber-950/80 text-amber-300 border border-amber-600/50'
                : hasSAR
                ? 'text-slate-400 hover:text-slate-200'
                : 'text-slate-500 opacity-60 hover:opacity-100'
            }`}
          >
            SAR Calibrated dB
            {!hasSAR && <span className="text-[9px] text-amber-400 font-mono">(No Radar)</span>}
          </button>
        </div>

        {isComputingIndices && (
          <div className="flex items-center gap-1.5 text-cyan-400 text-[11px]">
            <Loader2 className="w-3 h-3 animate-spin" />
            Calculating raster indices...
          </div>
        )}
      </div>

      {/* Control Bar: View Layouts, Zoom, Opacity */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/80 px-4 py-2 rounded-xl border border-slate-800 text-xs">
        
        {/* Layout Mode Selector for Bi-Temporal / Comparison */}
        {isBiTemporal ? (
          <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setViewMode('tri')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-all ${
                viewMode === 'tri'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Columns3 className="w-3.5 h-3.5" />
              Tri-View (T1 + T2 + Change)
            </button>

            <button
              onClick={() => setViewMode('split')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-all ${
                viewMode === 'split'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Split className="w-3.5 h-3.5" />
              Side-by-Side (T1 vs T2)
            </button>

            <button
              onClick={() => setViewMode('single')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-all ${
                viewMode === 'single'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Square className="w-3.5 h-3.5" />
              Single Layer
            </button>
          </div>
        ) : (
          mode !== 'single' && secondaryImageUrl && (
            <button
              onClick={() => setViewMode(viewMode === 'split' ? 'single' : 'split')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-mono text-xs transition-all ${
                viewMode === 'split'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'bg-slate-900 text-slate-400 border border-slate-800'
              }`}
            >
              <Split className="w-3.5 h-3.5" />
              {viewMode === 'split' ? 'Side-by-Side: ON' : 'Single View'}
            </button>
          )
        )}

        {/* Opacity Control */}
        <div className="flex items-center gap-2">
          <Sliders className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-300 font-mono">Overlay Opacity:</span>
          <input
            type="range"
            min="0.1"
            max="1.0"
            step="0.05"
            value={opacity}
            onChange={(e) => setOpacity(parseFloat(e.target.value))}
            className="w-24 accent-cyan-400 cursor-pointer"
          />
          <span className="font-mono text-cyan-400 text-[11px]">{Math.round(opacity * 100)}%</span>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoomLevel((z) => Math.max(0.75, z - 0.25))}
            className="p-1 rounded bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono text-slate-300 min-w-[45px] text-center">{Math.round(zoomLevel * 100)}%</span>
          <button
            onClick={() => setZoomLevel((z) => Math.min(2.5, z + 0.25))}
            className="p-1 rounded bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

      </div>

      {/* Main Canvas Viewport */}
      <div className="relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800 min-h-[360px] p-2 flex items-center justify-center">
        
        {/* Layout 1: Tri-View (T1 Scene + T2 Scene + Change Evidence) */}
        {viewMode === 'tri' && isBiTemporal ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full h-full">
            
            {/* Panel 1: T1 Earlier Date Scene */}
            <div className="relative rounded-lg overflow-hidden bg-slate-900 border border-slate-800 flex flex-col">
              <div className="bg-slate-950/90 px-3 py-2 border-b border-slate-800 flex flex-col gap-1 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800 text-[10px] font-bold">
                    T1 PRE-EVENT
                  </span>
                  <span className="text-[10px] text-slate-400 truncate max-w-[140px]">
                    {metadata?.temporal_provenance?.t1?.catalog_id || t1Label || 'Sentinel-2B'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-cyan-300 text-[11px] font-semibold">
                  <Calendar className="w-3 h-3 text-cyan-400 shrink-0" />
                  <span>Acquisition: {t1DateInfo.formatted}</span>
                </div>
              </div>
              <div className="p-2 flex items-center justify-center flex-1 overflow-auto bg-slate-950/50">
                {t1ImageSrc ? (
                  <img
                    src={t1ImageSrc}
                    alt="T1 Earlier Scene"
                    className="max-h-[360px] object-contain transition-transform duration-200"
                    style={{ transform: `scale(${zoomLevel})` }}
                  />
                ) : (
                  <p className="text-xs text-slate-500 font-mono">T1 scene unavailable</p>
                )}
              </div>
            </div>

            {/* Panel 2: T2 Second-Date Scene */}
            <div className="relative rounded-lg overflow-hidden bg-slate-900 border border-slate-800 flex flex-col">
              <div className="bg-slate-950/90 px-3 py-2 border-b border-slate-800 flex flex-col gap-1 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 text-[10px] font-bold">
                    T2 POST-EVENT
                  </span>
                  <span className="text-[10px] text-slate-400 truncate max-w-[140px]">
                    {metadata?.temporal_provenance?.t2?.catalog_id || t2Label || 'Sentinel-2A'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-cyan-300 text-[11px] font-semibold">
                  <Calendar className="w-3 h-3 text-cyan-400 shrink-0" />
                  <span>Acquisition: {t2DateInfo.formatted}</span>
                </div>
              </div>
              <div className="p-2 flex items-center justify-center flex-1 overflow-auto bg-slate-950/50">
                {t2ImageSrc ? (
                  <img
                    src={t2ImageSrc}
                    alt="T2 Later Scene"
                    className="max-h-[360px] object-contain transition-transform duration-200"
                    style={{ transform: `scale(${zoomLevel})` }}
                  />
                ) : (
                  <p className="text-xs text-slate-500 font-mono">T2 scene unavailable</p>
                )}
              </div>
            </div>

            {/* Panel 3: Change Map & Spatial Overlay */}
            <div className="relative rounded-lg overflow-hidden bg-slate-900 border border-slate-800 flex flex-col">
              <div className="bg-slate-950/90 px-3 py-2 border-b border-slate-800 flex flex-col gap-1 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 text-[10px] font-bold">
                    CHANGE EVIDENCE
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setActiveChangeDisplay('map')}
                      className={`px-1.5 py-0.5 rounded text-[10px] transition-all ${
                        activeChangeDisplay === 'map'
                          ? 'bg-rose-900/80 text-rose-200 font-bold border border-rose-600/60'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Difference Map
                    </button>
                    <button
                      onClick={() => setActiveChangeDisplay('overlay')}
                      className={`px-1.5 py-0.5 rounded text-[10px] transition-all ${
                        activeChangeDisplay === 'overlay'
                          ? 'bg-rose-900/80 text-rose-200 font-bold border border-rose-600/60'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Spatial Overlay
                    </button>
                  </div>
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  Delta &gt; {diffThreshold} &bull; <strong className="text-rose-400">{changedPctStr}</strong> candidate delta
                </div>
              </div>
              <div className="p-2 flex items-center justify-center flex-1 overflow-auto bg-slate-950/50">
                {changeMapSrc ? (
                  <img
                    src={changeMapSrc}
                    alt="Change Detection Result"
                    className="max-h-[360px] object-contain transition-transform duration-200"
                    style={{ transform: `scale(${zoomLevel})`, opacity }}
                  />
                ) : (
                  <p className="text-xs text-slate-500 font-mono">Change map unavailable</p>
                )}
              </div>
            </div>

          </div>
        ) : viewMode === 'split' ? (
          /* Layout 2: Dual Side-by-Side (T1 vs T2 or Optical vs SAR) */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full h-full">
            
            {/* Left Frame */}
            <div className="relative rounded-lg overflow-hidden bg-slate-900 border border-slate-800 flex flex-col">
              <div className="bg-slate-950/90 px-3 py-1.5 border-b border-slate-800 flex items-center justify-between text-xs font-mono text-slate-300">
                <span>{isBiTemporal ? 'T1: BEFORE' : 'OPTICAL REFLECTANCE'}</span>
                {isBiTemporal && (
                  <span className="text-cyan-400 flex items-center gap-1 text-[11px]">
                    <Calendar className="w-3 h-3" />
                    {t1DateInfo.formatted}
                  </span>
                )}
              </div>
              <div className="p-2 flex items-center justify-center flex-1 overflow-auto">
                <img
                  src={t1ImageSrc}
                  alt="T1 scene"
                  className="max-h-[380px] object-contain transition-transform duration-200"
                  style={{ transform: `scale(${zoomLevel})` }}
                />
              </div>
            </div>

            {/* Right Frame */}
            <div className="relative rounded-lg overflow-hidden bg-slate-900 border border-slate-800 flex flex-col">
              <div className="bg-slate-950/90 px-3 py-1.5 border-b border-slate-800 flex items-center justify-between text-xs font-mono text-slate-300">
                <span>
                  {spectralOverlayData 
                    ? `SPECTRAL LAYER: ${activeSpectralView.toUpperCase()}` 
                    : (isBiTemporal ? 'T2: AFTER (SECOND DATE)' : (selectedEvidence ? selectedEvidence.title : 'SAR / FUSED EVIDENCE'))}
                </span>
                {isBiTemporal && !spectralOverlayData && (
                  <span className="text-cyan-400 flex items-center gap-1 text-[11px]">
                    <Calendar className="w-3 h-3" />
                    {t2DateInfo.formatted}
                  </span>
                )}
              </div>
              <div className="p-2 flex items-center justify-center flex-1 overflow-auto">
                <img
                  src={spectralOverlayData || t2ImageSrc || currentDisplayImage}
                  alt="T2 scene or evidence"
                  className="max-h-[380px] object-contain transition-transform duration-200"
                  style={{ transform: `scale(${zoomLevel})`, opacity }}
                />
              </div>
            </div>

          </div>
        ) : (
          /* Layout 3: Single Canvas View */
          <div className="relative max-w-full overflow-auto flex items-center justify-center">
            {currentDisplayImage ? (
              <img
                src={currentDisplayImage}
                alt={selectedEvidence?.title || 'Satellite Evidence'}
                className="max-h-[440px] rounded-lg object-contain transition-transform duration-200 shadow-2xl"
                style={{ transform: `scale(${zoomLevel})`, opacity }}
              />
            ) : (
              <p className="text-xs text-slate-500 font-mono">No visual evidence layer selected.</p>
            )}
          </div>
        )}

      </div>

      {/* Explicit Scientific Change Overlay Legend & Pixel Accounting */}
      {isBiTemporal && (
        <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-cyan-400" />
              <span className="font-mono text-xs font-bold text-slate-200 uppercase tracking-wider">
                CHANGE OVERLAY SCIENTIFIC LEGEND & PIXEL ACCOUNTING
              </span>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Total Grid Pixels: <strong className="text-slate-200">{totalPixels.toLocaleString()} px</strong>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
            
            {/* 1. Changed Pixels */}
            <div className="p-2.5 rounded-lg bg-red-950/30 border border-red-800/40 space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded bg-red-500 shrink-0 border border-red-400 shadow-sm shadow-red-500/50" />
                <span className="font-mono font-bold text-red-300">Changed Pixels</span>
              </div>
              <div className="text-[11px] text-slate-300 font-mono">
                <strong>{changedPixels.toLocaleString()} px</strong> ({changedPctStr})
              </div>
              <p className="text-[10px] text-slate-400 leading-tight">
                Candidate spectral delta &gt; threshold ({diffThreshold}). Unverified candidate clusters.
              </p>
            </div>

            {/* 2. Unchanged Pixels */}
            <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded bg-slate-700 shrink-0 border border-slate-600" />
                <span className="font-mono font-bold text-slate-300">Unchanged Pixels</span>
              </div>
              <div className="text-[11px] text-slate-300 font-mono">
                <strong>{unchangedPixels.toLocaleString()} px</strong> ({unchangedPctStr})
              </div>
              <p className="text-[10px] text-slate-400 leading-tight">
                Stable spectral reflectance within baseline tolerance (delta &le; {diffThreshold}).
              </p>
            </div>

            {/* 3. Invalid or Cloud-Obscured Pixels */}
            {hasGenuineCloudMask ? (
              <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-800/40 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded bg-amber-500 shrink-0 border border-amber-400 shadow-sm shadow-amber-500/50" />
                  <span className="font-mono font-bold text-amber-300">Invalid / Cloud-Obscured</span>
                </div>
                <div className="text-[11px] text-slate-300 font-mono">
                  <strong>{invalidPixels.toLocaleString()} px</strong> ({invalidPctStr})
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">
                  Masked via Sentinel-2 SCL scene classification (cloud, cloud shadow, or defect).
                </p>
              </div>
            ) : (
              <div className="p-2.5 rounded-lg bg-slate-900/40 border border-dashed border-slate-800 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded bg-slate-800 shrink-0 border border-dashed border-slate-600 flex items-center justify-center text-[9px] text-slate-500 font-mono">
                    &times;
                  </span>
                  <span className="font-mono font-bold text-slate-400">Invalid / Cloud-Obscured</span>
                </div>
                <div className="text-[11px] text-amber-400/90 font-mono">
                  Unavailable (RGB visual only)
                </div>
                <p className="text-[10px] text-slate-500 leading-tight">
                  SCL cloud mask unavailable in RGB visual assets. Atmospheric differences may confound pixel differences.
                </p>
              </div>
            )}

          </div>
        </div>
      )}

      {/* Derived Evidence / Spectral Stats Panel */}
      {(spectralStats || (selectedEvidence?.statistics && Object.keys(selectedEvidence.statistics).length > 0)) && (
        <div className="bg-slate-950/90 rounded-xl p-3 border border-slate-800 space-y-1.5">
          <p className="text-[11px] font-mono font-semibold text-slate-400 uppercase tracking-wider">
            {spectralStats ? `SPECTRAL INDEX METRICS (${activeSpectralView.toUpperCase()})` : `DERIVED GEOSPATIAL STATISTICS (${selectedEvidence.title})`}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
            {Object.entries(spectralStats || selectedEvidence.statistics || {}).map(([k, v]) => (
              <div key={k} className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-400 block truncate">{k.replace(/_/g, ' ')}</span>
                <span className="text-cyan-300 font-bold">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};
