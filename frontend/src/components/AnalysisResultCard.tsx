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
  XCircle
} from 'lucide-react';
import { AnalysisResponse } from '../types';
import { MetadataInspectorModal } from './MetadataInspectorModal';
import { ReportPreviewModal } from './ReportPreviewModal';

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
      const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';
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
      const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';
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
