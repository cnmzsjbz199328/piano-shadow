import { useAppStore, type PracticeMode } from '@/stores/useAppStore';
import { MIN_TEMPO_SCALE, MAX_TEMPO_SCALE } from '@/playback-engine';

/**
 * The Practice workspace header + slim control sub-row
 * (ROUND_3_REQUIREMENTS §C.2.3): song name (left) · mode selector (centre) ·
 * compact transport (right), then a quiet sub-row for the seek bar, tempo
 * options, and the attempt recorder. All transport / mode / attempt state
 * lives here; `PracticePage` just drops this at the top of the workspace.
 */

const MODES: Array<{ id: PracticeMode; label: string }> = [
  { id: 'listen', label: 'Listen' },
  { id: 'play-along', label: 'Play Along' },
  { id: 'wait', label: 'Wait' },
];

const TEMPO_STEP = 0.05;

function formatTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const m = Math.floor(clamped / 60);
  const s = Math.floor(clamped % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function TransportControls() {
  const song = useAppStore((s) => s.song);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const transportState = useAppStore((s) => s.transportState);
  const currentTime = useAppStore((s) => s.currentTime);
  const duration = useAppStore((s) => s.duration);
  const tempoScale = useAppStore((s) => s.tempoScale);
  const metronomeEnabled = useAppStore((s) => s.metronomeEnabled);
  const countInEnabled = useAppStore((s) => s.countInEnabled);
  const isAttemptRunning = useAppStore((s) => s.isAttemptRunning);
  const waitingForMidi = useAppStore((s) => s.waitingForMidi);

  const play = useAppStore((s) => s.play);
  const pause = useAppStore((s) => s.pause);
  const stop = useAppStore((s) => s.stop);
  const restart = useAppStore((s) => s.restart);
  const seek = useAppStore((s) => s.seek);
  const setTempoScale = useAppStore((s) => s.setTempoScale);
  const setMetronomeEnabled = useAppStore((s) => s.setMetronomeEnabled);
  const setCountInEnabled = useAppStore((s) => s.setCountInEnabled);
  const startAttempt = useAppStore((s) => s.startAttempt);
  const finishAttempt = useAppStore((s) => s.finishAttempt);

  const isPlaying = transportState === 'playing' || transportState === 'counting-in';
  const disabled = !song;
  const tempoPct = Math.round(tempoScale * 100);

  return (
    <div>
      <div className="practice-header">
        <h1 className="practice-header__title" title={song?.name}>
          {song?.name}
        </h1>

        <div className="practice-header__center">
          <div className="mode-tabs" role="tablist" aria-label="Practice mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                aria-pressed={mode === m.id}
                disabled={disabled || isAttemptRunning}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="practice-header__transport">
          <button
            type="button"
            className="btn btn--primary"
            disabled={disabled}
            onClick={() => (isPlaying ? pause() : void play())}
          >
            <span aria-hidden>{isPlaying ? '⏸' : '▶'}</span>
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <div className="transport__group">
            <button
              type="button"
              className="btn btn--icon"
              aria-label="Restart from the beginning"
              disabled={disabled}
              onClick={restart}
            >
              ⏮
            </button>
            <button
              type="button"
              className="btn btn--icon"
              aria-label="Skip to the end"
              disabled={disabled}
              onClick={() => seek(duration)}
            >
              ⏭
            </button>
          </div>
          <div className="transport__group">
            <button
              type="button"
              className="btn btn--icon"
              aria-label="Slower"
              disabled={disabled || tempoScale <= MIN_TEMPO_SCALE}
              onClick={() => setTempoScale(tempoScale - TEMPO_STEP)}
            >
              −
            </button>
            <span className="stepper">
              Tempo <span className="stepper__value">{tempoPct}%</span>
            </span>
            <button
              type="button"
              className="btn btn--icon"
              aria-label="Faster"
              disabled={disabled || tempoScale >= MAX_TEMPO_SCALE}
              onClick={() => setTempoScale(tempoScale + TEMPO_STEP)}
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="practice-subrow">
        <span className="transport__time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <input
          className="practice-subrow__seek"
          type="range"
          min={0}
          max={Math.max(duration, 0.01)}
          step={0.01}
          value={Math.min(currentTime, duration)}
          disabled={disabled}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek"
        />
        <button type="button" className="btn btn--quiet btn--sm" disabled={disabled} onClick={stop}>
          Stop
        </button>
        <label className="toggle">
          <input
            type="checkbox"
            checked={countInEnabled}
            onChange={(e) => setCountInEnabled(e.target.checked)}
          />
          Count-in
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={metronomeEnabled}
            onChange={(e) => setMetronomeEnabled(e.target.checked)}
          />
          Metronome
        </label>

        {transportState === 'counting-in' && <span className="count-in-banner">Count-in…</span>}

        {mode !== 'listen' && (
          <span className="practice-subrow__attempt">
            {!isAttemptRunning ? (
              <button type="button" className="btn btn--primary btn--sm" disabled={disabled} onClick={startAttempt}>
                ● Start Attempt
              </button>
            ) : (
              <button type="button" className="btn btn--danger btn--sm" onClick={() => void finishAttempt()}>
                ■ Finish Attempt
              </button>
            )}
            {isAttemptRunning && <span className="badge badge--ok badge--dot">Recording</span>}
          </span>
        )}
      </div>

      {waitingForMidi && (
        <div className="wait-banner" role="status">
          Play {waitingForMidi.length > 1 ? 'these notes' : 'this note'} to continue…
        </div>
      )}
    </div>
  );
}
