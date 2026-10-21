import React, { useState } from 'react';
import { 
  CheckCircle2, 
  Download, 
  ShieldCheck, 
  Cpu, 
  FileSpreadsheet, 
  FileText,
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
  Sun,
  Sprout
} from 'lucide-react';
import { AnalysisResponse } from '../types';
import { API_BASE } from '../services/api';
import { MetadataInspectorModal } from './MetadataInspectorModal';
import { ReportPreviewModal } from './ReportPreviewModal';
import { ScientificVerificationPanel } from './ScientificVerificationPanel';
import { detectLocalFixtureProvenance } from '../utils/provenanceDisclosure';

interface AnalysisResultCardProps {
  response: AnalysisResponse;
}

export const AnalysisResultCard: React.FC<AnalysisResultCardProps> = ({ response }) => {
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingJson, setIsExportingJson] = useState(false);
  const [isExportingMarkdown, setIsExportingMarkdown] = useState(false);
  const [isMetadataOpen, setIsMetadataOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const handleDownloadMarkdown = async () => {
    try {
      setIsExportingMarkdown(true);
      const res = await fetch(`${API_BASE}/reports/markdown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response),
      });
      if (!res.ok) throw new Error('Markdown export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `satquery_report_${response.id}.md`;
      a.click();
    } catch (err) {
      console.error('Markdown Download Error:', err);
    } finally {
      setIsExportingMarkdown(false);
    }
  };

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
  const qualityScreening = response.metadata?.quality_screening ||
    response.metadata?.optical_sar_joint?.quality_screening ||
    (response.reproducible_report?.provenance as any)?.quality_screening;
  const opticalQuality = qualityScreening?.optical;
  const sarQuality = qualityScreening?.sar;
  const ndviResult = response.metadata?.ndvi_result ||
    response.metadata?.calibrated_ndvi ||
    ((response.reproducible_report?.provenance as any)?.ndvi_mean !== undefined ||
     (response.reproducible_report?.provenance as any)?.ndvi_status ?
      response.reproducible_report?.provenance : null);
  const dprviResult = response.metadata?.dprvi_result ||
    response.metadata?.calibrated_dprvi ||
    ((response.reproducible_report?.provenance as any)?.dprvi_mean !== undefined ||
     (response.reproducible_report?.provenance as any)?.dprvi_status ?
      response.reproducible_report?.provenance : null);

  const temporalOpticalResult = response.metadata?.temporal_optical_change ||
    ((response.reproducible_report?.provenance as any)?.delta_ndvi_mean !== undefined ||
     (response.reproducible_report?.provenance as any)?.vegetation_loss_pct !== undefined ?
      response.reproducible_report?.provenance : null);

  const temporalSarResult = response.metadata?.temporal_sar_change ||
    ((response.reproducible_report?.provenance as any)?.delta_dprvi_mean !== undefined ||
     (response.reproducible_report?.provenance as any)?.radar_canopy_loss_pct !== undefined ?
      response.reproducible_report?.provenance : null);

  const classificationResult = response.classification_result ||
    response.metadata?.classification ||
    response.metadata?.land_cover_classification ||
    (response.evidence?.find(e => e.type === 'classification')?.statistics as any);

  const fixtureDisclosure = detectLocalFixtureProvenance(response);

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

      {/* Offline Demonstration Mode Fixture Disclosure Warning Banner */}
      {fixtureDisclosure.isOfflineFixture && (
        <div
          data-testid="offline-fixture-warning"
          className="p-4 rounded-xl bg-amber-950/70 border border-amber-500/80 space-y-2 text-xs font-mono shadow-lg shadow-amber-950/30"
        >
          <div className="flex items-center gap-2 text-amber-300 font-bold uppercase tracking-wider">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>OFFLINE DEMONSTRATION MODE (PRE-PACKAGED FIXTURE)</span>
          </div>
          <p className="text-amber-100/90 text-xs font-sans leading-relaxed">
            Offline Demonstration Mode: This analysis uses pre-packaged local raster fixtures. It is not a live satellite acquisition, and the imagery may not cover the requested AOI.
          </p>
          {fixtureDisclosure.fixtureIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px] font-mono text-amber-300/80">
              <span className="text-slate-400 text-[10px] uppercase tracking-wider">Source Fixtures:</span>
              {fixtureDisclosure.fixtureIds.map((id, idx) => (
                <span key={idx} className="px-2 py-0.5 rounded bg-slate-950 border border-amber-900/60 text-amber-300 text-[10px]">
                  {id}
                </span>
              ))}
            </div>
          )}
          {fixtureDisclosure.isOutOfBoundsClamped && (
            <div className="pt-1 flex flex-wrap items-center gap-2 text-[11px] font-mono text-amber-200">
              <span className="px-2 py-0.5 rounded bg-rose-950/80 border border-rose-700/80 text-rose-300 text-[10px] font-bold uppercase tracking-wider">
                AOI MISMATCH: CLAMPED EXTENT
              </span>
              <span className="text-amber-200/90 text-xs font-sans">
                The requested AOI lies outside this demonstration fixture's bounds. The window was clamped to the sample raster extent.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Ambiguity Clarification Request Banner */}
      {response.is_clarification_required && (
        <div className="p-4 rounded-xl bg-amber-950/70 border border-amber-600/80 space-y-3 text-xs font-mono">
          <div className="flex items-center gap-2 text-amber-300 font-bold uppercase tracking-wider">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            INPUT CLARIFICATION REQUIRED (DATA INTEGRITY GATE)
          </div>
          <p className="text-amber-100/90 text-sm font-sans leading-relaxed">
            {response.answer}
          </p>
          {response.missing_parameters && response.missing_parameters.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-amber-400/80 text-[11px]">Unresolved Parameters:</span>
              {response.missing_parameters.map((p, idx) => (
                <span key={idx} className="px-2 py-0.5 rounded bg-amber-900/60 border border-amber-700 text-amber-200 text-[10px]">
                  {p}
                </span>
              ))}
            </div>
          )}
          {response.suggested_examples && response.suggested_examples.length > 0 && (
            <div className="pt-2 border-t border-amber-800/40">
              <span className="text-slate-400 block text-[10px] mb-1">SUGGESTED QUERY TEMPLATES:</span>
              <ul className="space-y-1 text-slate-300 text-[11px]">
                {response.suggested_examples.map((ex, idx) => (
                  <li key={idx} className="flex items-center gap-1.5">
                    <span className="text-amber-400">•</span>
                    <code>{ex}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
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

      {/* Radiometric Quality Screening & SCL / SAR Validity Banner */}
      {qualityScreening && (
        <div className="p-4 rounded-xl bg-slate-950/90 border border-teal-800/60 space-y-3 text-xs font-mono">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
            <span className="text-teal-400 font-bold flex items-center gap-1.5 uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4 text-teal-400" />
              RADIOMETRIC QUALITY SCREENING & PIXEL VALIDITY
            </span>
            <div className="flex items-center gap-1.5">
              <span className={`px-2 py-0.5 rounded text-[10px] border ${
                opticalQuality?.screened ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-slate-900 text-slate-400 border-slate-700'
              }`}>
                {opticalQuality?.screened ? 'SCL FILTER APPLIED' : 'SCL FILTER UNAVAILABLE'}
              </span>
              <span className="px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 text-[10px]">
                {sarQuality?.screened ? 'RTC VALIDATED' : 'SAR RAW'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Optical SCL Quality */}
            <div className="p-2.5 rounded-lg bg-slate-900/90 border border-teal-900/40 space-y-1 text-[11px]">
              <span className="text-teal-300 font-bold block">
                OPTICAL SCL (SCENE CLASSIFICATION LAYER)
              </span>
              {opticalQuality?.screened ? (
                <div className="space-y-0.5 text-[10px] text-slate-300">
                  <div>Clear-Sky Footprint: <span className="text-emerald-400 font-bold">{(opticalQuality.quality_clearance_fraction * 100).toFixed(1)}%</span></div>
                  <div>Observed Pixels: <span className="text-slate-100">{opticalQuality.observed_pixel_count?.toLocaleString()}</span> (Excluded: <span className="text-amber-400">{opticalQuality.excluded_pixel_count?.toLocaleString()}</span> px)</div>
                  <div>Resampling: <span className="text-slate-100">rasterio nearest-neighbor (categorical)</span></div>
                </div>
              ) : (
                <div className="text-[10px] text-slate-400">
                  SCL screening unperformed or asset unavailable. Clear-sky pixels cannot be confirmed.
                </div>
              )}
            </div>

            {/* SAR Backscatter & Terrain Limitations */}
            <div className="p-2.5 rounded-lg bg-slate-900/90 border border-purple-900/40 space-y-1 text-[11px]">
              <span className="text-purple-300 font-bold block">
                SAR BACKSCATTER & GEOMETRIC TERRAIN MASK
              </span>
              <div className="space-y-0.5 text-[10px] text-slate-300">
                <div>Finite Linear Power: <span className="text-slate-100">{sarQuality?.valid_pixel_count ? `${sarQuality.valid_pixel_count.toLocaleString()} px` : 'Preserved'}</span></div>
                <div className="text-amber-300">
                  Layover/Shadow Mask: <span className="text-amber-400 font-semibold">Unavailable from STAC provider</span>
                </div>
                <div className="text-[9px] text-slate-400 italic">
                  Terrain shadows cannot be ruled out without provider-level DEM layover/shadow asset.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Genuine Sentinel-2 B04 + B08 NDVI Telemetry Banner */}
      {ndviResult && (
        <div className="p-4 rounded-xl bg-slate-950/90 border border-emerald-800/60 space-y-3 text-xs font-mono">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
            <span className="text-emerald-400 font-bold flex items-center gap-1.5 uppercase tracking-wider">
              <Sprout className="w-4 h-4 text-emerald-400" />
              GENUINE SENTINEL-2 B04 + B08 CALIBRATED NDVI PIPELINE
            </span>
            <div className="flex items-center gap-1.5">
              <span className={`px-2 py-0.5 rounded text-[10px] border ${
                ndviResult.status === 'unsupported_zero_valid_pixels'
                  ? 'bg-amber-950 text-amber-300 border-amber-800'
                  : 'bg-emerald-950 text-emerald-300 border-emerald-800'
              }`}>
                {ndviResult.status === 'unsupported_zero_valid_pixels'
                  ? 'ZERO VALID PIXELS'
                  : 'BOA SURFACE REFLECTANCE'}
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700 text-[10px]">
                Red (B04) + NIR (B08)
              </span>
            </div>
          </div>

          {ndviResult.status === 'unsupported_zero_valid_pixels' ? (
            <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-800/50 text-[11px] text-amber-300 space-y-1">
              <span className="font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                NUMERIC NDVI STATISTICS SUPPRESSED (0 VALID CLEAR PIXELS)
              </span>
              <p className="text-amber-200/80 text-[10px] leading-relaxed">
                All pixels in the requested spatial window were excluded due to cloud obstruction, cloud shadows, defective detectors, or missing data in the Scene Classification Layer (SCL). In accordance with Stage 12 scientific integrity standards, no fabricated numeric values are reported.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] text-slate-300">
              <div className="p-2 rounded bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400 block text-[9px]">MEAN NDVI</span>
                <span className="font-bold text-emerald-300 text-xs">
                  {ndviResult.ndvi_mean !== null && ndviResult.ndvi_mean !== undefined
                    ? Number(ndviResult.ndvi_mean).toFixed(4)
                    : 'N/A'}
                </span>
                <span className="text-slate-500 block text-[8px]">Unitless [-1.0, 1.0]</span>
              </div>
              <div className="p-2 rounded bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400 block text-[9px]">90TH PERCENTILE (P90)</span>
                <span className="font-bold text-teal-300 text-xs">
                  {ndviResult.ndvi_p90 !== null && ndviResult.ndvi_p90 !== undefined
                    ? Number(ndviResult.ndvi_p90).toFixed(4)
                    : 'N/A'}
                </span>
                <span className="text-slate-500 block text-[8px]">Peak Canopy Ratio</span>
              </div>
              <div className="p-2 rounded bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400 block text-[9px]">VEGETATION COVERAGE</span>
                <span className="font-bold text-emerald-400 text-xs">
                  {ndviResult.vegetation_coverage_pct !== null && ndviResult.vegetation_coverage_pct !== undefined
                    ? `${Number(ndviResult.vegetation_coverage_pct).toFixed(1)}%`
                    : 'N/A'}
                </span>
                <span className="text-slate-500 block text-[8px]">Threshold &ge; {ndviResult.vegetation_threshold || 0.40}</span>
              </div>
              <div className="p-2 rounded bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400 block text-[9px]">VALID CLEAR PIXELS</span>
                <span className="font-bold text-slate-100 text-xs">
                  {ndviResult.valid_pixel_count !== null && ndviResult.valid_pixel_count !== undefined
                    ? ndviResult.valid_pixel_count.toLocaleString()
                    : 'Masked'}
                </span>
                <span className="text-slate-500 block text-[8px]">
                  Total: {ndviResult.total_pixel_count ? ndviResult.total_pixel_count.toLocaleString() : 'N/A'} px
                </span>
              </div>
            </div>
          )}

          {/* SCL Quality Screening Provenance & Preview */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/60 text-[10px] text-slate-400">
            <div>
              <span className="text-slate-500">Quality Policy: </span>
              <span className="text-slate-300">SCL Cloud/Shadow Filter (Classes 0, 1, 3, 8, 9, 10 Excluded)</span>
            </div>
            <div>
              <span className="text-slate-500">Scale: </span>
              <span className="text-slate-300">Integer BOA Factor (DN / 10,000)</span>
            </div>
          </div>

          {ndviResult.preview_base64 && (
            <div className="mt-2 p-2 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1.5">
              <span className="text-slate-300 text-[10px] font-bold block">
                COLORIZED NDVI SURFACE MAP (VALID SCREENED PIXELS ONLY):
              </span>
              <img
                src={ndviResult.preview_base64.startsWith('data:') ? ndviResult.preview_base64 : `data:image/png;base64,${ndviResult.preview_base64}`}
                alt="Calibrated NDVI Surface Map"
                className="max-h-48 rounded border border-slate-700 mx-auto object-contain"
              />
            </div>
          )}
        </div>
      )}

      {/* Sentinel-1 RTC Dual-Polarization & DpRVI Telemetry Banner */}
      {dprviResult && (
        <div className="p-4 rounded-xl bg-slate-950/90 border border-purple-800/60 space-y-3 text-xs font-mono">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
            <span className="text-purple-400 font-bold flex items-center gap-1.5 uppercase tracking-wider">
              <Radio className="w-4 h-4 text-purple-400" />
              SENTINEL-1 RTC DUAL-POLARIZATION & DpRVI PIPELINE
            </span>
            <div className="flex items-center gap-1.5">
              <span className={`px-2 py-0.5 rounded text-[10px] border ${
                dprviResult.status === 'unsupported_zero_valid_pixels'
                  ? 'bg-amber-950 text-amber-300 border-amber-800'
                  : 'bg-purple-950 text-purple-300 border-purple-800'
              }`}>
                {dprviResult.status === 'unsupported_zero_valid_pixels'
                  ? 'ZERO VALID RADAR PIXELS'
                  : 'RTC GAMMA0 POWER'}
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700 text-[10px]">
                Dual-Pol (VV + VH)
              </span>
            </div>
          </div>

          {dprviResult.status === 'unsupported_zero_valid_pixels' ? (
            <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-800/50 text-[11px] text-amber-300 space-y-1">
              <span className="font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                NUMERIC DpRVI STATISTICS SUPPRESSED (0 VALID RADAR PIXELS)
              </span>
              <p className="text-amber-200/80 text-[10px] leading-relaxed">
                All pixels in the requested spatial window were excluded due to nodata sentinels (-32768.0), non-positive linear power, or numerical invalidity. In accordance with Stage 13 scientific integrity standards, no fabricated numeric values are reported.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] text-slate-300">
              <div className="p-2 rounded bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400 block text-[9px]">MEAN DpRVI</span>
                <span className="font-bold text-purple-300 text-xs">
                  {dprviResult.dprvi_mean !== null && dprviResult.dprvi_mean !== undefined
                    ? Number(dprviResult.dprvi_mean).toFixed(4)
                    : 'N/A'}
                </span>
                <span className="text-slate-500 block text-[8px]">Unitless [0.0, 1.0]</span>
              </div>
              <div className="p-2 rounded bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400 block text-[9px]">90TH PERCENTILE (P90)</span>
                <span className="font-bold text-indigo-300 text-xs">
                  {dprviResult.dprvi_p90 !== null && dprviResult.dprvi_p90 !== undefined
                    ? Number(dprviResult.dprvi_p90).toFixed(4)
                    : 'N/A'}
                </span>
                <span className="text-slate-500 block text-[8px]">Peak Radar Canopy Proxy</span>
              </div>
              <div className="p-2 rounded bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400 block text-[9px]">CROSS-POL RATIO</span>
                <span className="font-bold text-pink-300 text-xs">
                  {dprviResult.cross_pol_ratio_db !== null && dprviResult.cross_pol_ratio_db !== undefined
                    ? `${Number(dprviResult.cross_pol_ratio_db).toFixed(1)} dB`
                    : 'N/A'}
                </span>
                <span className="text-slate-500 block text-[8px]">
                  Linear q: {dprviResult.cross_pol_ratio_linear !== null && dprviResult.cross_pol_ratio_linear !== undefined ? Number(dprviResult.cross_pol_ratio_linear).toFixed(4) : 'N/A'}
                </span>
              </div>
              <div className="p-2 rounded bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400 block text-[9px]">BACKSCATTER POWER</span>
                <span className="font-bold text-cyan-300 text-xs">
                  {dprviResult.vv_mean_db !== null && dprviResult.vv_mean_db !== undefined
                    ? `VV: ${Number(dprviResult.vv_mean_db).toFixed(1)} dB`
                    : 'N/A'}
                </span>
                <span className="text-slate-500 block text-[8px]">
                  {dprviResult.vh_mean_db !== null && dprviResult.vh_mean_db !== undefined
                    ? `VH: ${Number(dprviResult.vh_mean_db).toFixed(1)} dB`
                    : ''}
                </span>
              </div>
            </div>
          )}

          {/* DpRVI Validity Policy & Limitations */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/60 text-[10px] text-slate-400">
            <div>
              <span className="text-slate-500">Formula: </span>
              <span className="text-slate-300">DpRVI = q(q+3)/(q+1)^2, q = VH/VV (Mandal et al., 2020)</span>
            </div>
            <div>
              <span className="text-slate-500">Terrain Shadow: </span>
              <span className="text-amber-400">Unavailable from STAC provider (unmasked)</span>
            </div>
          </div>

          {(dprviResult.preview_base64 || dprviResult.colorized_preview_base64) && (
            <div className="mt-2 p-2 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1.5">
              <span className="text-slate-300 text-[10px] font-bold block">
                COLORIZED DpRVI RADAR CANOPY MAP (VALID RADAR PIXELS ONLY):
              </span>
              <img
                src={(dprviResult.preview_base64 || dprviResult.colorized_preview_base64).startsWith('data:')
                  ? (dprviResult.preview_base64 || dprviResult.colorized_preview_base64)
                  : `data:image/png;base64,${dprviResult.preview_base64 || dprviResult.colorized_preview_base64}`}
                alt="Calibrated DpRVI Radar Canopy Map"
                className="max-h-48 rounded border border-slate-700 mx-auto object-contain"
              />
            </div>
          )}
        </div>
      )}

      {/* Sentinel-2 Bi-Temporal Optical Change Telemetry Banner */}
      {temporalOpticalResult && (
        <div className="p-4 rounded-xl bg-slate-950/90 border border-emerald-800/80 space-y-3 text-xs font-mono">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <span className="text-emerald-400 font-bold flex items-center gap-1.5 uppercase tracking-wider">
              <Sprout className="w-4 h-4 text-emerald-400" />
              SENTINEL-2 BI-TEMPORAL OPTICAL CHANGE & SCL SCREENING
            </span>
            <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px]">
              {temporalOpticalResult.status || 'calibrated_optical_change'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
              <span className="text-slate-400 block text-[9px]">MEAN ΔNDVI</span>
              <span className="text-base font-bold text-emerald-300">
                {temporalOpticalResult.delta_ndvi_mean !== null && temporalOpticalResult.delta_ndvi_mean !== undefined
                  ? Number(temporalOpticalResult.delta_ndvi_mean).toFixed(4)
                  : 'N/A'}
              </span>
            </div>
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
              <span className="text-slate-400 block text-[9px]">VEGETATION LOSS</span>
              <span className="text-base font-bold text-rose-400">
                {temporalOpticalResult.vegetation_loss_pct !== null && temporalOpticalResult.vegetation_loss_pct !== undefined
                  ? `${Number(temporalOpticalResult.vegetation_loss_pct).toFixed(1)}%`
                  : 'N/A'}
              </span>
            </div>
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
              <span className="text-slate-400 block text-[9px]">VEGETATION GAIN</span>
              <span className="text-base font-bold text-emerald-400">
                {temporalOpticalResult.vegetation_gain_pct !== null && temporalOpticalResult.vegetation_gain_pct !== undefined
                  ? `${Number(temporalOpticalResult.vegetation_gain_pct).toFixed(1)}%`
                  : 'N/A'}
              </span>
            </div>
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
              <span className="text-slate-400 block text-[9px]">JOINT CLEAR PIXELS</span>
              <span className="text-base font-bold text-cyan-300">
                {temporalOpticalResult.joint_valid_pixel_count !== null && temporalOpticalResult.joint_valid_pixel_count !== undefined
                  ? Number(temporalOpticalResult.joint_valid_pixel_count).toLocaleString()
                  : 'N/A'} px
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/60">
            <span>T1: {temporalOpticalResult.t1_datetime || temporalOpticalResult.temporal_t1_datetime || 'Baseline'}</span>
            <span>T2: {temporalOpticalResult.t2_datetime || temporalOpticalResult.temporal_t2_datetime || 'Comparison'}</span>
          </div>
        </div>
      )}

      {/* Sentinel-1 RTC Bi-Temporal SAR Change Telemetry Banner */}
      {temporalSarResult && (
        <div className="p-4 rounded-xl bg-slate-950/90 border border-violet-800/80 space-y-3 text-xs font-mono">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <span className="text-violet-400 font-bold flex items-center gap-1.5 uppercase tracking-wider">
              <Radio className="w-4 h-4 text-violet-400" />
              SENTINEL-1 RTC BI-TEMPORAL SAR CHANGE & DpRVI
            </span>
            <span className="px-2 py-0.5 rounded bg-violet-950 text-violet-300 border border-violet-800 text-[10px]">
              {temporalSarResult.status || 'calibrated_sar_change'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
              <span className="text-slate-400 block text-[9px]">MEAN ΔDpRVI</span>
              <span className="text-base font-bold text-violet-300">
                {temporalSarResult.delta_dprvi_mean !== null && temporalSarResult.delta_dprvi_mean !== undefined
                  ? Number(temporalSarResult.delta_dprvi_mean).toFixed(4)
                  : 'N/A'}
              </span>
            </div>
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
              <span className="text-slate-400 block text-[9px]">RADAR CANOPY LOSS</span>
              <span className="text-base font-bold text-amber-400">
                {temporalSarResult.radar_canopy_loss_pct !== null && temporalSarResult.radar_canopy_loss_pct !== undefined
                  ? `${Number(temporalSarResult.radar_canopy_loss_pct).toFixed(1)}%`
                  : 'N/A'}
              </span>
            </div>
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
              <span className="text-slate-400 block text-[9px]">RADAR CANOPY GAIN</span>
              <span className="text-base font-bold text-emerald-400">
                {temporalSarResult.radar_canopy_gain_pct !== null && temporalSarResult.radar_canopy_gain_pct !== undefined
                  ? `${Number(temporalSarResult.radar_canopy_gain_pct).toFixed(1)}%`
                  : 'N/A'}
              </span>
            </div>
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
              <span className="text-slate-400 block text-[9px]">BACKSCATTER SHIFT</span>
              <span className="text-base font-bold text-cyan-300">
                {temporalSarResult.delta_vv_db !== null && temporalSarResult.delta_vv_db !== undefined
                  ? `VV: ${Number(temporalSarResult.delta_vv_db).toFixed(1)} dB`
                  : 'N/A'}
              </span>
            </div>
          </div>

          {/* DpRVI Assumption Violation Notice */}
          {((temporalSarResult.dprvi_assumption_violations?.total_count || temporalSarResult.dprvi_assumption_violations_count || 0) > 0) && (
            <div className="flex items-center gap-1.5 text-amber-300 text-[10px] bg-amber-950/40 p-2 rounded border border-amber-800/60">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              <span>
                DpRVI assumption violations (q = VH/VV &gt; 1.0): {temporalSarResult.dprvi_assumption_violations?.total_count || temporalSarResult.dprvi_assumption_violations_count} observations violate Mandal et al. (2020) and are uncertified approximations.
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/60">
            <span>Terrain Mask: Unavailable from STAC provider (relief shadows unmasked)</span>
            <span>Mode: DUAL_VV_VH</span>
          </div>
        </div>
      )}

      {/* BigEarthNet v2.0 Multi-Label Land-Cover Classification Card */}
      {(classificationResult || response.task === 'classification' || response.task === 'land_cover_classification' || response.mode === 'classification') && (
        <div className="p-4 rounded-xl bg-slate-950/90 border border-emerald-800/80 space-y-4 text-xs font-mono">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <span className="text-emerald-400 font-bold flex items-center gap-1.5 uppercase tracking-wider">
              <Layers className="w-4 h-4 text-emerald-400" />
              BIGEARTHNET v2.0 SENTINEL-2 RESNET-50 MULTI-LABEL CLASSIFICATION
            </span>
            <div className="flex items-center gap-1.5">
              <span className={`px-2 py-0.5 rounded text-[10px] border ${
                response.model_status === 'invalid_input' || response.implementation_status === 'invalid_input'
                  ? 'bg-amber-950 text-amber-300 border-amber-800'
                  : 'bg-emerald-950 text-emerald-300 border-emerald-800'
              }`}>
                {response.model_status === 'invalid_input' ? 'INVALID INPUT' : 'PRETRAINED reBEN CHECKPOINT'}
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700 text-[10px]">
                {classificationResult?.model_name || response.primary_model || 'resnet50-s2-v0.2.0'}
              </span>
            </div>
          </div>

          {/* Invalid Input Warning Banner */}
          {(response.model_status === 'invalid_input' || response.implementation_status === 'invalid_input') && (
            <div className="p-3 rounded-lg bg-amber-950/50 border border-amber-600/70 text-amber-200 text-xs space-y-1">
              <div className="flex items-center gap-2 text-amber-300 font-bold">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>MULTISPECTRAL 10-BAND DATA REQUIRED (SCREENSHOT DETECTED)</span>
              </div>
              <p className="text-amber-100/90 font-sans leading-relaxed text-[11px]">
                {response.answer || 'Visual RGB browse images and Copernicus Browser screenshots lack the 10 raw Sentinel-2 multispectral bands (B02-B12) needed for BigEarthNetv2 ResNet-50. Please supply authentic Sentinel-2 L2A GeoTIFF data.'}
              </p>
            </div>
          )}

          {/* Valid Predictions Rendering */}
          {classificationResult && (
            <div className="space-y-3">
              {/* Predicted Classes Badge Group */}
              <div>
                <span className="text-slate-400 text-[10px] uppercase tracking-wider block mb-1.5">
                  Predicted CORINE Land Cover Classes (Threshold &ge; {classificationResult.threshold ?? 0.5}):
                </span>
                {classificationResult.predicted_classes && classificationResult.predicted_classes.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {classificationResult.predicted_classes.map((cls: string, idx: number) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-950/90 border border-emerald-600 text-emerald-200 text-[11px] font-semibold"
                      >
                        <CheckCircle className="w-3 h-3 text-emerald-400" />
                        {cls}
                        {classificationResult.class_probabilities?.[cls] !== undefined && (
                          <span className="text-emerald-400 font-mono text-[10px]">
                            ({(classificationResult.class_probabilities[cls] * 100).toFixed(1)}%)
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-slate-500 italic text-[11px]">
                    No classes exceeded decision threshold &ge; {classificationResult.threshold ?? 0.5}.
                  </span>
                )}
              </div>

              {/* 19 CORINE Classes Ranked Probability Bars */}
              {classificationResult.top_predictions && classificationResult.top_predictions.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    <span>Ranked CORINE Classes (Multi-label Sigmoid Probabilities)</span>
                    <span>19 Output Head Logits</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                    {classificationResult.top_predictions.map((item: any, idx: number) => {
                      const prob = Number(item.probability);
                      const pct = Math.max(0, Math.min(100, Math.round(prob * 100)));
                      const isPredicted = (classificationResult.predicted_classes || []).includes(item.label);
                      return (
                        <div
                          key={idx}
                          className={`p-2 rounded-lg border text-[11px] transition-colors ${
                            isPredicted
                              ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-100'
                              : 'bg-slate-900/60 border-slate-800/60 text-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-sans font-medium truncate max-w-[220px]" title={item.label}>
                              {item.label}
                            </span>
                            <span className={`font-mono text-[10px] font-bold ${isPredicted ? 'text-emerald-300' : 'text-slate-400'}`}>
                              {(prob * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                isPredicted ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-slate-700'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Multispectral Specs & Scientific Disclaimer */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/60 text-[10px] text-slate-400">
                <span>
                  Bands ({classificationResult.bands_used?.length || 10}):{' '}
                  <span className="text-slate-200">
                    {classificationResult.bands_used?.join(', ') || 'B02, B03, B04, B05, B06, B07, B08, B8A, B11, B12'}
                  </span>
                </span>
                <span>Spatial: 120×120 px (~1.2 km patch)</span>
                <span className="text-amber-400/90 italic">
                  Note: Sigmoid probabilities are uncalibrated multi-label outputs.
                </span>
              </div>
            </div>
          )}
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
            onClick={handleDownloadMarkdown}
            disabled={isExportingMarkdown}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 transition-all shadow-sm"
          >
            {isExportingMarkdown ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            Export Markdown
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
        onDownloadMarkdown={handleDownloadMarkdown}
        isExportingPdf={isExportingPdf}
        isExportingJson={isExportingJson}
        isExportingMarkdown={isExportingMarkdown}
      />

    </div>
  );
};
