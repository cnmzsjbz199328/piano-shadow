import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/useAppStore';
import { OverflowMenu } from '@/components/common/OverflowMenu';
import { PracticePage } from '@/pages/PracticePage';
import { ResultsPage } from '@/pages/ResultsPage';
import { ExperimentsPage } from '@/pages/ExperimentsPage';
import { MicrophoneLabPage } from '@/pages/MicrophoneLabPage';

/** The product surface is one page. */
export default function App() {
  const init = useAppStore((s) => s.init);
  const location = useLocation();
  const navigate = useNavigate();
  const isPracticeRoute = location.pathname === '/' || location.pathname === '/practice';

  useEffect(() => { void init(); }, [init]);

  return (
    <div className="app-shell">
      <nav className={`app-nav${isPracticeRoute ? ' app-nav--practice' : ''}`}>
        {isPracticeRoute && <div className="app-nav__header-settings-slot" id="header-settings-slot" />}
        {!isPracticeRoute && <div className="app-nav__settings" />}
        {!isPracticeRoute && <div className="app-nav__actions">
          <OverflowMenu label="Settings">
            <div className="overflow-menu__heading">Settings</div>
            <button type="button" role="menuitem" className="overflow-menu__item" onClick={() => navigate('/experiments')}>
              Browser and advanced settings
            </button>
            <button type="button" role="menuitem" className="overflow-menu__item" onClick={() => navigate('/lab')}>
              Recognition diagnostics
            </button>
            <div className="overflow-menu__sep" />
          </OverflowMenu>
        </div>}
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
    </div>
  );
}
