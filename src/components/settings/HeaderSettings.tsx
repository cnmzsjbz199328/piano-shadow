import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MIN_TEMPO_SCALE, MAX_TEMPO_SCALE } from '@/playback-engine';
import { useAppStore, type PracticeMode, type PracticeVoice } from '@/stores/useAppStore';
import { MidiDevicePanel } from '@/components/transport/MidiDevicePanel';

type SettingsCategory = 'mode' | 'hands' | 'tempo' | 'input' | 'more';

const CATEGORIES: Array<{ id: SettingsCategory; label: string }> = [
  { id: 'mode', label: 'Mode' },
  { id: 'hands', label: 'Hands' },
  { id: 'tempo', label: 'Tempo' },
  { id: 'input', label: 'Input' },
  { id: 'more', label: 'More' },
];

const MODES: Array<{ id: PracticeMode; label: string; explanation: string }> = [
  { id: 'play-along', label: 'Play along', explanation: 'The reference plays at a steady pace.' },
  { id: 'wait', label: 'Wait', explanation: 'The reference waits for your note.' },
  { id: 'listen', label: 'Listen', explanation: 'Hear the reference without recording.' },
];

const VOICES: Array<{ id: PracticeVoice; label: string }> = [
  { id: 'both', label: 'Both' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
];

const TEMPO_STEP = 0.05;

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  ));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, [query]);

  return matches;
}

function pageCount(category: SettingsCategory, phone: boolean): number {
  if (!phone) return 1;
  if (category === 'tempo' || category === 'more') return 3;
  return 1;
}

