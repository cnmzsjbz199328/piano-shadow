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
import { useAppStore, _getEnginesForTests } from './useAppStore';
import { evaluatePerformance } from '@/practice-engine';
import { buildPerformance, inferHands } from '@/music-model';

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
