import { useEffect } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useAppStore } from '@/stores/useAppStore';
import { DebugPanel } from '@/components/debug/DebugPanel';
import { HomePage } from '@/pages/HomePage';
import { PracticePage } from '@/pages/PracticePage';
import { ResultsPage } from '@/pages/ResultsPage';
import { ExperimentsPage } from '@/pages/ExperimentsPage';

const NAV_LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/practice', label: 'Practice' },
  { to: '/results', label: 'Results' },
  { to: '/experiments', label: 'Experiments' },
];

export default function App() {
  const init = useAppStore((s) => s.init);
  const showDebugPanel = useAppStore((s) => s.showDebugPanel);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <NavLink to="/" className="app-nav__brand">
          🎹 Piano Shadow
        </NavLink>
        <div className="app-nav__links">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => 'app-nav__link' + (isActive ? ' app-nav__link--active' : '')}
            >
              {link.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/practice" element={<PracticePage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/experiments" element={<ExperimentsPage />} />
        </Routes>
      </main>
      {showDebugPanel && <DebugPanel />}
    </div>
  );
}
