import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPerformance } from '@/music-model';

const mocks = vi.hoisted(() => ({
  transport: {
    seconds: 0,
    stop: vi.fn(),
    pause: vi.fn(),
    start: vi.fn(),
    clear: vi.fn(),
    scheduleOnce: vi.fn(() => 1),
    scheduleRepeat: vi.fn(() => 2),
  },
  Synth: vi.fn(() => ({
    toDestination() { return this; },
    volume: { value: 0 },
    triggerAttackRelease: vi.fn(),
    dispose: vi.fn(),
  })),
  attack: vi.fn(),
  releaseReferenceVoices: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock('tone', () => ({
  getTransport: () => mocks.transport,
  getDraw: () => ({ schedule: vi.fn() }),
  start: vi.fn(async () => undefined),
  Synth: mocks.Synth,
}));
vi.mock('@/audio-engine', () => ({ instrument: mocks }));

import { PlaybackEngine } from './PlaybackEngine';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transport.seconds = 0;
});

describe('PlaybackEngine — reference voice ownership', () => {
  it('stops active reference voices when transport stop cancels playback', () => {
    const engine = new PlaybackEngine();
    engine.load(buildPerformance([{ midi: 60, startTime: 0, duration: 2 }], { name: 'long-note', source: 'midi-file' }));
    mocks.releaseReferenceVoices.mockClear();

    engine.stop();

    expect(mocks.releaseReferenceVoices).toHaveBeenCalledTimes(1);
  });
});

describe('PlaybackEngine — note click loop', () => {
  it('starts a valid range at A and uses one repeating boundary schedule', () => {
    const engine = new PlaybackEngine();
    engine.load(buildPerformance([
      { midi: 60, startTime: 1, duration: 0.5 },
      { midi: 64, startTime: 3, duration: 1 },
    ], { name: 'loop', source: 'midi-file' }));
    const range = {
      startTime: 1,
      endTime: 4,
      startRef: { anchorId: 'a', sourceIds: ['a'], startTime: 1, endTime: 1.5 },
      endRef: { anchorId: 'b', sourceIds: ['b'], startTime: 3, endTime: 4 },
    };
    expect(engine.setLoopRange(range)).toBe(true);
    expect(engine.startLoop()).toBe(true);
    expect(engine.getCurrentTime()).toBe(1);
    expect(engine.getState()).toBe('playing');
    expect(mocks.transport.scheduleRepeat).toHaveBeenCalledTimes(1);
    const repeatCall = (mocks.transport.scheduleRepeat.mock.calls as unknown as Array<[unknown, number, number]>)[0];
    expect(repeatCall?.[1]).toBeCloseTo(3 / 0.8);
  });

  it('rejects zero-length/out-of-song ranges and clears the active loop', () => {
    const engine = new PlaybackEngine();
    engine.load(buildPerformance([{ midi: 60, startTime: 0, duration: 2 }], { name: 'loop', source: 'midi-file' }));
    const base = { startRef: { anchorId: 'a', sourceIds: ['a'], startTime: 0, endTime: 1 }, endRef: { anchorId: 'b', sourceIds: ['b'], startTime: 1, endTime: 2 } };
    expect(engine.setLoopRange({ ...base, startTime: 1, endTime: 1 })).toBe(false);
    expect(engine.setLoopRange({ ...base, startTime: -1, endTime: 1 })).toBe(false);
    expect(engine.setLoopRange({ ...base, startTime: 0, endTime: 1.5 })).toBe(true);
    engine.startLoop();
    engine.clearLoopRange();
    expect(engine.getLoopRange()).toBeNull();
    expect(mocks.transport.clear).toHaveBeenCalled();
  });
});
