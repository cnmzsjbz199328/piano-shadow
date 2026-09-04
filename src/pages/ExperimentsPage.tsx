import { useState } from 'react';
import { WebMidiAdapter } from '@/device-adapters';

interface AudioCapabilities {
  sampleRate: number;
  state: string;
  baseLatency?: number;
}

export function ExperimentsPage() {
  const [audio, setAudio] = useState<AudioCapabilities | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  function checkAudio() {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error('Web Audio API is not available in this browser.');
      const ctx = new Ctor();
      setAudio({ sampleRate: ctx.sampleRate, state: ctx.state, baseLatency: ctx.baseLatency });
      void ctx.close();
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : 'Could not create an AudioContext.');
    }
  }

  return (
    <div>
      <header className="page-header">
        <div className="page-header__eyebrow">Experiments</div>
        <h1>Capabilities &amp; roadmap</h1>
        <p>Live diagnostics for this browser, and what comes after v0.1.</p>
      </header>

      <div className="panel">
        <h2>Browser capabilities</h2>
        <div className="capability-list">
          <div className="capability-row">
            <span>Web MIDI API</span>
            <strong>{WebMidiAdapter.isSupported() ? 'Supported' : 'Not supported'}</strong>
          </div>
          <div className="capability-row">
            <span>Web Audio API</span>
            <button type="button" className="btn" onClick={checkAudio}>
              Check
            </button>
          </div>
          {audio && (
            <div className="capability-row">
              <span>Sample rate / latency</span>
              <strong>
                {audio.sampleRate} Hz{audio.baseLatency !== undefined ? ` · ${(audio.baseLatency * 1000).toFixed(1)}ms base latency` : ''}
              </strong>
            </div>
          )}
          {audioError && <p style={{ color: 'var(--wrong)' }}>{audioError}</p>}
        </div>
      </div>

      <div className="panel">
        <h2>Microphone recognition (v0.2 — not part of this MVP)</h2>
        <p>
          Microphone pitch recognition is intentionally out of scope for v0.1 (spec §15). The practice engine only ever
          consumes canonical <code>NoteEvent[]</code>, so a future microphone adapter plugs in without any change to
          matching or scoring. The reserved interface:
        </p>
        <pre style={{ background: 'var(--bg-elevated-2)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', overflowX: 'auto', fontSize: '0.8rem' }}>
{`interface NoteRecognizer {
  initialize(): Promise<void>;
  process(audio: Float32Array, sampleRate: number): Promise<DetectedNote[]>;
}`}
        </pre>
        <p>
          v0.2 ("Microphone Lab") will benchmark candidate recognizers (Pitchy, Basic Pitch, Transkun) against MIDI
          ground truth for latency and accuracy before anything is wired into the stable practice path.
        </p>
      </div>

      <div className="panel">
        <h2>Known limitations (v0.1)</h2>
        <ul>
          <li>The metronome and count-in follow the reference file's first tempo marking only — a mid-piece tempo change is not yet reflected in the click grid.</li>
          <li>Wait Mode resumes on a monophonic or simultaneous-onset chord match; it does not yet require a specific voicing order within a chord.</li>
          <li>No microphone input, teacher-recording transcription, or ESP32 adapter — reserved by the adapter interfaces, not implemented.</li>
        </ul>
      </div>
    </div>
  );
}
