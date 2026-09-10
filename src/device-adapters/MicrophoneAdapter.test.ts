import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AdapterNoteOff, AdapterNoteOn, ClockFn } from './types';

/**
 * Regression cover for Bug 2 (recognition clock unification).
 *
 * The adapter used to timestamp note *onsets* on a buffer-relative value (0..~20s,
 * saturating at the rolling-buffer cap) while note *offsets* came from
 * `this.clock()` (the store injected none, so it defaulted to the absolute
 * `performance.now()/1000` wall clock). `duration = offset - onset` then ran to
 * hundreds/thousands of seconds. The fix: every boundary — onset, silence-timeout
 * end, pitch-change end, and the end emitted by `disconnect()` — is derived from
 * the one injected session clock, and the detection-window offset is a real-time
 * span (`audioWindow.length / sampleRate`), never the buffer's sample offset.
 *
 * `@/recognition` is stubbed so a fake clock and scripted "detected notes" fully
 * determine timing; `vi.useFakeTimers()` drives the adapter's internal poll loop.
 */

interface ScriptedNote {
  midi: number;
  startTime: number;
  duration: number;
  confidence: number;
}

const ctrl = vi.hoisted(() => ({
  sampleRate: 16000,
  audio: new Float32Array(0) as Float32Array,
  notes: [] as Array<{ midi: number; startTime: number; duration: number; confidence: number }>,
}));

vi.mock('@/recognition', () => {
  class MicrophoneCaptureError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
      super(message, options);
      this.name = 'MicrophoneCaptureError';
    }
  }
  class MicrophoneCapture {
    status = 'idle';
    constructor(_options: { onLevel?: (rms: number) => void } = {}) {
      void _options;
    }
    get sampleRate(): number {
      return ctrl.sampleRate;
    }
    async start(): Promise<void> {
      this.status = 'capturing';
    }
    async stop(): Promise<void> {
      this.status = 'stopped';
    }
    getBuffer(): { audio: Float32Array; sampleRate: number } {
      return { audio: ctrl.audio, sampleRate: ctrl.sampleRate };
    }
    clearBuffer(): void {}
  }
  class PitchyRecognizer {
    async initialize(): Promise<void> {}
    async process(_audio: Float32Array, _sampleRate: number): Promise<ScriptedNote[]> {
      return ctrl.notes.map((n) => ({ ...n }));
    }
  }
  return { MicrophoneCapture, MicrophoneCaptureError, PitchyRecognizer };
});

import { MicrophoneAdapter, POLL_MS } from './MicrophoneAdapter';

const DETECTION_WINDOW_SECONDS = 0.45;

/** Samples for `seconds` of audio at the stubbed sample rate. */
function samplesFor(seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * ctrl.sampleRate));
}

/** Real-time span of the detection window the adapter will read for the current buffer. */
function windowSeconds(): number {
  const windowSamples = Math.max(2048, Math.round(DETECTION_WINDOW_SECONDS * ctrl.sampleRate));
  const windowStartSamples = Math.max(0, ctrl.audio.length - windowSamples);
  return (ctrl.audio.length - windowStartSamples) / ctrl.sampleRate;
}

describe('MicrophoneAdapter — one session clock for every note boundary', () => {
  let now = 0;
  const clock: ClockFn = () => now;
  let adapter: MicrophoneAdapter;
  let starts: AdapterNoteOn[];
  let ends: AdapterNoteOff[];

  beforeEach(() => {
    vi.useFakeTimers();
    ctrl.sampleRate = 16000;
    ctrl.audio = new Float32Array(0);
    ctrl.notes = [];
    now = 0;
    adapter = new MicrophoneAdapter({ clock });
    starts = [];
    ends = [];
    adapter.onNoteStart((n) => starts.push(n));
    adapter.onNoteEnd((n) => ends.push(n));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Advance the fake clock to `t` and let exactly one poll run to completion. */
  async function pollAt(t: number): Promise<void> {
    now = t;
    await vi.advanceTimersByTimeAsync(POLL_MS);
  }

  it('bounds the duration of a note still active when disconnect() is called', async () => {
    // The injected clock stands in for the absolute wall clock the real bug used:
    // large base value, seconds-since-page-load style.
    now = 1000;
    await adapter.connect();

    ctrl.audio = samplesFor(0.3);
    ctrl.notes = [{ midi: 60, startTime: 0.05, duration: 0.2, confidence: 0.9 }];
    await pollAt(1000.5);

    expect(starts).toHaveLength(1);
    // onset is on the injected clock, not near zero / not buffer-relative
    expect(starts[0]!.time).toBeGreaterThan(999);
    expect(starts[0]!.time).toBeLessThan(1001);

    // Session runs 30s further; the note is never released by silence.
    const sessionLength = 30;
    now = 1000 + sessionLength;
    await adapter.disconnect();

    expect(ends).toHaveLength(1);
    const duration = ends[0]!.time - starts[0]!.time;
    // ~30s (the note began a fraction before t=1000, so a touch over is fine) —
    // emphatically not the hundreds/thousands the old mismatched clocks produced.
    expect(duration).toBeGreaterThan(sessionLength - 1);
    expect(duration).toBeLessThan(sessionLength + 1);
  });

  it('gives a note followed by a silence gap a bounded, plausible duration', async () => {
    now = 500;
    await adapter.connect();

    ctrl.audio = samplesFor(0.3);
    ctrl.notes = [{ midi: 62, startTime: 0.05, duration: 0.2, confidence: 0.9 }];
    await pollAt(500.2);
    expect(starts).toHaveLength(1);

    // Silence: recognizer returns nothing; advance past SILENCE_TIMEOUT_MS (180ms).
    ctrl.notes = [];
    await pollAt(500.5);

    expect(ends).toHaveLength(1);
    const duration = ends[0]!.time - starts[0]!.time;
    expect(duration).toBeGreaterThan(0);
    expect(duration).toBeLessThan(2);
    // end time tracks the session clock at silence detection, not a second clock
    expect(ends[0]!.time).toBeCloseTo(500.5, 6);
  });

  it('keeps onsets monotonic and clock-aligned past the ~20s rolling-buffer horizon', async () => {
    now = 0;
    await adapter.connect();

    // Rolling buffer pinned at its 20s cap for the whole session — this is exactly
    // where the old buffer-relative anchor saturated and every onset collapsed to
    // the same ~19.5s value.
    ctrl.audio = samplesFor(20);
    const span = windowSeconds(); // 0.45 at the cap
    const noteOffset = 0.1;

    const clockTimes = [3, 9, 16, 24, 29];
    const pitches = [60, 62, 64, 65, 67];
    for (let i = 0; i < clockTimes.length; i++) {
      ctrl.notes = [{ midi: pitches[i]!, startTime: noteOffset, duration: 0.2, confidence: 0.9 }];
      await pollAt(clockTimes[i]!);
    }

    expect(starts.map((s) => s.midi)).toEqual(pitches);

    const onsets = starts.map((s) => s.time);
    for (let i = 1; i < onsets.length; i++) {
      expect(onsets[i]!).toBeGreaterThan(onsets[i - 1]!);
    }
    onsets.forEach((t, i) => {
      expect(t).toBeCloseTo(clockTimes[i]! - span + noteOffset, 6);
    });
    // The late onsets are the real session time, not clamped near the 20s cap.
    expect(onsets.at(-1)!).toBeGreaterThan(25);
  });
});
