import React, { useState } from 'react';
import { Terminal, ChevronDown, ChevronRight, CheckCircle2, Clock, Cpu, FileText } from 'lucide-react';
import { ExecutionTrace } from '../types';

interface ExecutionTracePanelProps {
  trace?: ExecutionTrace;
}

export const ExecutionTracePanel: React.FC<ExecutionTracePanelProps> = ({ trace }) => {
  const [isOpen, setIsOpen] = useState<boolean>(true);
  if (!trace) return null;

  return (
    <div className="glass-panel rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl overflow-hidden">
      
      {/* Collapsible Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-5 py-3.5 flex items-center justify-between bg-slate-950/80 hover:bg-slate-950 transition-colors text-left border-b border-slate-800/80"
      >
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-teal-950 text-teal-400 border border-teal-800">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider font-mono flex items-center gap-2">
              AGENT EXECUTION TRACE
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800 font-normal">
                {trace.task.toUpperCase()}
              </span>
            </h3>
            <p className="text-xs text-slate-400">Observable task routing & execution timeline</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-cyan-400 bg-slate-900 px-2.5 py-1 rounded-md border border-slate-800 flex items-center gap-1">
            <Clock className="w-3 h-3 text-cyan-400" />
            {trace.execution_time_ms} ms
          </span>
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400" />
          )}
        </div>
      </button>

      {/* Expandable Trace Content */}
      {isOpen && (
        <div className="p-5 space-y-4 font-mono text-xs">
          
          {/* Summary Badges */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800">
            <div>
              <span className="text-[10px] text-slate-400 block uppercase">CLASSIFIED TASK</span>
              <span className="text-slate-100 font-bold">{trace.task.toUpperCase()}</span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 block uppercase">SPECIALIST MODELS</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {trace.models_selected.map((m, idx) => (
                  <span key={idx} className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                    {m}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 block uppercase font-mono">LATENCY</span>
              <span className="text-slate-100 font-bold">{trace.execution_time_ms} ms</span>
            </div>
          </div>

          {/* Observable Event Steps Timeline */}
          <div className="space-y-2">
            <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
              EVENT CHRONOLOGY LOG
            </p>

            <div className="space-y-1.5 pl-2 border-l-2 border-slate-800">
              {trace.steps.map((step, idx) => (
                <div key={idx} className="flex items-start gap-2.5 text-slate-300 hover:text-slate-100 transition-colors">
                  <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <span className="font-bold text-cyan-300 mr-2">[{step.step}]</span>
                    <span className="text-slate-300">{step.detail}</span>
                  </div>
                  <span className="text-[10px] text-slate-500 shrink-0">{step.timestamp.slice(11, 19)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Dynamic Multi-Step Tool Execution DAG (Stage 14) */}
          {(trace as any).execution_steps && (trace as any).execution_steps.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-cyan-400 uppercase tracking-wider font-semibold">
                  ORCHESTRATED TOOL EXECUTION DAG
                </p>
                {(trace as any).cumulative_transfer_bytes !== undefined && (
                  <span className="text-[10px] text-slate-400">
                    Cumulative Transfer: {((trace as any).cumulative_transfer_bytes / (1024 * 1024)).toFixed(2)} MB / {(((trace as any).transfer_budget_bytes || 20971520) / (1024 * 1024)).toFixed(0)} MB Cap
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {((trace as any).execution_steps as any[]).map((st, idx) => {
                  const isSuccess = st.status === 'success' || st.status === 'completed';
                  const isBlocked = st.status === 'blocked';
                  const isRetrying = st.status === 'retrying';
                  const statusClass = isSuccess
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : isBlocked
                    ? 'bg-amber-950 text-amber-300 border border-amber-800'
                    : isRetrying
                    ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                    : 'bg-rose-950 text-rose-300 border border-rose-800';
                  const latency = st.latency_ms ?? st.execution_time_ms ?? 0;
                  const stepText = st.summary || st.description || st.tool;

                  return (
                    <div key={idx} className="p-2 rounded bg-slate-950 border border-slate-800 flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 font-bold text-[10px]">
                          Step {st.step_number || idx + 1}
                        </span>
                        <span className="font-semibold text-slate-200">{st.tool}</span>
                        <span className="text-slate-400 text-[10px] truncate max-w-xs">{stepText}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-400 text-[10px]">{latency} ms</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${statusClass}`}>
                          {st.status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}

    </div>
  );
};
