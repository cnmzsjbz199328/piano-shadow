import { useEffect } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/useAppStore';
import { DebugPanel } from '@/components/debug/DebugPanel';
import { OverflowMenu } from '@/components/common/OverflowMenu';
import { PracticePage } from '@/pages/PracticePage';
import { ResultsPage } from '@/pages/ResultsPage';
import { ExperimentsPage } from '@/pages/ExperimentsPage';
import { MicrophoneLabPage } from '@/pages/MicrophoneLabPage';

/** The product surface is one page. Diagnostics remain available from Settings. */
export default function App() {
  const init = useAppStore((s) => s.init);
  const showDebugPanel = useAppStore((s) => s.showDebugPanel);
  const setShowDebugPanel = useAppStore((s) => s.setShowDebugPanel);
  const navigate = useNavigate();

  useEffect(() => { void init(); }, [init]);

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <NavLink to="/" className="app-nav__brand">
          <span className="app-nav__brand-mark" aria-hidden>♬</span>
          Piano Shadow
        </NavLink>
        <div className="app-nav__actions">
          <OverflowMenu label="Settings">
            <div className="overflow-menu__heading">Settings</div>
            <button type="button" role="menuitem" className="overflow-menu__item" onClick={() => navigate('/experiments')}>
              Browser and advanced settings
            </button>
            <button type="button" role="menuitem" className="overflow-menu__item" onClick={() => navigate('/lab')}>
              Recognition diagnostics
            </button>
            <div className="overflow-menu__sep" />
            <button type="button" role="menuitemcheckbox" aria-checked={showDebugPanel} className="overflow-menu__item" onClick={() => setShowDebugPanel(!showDebugPanel)}>
              Debug panel <span aria-hidden>{showDebugPanel ? 'On' : 'Off'}</span>
            </button>
          </OverflowMenu>
        </div>
      </nav>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<PracticePage />} />
          <Route path="/practice" element={<PracticePage />} />
          {/* Compatibility routes; the main completion flow stays on Practice. */}
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/lab" element={<MicrophoneLabPage />} />
          <Route path="/microphone-lab" element={<Navigate to="/lab" replace />} />
          <Route path="/experiments" element={<ExperimentsPage />} />
        </Routes>
      </main>
      {showDebugPanel && <DebugPanel />}
    </div>
  );
}
