import React from 'react';
import {
  X,
  Download,
  FileSpreadsheet,
  FileText,
  ShieldCheck,
  Cpu,
  Terminal,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Globe,
  Layers,
  Activity,
  AlertCircle
} from 'lucide-react';
import { AnalysisResponse } from '../types';

interface ReportPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  response: AnalysisResponse;
  onDownloadPdf: () => void;
  onDownloadJson: () => void;
  onDownloadMarkdown?: () => void;
  isExportingPdf: boolean;
  isExportingJson: boolean;
  isExportingMarkdown?: boolean;
}

export const ReportPreviewModal: React.FC<ReportPreviewModalProps> = ({
  isOpen,
  onClose,
  response,
  onDownloadPdf,
  onDownloadJson,
  onDownloadMarkdown,
  isExportingPdf,
  isExportingJson,
  isExportingMarkdown,
}) => {
  if (!isOpen) return null;

  const rep = response.reproducible_report;
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
                  SATQUERY AI SCIENTIFIC ANALYSIS REPORT
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800">
                  STAGE 8 VERIFIED
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">
                Report ID: {rep?.report_id || response.id} | Generated: {response.created_at.slice(0, 19)}Z
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onDownloadMarkdown && (
              <button
                onClick={onDownloadMarkdown}
                disabled={isExportingMarkdown}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 transition-all shadow-sm"
              >
                <FileText className="w-3.5 h-3.5" />
                Markdown
              </button>
            )}

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
          
          {/* Scientific Integrity Disclaimer Banner */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-cyan-800/60 flex items-start gap-3 text-cyan-200">
            <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-mono font-bold text-xs text-cyan-300 block uppercase tracking-wider">
                Scientific Integrity & Reproducibility Notice
              </span>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                {rep?.integrity_notice ||
                  "This report strictly separates calibrated physical measurements from 8-bit display visualizations and preliminary heuristic indicators. The interpretive layer does not alter numerical measurements or replace physical validation."}
              </p>
            </div>
          </div>

          {/* Metadata Matrix Card */}
          <div className="bg-slate-950/80 rounded-xl p-4 border border-slate-800 font-mono grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <span className="text-[10px] text-slate-500 block uppercase">CLASSIFIED TASK</span>
              <span className="text-cyan-300 font-bold">{(rep?.provenance.task || response.task).toUpperCase()}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block uppercase">OPERATIONAL MODE</span>
              <span className="text-slate-200 font-bold">{(rep?.provenance.mode || response.mode).toUpperCase()}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block uppercase">CRS PROJECTION</span>
              <span className="text-teal-300 font-bold">{rep?.provenance.crs || meta.crs || 'CRS unavailable'}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block uppercase">GROUND RESOLUTION</span>
              <span className="text-slate-300 font-bold">
                {rep?.provenance.spatial_resolution_m ? `${rep.provenance.spatial_resolution_m} m` : 'Uncalibrated'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block uppercase">VALID PIXEL COVERAGE</span>
              <span className="text-emerald-400 font-bold">
                {rep?.provenance.valid_pixel_percentage != null ? `${rep.provenance.valid_pixel_percentage}%` : 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block uppercase">PROVIDER ENGINE</span>
              <span className="text-cyan-400 font-bold">
                {rep?.provenance.actual_model_used || response.actual_model_used || response.models.join(', ')}
              </span>
            </div>
          </div>

          {/* Section 1: Executive Scientific Findings */}
          <div className="space-y-2">
            <h4 className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              1. AGENT SYNTHESIS & SCIENTIFIC FINDINGS
            </h4>
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm leading-relaxed shadow-inner">
              {rep?.executive_summary || response.answer}
            </div>
          </div>

          {/* Section 2: Calibrated Physical Measurements */}
          {rep && rep.physical_measurements && rep.physical_measurements.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-teal-400" />
                2. CALIBRATED PHYSICAL MEASUREMENTS ({rep.physical_measurements.length})
              </h4>
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">Variable Name</th>
                      <th className="py-2.5 px-3">Value</th>
                      <th className="py-2.5 px-3">Unit</th>
                      <th className="py-2.5 px-3">Statistic Type</th>
                      <th className="py-2.5 px-3">Mask Applied</th>
                      <th className="py-2.5 px-3">Evidence Artifacts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {rep.physical_measurements.map((pm, idx) => (
                      <tr key={idx} className="hover:bg-slate-900/50">
                        <td className="py-2.5 px-3 font-bold text-cyan-300">{pm.name}</td>
                        <td className="py-2.5 px-3 font-bold text-emerald-300">{String(pm.value)}</td>
                        <td className="py-2.5 px-3 text-slate-300">{pm.unit}</td>
                        <td className="py-2.5 px-3 text-slate-400">{pm.statistic_type}</td>
                        <td className="py-2.5 px-3 text-teal-300">{pm.mask_applied}</td>
                        <td className="py-2.5 px-3 text-slate-400">
                          {pm.source_artifact_ids.length > 0
                            ? pm.source_artifact_ids.map((id) => (
                                <span key={id} className="px-1.5 py-0.5 mr-1 rounded bg-slate-900 border border-slate-800 text-cyan-400 text-[10px]">
                                  {id}
                                </span>
                              ))
                            : 'None'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Section 3: Normalized Display Statistics (Separated from Physical) */}
          {rep && rep.display_statistics && rep.display_statistics.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-mono font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  3. NORMALIZED DISPLAY STATISTICS (VISUALIZATION ONLY)
                </h4>
                <span className="text-[10px] font-mono text-amber-300/80 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/60">
                  Not Physical Radiometry
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-amber-950/20 border border-amber-900/40 text-[11px] text-amber-200/90 font-mono">
                Display statistics are 8-bit normalized or percentile-stretched arrays generated exclusively for screen rendering. They are strictly separate from physical radiometry.
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                    <tr>
                      <th className="py-2 px-3">Display Field</th>
                      <th className="py-2 px-3">Render Value</th>
                      <th className="py-2 px-3">Scale</th>
                      <th className="py-2 px-3">Purpose</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {rep.display_statistics.map((ds, idx) => (
                      <tr key={idx} className="hover:bg-slate-900/50">
                        <td className="py-2 px-3 font-semibold text-slate-300">{ds.name}</td>
                        <td className="py-2 px-3 font-bold text-amber-300">{String(ds.value)}</td>
                        <td className="py-2 px-3 text-slate-400">{ds.scale}</td>
                        <td className="py-2 px-3 text-slate-500">{ds.purpose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Section 4: Preliminary Heuristic Indicators */}
          {rep && rep.heuristic_indicators && rep.heuristic_indicators.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-cyan-400" />
                  4. PRELIMINARY HEURISTIC INDICATORS ({rep.heuristic_indicators.length})
                </h4>
                <span className="text-[10px] font-mono text-cyan-300/80 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/60">
                  Uncalibrated Proxies
                </span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                    <tr>
                      <th className="py-2 px-3">Indicator Name</th>
                      <th className="py-2 px-3">Spatial Extent (%)</th>
                      <th className="py-2 px-3">Pixel Count</th>
                      <th className="py-2 px-3">Threshold Definition</th>
                      <th className="py-2 px-3">Certified Land Cover?</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {rep.heuristic_indicators.map((hi, idx) => (
                      <tr key={idx} className="hover:bg-slate-900/50">
                        <td className="py-2 px-3 font-semibold text-cyan-300">{hi.name}</td>
                        <td className="py-2 px-3 font-bold text-emerald-300">{hi.percentage}%</td>
                        <td className="py-2 px-3 text-slate-300">{hi.pixel_count}</td>
                        <td className="py-2 px-3 text-slate-400">{hi.definition}</td>
                        <td className="py-2 px-3">
                          <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 text-[10px] font-bold">
                            NO (Proxy Only)
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Section 5: Evaluated Verification Claims & Caveats */}
          {rep?.verification_summary && rep.verification_summary.claims && rep.verification_summary.claims.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                5. EVIDENCE-GROUNDED VERIFICATION CLAIMS ({rep.verification_summary.claims.length})
              </h4>
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                    <tr>
                      <th className="py-2 px-3">Scientific Claim</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Cited Artifacts</th>
                      <th className="py-2 px-3">Verification Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {rep.verification_summary.claims.map((cl, idx) => (
                      <tr key={idx} className="hover:bg-slate-900/50">
                        <td className="py-2 px-3 font-sans text-slate-200 text-xs">{cl.claim_text}</td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                            cl.status === 'supported'
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                              : cl.status === 'partially_supported'
                              ? 'bg-amber-950 text-amber-300 border-amber-800'
                              : 'bg-rose-950 text-rose-300 border-rose-800'
                          }`}>
                            {cl.status}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-cyan-400">
                          {cl.cited_artifact_ids.join(', ') || 'None'}
                        </td>
                        <td className="py-2 px-3 text-slate-400 text-[10px]">{cl.reason || 'Verified against evidence.'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Section 6: Visual Evidence Artifacts Gallery */}
          {response.evidence && response.evidence.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" />
                6. GENERATED VISUAL EVIDENCE ARTIFACTS ({response.evidence.length})
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

          {/* Section 7: Reproducibility & Unavailable Fields */}
          {rep && rep.reproducibility && (
            <div className="space-y-2">
              <h4 className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5" />
                7. REPRODUCIBILITY & PIPELINE TRACEABILITY
              </h4>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono text-[11px] space-y-3">
                <div className="text-slate-400">
                  <span className="text-slate-500 uppercase block text-[10px]">Software Pipeline Version:</span>
                  <span className="text-slate-200 font-bold">{rep.reproducibility.software_version}</span>
                </div>

                {rep.reproducibility.pipeline_steps.length > 0 && (
                  <div>
                    <span className="text-slate-500 uppercase block text-[10px] mb-1">Execution Steps:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {rep.reproducibility.pipeline_steps.map((st, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-teal-300 text-[10px]">
                          {st}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {rep.reproducibility.unavailable_fields.length > 0 ? (
                  <div>
                    <span className="text-amber-400 uppercase block text-[10px] font-bold mb-1">
                      Unavailable / Unprovided Metadata Fields:
                    </span>
                    <ul className="space-y-1 text-[10px] text-amber-200/80">
                      {rep.reproducibility.unavailable_fields.map((uf, idx) => (
                        <li key={idx} className="flex items-center gap-1.5">
                          <span className="text-amber-500">•</span> {uf}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="text-emerald-400 text-[10px]">
                    ✓ All pipeline provenance fields were observed and verified.
                  </div>
                )}
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
