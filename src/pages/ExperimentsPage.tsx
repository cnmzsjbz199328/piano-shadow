import { useState } from 'react';
import { WebMidiAdapter } from '@/device-adapters';
import { useAppStore } from '@/stores/useAppStore';

interface AudioCapabilities {
  sampleRate: number;
  state: string;
  baseLatency?: number;
}

export function ExperimentsPage() {
  const [audio, setAudio] = useState<AudioCapabilities | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  const inputLatencyMs = useAppStore((s) => s.inputLatencyMs);
  const setInputLatencyMs = useAppStore((s) => s.setInputLatencyMs);
  // Local draft so the user can clear the field / type a minus sign before the
  // store clamps and persists on commit (blur or Enter).
  const [latencyDraft, setLatencyDraft] = useState<string>(String(inputLatencyMs));

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

  function commitLatency() {
    const parsed = Number(latencyDraft.trim());
    setInputLatencyMs(Number.isFinite(parsed) ? parsed : 0);
    setLatencyDraft(String(useAppStore.getState().inputLatencyMs));
  }

  return (
    <div className="page">
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
        <h2>Input latency compensation</h2>
        <div className="capability-row">
          <label htmlFor="input-latency-ms">Input latency compensation (ms)</label>
          <input
            id="input-latency-ms"
            type="number"
            inputMode="numeric"
            step={5}
            min={-200}
            max={500}
            value={latencyDraft}
            onChange={(e) => setLatencyDraft(e.target.value)}
            onBlur={commitLatency}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            style={{
              width: '6rem',
              padding: '0.35rem 0.5rem',
              background: 'var(--bg-elevated-2)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums',
            }}
          />
        </div>
        <p>
          A positive value shifts every recorded learner onset earlier before scoring, to cancel
          device / OS / audio-scan delay so an on-time performance is scored as on-time. Applied once,
          at the shared learner clock (spec §6); clamped to −200…500&nbsp;ms. Currently in effect:{' '}
          <strong>{inputLatencyMs} ms</strong>.
        </p>
        <p>
          A guided tap-to-calibrate flow (play along with the metronome, measure your own offset
          automatically) is future work — for now, set the value by hand.
        </p>
      </div>

      <div className="panel">
        <h2>Microphone recognition (v0.2 — not part of Practice)</h2>
        <p>
          Microphone pitch recognition is intentionally kept out of Practice (spec §15). The practice engine only
          ever consumes canonical <code>NoteEvent[]</code>, so a future microphone adapter plugs in without any
          change to matching or scoring. The reserved interface:
        </p>
        <pre style={{ background: 'var(--bg-elevated-2)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', overflowX: 'auto', fontSize: '0.8rem' }}>
{`interface NoteRecognizer {
  initialize(): Promise<void>;
  process(audio: Float32Array, sampleRate: number): Promise<DetectedNote[]>;
}`}
        </pre>
        <p>
          The <a href="/lab">Microphone Lab</a> benchmarks two candidate recognizers (Pitchy, Basic
          Pitch) against MIDI ground truth for latency and accuracy — see{' '}
          <code>doc/MICROPHONE_LAB_FINDINGS.md</code> for the measured numbers. Nothing there is wired into
          Practice yet; that's a decision for a future round, made only after those findings are in.
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
