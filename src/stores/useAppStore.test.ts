import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Wave 2 / Track B: every audible-input path in the store funnels note-on /
 * note-off through the shared `audio-engine` instrument, gated by `soundEnabled`.
 * The audio-engine module is mocked so nothing touches Web Audio here.
 */

const audio = vi.hoisted(() => ({
  attack: vi.fn(),
  release: vi.fn(),
  releaseAll: vi.fn(),
  prepare: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('@/audio-engine', () => ({ instrument: audio, SampledInstrument: class {} }));

import { useAppStore, _getEnginesForTests } from './useAppStore';
import { PerformanceRecorder } from '@/device-adapters';
import { evaluatePerformance } from '@/practice-engine';
import { buildPerformance } from '@/music-model';

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ soundEnabled: true });
});

describe('useAppStore — audible input wiring', () => {
  it('pressing a virtual key sounds the note through the instrument', () => {
    useAppStore.getState().pressVirtualKey(60, 100);
    expect(audio.attack).toHaveBeenCalledWith(60, 100);
  });

  it('releasing a virtual key releases the note through the instrument', () => {
    useAppStore.getState().pressVirtualKey(60, 100);
    audio.release.mockClear();
    useAppStore.getState().releaseVirtualKey(60);
    expect(audio.release).toHaveBeenCalledWith(60);
  });

  it('does not call attack/release when soundEnabled is false', () => {
    useAppStore.getState().setSoundEnabled(false);
    audio.attack.mockClear();
    audio.release.mockClear();

    useAppStore.getState().pressVirtualKey(64, 90);
    useAppStore.getState().releaseVirtualKey(64);

    expect(audio.attack).not.toHaveBeenCalled();
    expect(audio.release).not.toHaveBeenCalled();
  });

  it('turning sound off silences anything currently ringing', () => {
    useAppStore.getState().pressVirtualKey(67, 100);
    useAppStore.getState().setSoundEnabled(false);
    expect(audio.releaseAll).toHaveBeenCalledTimes(1);
  });
});

/**
 * Wave 3 / Track G2: `inputLatencyMs` is applied once, at the shared learner
 * clock the input adapters timestamp against. A learner who plays a uniform
 * amount late should score on-time on the Timing dimension once the offset
 * matches that lateness — and measurably worse with no offset. The adapter
 * clock is the boundary under test; `evaluatePerformance` / `SequenceAligner`
 * stay pure and are not touched.
 */
describe('useAppStore — input-latency compensation (Track G2)', () => {
  const reference = buildPerformance(
    [
      { midi: 60, startTime: 0.5, duration: 0.4 },
      { midi: 62, startTime: 1.0, duration: 0.4 },
      { midi: 64, startTime: 1.5, duration: 0.4 },
      { midi: 65, startTime: 2.0, duration: 0.4 },
    ],
    { name: 'latency-ref', source: 'midi-file' },
  );

  const LATE_BY = 0.08; // the learner plays a uniform 80 ms late

  /** Record an attempt where every learner onset lands `LATE_BY` after the
   *  reference, reading the learner clock through the real keyboard adapter. */
  function scoreUniformlyLateAttempt(): ReturnType<typeof evaluatePerformance> {
    const { engine, keyboardAdapter } = _getEnginesForTests();
    const clock = vi.spyOn(engine, 'getCurrentTime');
    keyboardAdapter.releaseAll();
    const recorder = new PerformanceRecorder('virtual-keyboard');
    recorder.attach(keyboardAdapter);
    recorder.start();
    for (const note of reference.notes) {
      clock.mockReturnValue(note.startTime + LATE_BY);
      keyboardAdapter.press(note.midi, 100);
      clock.mockReturnValue(note.startTime + LATE_BY + note.duration);
      keyboardAdapter.release(note.midi);
    }
    const learner = recorder.stop(reference.duration + LATE_BY, 'latency attempt');
    recorder.dispose();
    clock.mockRestore();
    return evaluatePerformance(reference.notes, learner.notes);
  }

  it('compensating the shift restores an on-time Timing score', () => {
    useAppStore.getState().setInputLatencyMs(0);
    const uncompensated = scoreUniformlyLateAttempt();

    useAppStore.getState().setInputLatencyMs(80);
    const compensated = scoreUniformlyLateAttempt();

    expect(useAppStore.getState().inputLatencyMs).toBe(80);
    expect(compensated.scores.timing).toBeGreaterThan(uncompensated.scores.timing);
    expect(compensated.scores.timing).toBeGreaterThanOrEqual(99); // ~perfectly on time
    expect(uncompensated.scores.timing).toBeLessThan(95); // 80 ms late is measurably worse
  });

  it('clamps the offset to a sane range', () => {
    useAppStore.getState().setInputLatencyMs(9999);
    expect(useAppStore.getState().inputLatencyMs).toBe(500);
    useAppStore.getState().setInputLatencyMs(-9999);
    expect(useAppStore.getState().inputLatencyMs).toBe(-200);
    useAppStore.getState().setInputLatencyMs(Number.NaN);
    expect(useAppStore.getState().inputLatencyMs).toBe(0);
  });
});
