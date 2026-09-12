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
  /** Lock the switch while a flip is in flight (UI_OPTIMIZATION_PLAN.md section 5.2). */
  surfaceSwitchDisabled?: boolean;
}

export function TransportControls({ surface, onSurfaceChange, surfaceSwitchDisabled = false }: TransportControlsProps) {
  const song = useAppStore((s) => s.song);
  const transportState = useAppStore((s) => s.transportState);
  const currentTime = useAppStore((s) => s.currentTime);
  const duration = useAppStore((s) => s.duration);
  const tempoScale = useAppStore((s) => s.tempoScale);
  const waitingForMidi = useAppStore((s) => s.waitingForMidi);
  const play = useAppStore((s) => s.play);
  const pause = useAppStore((s) => s.pause);
  const seek = useAppStore((s) => s.seek);
  const setTempoScale = useAppStore((s) => s.setTempoScale);

  const playing = transportState === 'playing' || transportState === 'counting-in';
  const recognitionActive = useAppStore((s) => s.recognitionState === 'initializing' || s.recognitionState === 'listening');
  const disabled = !song;
  const displayTempo = Math.min(1, Math.max(0.1, Math.round(tempoScale * 10) / 10));

  function increaseTempo(): void {
    const next = displayTempo >= 1 ? 0.1 : Math.min(1, displayTempo + 0.1);
    setTempoScale(Number(next.toFixed(1)));
  }

  // File imports already strip the extension, but saved records from older
  // versions may still contain it. Keep the transport title clean in either case.
  const displayName = song?.name?.replace(/\.(mid|midi)$/i, '') || song?.name;

  return (
    <div className="song-transport">
      <div className="practice-header">
        <div className="practice-header__id">
          <h2 className="practice-header__title" title={displayName}>{displayName ?? 'No reference loaded'}</h2>
        </div>

        {song && (
          <input
            className="practice-header__seek"
            type="range"
            min={0}
            max={Math.max(duration, 0.01)}
            step={0.01}
            value={Math.min(currentTime, duration)}
            disabled={disabled}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Seek"
          />
        )}
        {song && <span className="transport__time">{formatTime(currentTime)} / {formatTime(duration)}</span>}

        <div className="practice-header__transport">
          <button type="button" className="btn btn--primary" disabled={disabled || recognitionActive} onClick={() => (playing ? pause() : void play())}>
            <span aria-hidden>{playing ? '\u23f8' : '\u25b6'}</span> {playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            className="btn btn--quiet btn--sm practice-speed"
            aria-label={`Speed is ${displayTempo.toFixed(1)}. Tap to increase.`}
            title="Click to increase playback speed"
            disabled={disabled}
            onClick={increaseTempo}
          >
            {displayTempo.toFixed(1)}x
          </button>
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

      {song && transportState === 'counting-in' && <span className="count-in-banner">Count-in...</span>}
      {song && waitingForMidi && <div className="wait-banner" role="status">Play {waitingForMidi.length > 1 ? 'these notes' : 'this note'} to continue...</div>}
    </div>
  );
}
