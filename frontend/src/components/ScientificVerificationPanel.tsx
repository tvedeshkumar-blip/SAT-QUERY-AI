import React, { useState } from 'react';
import { 
  ShieldCheck, 
  AlertTriangle, 
  XCircle, 
  Clock, 
  CheckCircle2, 
  HelpCircle, 
  Tag, 
  Info,
  ChevronDown,
  ChevronUp,
  FileCheck2,
  RefreshCw
} from 'lucide-react';
import { VerificationResponse, ClaimVerificationItem } from '../types';

interface ScientificVerificationPanelProps {
  verification?: VerificationResponse | null;
  onReverify?: () => void;
  isVerifying?: boolean;
}

export const ScientificVerificationPanel: React.FC<ScientificVerificationPanelProps> = ({
  verification,
  onReverify,
  isVerifying = false
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!verification) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between text-slate-400">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-mono font-medium">Stage 7 Scientific Verification: Not run</span>
          </div>
          {onReverify && (
            <button
              onClick={onReverify}
              disabled={isVerifying}
              className="text-xs font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
              Run Verification
            </button>
          )}
        </div>
      </div>
    );
  }

  const status = verification.verification_status;
  const statusConfig = {
    supported: {
      label: 'SCIENTIFIC VERIFICATION: SUPPORTED',
      badgeClass: 'bg-emerald-950/80 text-emerald-300 border-emerald-600',
      icon: <ShieldCheck className="w-4 h-4 text-emerald-400" />,
      dotClass: 'bg-emerald-400'
    },
    partially_supported: {
      label: 'SCIENTIFIC VERIFICATION: PARTIALLY SUPPORTED',
      badgeClass: 'bg-amber-950/80 text-amber-300 border-amber-600',
      icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
      dotClass: 'bg-amber-400'
    },
    unsupported: {
      label: 'SCIENTIFIC VERIFICATION: UNSUPPORTED',
      badgeClass: 'bg-rose-950/80 text-rose-300 border-rose-600',
      icon: <XCircle className="w-4 h-4 text-rose-400" />,
      dotClass: 'bg-rose-400'
    },
    not_run: {
      label: 'SCIENTIFIC VERIFICATION: NOT RUN (LLM OFFLINE)',
      badgeClass: 'bg-slate-800/90 text-slate-300 border-slate-700',
      icon: <Clock className="w-4 h-4 text-slate-400" />,
      dotClass: 'bg-slate-400'
    }
  }[status] || {
    label: `SCIENTIFIC VERIFICATION: ${status.toUpperCase()}`,
    badgeClass: 'bg-slate-800 text-slate-300 border-slate-700',
    icon: <HelpCircle className="w-4 h-4 text-slate-400" />,
    dotClass: 'bg-slate-400'
  };

  const getClaimStatusBadge = (claimStatus: string) => {
    switch (claimStatus) {
      case 'supported':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-950/60 text-emerald-300 border border-emerald-800/80">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Supported
          </span>
        );
      case 'partially_supported':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-amber-950/60 text-amber-300 border border-amber-800/80">
            <AlertTriangle className="w-3 h-3 text-amber-400" /> Partial
          </span>
        );
      case 'contradicted':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-rose-950/60 text-rose-300 border border-rose-800/80">
            <XCircle className="w-3 h-3 text-rose-400" /> Contradicted
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-800 text-slate-300 border border-slate-700">
            <HelpCircle className="w-3 h-3 text-slate-400" /> Unsupported
          </span>
        );
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 space-y-3 shadow-lg">
      
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-mono font-semibold tracking-wide ${statusConfig.badgeClass}`}>
            {statusConfig.icon}
            {statusConfig.label}
          </span>

          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-mono border ${
            verification.deterministic_passed 
              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-900/60'
              : 'bg-rose-950/40 text-rose-300 border-rose-900/60'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${verification.deterministic_passed ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
            Deterministic: {verification.deterministic_passed ? 'Passed' : 'Violations'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onReverify && (
            <button
              onClick={onReverify}
              disabled={isVerifying}
              className="text-xs font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1 px-2 py-1 rounded bg-slate-800/50 hover:bg-slate-800 transition"
              title="Re-run scientific verification"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
              Re-verify
            </button>
          )}

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-slate-400 hover:text-slate-200 transition p-1"
            title={isExpanded ? 'Collapse Verification Panel' : 'Expand Verification Panel'}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Main explanation */}
      <div className="text-sm text-slate-300 bg-slate-950/40 rounded-lg p-3 border border-slate-800/60">
        <p className="leading-relaxed">{verification.summary_explanation}</p>
      </div>

      {isExpanded && (
        <div className="space-y-3 pt-1">
          
          {/* Deterministic Failures / Contradictions (if any) */}
          {verification.contradictions && verification.contradictions.length > 0 && (
            <div className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-rose-300 uppercase">
                <XCircle className="w-4 h-4 text-rose-400" />
                Deterministic Contradictions & Integrity Violations
              </div>
              <ul className="text-xs text-rose-200/90 list-disc list-inside space-y-1">
                {verification.contradictions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Missing Evidence / Uncertainty (if any) */}
          {verification.missing_evidence && verification.missing_evidence.length > 0 && (
            <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-amber-300 uppercase">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Missing Evidence & Observational Gaps
              </div>
              <ul className="text-xs text-amber-200/90 list-disc list-inside space-y-1">
                {verification.missing_evidence.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Evaluated Claims Checklist */}
          {verification.claims && verification.claims.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono font-semibold text-slate-400 uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <FileCheck2 className="w-3.5 h-3.5 text-cyan-400" />
                  Audited Claims ({verification.claims.length})
                </span>
                <span className="text-[11px] text-slate-500 lowercase">grounded in evidence artifacts</span>
              </div>

              <div className="space-y-2">
                {verification.claims.map((claim: ClaimVerificationItem, idx: number) => (
                  <div 
                    key={idx} 
                    className="rounded-lg border border-slate-800/90 bg-slate-950/30 p-2.5 space-y-1.5 hover:border-slate-700/80 transition"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="text-xs font-medium text-slate-200 leading-snug">
                        {claim.claim_text}
                      </span>
                      {getClaimStatusBadge(claim.status)}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      {claim.cited_artifact_ids && claim.cited_artifact_ids.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <Tag className="w-3 h-3 text-slate-500" />
                          {claim.cited_artifact_ids.map((artId, aIdx) => (
                            <span 
                              key={aIdx} 
                              className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-950/60 text-cyan-300 border border-cyan-800/60"
                            >
                              {artId}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[10px] font-mono text-slate-500 italic">No artifact cited</span>
                      )}

                      {claim.evidence_found && (
                        <span className="text-[11px] text-slate-400">
                          Found: <span className="text-slate-300 font-mono">{claim.evidence_found}</span>
                        </span>
                      )}
                    </div>

                    {claim.reason && (
                      <p className="text-[11px] text-slate-400/90 italic border-l-2 border-slate-700/60 pl-2 mt-1">
                        {claim.reason}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Scientific Limitations & Recommended Follow-up Checks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {verification.scientific_limitations && verification.scientific_limitations.length > 0 && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-2.5 space-y-1">
                <span className="font-mono font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1">
                  <Info className="w-3.5 h-3.5 text-slate-400" />
                  Known Limitations
                </span>
                <ul className="text-slate-400 list-disc list-inside space-y-0.5">
                  {verification.scientific_limitations.map((lim, i) => (
                    <li key={i}>{lim}</li>
                  ))}
                </ul>
              </div>
            )}

            {verification.recommended_checks && verification.recommended_checks.length > 0 && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-2.5 space-y-1">
                <span className="font-mono font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1">
                  <FileCheck2 className="w-3.5 h-3.5 text-cyan-400" />
                  Recommended Checks
                </span>
                <ul className="text-slate-400 list-disc list-inside space-y-0.5">
                  {verification.recommended_checks.map((chk, i) => (
                    <li key={i}>{chk}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Legal / Interpretive layer notice */}
          <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-2 text-[11px] text-slate-400 flex items-start gap-2">
            <Info className="w-4 h-4 text-cyan-500 shrink-0 mt-0.5" />
            <span>
              {verification.interpretive_statement || 
                "The LLM verifier is strictly an interpretive and explanatory layer based solely on computed evidence. It does not calculate raster data, alter numerical measurements, or replace physical validation."}
            </span>
          </div>

        </div>
      )}
    </div>
  );
};
