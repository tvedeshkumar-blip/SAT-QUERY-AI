import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { WorkspacePage } from './pages/WorkspacePage';
import { BenchmarksPage } from './pages/BenchmarksPage';
import { ModelRegistryPage } from './pages/ModelRegistryPage';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { checkBackendHealth } from './services/api';

type TabType = 'workspace' | 'benchmarks' | 'models' | 'architecture';

const parseTabFromLocation = (): TabType => {
  const hash = window.location.hash.replace('#', '').toLowerCase();
  if (['workspace', 'benchmarks', 'models', 'architecture'].includes(hash)) {
    return hash as TabType;
  }
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab')?.toLowerCase();
  if (tab && ['workspace', 'benchmarks', 'models', 'architecture'].includes(tab)) {
    return tab as TabType;
  }
  return 'workspace';
};

export const App: React.FC = () => {
  const [activeTab, setActiveTabState] = useState<TabType>(parseTabFromLocation);
  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(false);

  useEffect(() => {
    checkBackendHealth().then((health) => {
      setIsBackendConnected(health.status === 'ok');
    });

    const handleLocationChange = () => {
      const tab = parseTabFromLocation();
      setActiveTabState(tab);
    };

    window.addEventListener('hashchange', handleLocationChange);
    window.addEventListener('popstate', handleLocationChange);
    return () => {
      window.removeEventListener('hashchange', handleLocationChange);
      window.removeEventListener('popstate', handleLocationChange);
    };
  }, []);

  const setActiveTab = (tab: TabType) => {
    setActiveTabState(tab);
    if (window.location.hash !== `#${tab}`) {
      window.location.hash = tab;
    }
  };

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
