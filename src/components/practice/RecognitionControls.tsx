import { midiToNoteName } from '@/music-model';
import { useAppStore, type RecognitionState } from '@/stores/useAppStore';

/**
 * Microphone recognition is wired into the practice path ahead of the live
 * real-piano validation gate (PIANO_SHADOW_GOAL.md §36, ROUND_3_REQUIREMENTS
 * §D.1). Until that session runs, every microphone surface must say so
 * plainly (spec §25 — never present unmeasured recognition as working).
 */
const EXPERIMENTAL_NOTE =
  'Experimental — single-note (monophonic) recognition via Pitchy. ' +
  'Real-piano pitch accuracy and onset latency have not been measured yet; ' +
  'chords and polyphonic passages need MIDI or MIDI import. ' +
  'See “Recognition diagnostics” in Settings.';

function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${Math.floor(safe % 60).toString().padStart(2, '0')}`;
}

function statusCopy(state: RecognitionState): string {
  if (state === 'initializing') return 'Preparing microphone…';
  if (state === 'listening') return 'Listening… play a clear single-note melody';
  if (state === 'stopped') return 'Recognition stopped';
  if (state === 'error') return 'Recognition could not continue';
  return 'Ready to listen';
}

export function RecognitionControls() {
  const state = useAppStore((s) => s.recognitionState);
  const source = useAppStore((s) => s.recognitionSource);
  const notes = useAppStore((s) => s.recognitionNotes);
  const elapsed = useAppStore((s) => s.recognitionElapsed);
  const level = useAppStore((s) => s.recognitionLevel);
  const error = useAppStore((s) => s.recognitionError);
  const start = useAppStore((s) => s.startRecognition);
  const stop = useAppStore((s) => s.stopRecognition);
  const retry = useAppStore((s) => s.retryRecognition);

  const listening = state === 'listening' || state === 'initializing';
  const recentNotes = notes.slice(-12);
  const levelPct = Math.min(100, Math.round(level * 260));

  return (
    <section className={`recognition-panel${listening ? ' recognition-panel--active' : ''}`} aria-labelledby="recognition-title">
      <div className="recognition-panel__topline">
        <div>
          <span className="section-heading__eyebrow">Single-page recognition</span>
          <h1 id="recognition-title">Listen to my playing</h1>
          <p className="recognition-panel__status" role="status">{statusCopy(state)}</p>
        </div>
        <div className="recognition-panel__actions">
          {!listening && state !== 'error' && (
            <button type="button" className="btn btn--primary btn--listen" onClick={() => void start('microphone')}>
              <span className="record-dot" aria-hidden /> Listen
            </button>
          )}
          {listening && (
            <button type="button" className="btn btn--danger btn--listen" onClick={() => void stop()}>
              <span className="record-dot" aria-hidden /> Stop
            </button>
          )}
          {state === 'error' && (
            <>
              <button type="button" className="btn btn--primary" onClick={() => void retry()}>Try again</button>
              <button type="button" className="btn" onClick={() => void start('midi')}>Use MIDI instead</button>
            </>
          )}
        </div>
      </div>

      <p className="recognition-panel__experimental" role="note">{EXPERIMENTAL_NOTE}</p>

      {source === 'microphone' && (listening || state === 'error') && (
        <div className="recognition-meter-row">
          <span>Microphone level</span>
          <div className="recognition-meter" role="meter" aria-label="Microphone level" aria-valuenow={levelPct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${levelPct}%` }} />
          </div>
          <span className="recognition-time">{formatTime(elapsed)}</span>
        </div>
      )}

      {error && (
        <div className="recognition-error" role="alert">
          <strong>{error}</strong>
          <span>Microphone input supports single-note melodies in this version.</span>
        </div>
      )}

      {(listening || recentNotes.length > 0) && (
        <div className="recognition-events" aria-label="Recognition timeline">
          {recentNotes.length === 0 ? <span className="recognition-events__empty">Waiting for the first note…</span> : recentNotes.map((note) => (
            <span className="recognition-event" key={note.id}>
              <b>{midiToNoteName(note.midi)}</b><small>{formatTime(note.startTime)}</small>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
