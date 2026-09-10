import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Wave 2 / Track B: every audible-input path in the store funnels note-on /
 * note-off through the shared `audio-engine` instrument, gated by `soundEnabled`.
 * The audio-engine module is mocked so nothing touches Web Audio here.
 *
 * Wave 3 / Track E appends the per-hand practice case at the bottom; it wraps
 * `evaluatePerformance` in a spy (real implementation) so it can assert which
 * reference notes the store passed in.
 */

const audio = vi.hoisted(() => ({
  attack: vi.fn(),
  release: vi.fn(),
  releaseAll: vi.fn(),
  prepare: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('@/audio-engine', () => ({ instrument: audio, SampledInstrument: class {} }));

vi.mock('@/practice-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof PracticeEngineModule>();
  return { ...actual, evaluatePerformance: vi.fn(actual.evaluatePerformance) };
});

import type * as PracticeEngineModule from '@/practice-engine';
import { useAppStore, _getEnginesForTests, _getRecognitionForTests } from './useAppStore';
import { PerformanceRecorder } from '@/device-adapters';
import { evaluatePerformance } from '@/practice-engine';
import { buildPerformance, inferHands } from '@/music-model';

beforeEach(() => {
  _getEnginesForTests().keyboardAdapter.releaseAll();
  vi.clearAllMocks();
  useAppStore.setState({ soundEnabled: true, recognitionState: 'idle', recognitionSource: null, recognitionNotes: [], recognitionActiveMidi: [], recognitionElapsed: 0, isAttemptRunning: false });
});

describe('useAppStore — audible input wiring', () => {
  it('pressing a virtual key sounds the note through the instrument', () => {
    useAppStore.getState().pressVirtualKey(60, 100);
    expect(audio.attack).toHaveBeenCalledWith(60, 100);
    expect(audio.attack).toHaveBeenCalledTimes(1);
  });

  it('releasing a virtual key releases the note through the instrument', () => {
    useAppStore.getState().pressVirtualKey(60, 100);
    audio.release.mockClear();
    useAppStore.getState().releaseVirtualKey(60);
    expect(audio.release).toHaveBeenCalledWith(60);
  });

  it('does not attack when soundEnabled is false, but still forwards note-off', () => {
    useAppStore.getState().setSoundEnabled(false);
    audio.attack.mockClear();
    audio.release.mockClear();

    useAppStore.getState().pressVirtualKey(64, 90);
    useAppStore.getState().releaseVirtualKey(64);

    expect(audio.attack).not.toHaveBeenCalled();
    expect(audio.release).toHaveBeenCalledWith(64);
  });

  it('turning sound off silences anything currently ringing', () => {
    useAppStore.getState().pressVirtualKey(67, 100);
    useAppStore.getState().setSoundEnabled(false);
    expect(audio.releaseAll).toHaveBeenCalledTimes(1);
  });

  it('recognition note events record and highlight without producing audio', () => {
    useAppStore.setState({ recognitionState: 'listening', recognitionSource: 'microphone' });
    const recognition = _getRecognitionForTests();

    recognition.noteStartedForRecognition(60, 100, 'microphone', 0.25);
    recognition.noteEndedForRecognition(60, 0.5);

    expect(useAppStore.getState().recognitionNotes).toHaveLength(1);
    expect(useAppStore.getState().recognitionActiveMidi).toEqual([]);
    expect(audio.attack).not.toHaveBeenCalled();
    expect(audio.release).not.toHaveBeenCalled();
  });

  it('routes MIDI recognition through the shared input listener exactly once', () => {
    useAppStore.setState({ recognitionState: 'listening', recognitionSource: 'midi' });

    useAppStore.getState().pressVirtualKey(60, 100);
    useAppStore.getState().releaseVirtualKey(60);

    expect(audio.attack).toHaveBeenCalledTimes(1);
    expect(audio.release).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().recognitionNotes).toHaveLength(1);
  });

  it('timestamps MIDI-recognised notes on the advancing recognition clock, not the stopped playback clock', async () => {
    // Regression: routing MIDI recognition through the shared keyboard/MIDI
    // adapters must NOT inherit their learner-clock timestamp. Playback is
    // stopped during recognition, so that clock is pinned near 0 — every
    // recognised note would collapse onto the same onset.
    useAppStore.setState({ recognitionState: 'listening', recognitionSource: 'midi' });

    useAppStore.getState().pressVirtualKey(60, 100);
    useAppStore.getState().releaseVirtualKey(60);
    await new Promise((resolve) => setTimeout(resolve, 40));
    useAppStore.getState().pressVirtualKey(62, 100);
    useAppStore.getState().releaseVirtualKey(62);

    const notes = useAppStore.getState().recognitionNotes;
    expect(notes).toHaveLength(2);
    // A later press in the same session has a later onset — under the bug both
    // read back as the same near-zero playback time.
    expect(notes[1]!.startTime).toBeGreaterThan(notes[0]!.startTime + 0.01);
  });
});

describe('useAppStore — recognition/playback exclusion', () => {
  it('stops reference playback and blocks play, restart, and practice while listening', async () => {
    const { engine } = _getEnginesForTests();
    const stopSpy = vi.spyOn(engine, 'stop').mockImplementation(() => {});
    const playSpy = vi.spyOn(engine, 'play').mockResolvedValue();
    const restartSpy = vi.spyOn(engine, 'restart');
    const song = buildPerformance([{ midi: 60, startTime: 0, duration: 0.5 }], { name: 'listen-ref', source: 'midi-file' });
    useAppStore.setState({ song, mode: 'play-along', recognitionState: 'idle' });

    const start = useAppStore.getState().startRecognition('midi');
    await start;
    expect(useAppStore.getState().recognitionState).toBe('listening');
    expect(stopSpy).toHaveBeenCalled();

    await useAppStore.getState().play();
    useAppStore.getState().restart();
    useAppStore.getState().startAttempt();

    expect(playSpy).not.toHaveBeenCalled();
    expect(restartSpy).not.toHaveBeenCalled();
    expect(useAppStore.getState().isAttemptRunning).toBe(false);

    await useAppStore.getState().stopRecognition();
    stopSpy.mockRestore();
    playSpy.mockRestore();
    restartSpy.mockRestore();
  });
});

describe('useAppStore — per-hand practice (Track E)', () => {
  beforeEach(() => {
    useAppStore.setState({ song: null, practiceVoice: 'both', isAttemptRunning: false, mode: 'play-along' });
  });

  it('setPracticeVoice("left") makes a scored attempt evaluate only the left-hand reference', async () => {
    // Tone's transport is a stub under jsdom, so `engine.load` (called by
    // setPracticeVoice) can't touch the real transport — no-op it and assert the
    // filtered song it receives instead.
    const { engine } = _getEnginesForTests();
    const loadSpy = vi.spyOn(engine, 'load').mockImplementation(() => {});

    const song = buildPerformance(
      [
        { midi: 48, startTime: 0, duration: 0.4 }, // C3 → left
        { midi: 50, startTime: 1.0, duration: 0.4 }, // D3 → left
        { midi: 72, startTime: 0.5, duration: 0.4 }, // C5 → right
        { midi: 74, startTime: 1.5, duration: 0.4 }, // D5 → right
      ],
      { name: 'Two hands', source: 'midi-file', idPrefix: 'ref' },
    );
    song.notes = inferHands(song.notes);
    expect(new Set(song.notes.map((n) => n.hand))).toEqual(new Set(['left', 'right']));

    useAppStore.setState({ song });
    useAppStore.getState().setPracticeVoice('left');
    expect(useAppStore.getState().practiceVoice).toBe('left');

    // setPracticeVoice re-loads the engine with only the chosen hand's notes.
    const reloaded = loadSpy.mock.calls.at(-1)![0];
    expect(reloaded.notes.map((n) => n.midi)).toEqual([48, 50]);

    useAppStore.getState().startAttempt();
    await useAppStore.getState().finishAttempt(2);

    const referenceArg = vi.mocked(evaluatePerformance).mock.calls.at(-1)![0];
    expect(referenceArg.map((n) => n.midi)).toEqual([48, 50]);
    expect(referenceArg.every((n) => n.hand === 'left')).toBe(true);

    loadSpy.mockRestore();
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
