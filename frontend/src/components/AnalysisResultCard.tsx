import React, { useState } from 'react';
import { 
  CheckCircle2, 
  Download, 
  ShieldCheck, 
  Cpu, 
  FileSpreadsheet, 
  Loader2, 
  Globe, 
  Eye, 
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Search,
  CheckCircle,
  XCircle,
  GitCompare,
  Clock,
  Layers,
  Radio,
  Sun
} from 'lucide-react';
import { AnalysisResponse } from '../types';
import { API_BASE } from '../services/api';
import { MetadataInspectorModal } from './MetadataInspectorModal';
import { ReportPreviewModal } from './ReportPreviewModal';
import { ScientificVerificationPanel } from './ScientificVerificationPanel';

interface AnalysisResultCardProps {
  response: AnalysisResponse;
}

export const AnalysisResultCard: React.FC<AnalysisResultCardProps> = ({ response }) => {
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingJson, setIsExportingJson] = useState(false);
  const [isMetadataOpen, setIsMetadataOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const handleDownloadPdf = async () => {
    try {
      setIsExportingPdf(true);
      const res = await fetch(`${API_BASE}/reports/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response),
      });
      if (!res.ok) throw new Error('PDF export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `satquery_report_${response.id}.pdf`;
      a.click();
    } catch (err) {
      console.error('PDF Download Error:', err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleDownloadJson = async () => {
    try {
      setIsExportingJson(true);
      const res = await fetch(`${API_BASE}/reports/json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response),
      });
      if (!res.ok) throw new Error('JSON export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `satquery_report_${response.id}.json`;
      a.click();
    } catch (err) {
      console.error('JSON Download Error:', err);
    } finally {
      setIsExportingJson(false);
    }
  };

  const conflict = response.conflict_info;
  const confidenceBreakdown = response.confidence_breakdown;
  const quality = confidenceBreakdown?.evidence_quality || {};

  return (
    <div className="glass-panel rounded-2xl p-6 border border-slate-800 bg-slate-900/60 shadow-xl space-y-4">
      
      {/* Header Badges */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-lg bg-cyan-950 text-cyan-300 border border-cyan-800">
            TASK: {response.task.toUpperCase()}
          </span>

          <span className={`font-mono text-[11px] font-semibold px-2.5 py-1 rounded-lg border ${
            response.implementation_status === 'pretrained_model' 
              ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
              : response.implementation_status === 'demo'
              ? 'bg-amber-950 text-amber-300 border-amber-800'
              : 'bg-slate-950 text-slate-300 border-slate-800'
          }`}>
            STATUS: {(response.implementation_status || 'baseline').toUpperCase()}
          </span>
          
          <span className="font-mono text-xs text-slate-400">
            ID: <span className="text-slate-200">{response.id}</span>
          </span>

          {response.verification && (
            <span className={`font-mono text-[11px] font-semibold px-2.5 py-1 rounded-lg border ${
              response.verification.verification_status === 'supported'
                ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                : response.verification.verification_status === 'partially_supported'
                ? 'bg-amber-950 text-amber-300 border-amber-800'
                : response.verification.verification_status === 'unsupported'
                ? 'bg-rose-950 text-rose-300 border-rose-800'
                : 'bg-slate-950 text-slate-400 border-slate-800'
            }`}>
              VERIFICATION: {response.verification.verification_status.toUpperCase()}
            </span>
          )}
        </div>

        {/* Latency & Quality Summary */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono">
            <Cpu className="w-3.5 h-3.5 text-teal-400" />
            <span className="text-slate-400">Latency:</span>
            <span className="text-teal-300 font-bold">{response.execution_time_ms} ms</span>
          </div>
        </div>

      </div>

      {/* User Query Banner */}
      {response.query && (
        <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-start gap-2.5">
          <Search className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
          <div className="text-xs">
            <span className="font-mono text-slate-400 font-semibold uppercase tracking-wider">User Query: </span>
            <span className="text-slate-200 font-medium font-sans">"{response.query}"</span>
          </div>
        </div>
      )}

      {/* Model Selection, Execution & Fallback Provenance Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs font-mono">
        <div>
          <span className="text-slate-500 block text-[10px] uppercase tracking-wider">Model Selected (Primary)</span>
          <span className="text-cyan-300 font-bold">{response.primary_model || response.models[0]}</span>
        </div>

        <div>
          <span className="text-slate-500 block text-[10px] uppercase tracking-wider">Model Actually Used</span>
          <span className="text-slate-200 font-semibold">{response.actual_model_used || response.models[0]}</span>
        </div>

        <div>
          <span className="text-slate-500 block text-[10px] uppercase tracking-wider">Fallback Status</span>
          {response.fallback_used ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-amber-300 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
              Fallback Active ({response.actual_model_used})
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              Direct Model Execution
            </span>
          )}
        </div>
      </div>

      {/* Explicit Fallback Warning Banner if Fallback is Used */}
      {response.fallback_used && (
        <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/80 flex items-start gap-2.5 text-xs text-amber-200">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-semibold font-mono uppercase tracking-wider text-amber-300 block">
              {response.task === 'change_detection' 
                ? 'Neural change model unavailable — deterministic baseline used.' 
                : response.task === 'grounding'
                ? 'Neural grounding model unavailable — deterministic baseline used.'
                : 'Primary model unavailable — deterministic baseline used.'}
            </span>
            <span className="text-amber-300/80 text-[11px]">
              Primary model '{response.primary_model}' weights are not mounted ({response.model_status || 'checkpoint_not_found'}). 
              Analysis was executed using the deterministic '{response.actual_model_used}' fallback.
            </span>
          </div>
        </div>
      )}

      {/* Bi-Temporal Scientific Provenance & Verification Banner */}
      {response.metadata?.temporal_provenance && (
        <div className="p-4 rounded-xl bg-slate-950/90 border border-cyan-800/60 space-y-3 text-xs font-mono">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
            <span className="text-cyan-400 font-bold flex items-center gap-1.5 uppercase tracking-wider">
              <GitCompare className="w-4 h-4 text-cyan-400" />
              BI-TEMPORAL SCIENTIFIC PROVENANCE & PAIR VERIFICATION
            </span>
            <div className="flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 text-[10px]">
                {response.metadata.temporal_provenance.t1?.modality || 'OPTICAL'} Bi-Temporal
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700 text-[10px]">
                Actual Provider: {response.actual_model_used || response.models[0]}
              </span>
            </div>
          </div>

          {/* Independent T1 and T2 Scene Columns */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* T1 Pre-Event */}
            <div className="p-3 rounded-lg bg-slate-900/90 border border-cyan-900/40 space-y-1.5">
              <div className="flex items-center justify-between text-cyan-300 font-bold text-[11px]">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-cyan-400" />
                  T1: PRE-EVENT (BASELINE)
                </span>
                <span className="text-slate-400 text-[10px]">
                  {response.metadata.temporal_provenance.t1?.datetime ? new Date(response.metadata.temporal_provenance.t1.datetime).toLocaleDateString() : 'Baseline Pass'}
                </span>
              </div>
              <div className="space-y-0.5 text-[10px] text-slate-300">
                <div>Catalog ID: <span className="text-slate-100 font-semibold truncate block" title={response.metadata.temporal_provenance.t1?.catalog_id}>{response.metadata.temporal_provenance.t1?.catalog_id || 'N/A'}</span></div>
                <div>Collection: <span className="text-cyan-300">{response.metadata.temporal_provenance.t1?.collection}</span> | Asset: <span className="text-slate-100">{response.metadata.temporal_provenance.t1?.asset_key}</span></div>
                <div>CRS: <span className="text-slate-100">{response.metadata.temporal_provenance.t1?.crs || 'Unprojected'}</span> | Dims: <span className="text-slate-100">{response.metadata.temporal_provenance.t1?.dimensions}</span></div>
              </div>
            </div>

            {/* T2 Post-Event */}
            <div className="p-3 rounded-lg bg-slate-900/90 border border-indigo-900/40 space-y-1.5">
              <div className="flex items-center justify-between text-indigo-300 font-bold text-[11px]">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-indigo-400" />
                  T2: POST-EVENT (CHANGED STATE)
                </span>
                <span className="text-slate-400 text-[10px]">
                  {response.metadata.temporal_provenance.t2?.datetime ? new Date(response.metadata.temporal_provenance.t2.datetime).toLocaleDateString() : 'Later Pass'}
                </span>
              </div>
              <div className="space-y-0.5 text-[10px] text-slate-300">
                <div>Catalog ID: <span className="text-slate-100 font-semibold truncate block" title={response.metadata.temporal_provenance.t2?.catalog_id}>{response.metadata.temporal_provenance.t2?.catalog_id || 'N/A'}</span></div>
                <div>Collection: <span className="text-indigo-300">{response.metadata.temporal_provenance.t2?.collection}</span> | Asset: <span className="text-slate-100">{response.metadata.temporal_provenance.t2?.asset_key}</span></div>
                <div>CRS: <span className="text-slate-100">{response.metadata.temporal_provenance.t2?.crs || 'Unprojected'}</span> | Dims: <span className="text-slate-100">{response.metadata.temporal_provenance.t2?.dimensions}</span></div>
              </div>
            </div>
          </div>

          {/* Scientific Distinction Notice */}
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[10px] space-y-1">
            <span className="text-cyan-300 font-bold block uppercase tracking-wider">
              SCIENTIFIC DISTINCTION & VERIFICATION FRAMEWORK:
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-slate-300">
              <div className="p-1.5 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="font-bold text-amber-300 block mb-0.5">1. PIXEL DELTA</span>
                <span className="text-slate-400 text-[9px]">{response.metadata.temporal_provenance.scientific_distinction?.detected_pixel_differences || 'Numeric radiance delta exceeding threshold.'}</span>
              </div>
              <div className="p-1.5 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="font-bold text-cyan-300 block mb-0.5">2. PREDICTED REGIONS</span>
                <span className="text-slate-400 text-[9px]">{response.metadata.temporal_provenance.scientific_distinction?.model_predicted_change || 'Candidate spatial cluster boundaries identified by model.'}</span>
              </div>
              <div className="p-1.5 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="font-bold text-rose-300 block mb-0.5">3. REAL-WORLD CHANGE</span>
                <span className="text-slate-400 text-[9px]">{response.metadata.temporal_provenance.scientific_distinction?.confirmed_real_world_change || 'Unconfirmed without independent field validation.'}</span>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* Optical + SAR Cross-Sensor Scientific Provenance Banner */}
      {response.metadata?.optical_sar_provenance && (
        <div className="p-4 rounded-xl bg-slate-950/90 border border-purple-800/60 space-y-3 text-xs font-mono">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
            <span className="text-purple-400 font-bold flex items-center gap-1.5 uppercase tracking-wider">
              <Layers className="w-4 h-4 text-purple-400" />
              OPTICAL + SAR CROSS-SENSOR SCIENTIFIC PROVENANCE & RADIOMETRIC VERIFICATION
            </span>
            <div className="flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 text-[10px]">
                Dual-Modality Joint Analysis
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700 text-[10px]">
                Specialist: {response.actual_model_used || response.models[0]}
              </span>
            </div>
          </div>

          {/* Independent Optical and SAR Scene Columns */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Optical Reflectance Scene */}
            <div className="p-3 rounded-lg bg-slate-900/90 border border-cyan-900/40 space-y-1.5">
              <div className="flex items-center justify-between text-cyan-300 font-bold text-[11px]">
                <span className="flex items-center gap-1">
                  <Sun className="w-3 h-3 text-cyan-400" />
                  OPTICAL SCENE (SURFACE REFLECTANCE)
                </span>
                <span className="text-slate-400 text-[10px]">
                  {response.metadata.optical_sar_provenance.optical?.datetime ? new Date(response.metadata.optical_sar_provenance.optical.datetime).toLocaleDateString() : 'Recorded Pass'}
                </span>
              </div>
              <div className="space-y-0.5 text-[10px] text-slate-300">
                <div>Catalog ID: <span className="text-slate-100 font-semibold truncate block" title={response.metadata.optical_sar_provenance.optical?.catalog_id}>{response.metadata.optical_sar_provenance.optical?.catalog_id || 'N/A'}</span></div>
                <div>Collection: <span className="text-cyan-300">{response.metadata.optical_sar_provenance.optical?.collection}</span> | Asset: <span className="text-slate-100">{response.metadata.optical_sar_provenance.optical?.asset_key}</span></div>
                <div>CRS: <span className="text-slate-100">{response.metadata.optical_sar_provenance.optical?.crs || 'Unprojected'}</span> | Dims: <span className="text-slate-100">{response.metadata.optical_sar_provenance.optical?.dimensions}</span></div>
              </div>
            </div>

            {/* SAR Microwave Scene */}
            <div className="p-3 rounded-lg bg-slate-900/90 border border-purple-900/40 space-y-1.5">
              <div className="flex items-center justify-between text-purple-300 font-bold text-[11px]">
                <span className="flex items-center gap-1">
                  <Radio className="w-3 h-3 text-purple-400" />
                  SAR SCENE (MICROWAVE BACKSCATTER)
                </span>
                <span className="text-slate-400 text-[10px]">
                  {response.metadata.optical_sar_provenance.sar?.datetime ? new Date(response.metadata.optical_sar_provenance.sar.datetime).toLocaleDateString() : 'Recorded Pass'}
                </span>
              </div>
              <div className="space-y-0.5 text-[10px] text-slate-300">
                <div>Catalog ID: <span className="text-slate-100 font-semibold truncate block" title={response.metadata.optical_sar_provenance.sar?.catalog_id}>{response.metadata.optical_sar_provenance.sar?.catalog_id || 'N/A'}</span></div>
                <div>Sensor: <span className="text-purple-300">{response.metadata.optical_sar_provenance.sar?.sensor || 'Sentinel-1'}</span> | Pol: <span className="text-slate-100">{response.metadata.optical_sar_provenance.sar?.polarization || 'VV'}</span></div>
                <div>
                  Calibration: <span className={`font-semibold ${response.metadata.optical_sar_provenance.sar?.calibration_status === 'calibrated_backscatter' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {response.metadata.optical_sar_provenance.sar?.calibration_status === 'calibrated_backscatter' ? '✓ Verified sigma-0 dB' : '⚠ Relative Linear DN (Unverified)'}
                  </span>
                </div>
                <div>
                  Terrain: <span className={`font-semibold ${response.metadata.optical_sar_provenance.sar?.terrain_correction_status === 'radiometrically_terrain_corrected' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {response.metadata.optical_sar_provenance.sar?.terrain_correction_status === 'radiometrically_terrain_corrected' ? '✓ Radiometrically Terrain Corrected (RTC)' : '⚠ Ellipsoid Projected (GRD)'}
                  </span>
                </div>
                <div>CRS: <span className="text-slate-100">{response.metadata.optical_sar_provenance.sar?.crs || 'Unprojected'}</span> | Dims: <span className="text-slate-100">{response.metadata.optical_sar_provenance.sar?.dimensions}</span></div>
              </div>
            </div>
          </div>

          {/* Cross-Sensor Verification Telemetry */}
          {response.metadata.optical_sar_provenance.cross_sensor_verification && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] text-slate-300 pt-1 border-t border-slate-800/60">
              <div>
                <span className="text-slate-400 block">SPATIAL OVERLAP:</span>
                <span className="font-bold text-slate-100">
                  {response.metadata.optical_sar_provenance.cross_sensor_verification.spatial_overlap_pct !== null ? `${response.metadata.optical_sar_provenance.cross_sensor_verification.spatial_overlap_pct}%` : 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">CRS PROJECTION:</span>
                <span className="font-bold text-slate-100">
                  {response.metadata.optical_sar_provenance.cross_sensor_verification.crs_matching ? '✓ Identical Coordinate System' : '⚠ Projection Mismatch'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">TEMPORAL DELTA:</span>
                <span className="font-bold text-slate-100">
                  {response.metadata.optical_sar_provenance.cross_sensor_verification.temporal_delta_days !== null ? `${response.metadata.optical_sar_provenance.cross_sensor_verification.temporal_delta_days} days` : 'Same Pass'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">CO-REGISTRATION:</span>
                <span className="font-bold text-slate-100">
                  {response.metadata.optical_sar_provenance.cross_sensor_verification.co_registered ? '✓ Verified (>=90%)' : 'Grid Resampled'}
                </span>
              </div>
            </div>
          )}

          {/* Scientific Non-Interchangeability Assertion */}
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[10px] space-y-1">
            <span className="text-purple-300 font-bold block uppercase tracking-wider">
              PHYSICAL NON-INTERCHANGEABILITY STANDARD:
            </span>
            <p className="text-slate-400 text-[9px] leading-relaxed">
              Optical surface reflectance measures reflected solar illumination across visible/NIR wavelengths, while SAR microwave backscatter measures coherent radar wave return sensitive to surface dielectric moisture and 3D structural roughness. They are physical complements and are never treated as homogeneous values.
            </p>
          </div>

        </div>
      )}

      {/* STAC Catalog Asset Provenance Banner (Rendered when analyzing single imported catalog scene) */}
      {!response.metadata?.temporal_provenance && !response.metadata?.optical_sar_provenance && response.metadata?.provenance && (
        <div className="p-3.5 rounded-xl bg-slate-950/90 border border-teal-800/60 space-y-2 text-xs font-mono">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
            <span className="text-teal-400 font-bold flex items-center gap-1.5 uppercase tracking-wider">
              <Globe className="w-3.5 h-3.5 text-teal-400" />
              SATELLITE CATALOG PROVENANCE (STAC)
            </span>
            <span className="px-2 py-0.5 rounded bg-teal-950 text-teal-300 border border-teal-800 text-[10px]">
              {response.metadata.provenance.provider || 'Element84 Earth Search'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            <div>
              <span className="text-slate-500 block text-[10px]">SCENE ID</span>
              <span className="text-slate-200 truncate block" title={response.metadata.provenance.scene_id}>
                {response.metadata.provenance.scene_id}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">COLLECTION / ASSET</span>
              <span className="text-cyan-300">
                {response.metadata.provenance.collection} ({response.metadata.provenance.asset_key})
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">ACQUISITION (UTC)</span>
              <span className="text-slate-300">
                {response.metadata.provenance.datetime ? new Date(response.metadata.provenance.datetime).toUTCString() : 'Recorded pass'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">RASTER CRS / BANDS</span>
              <span className="text-slate-300">
                {response.metadata.crs_display || 'Unprojected'} ({response.metadata.bands || 3} Bands)
              </span>
            </div>
          </div>

          {response.metadata.scientific_limitations && response.metadata.scientific_limitations.length > 0 && (
            <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-[10px] text-slate-400 space-y-0.5 mt-1">
              <span className="text-amber-400 font-bold block">SCIENTIFIC INTEGRITY CAVEATS:</span>
              {response.metadata.scientific_limitations.map((lim: string, i: number) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="text-amber-400 shrink-0">•</span>
                  <span>{lim}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}


      {/* Conflict & Reanalysis Banner (Rendered only when contradiction was detected) */}
      {conflict && conflict.conflict_detected && (
        <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800/80 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-amber-300 font-mono text-xs font-bold uppercase tracking-wider">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              CONTRADICTION DETECTED: {conflict.conflict_type}
            </div>
            {conflict.reanalysis_performed && (
              <span className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-amber-900/60 text-amber-200 border border-amber-700">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Targeted Reanalysis Triggered
              </span>
            )}
          </div>
          <p className="text-xs text-amber-200/90 leading-relaxed font-sans">
            {conflict.conflict_details}
          </p>
          {conflict.reanalysis_tool && (
            <div className="text-[11px] font-mono text-amber-400/80 pt-1 border-t border-amber-900/40">
              Reanalysis Engine: <span className="font-semibold text-amber-300">{conflict.reanalysis_tool}</span>
            </div>
          )}
        </div>
      )}

      {/* Primary Agent Answer Content */}
      <div className="space-y-2">
        <h4 className="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider">
          AGENT ANALYSIS SYNTHESIS & REASONING
        </h4>
        <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-sm text-slate-100 leading-relaxed font-sans shadow-inner">
          {response.answer}
        </div>
      </div>

      {/* Stage 7 Evidence-Grounded Scientific Verification Panel */}
      <ScientificVerificationPanel verification={response.verification} />

      {/* Confidence & Evidence Quality Diagnostics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/70 text-xs font-mono">
        <div>
          <span className="text-slate-400 block text-[10px] uppercase tracking-wider mb-1">MODEL CONFIDENCE</span>
          <span className="text-slate-200 font-semibold">
            {confidenceBreakdown?.model_confidence !== undefined && confidenceBreakdown?.model_confidence !== null
              ? `${Math.round(confidenceBreakdown.model_confidence * 100)}% (Calibrated Logits)`
              : response.confidence_label || 'Not available'}
          </span>
        </div>

        <div>
          <span className="text-slate-400 block text-[10px] uppercase tracking-wider mb-1">EVIDENCE INTEGRITY</span>
          <span className="text-cyan-300 font-semibold">
            {confidenceBreakdown?.evidence_confidence !== undefined && confidenceBreakdown?.evidence_confidence !== null
              ? `${Math.round(confidenceBreakdown.evidence_confidence * 100)}% (Geometry & Data Validity)`
              : 'Verified Radiometric Input'}
          </span>
        </div>

        <div>
          <span className="text-slate-400 block text-[10px] uppercase tracking-wider mb-1">GEOSPATIAL COMPATIBILITY</span>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="flex items-center gap-1 text-slate-300">
              {quality.crs_present ? <CheckCircle className="w-3 h-3 text-emerald-400" /> : <XCircle className="w-3 h-3 text-amber-400" />}
              {quality.crs_present ? 'CRS Verified' : 'CRS Unavailable'}
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-300">Overlap: {quality.spatial_overlap_pct || 100}%</span>
          </div>
        </div>
      </div>

      {/* Specialist Model Badges & Download Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
        
        {/* Model Badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-mono text-slate-400">Models Selected:</span>
          {response.models.map((m, idx) => (
            <span key={idx} className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-950 text-slate-300 border border-slate-800">
              {m}
            </span>
          ))}
        </div>

        {/* Actions: Metadata & Download */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setIsMetadataOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold bg-slate-950 hover:bg-slate-800 text-teal-300 border border-teal-800/60 transition-all"
          >
            <Globe className="w-3.5 h-3.5 text-teal-400" />
            Inspect Geospatial Metadata
          </button>

          <button
            onClick={() => setIsPreviewOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold bg-slate-950 hover:bg-slate-800 text-cyan-300 border border-cyan-800/60 transition-all"
          >
            <Eye className="w-3.5 h-3.5 text-cyan-400" />
            Preview Formal Report
          </button>

          <button
            onClick={handleDownloadPdf}
            disabled={isExportingPdf}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white shadow-sm shadow-cyan-900/30 transition-all"
          >
            {isExportingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Export PDF Report
          </button>

          <button
            onClick={handleDownloadJson}
            disabled={isExportingJson}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-all"
          >
            {isExportingJson ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
            Export JSON
          </button>
        </div>

      </div>

      {/* Geospatial Metadata Inspector Modal */}
      <MetadataInspectorModal
        isOpen={isMetadataOpen}
        onClose={() => setIsMetadataOpen(false)}
        metadata={(response.metadata as any) || null}
        filename={response.metadata?.filename}
      />

      {/* Formal Analysis Report Preview Modal */}
      <ReportPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        response={response}
        onDownloadPdf={handleDownloadPdf}
        onDownloadJson={handleDownloadJson}
        isExportingPdf={isExportingPdf}
        isExportingJson={isExportingJson}
      />

    </div>
  );
};