export function HeaderSettings() {
  const location = useLocation();
  const navigate = useNavigate();
  const compact = useMediaQuery('(max-width: 1099px)');
  const phone = useMediaQuery('(max-width: 699px)');
  const [openCategory, setOpenCategory] = useState<SettingsCategory | null>(null);
  const [pages, setPages] = useState<Partial<Record<SettingsCategory, number>>>({});
  const panelId = `header-settings-panel-${useId().replace(/:/g, '')}`;
  const backRef = useRef<HTMLButtonElement>(null);
  const triggerRefs = useRef<Partial<Record<SettingsCategory, HTMLButtonElement | null>>>({});

  const song = useAppStore((s) => s.song);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const practiceVoice = useAppStore((s) => s.practiceVoice);
  const setPracticeVoice = useAppStore((s) => s.setPracticeVoice);
  const tempoScale = useAppStore((s) => s.tempoScale);
  const setTempoScale = useAppStore((s) => s.setTempoScale);
  const metronomeEnabled = useAppStore((s) => s.metronomeEnabled);
  const setMetronomeEnabled = useAppStore((s) => s.setMetronomeEnabled);
  const countInEnabled = useAppStore((s) => s.countInEnabled);
  const setCountInEnabled = useAppStore((s) => s.setCountInEnabled);
  const isAttemptRunning = useAppStore((s) => s.isAttemptRunning);
  const recognitionActive = useAppStore((s) => s.recognitionState === 'initializing' || s.recognitionState === 'listening');
  const showDebugPanel = useAppStore((s) => s.showDebugPanel);
  const setShowDebugPanel = useAppStore((s) => s.setShowDebugPanel);

  const currentPage = openCategory ? Math.min(pages[openCategory] ?? 0, pageCount(openCategory, phone) - 1) : 0;
  const settingsDisabled = !song;
  const modeDisabled = settingsDisabled || isAttemptRunning || recognitionActive;
  const handsDisabled = settingsDisabled || isAttemptRunning;
  const tempoDisabled = settingsDisabled;

  useEffect(() => {
    setOpenCategory(null);
    setPages({});
  }, [location.pathname]);

  useEffect(() => {
    if (!openCategory || !compact) return undefined;
    const frame = requestAnimationFrame(() => backRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [compact, openCategory]);

  useEffect(() => {
    if (openCategory && !phone && (pages[openCategory] ?? 0) !== 0) {
      setPages((current) => ({ ...current, [openCategory]: 0 }));
    }
  }, [openCategory, pages, phone]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !openCategory) return;
      event.preventDefault();
      const trigger = triggerRefs.current[openCategory];
      setOpenCategory(null);
      setPages({});
      requestAnimationFrame(() => trigger?.focus({ preventScroll: true }));
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openCategory]);

  function toggleCategory(category: SettingsCategory): void {
    if (openCategory === category) {
      setOpenCategory(null);
      setPages({});
      requestAnimationFrame(() => triggerRefs.current[category]?.focus({ preventScroll: true }));
      return;
    }
    setOpenCategory(category);
    setPages({ [category]: 0 });
  }

  function setPage(next: number): void {
    if (!openCategory) return;
    setPages((current) => ({ ...current, [openCategory]: next }));
  }

  function renderMode(): JSX.Element {
    return (
      <div className="header-settings__page">
        <div className="header-settings__button-group" role="group" aria-label="Practice mode">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              className="header-settings__option"
              aria-pressed={mode === item.id}
              aria-label={`${item.label}: ${item.explanation}`}
              disabled={modeDisabled}
              onClick={() => setMode(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="header-settings__hint">{settingsDisabled ? 'Load a song to change mode.' : MODES.find((item) => item.id === mode)?.explanation}</span>
      </div>
    );
  }

  function renderHands(): JSX.Element {
    return (
      <div className="header-settings__page">
        <div className="header-settings__button-group" role="group" aria-label="Which hand to practise">
          {VOICES.map((voice) => (
            <button
              key={voice.id}
              type="button"
              className="header-settings__option"
              aria-pressed={practiceVoice === voice.id}
              disabled={handsDisabled}
              onClick={() => setPracticeVoice(voice.id)}
            >
              {voice.label}
            </button>
          ))}
        </div>
        {settingsDisabled && <span className="header-settings__hint">Load a song to choose hands.</span>}
      </div>
    );
  }

  function renderTempo(): JSX.Element {
    const tempo = (
      <div className="header-settings__tempo" aria-label="Tempo">
        <span className="header-settings__value">{Math.round(tempoScale * 100)}%</span>
        <button type="button" className="header-settings__option header-settings__icon" aria-label="Slower" disabled={tempoDisabled || tempoScale <= MIN_TEMPO_SCALE} onClick={() => setTempoScale(tempoScale - TEMPO_STEP)}>−</button>
        <button type="button" className="header-settings__option header-settings__icon" aria-label="Faster" disabled={tempoDisabled || tempoScale >= MAX_TEMPO_SCALE} onClick={() => setTempoScale(tempoScale + TEMPO_STEP)}>+</button>
      </div>
    );
    const renderToggle = (label: string, checked: boolean, onChange: () => void) => (
      <button type="button" className="header-settings__option" aria-pressed={checked} disabled={tempoDisabled} onClick={onChange}>
        {label} {checked ? 'On' : 'Off'}
      </button>
    );
    const toggles = (
      <div className="header-settings__button-group" role="group" aria-label="Tempo options">
        {renderToggle('Count-in', countInEnabled, () => setCountInEnabled(!countInEnabled))}
        {renderToggle('Metronome', metronomeEnabled, () => setMetronomeEnabled(!metronomeEnabled))}
      </div>
    );

    if (!phone) {
      return <div className="header-settings__page">{tempo}<span className="header-settings__tempo-divider" />{toggles}</div>;
    }
    if (currentPage === 0) return <div className="header-settings__page"><span className="header-settings__small-label">Speed</span>{tempo}</div>;
    if (currentPage === 1) return <div className="header-settings__page"><span className="header-settings__small-label">Count-in</span>{renderToggle('Count-in', countInEnabled, () => setCountInEnabled(!countInEnabled))}</div>;
    return <div className="header-settings__page"><span className="header-settings__small-label">Metronome</span>{renderToggle('Metronome', metronomeEnabled, () => setMetronomeEnabled(!metronomeEnabled))}</div>;
  }

  function renderMore(): JSX.Element {
    const actions = [
      <button key="advanced" type="button" className="header-settings__option" onClick={() => navigate('/experiments')}>Advanced</button>,
      <button key="diagnostics" type="button" className="header-settings__option" onClick={() => navigate('/lab')}>Diagnostics</button>,
      <button key="debug" type="button" className="header-settings__option" aria-pressed={showDebugPanel} onClick={() => setShowDebugPanel(!showDebugPanel)}>Debug {showDebugPanel ? 'On' : 'Off'}</button>,
    ];
    return <div className="header-settings__page">{phone ? actions[currentPage] : actions}</div>;
  }

  function renderCategory(category: SettingsCategory): JSX.Element {
    if (category === 'mode') return renderMode();
    if (category === 'hands') return renderHands();
    if (category === 'tempo') return renderTempo();
    if (category === 'input') return <div className="header-settings__page header-settings__page--input"><MidiDevicePanel compact /></div>;
    return renderMore();
  }

  const activeLabel = CATEGORIES.find((category) => category.id === openCategory)?.label;
  const totalPages = openCategory ? pageCount(openCategory, phone) : 1;

  return (
    <div className={`header-settings${openCategory ? ' header-settings--open' : ''}`} data-open={openCategory ? 'true' : undefined}>
      <div className="header-settings__nav" role="group" aria-label="Practice settings">
        {CATEGORIES.map((category) => (
          <button
            key={category.id}
            ref={(element) => { triggerRefs.current[category.id] = element; }}
            type="button"
            className="header-settings__category"
            aria-expanded={openCategory === category.id}
            aria-controls={openCategory === category.id ? panelId : undefined}
            onClick={() => toggleCategory(category.id)}
          >
            {category.label}
          </button>
        ))}
      </div>

      {openCategory && (
        <div className="header-settings__content" id={panelId} role="region" aria-label={`${activeLabel} settings`}>
          <button ref={backRef} type="button" className="header-settings__back" onClick={() => toggleCategory(openCategory)}>
            <span aria-hidden>←</span><span>Back</span>
          </button>
          <strong className="header-settings__title">{activeLabel}</strong>
          <div className="header-settings__body">
            <div key={`${openCategory}-${currentPage}`} className="header-settings__page-transition">
              {renderCategory(openCategory)}
            </div>
          </div>
          {phone && totalPages > 1 && (
            <div className="header-settings__pager" aria-label={`${activeLabel} pages`}>
              <button type="button" className="header-settings__pager-button" aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>‹</button>
              <span aria-live="polite">{currentPage + 1}/{totalPages}</span>
              <button type="button" className="header-settings__pager-button" aria-label="Next page" disabled={currentPage === totalPages - 1} onClick={() => setPage(currentPage + 1)}>›</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
