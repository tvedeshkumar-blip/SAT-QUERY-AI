import React, { useEffect, useState } from 'react';
import { BarChart3, ShieldAlert, Award, Layers, TrendingUp, Sparkles, Filter, Play, Loader2, Compass, AlertCircle, Info, Database } from 'lucide-react';
import { BenchmarkResult } from '../types';
import { fetchBenchmarkResults, runSyntheticValidation, runOfficialEvaluation } from '../services/api';

export const BenchmarksPage: React.FC = () => {
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [evalStatus, setEvalStatus] = useState<string>('not_evaluated');
  const [evalMessage, setEvalMessage] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  
  // Synthetic Pipeline Validation state
  const [syntheticMetrics, setSyntheticMetrics] = useState<any>(null);
  const [isRunningSynthetic, setIsRunningSynthetic] = useState<boolean>(false);

  // Official Evaluation state
  const [officialStatus, setOfficialStatus] = useState<any>(null);
  const [isRunningOfficial, setIsRunningOfficial] = useState<boolean>(false);

  useEffect(() => {
    fetchBenchmarkResults()
      .then((data) => {
        setResults(data.results);
        setEvalStatus(data.status);
        setEvalMessage(data.message);
      })
      .finally(() => setIsLoading(false));

    // Execute runtime synthetic pipeline validation on mount
    runSyntheticValidation(42)
      .then((data) => setSyntheticMetrics(data))
      .catch((err) => console.error('Synthetic validation init error:', err));

    // Check official evaluation dataset package status
    runOfficialEvaluation()
      .then((data) => setOfficialStatus(data))
      .catch((err) => console.error('Official evaluation init error:', err));
  }, []);

  const filteredResults = filterCategory === 'all'
    ? results
    : results.filter((r) => r.task.toLowerCase().includes(filterCategory.toLowerCase()));

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-6" data-testid="benchmarks-page">
      
      {/* Page Header */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 bg-slate-900/60 shadow-xl space-y-2">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-950 text-cyan-400 border border-cyan-800/50">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100 uppercase tracking-wider font-mono">
              VERIFIED REMOTE SENSING BENCHMARK DASHBOARD
            </h2>
            <p className="text-xs text-slate-400">
              Evaluated performance metrics across mounted Earth observation benchmarks (RSVQA, VRSBench, CDVQA, BigEarthNet-MM)
            </p>
          </div>
        </div>
      </div>

      {/* Verified Benchmark Results Section */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 bg-slate-900/50 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold font-mono text-slate-100 uppercase tracking-wider flex items-center gap-2">
              <Database className="w-4 h-4 text-cyan-400" />
              Verified Public Benchmark Results
            </h3>
            <p className="text-xs text-slate-400 font-mono">
              Results populated strictly from persisted execution artifacts. Zero fabricated scores.
            </p>
          </div>

          {results.length > 0 && (
            <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-xl border border-slate-800 text-xs font-mono">
              <span className="text-slate-500 px-2 flex items-center gap-1">
                <Filter className="w-3 h-3" />
                Filter:
              </span>
              {['all', 'vqa', 'grounding', 'change', 'fusion'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  className={`px-2.5 py-1 rounded-lg uppercase text-[10px] transition-all ${
                    filterCategory === cat
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Dynamic Display: Table or Honest "NO VERIFIED BENCHMARK RESULTS" */}
        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400 font-mono text-xs">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
            Checking persisted benchmark artifacts...
          </div>
        ) : results.length === 0 ? (
          <div className="py-12 px-6 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 text-center space-y-3">
            <div className="inline-flex p-3 rounded-2xl bg-cyan-950/50 border border-cyan-800/40 text-cyan-400">
              <Info className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold font-mono text-slate-200 uppercase tracking-wider">
              NO VERIFIED BENCHMARK RESULTS
            </h4>
            <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed font-sans">
              Benchmark results will appear after actual evaluation on mounted datasets (RSVQA, VRSBench, CDVQA). 
              In compliance with scientific integrity rules, SatQuery AI never displays unverified or hardcoded percentages.
            </p>
            <p className="text-[11px] text-cyan-400/80 font-mono">
              Run the evaluation pipeline with mounted data splits to populate this panel.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950 text-slate-400 uppercase text-[10px]">
                  <th className="p-3">Benchmark Dataset</th>
                  <th className="p-3">Task Category</th>
                  <th className="p-3">Specialist Model Adapter</th>
                  <th className="p-3">Target Metric</th>
                  <th className="p-3">Evaluated Score</th>
                  <th className="p-3">Evaluation Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {filteredResults.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-950/50 transition-colors">
                    <td className="p-3 font-semibold text-cyan-300">{row.dataset}</td>
                    <td className="p-3">{row.task}</td>
                    <td className="p-3 font-mono text-slate-400">{row.model}</td>
                    <td className="p-3 text-slate-400">{row.metric}</td>
                    <td className="p-3 font-bold text-emerald-400">{row.score}</td>
                    <td className="p-3 text-slate-500">{row.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </div>

      {/* Local Synthetic Pipeline Validation (Section 4 & 28) */}
      <div 
        className="glass-panel rounded-2xl p-6 border border-slate-800 bg-slate-900/60 shadow-xl space-y-4"
        data-testid="synthetic-pipeline-validation-section"
      >
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-950 text-cyan-400 border border-cyan-800">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold font-mono text-slate-100 uppercase tracking-wider">
                  LOCAL SYNTHETIC PIPELINE VALIDATION
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-cyan-300 border border-cyan-800/40 uppercase">
                  Synthetic Math Verification
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">
                Verifies spatial array arithmetic, mask IoU, bounding box overlap, and cross-modal NCC on deterministic test rasters.
              </p>
            </div>
          </div>

          <button
            onClick={async () => {
              try {
                setIsRunningSynthetic(true);
                const data = await runSyntheticValidation(42);
                setSyntheticMetrics(data);
              } catch (err) {
                console.error('Synthetic validation error:', err);
              } finally {
                setIsRunningSynthetic(false);
              }
            }}
            disabled={isRunningSynthetic}
            data-testid="run-synthetic-validation-btn"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold bg-cyan-600 hover:bg-cyan-500 text-slate-950 shadow-md shadow-cyan-950 transition-all disabled:opacity-50"
          >
            {isRunningSynthetic ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                Computing Pipeline Math...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-slate-950" />
                Run Synthetic Pipeline Validation
              </>
            )}
          </button>
        </div>

        {/* Prominent Scientific Disclaimer */}
        <div 
          className="p-3.5 rounded-xl bg-amber-950/25 border border-amber-800/50 text-amber-300 flex items-start gap-3"
          data-testid="synthetic-disclaimer"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
          <div className="space-y-1">
            <span className="font-bold uppercase text-[10px] tracking-wide block text-amber-200">
              Scientific Arithmetic Smoke Disclaimer
            </span>
            <p className="text-[11px] leading-relaxed text-amber-300/90 font-mono">
              SYNTHETIC LOCAL PIPELINE VALIDATION ONLY. Computed on test patterns to verify pipeline arithmetic (Mask IoU, Bounding Box IoU, Cross-Modal NCC). This does NOT represent official ISRO / SAC Cartosat-2S or RISAT-1A evaluation scores.
            </p>
          </div>
        </div>

        {/* Synthetic Results Display */}
        {syntheticMetrics ? (
          <div className="space-y-4 pt-1 font-mono text-xs animate-in fade-in duration-300">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Cross-Modal NCC</span>
                <p className="text-xl font-bold text-cyan-300" data-testid="metric-ncc">
                  {syntheticMetrics.metrics?.spatial_ncc_correlation ?? 'N/A'}
                </p>
                <p className="text-[9px] text-slate-500">Normalized Correlation</p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Binary Mask IoU</span>
                <p className="text-xl font-bold text-teal-300" data-testid="metric-mask-iou">
                  {syntheticMetrics.metrics?.mask_iou ?? 'N/A'}
                </p>
                <p className="text-[9px] text-slate-500">Overlap Ratio</p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Mask F1-Score</span>
                <p className="text-xl font-bold text-emerald-300" data-testid="metric-mask-f1">
                  {syntheticMetrics.metrics?.mask_f1_score ?? 'N/A'}
                </p>
                <p className="text-[9px] text-slate-500">Dice Coefficient</p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Bounding Box Mean IoU</span>
                <p className="text-xl font-bold text-sky-300" data-testid="metric-box-iou">
                  {syntheticMetrics.metrics?.bounding_box_mean_iou ?? 'N/A'}
                </p>
                <p className="text-[9px] text-slate-500">Spatial Overlap</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-950/50 border border-slate-800 text-[10px] text-slate-400 font-mono">
              <span>Status: <strong className="text-emerald-400 uppercase">{syntheticMetrics.validation_status}</strong></span>
              <span>Evaluated Pixels: <strong className="text-slate-200">{syntheticMetrics.metrics?.evaluated_pixel_count?.toLocaleString() || '65,536'}</strong></span>
              <span>Pattern: <strong className="text-slate-200">256 × 256 Procedural Geometric Test Rasters</strong></span>
            </div>
          </div>
        ) : (
          <div className="p-6 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 text-center space-y-2">
            <p className="text-xs text-slate-400 font-mono">
              Click &quot;Run Synthetic Pipeline Validation&quot; to compute arithmetic verification on deterministic 256x256 test rasters.
            </p>
          </div>
        )}

      </div>

      {/* Official ISRO / SAC Evaluation Workflow (Requirement 28) */}
      <div 
        className="glass-panel rounded-2xl p-6 border border-slate-800 bg-slate-900/40 space-y-4"
        data-testid="official-evaluation-section"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-950 text-emerald-400 border border-emerald-800">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold font-mono text-slate-200 uppercase tracking-wider">
                  Official ISRO / SAC Evaluation Workflow
                </h4>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 uppercase">
                  Agency Evaluation
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">
                Dedicated verification harness for authorized Cartosat-2S and RISAT-1A evaluation suites when official ground truth packages are mounted.
              </p>
            </div>
          </div>

          <button
            onClick={async () => {
              try {
                setIsRunningOfficial(true);
                const data = await runOfficialEvaluation();
                setOfficialStatus(data);
              } catch (err) {
                console.error('Official evaluation error:', err);
              } finally {
                setIsRunningOfficial(false);
              }
            }}
            disabled={isRunningOfficial}
            data-testid="check-official-evaluation-btn"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono font-medium border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all disabled:opacity-50"
          >
            {isRunningOfficial ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Checking Package Status...
              </>
            ) : (
              'Check Official Evaluation Dataset'
            )}
          </button>
        </div>

        {/* Official Status Panel */}
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs font-mono">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 uppercase text-[10px]">Dataset Status:</span>
              <span 
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  officialStatus?.status === 'mounted_awaiting_execution'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : 'bg-rose-950/60 text-rose-300 border border-rose-800/80'
                }`}
                data-testid="official-status-badge"
              >
                {officialStatus?.status || 'not_mounted'}
              </span>
            </div>
            <span className="text-[10px] text-slate-500">
              Evaluated Scores: <strong className="text-slate-400">None (Zero Fabrication Policy)</strong>
            </span>
          </div>

          <p className="text-slate-300 leading-relaxed text-[11px]" data-testid="official-status-message">
            {officialStatus?.message || (
              "Official ISRO / SAC evaluation requires mounted Cartosat-2S and RISAT-1A radiometrically calibrated rasters with authorized ground truth shapefiles. No official evaluation package is currently mounted in data/official_isro/."
            )}
          </p>
        </div>

      </div>

    </div>
  );
};
