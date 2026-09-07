import { useEffect } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/useAppStore';
import { DebugPanel } from '@/components/debug/DebugPanel';
import { OverflowMenu } from '@/components/common/OverflowMenu';
import { PracticePage } from '@/pages/PracticePage';
import { ResultsPage } from '@/pages/ResultsPage';
import { ExperimentsPage } from '@/pages/ExperimentsPage';
import { MicrophoneLabPage } from '@/pages/MicrophoneLabPage';

/**
 * Primary navigation is deliberately three items (ROUND_3_REQUIREMENTS §C.2.1):
 * Practice · Results · Lab. Everything else (Experiments, the debug-panel
 * toggle, future settings) lives in the top-right gear menu. Home is folded
 * into Practice's empty state — `/` renders `PracticePage`.
 */
const NAV_LINKS = [
  { to: '/practice', label: 'Practice' },
  { to: '/results', label: 'Results' },
  { to: '/lab', label: 'Lab' },
];

export default function App() {
  const init = useAppStore((s) => s.init);
  const showDebugPanel = useAppStore((s) => s.showDebugPanel);
  const setShowDebugPanel = useAppStore((s) => s.setShowDebugPanel);
  const navigate = useNavigate();

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <NavLink to="/practice" className="app-nav__brand">
          <span className="app-nav__brand-mark" aria-hidden>
            🎹
          </span>
          Piano Shadow
        </NavLink>
        <div className="app-nav__links">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => 'app-nav__link' + (isActive ? ' app-nav__link--active' : '')}
            >
              {link.label}
            </NavLink>
          ))}
        </div>
        <div className="app-nav__actions">
          <OverflowMenu>
            <button
              type="button"
              role="menuitem"
              className="overflow-menu__item"
              onClick={() => navigate('/experiments')}
            >
              Experiments
            </button>
            <div className="overflow-menu__sep" />
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={showDebugPanel}
              className="overflow-menu__item"
              onClick={() => setShowDebugPanel(!showDebugPanel)}
            >
              Debug panel
              <span aria-hidden>{showDebugPanel ? 'On' : 'Off'}</span>
            </button>
          </OverflowMenu>
        </div>
      </nav>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<PracticePage />} />
          <Route path="/practice" element={<PracticePage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/lab" element={<MicrophoneLabPage />} />
          {/* keep the original deep link working */}
          <Route path="/microphone-lab" element={<Navigate to="/lab" replace />} />
          <Route path="/experiments" element={<ExperimentsPage />} />
        </Routes>
      </main>
      {showDebugPanel && <DebugPanel />}
    </div>
  );
}
