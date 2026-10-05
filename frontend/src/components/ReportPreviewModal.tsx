import React from 'react';
import { X, Download, FileSpreadsheet, ShieldCheck, Cpu, Terminal, Clock, CheckCircle2, Globe, Layers } from 'lucide-react';
import { AnalysisResponse } from '../types';

interface ReportPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  response: AnalysisResponse;
  onDownloadPdf: () => void;
  onDownloadJson: () => void;
  isExportingPdf: boolean;
  isExportingJson: boolean;
}

export const ReportPreviewModal: React.FC<ReportPreviewModalProps> = ({
  isOpen,
  onClose,
  response,
  onDownloadPdf,
  onDownloadJson,
  isExportingPdf,
  isExportingJson,
}) => {
  if (!isOpen) return null;

  const meta = response.metadata || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md overflow-y-auto">
      <div className="glass-panel w-full max-w-4xl max-h-[90vh] rounded-2xl border border-cyan-500/40 bg-slate-900/95 shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Top Header */}
        <div className="px-6 py-4 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-950 text-cyan-400 border border-cyan-800">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold font-mono text-slate-100 uppercase tracking-wider">
                  SATQUERY AI ANALYSIS REPORT PREVIEW
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800">
                  ISRO PS 26167
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">
                Report ID: {response.id} | Generated: {response.created_at.slice(0, 19)}Z
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onDownloadPdf}
              disabled={isExportingPdf}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white shadow-md shadow-cyan-900/30 transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              Download PDF
            </button>

            <button
              onClick={onDownloadJson}
              disabled={isExportingJson}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-all"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Download JSON
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-100 border border-slate-800 ml-2"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-6 font-sans text-xs">
          
          {/* Metadata Matrix Card */}
          <div className="bg-slate-950/80 rounded-xl p-4 border border-slate-800 font-mono grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <span className="text-[10px] text-slate-500 block uppercase">CLASSIFIED TASK</span>
              <span className="text-cyan-300 font-bold">{response.task.toUpperCase()}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block uppercase">OPERATIONAL MODE</span>
              <span className="text-slate-200 font-bold">{response.mode.toUpperCase()}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block uppercase">CRS PROJECTION</span>
              <span className="text-teal-300 font-bold">{meta.crs || 'CRS unavailable'}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block uppercase">CONFIDENCE CALIBRATION</span>
              <span className="text-cyan-400 font-bold">{response.confidence_label}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block uppercase">EXECUTION TIME</span>
              <span className="text-emerald-400 font-bold">{response.execution_time_ms} ms</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block uppercase">SPECIALIST MODELS</span>
              <span className="text-slate-300 font-bold">{response.models.join(', ')}</span>
            </div>
          </div>

          {/* Section 1: Executive Scientific Answer */}
          <div className="space-y-2">
            <h4 className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              1. AGENT SYNTHESIS & SCIENTIFIC FINDINGS
            </h4>
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm leading-relaxed shadow-inner">
              {response.answer}
            </div>
          </div>

          {/* Section 2: Visual Evidence Artifacts Gallery */}
          {response.evidence && response.evidence.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" />
                2. GENERATED VISUAL EVIDENCE ARTIFACTS ({response.evidence.length})
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {response.evidence.map((ev) => (
                  <div key={ev.id} className="bg-slate-950 rounded-xl p-3 border border-slate-800 space-y-2 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1">
                        <span className="uppercase font-bold text-cyan-300">{ev.title}</span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800">{ev.type}</span>
                      </div>
                      {ev.description && <p className="text-[11px] text-slate-400 mb-2">{ev.description}</p>}
                    </div>

                    {ev.data_base64 && (
                      <div className="rounded-lg overflow-hidden border border-slate-800/80 bg-slate-900 flex items-center justify-center p-1 max-h-[160px]">
                        <img
                          src={ev.data_base64}
                          alt={ev.title}
                          className="max-h-[150px] object-contain rounded"
                        />
                      </div>
                    )}

                    {ev.statistics && Object.keys(ev.statistics).length > 0 && (
                      <div className="pt-2 border-t border-slate-900 text-[10px] font-mono space-y-0.5">
                        {Object.entries(ev.statistics).map(([k, v]) => (
                          <div key={k} className="flex justify-between text-slate-400">
                            <span>{k.replace(/_/g, ' ')}:</span>
                            <span className="text-slate-200 font-bold">{String(v)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 3: Observable Execution Trace Log */}
          {response.trace?.steps && (
            <div className="space-y-2">
              <h4 className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5" />
                3. AGENT EXECUTION TRACE CHRONOLOGY
              </h4>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono text-[11px] space-y-1.5">
                {response.trace.steps.map((st, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-slate-300">
                    <span className="text-teal-400">✓</span>
                    <span className="font-bold text-cyan-300">[{st.step}]</span>
                    <span className="text-slate-400 flex-1">{st.detail}</span>
                    <span className="text-[10px] text-slate-600">{st.timestamp.slice(11, 19)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between text-xs font-mono text-slate-500 shrink-0">
          <span>ISRO Problem Statement 26167 Verified Architecture</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
          >
            Close Preview
          </button>
        </div>

      </div>
    </div>
  );
};
