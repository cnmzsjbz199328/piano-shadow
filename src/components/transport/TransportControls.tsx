import { useAppStore, type PracticeMode } from '@/stores/useAppStore';
import { MIN_TEMPO_SCALE, MAX_TEMPO_SCALE } from '@/playback-engine';

const MODES: Array<{ id: PracticeMode; label: string }> = [
  { id: 'listen', label: 'Listen' },
  { id: 'play-along', label: 'Play Along' },
  { id: 'wait', label: 'Wait Mode' },
];

function formatTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const m = Math.floor(clamped / 60);
  const s = Math.floor(clamped % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function TransportControls() {
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
  const song = useAppStore((s) => s.song);

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

  return (
    <div className="transport panel">
      <div className="mode-tabs" role="tablist" aria-label="Practice mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-pressed={mode === m.id}
            disabled={disabled || isAttemptRunning}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {waitingForMidi && (
        <div className="wait-banner" role="status">
          Play {waitingForMidi.length > 1 ? 'these notes' : 'this note'} to continue…
        </div>
      )}

      <div className="transport__row">
        <button type="button" className="btn btn--primary" disabled={disabled} onClick={() => (isPlaying ? pause() : void play())}>
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <button type="button" className="btn" disabled={disabled} onClick={stop}>
          ⏹ Stop
        </button>
        <button type="button" className="btn" disabled={disabled} onClick={restart}>
          ⟲ Restart
        </button>
        <input
          className="transport__seek"
          type="range"
          min={0}
          max={Math.max(duration, 0.01)}
          step={0.01}
          value={Math.min(currentTime, duration)}
          disabled={disabled}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek"
        />
        <span className="transport__time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      <div className="transport__row">
        <label className="field" style={{ minWidth: 160 }}>
          Tempo {Math.round(tempoScale * 100)}%
          <input
            type="range"
            min={MIN_TEMPO_SCALE}
            max={MAX_TEMPO_SCALE}
            step={0.05}
            value={tempoScale}
            onChange={(e) => setTempoScale(Number(e.target.value))}
            aria-label="Playback speed"
          />
        </label>
        <label className="toggle">
          <input type="checkbox" checked={metronomeEnabled} onChange={(e) => setMetronomeEnabled(e.target.checked)} />
          Metronome
        </label>
        <label className="toggle">
          <input type="checkbox" checked={countInEnabled} onChange={(e) => setCountInEnabled(e.target.checked)} />
          Count-in
        </label>
      </div>

      {mode !== 'listen' && (
        <div className="transport__row">
          {!isAttemptRunning ? (
            <button type="button" className="btn btn--primary" disabled={disabled} onClick={startAttempt}>
              ● Start Attempt
            </button>
          ) : (
            <button type="button" className="btn btn--danger" onClick={() => void finishAttempt()}>
              ■ Finish Attempt
            </button>
          )}
          {isAttemptRunning && <span className="badge badge--ok badge--dot">Recording</span>}
        </div>
      )}
    </div>
  );
}
