import { useAppStore, type PracticeSurface } from '@/stores/useAppStore';

function formatTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  return `${Math.floor(clamped / 60)}:${Math.floor(clamped % 60).toString().padStart(2, '0')}`;
}

interface TransportControlsProps {
  /** Which workspace face is currently shown. */
  surface: PracticeSurface;
  /** Request a flip to the other face (ignored by the caller while one is running). */
  onSurfaceChange: (surface: PracticeSurface) => void;
  /** Lock the switch while a flip is in flight (UI_OPTIMIZATION_PLAN.md §5.2). */
  surfaceSwitchDisabled?: boolean;
}

export function TransportControls({ surface, onSurfaceChange, surfaceSwitchDisabled = false }: TransportControlsProps) {
  const song = useAppStore((s) => s.song);
  const transportState = useAppStore((s) => s.transportState);
  const currentTime = useAppStore((s) => s.currentTime);
  const duration = useAppStore((s) => s.duration);
  const isAttemptRunning = useAppStore((s) => s.isAttemptRunning);
  const waitingForMidi = useAppStore((s) => s.waitingForMidi);
  const play = useAppStore((s) => s.play);
  const pause = useAppStore((s) => s.pause);
  const stop = useAppStore((s) => s.stop);
  const restart = useAppStore((s) => s.restart);
  const seek = useAppStore((s) => s.seek);
  const startAttempt = useAppStore((s) => s.startAttempt);
  const finishAttempt = useAppStore((s) => s.finishAttempt);

  const playing = transportState === 'playing' || transportState === 'counting-in';
  const recognitionActive = useAppStore((s) => s.recognitionState === 'initializing' || s.recognitionState === 'listening');
  const disabled = !song;
  return (
    <div className="song-transport">
      <div className="practice-header">
        <div className="practice-header__id">
          <h2 className="practice-header__title" title={song?.name}>{song?.name ?? 'No reference loaded'}</h2>
        </div>
        <div className="practice-header__transport">
          <button type="button" className="btn btn--primary" disabled={disabled || recognitionActive} onClick={() => (playing ? pause() : void play())}>
            <span aria-hidden>{playing ? 'Ⅱ' : '▶'}</span> {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="btn btn--quiet btn--sm" disabled={disabled} onClick={stop}>Stop</button>
          <button type="button" className="btn btn--icon" aria-label="Restart from the beginning" disabled={disabled || recognitionActive} onClick={restart}>↶</button>
        </div>
        <div className="surface-switch mode-tabs" role="group" aria-label="Practice workspace surface">
          <button
            type="button"
            aria-pressed={surface === 'score'}
            aria-label="Show the score"
            disabled={disabled || surfaceSwitchDisabled}
            onClick={() => onSurfaceChange('score')}
          >
            Score
          </button>
          <button
            type="button"
            aria-pressed={surface === 'library'}
            aria-label="Open the song library"
            disabled={surfaceSwitchDisabled}
            onClick={() => onSurfaceChange('library')}
          >
            Library
          </button>
        </div>
      </div>

      {song && (
        <>
          <div className="practice-subrow">
            <span className="transport__time">{formatTime(currentTime)} / {formatTime(duration)}</span>
            <input className="practice-subrow__seek" type="range" min={0} max={Math.max(duration, 0.01)} step={0.01} value={Math.min(currentTime, duration)} disabled={disabled} onChange={(e) => seek(Number(e.target.value))} aria-label="Seek" />
            <span className="practice-subrow__attempt">
              {!isAttemptRunning ? (
                <button type="button" className="btn btn--primary btn--sm" disabled={recognitionActive} onClick={startAttempt}>Start practice</button>
              ) : (
                <button type="button" className="btn btn--danger btn--sm" onClick={() => void finishAttempt()}>Finish practice</button>
              )}
              {isAttemptRunning && <span className="badge badge--ok badge--dot">Recording</span>}
            </span>
          </div>

          {transportState === 'counting-in' && <span className="count-in-banner">Count-in…</span>}
          {waitingForMidi && <div className="wait-banner" role="status">Play {waitingForMidi.length > 1 ? 'these notes' : 'this note'} to continue…</div>}
        </>
      )}
    </div>
  );
}
