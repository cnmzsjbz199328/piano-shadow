import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CompositionEvent, type FocusEvent, type PointerEvent, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
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

const TEMPO_STEP = 0.1;
export const SETTINGS_IDLE_TIMEOUT_MS = 10_000;

/** `App.tsx` mounts an empty div with this id inside `<nav>` on the Practice
 * route; `HeaderSettings` portals itself there so the categories and shared
 * content area render as part of the nav bar instead of a separate row
 * below it. Falls back to rendering in place until the slot is found. */
const NAV_SLOT_ID = 'header-settings-slot';

interface HeaderSettingsProps {
  /** The normal Practice controls shown while no category is selected. */
  defaultContent?: ReactNode;
}

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

export function HeaderSettings({ defaultContent = null }: HeaderSettingsProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const phone = useMediaQuery('(max-width: 699px)');
  const [openCategory, setOpenCategory] = useState<SettingsCategory | null>(null);
  const [pages, setPages] = useState<Partial<Record<SettingsCategory, number>>>({});
  const [navSlot, setNavSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setNavSlot(document.getElementById(NAV_SLOT_ID)); }, []);
  const panelId = `header-settings-panel-${useId().replace(/:/g, '')}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Partial<Record<SettingsCategory, HTMLButtonElement | null>>>({});
  const idleTimerRef = useRef<number | null>(null);
  const protectedRef = useRef(false);
  const pointerDownRef = useRef(false);
  const openCategoryRef = useRef<SettingsCategory | null>(null);
  openCategoryRef.current = openCategory;

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

  const currentPage = openCategory ? Math.min(pages[openCategory] ?? 0, pageCount(openCategory, phone) - 1) : 0;
  const settingsDisabled = !song;
  const modeDisabled = settingsDisabled || isAttemptRunning || recognitionActive;
  const handsDisabled = settingsDisabled || isAttemptRunning;
  const tempoDisabled = settingsDisabled;

  const clearIdleTimer = useCallback((): void => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const scheduleIdleReset = useCallback((): void => {
    clearIdleTimer();
    if (!openCategoryRef.current || protectedRef.current) return;
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      const category = openCategoryRef.current;
      if (!category) return;

      const focusedPanelElement = contentRef.current?.contains(document.activeElement);
      openCategoryRef.current = null;
      protectedRef.current = false;
      setOpenCategory(null);
      setPages({});
      if (focusedPanelElement) {
        requestAnimationFrame(() => triggerRefs.current[category]?.focus({ preventScroll: true }));
      }
    }, SETTINGS_IDLE_TIMEOUT_MS);
  }, [clearIdleTimer]);

  const hideCategory = useCallback((restoreFocus: boolean): void => {
    const category = openCategoryRef.current;
    clearIdleTimer();
    protectedRef.current = false;
    openCategoryRef.current = null;
    setOpenCategory(null);
    setPages({});
    if (restoreFocus && category) {
      requestAnimationFrame(() => triggerRefs.current[category]?.focus({ preventScroll: true }));
    }
  }, [clearIdleTimer]);

  const noteSettingsActivity = useCallback((): void => {
    if (!openCategoryRef.current) return;
    scheduleIdleReset();
  }, [scheduleIdleReset]);

  useEffect(() => {
    hideCategory(false);
  }, [hideCategory, location.pathname]);

  useEffect(() => {
    if (!openCategory) {
      clearIdleTimer();
      return undefined;
    }
    scheduleIdleReset();
    return clearIdleTimer;
  }, [clearIdleTimer, openCategory, scheduleIdleReset]);

  useEffect(() => () => clearIdleTimer(), [clearIdleTimer]);

  useEffect(() => {
    if (openCategory && !phone && (pages[openCategory] ?? 0) !== 0) {
      setPages((current) => ({ ...current, [openCategory]: 0 }));
    }
  }, [openCategory, pages, phone]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!openCategoryRef.current) return;
      if (event.key === 'Escape' && rootRef.current?.contains(event.target as Node)) {
        event.preventDefault();
        hideCategory(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hideCategory]);

  useEffect(() => {
    if (!openCategory) return undefined;
    const releasePointer = () => {
      pointerDownRef.current = false;
      protectedRef.current = false;
      scheduleIdleReset();
    };
    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('pointercancel', releasePointer);
    return () => {
      window.removeEventListener('pointerup', releasePointer);
      window.removeEventListener('pointercancel', releasePointer);
    };
  }, [openCategory, scheduleIdleReset]);

  useEffect(() => {
    if (!openCategory) return undefined;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearIdleTimer();
        return;
      }
      if (!(document.activeElement instanceof Node && contentRef.current?.contains(document.activeElement))) {
        protectedRef.current = false;
      }
      scheduleIdleReset();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [clearIdleTimer, openCategory, scheduleIdleReset]);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    pointerDownRef.current = true;
    if (event.target instanceof Node && contentRef.current?.contains(event.target)) {
      protectedRef.current = true;
      clearIdleTimer();
    }
  }

  function handlePointerUp(): void {
    pointerDownRef.current = false;
    protectedRef.current = false;
    scheduleIdleReset();
  }

  function handleFocusIn(event: FocusEvent<HTMLDivElement>): void {
    if (event.target instanceof Node && contentRef.current?.contains(event.target) && !pointerDownRef.current) {
      protectedRef.current = true;
      clearIdleTimer();
    }
  }

  function handleFocusOut(event: FocusEvent<HTMLDivElement>): void {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !contentRef.current?.contains(next)) {
      protectedRef.current = false;
      scheduleIdleReset();
    }
  }

  function handlePanelActivity(event: SyntheticEvent<HTMLDivElement>): void {
    if (event.target instanceof Node && contentRef.current?.contains(event.target)) noteSettingsActivity();
  }

  function handleCompositionStart(event: CompositionEvent<HTMLDivElement>): void {
    if (event.target instanceof Node && contentRef.current?.contains(event.target)) {
      protectedRef.current = true;
      clearIdleTimer();
    }
  }

  function handleCompositionEnd(event: CompositionEvent<HTMLDivElement>): void {
    if (event.target instanceof Node && contentRef.current?.contains(event.target)) {
      protectedRef.current = false;
      scheduleIdleReset();
    }
  }

  function toggleCategory(category: SettingsCategory): void {
    if (openCategory === category) {
      hideCategory(true);
      return;
    }
    clearIdleTimer();
    protectedRef.current = false;
    openCategoryRef.current = category;
    setOpenCategory(category);
    setPages({ [category]: 0 });
  }

  function setPage(next: number): void {
    if (!openCategory) return;
    setPages((current) => ({ ...current, [openCategory]: next }));
    noteSettingsActivity();
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

  const content = (
    <div
      ref={rootRef}
      className={`header-settings${openCategory ? ' header-settings--open' : ''}`}
      data-open={openCategory ? 'true' : undefined}
      onPointerDownCapture={handlePointerDown}
      onPointerUpCapture={handlePointerUp}
      onFocusCapture={handleFocusIn}
      onBlurCapture={handleFocusOut}
      onClick={handlePanelActivity}
      onInput={handlePanelActivity}
      onChange={handlePanelActivity}
      onKeyDown={handlePanelActivity}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
    >
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
        <div ref={contentRef} className="header-settings__content" id={panelId} role="region" aria-label={`${activeLabel} settings`}>
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
      {!openCategory && <div className="header-settings__default" role="region" aria-label="Practice controls">{defaultContent}</div>}
    </div>
  );

  return navSlot ? createPortal(content, navSlot) : content;
}
