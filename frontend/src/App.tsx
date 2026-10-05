import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { WorkspacePage } from './pages/WorkspacePage';
import { BenchmarksPage } from './pages/BenchmarksPage';
import { ModelRegistryPage } from './pages/ModelRegistryPage';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { checkBackendHealth } from './services/api';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'workspace' | 'benchmarks' | 'models' | 'architecture'>('workspace');
  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(false);

  useEffect(() => {
    checkBackendHealth().then((health) => {
      setIsBackendConnected(health.status === 'ok');
    });
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      
      {/* Top Application Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isBackendConnected={isBackendConnected}
      />

      {/* Main Page Body */}
      <main className="flex-1">
        {activeTab === 'workspace' && <WorkspacePage />}
        {activeTab === 'benchmarks' && <BenchmarksPage />}
        {activeTab === 'models' && <ModelRegistryPage />}
        {activeTab === 'architecture' && <ArchitecturePage />}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-4 px-4 text-center text-xs font-mono text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>SatQuery AI — Multimodal Remote Sensing Intelligence Platform</span>
          <span>ISRO Problem Statement 26167 Prototype</span>
        </div>
      </footer>

    </div>
  );
};

export default App;
