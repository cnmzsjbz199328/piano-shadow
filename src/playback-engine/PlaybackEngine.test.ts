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

describe('PlaybackEngine — metronome click scheduling', () => {
  it("does not schedule a click at t=0, avoiding a stacked attack on the piece's first note", async () => {
    const engine = new PlaybackEngine();
    engine.load(buildPerformance([
      { midi: 60, startTime: 0, duration: 0.5 },
      { midi: 64, startTime: 0.5, duration: 0.5 },
    ], { name: 'downbeat', source: 'midi-file' }));
    engine.setCountInEnabled(false);
    engine.setMetronomeEnabled(true);

    await engine.play();

    const scheduledTimes = (mocks.transport.scheduleOnce.mock.calls as unknown as Array<[unknown, number]>).map((c) => c[1]);
    const atZero = scheduledTimes.filter((t) => Math.abs(t) < 1e-9);
    // Exactly one thing may legitimately land at t=0: the reference note itself
    // (the schedule-end callback lands at the piece's duration, not 0).
    expect(atZero.length).toBe(1);
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

  it('keeps the loop clock in Transport-domain across repeat boundaries (no AudioContext-time freeze)', () => {
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
    engine.setLoopRange(range);
    engine.startLoop();

    const loopLength = 3 / 0.8; // (endTime - startTime) / scale
    const repeatCallback = (mocks.transport.scheduleRepeat.mock.calls as unknown as Array<[(time: number) => void]>)[0]?.[0];
    if (!repeatCallback) throw new Error('scheduleRepeat was not called');

    // Tone hands the boundary callback an AudioContext-domain timestamp, which
    // can be arbitrarily far from Transport.seconds once real session time (or
    // a seek) has accumulated — a fresh page load masks this gap, so passing a
    // wildly different value here catches a regression to using it for
    // Transport-domain bookkeeping (the loop froze at the start note once the
    // gap grew large enough — see PlaybackEngine.ts scheduleLoopBoundary).
    mocks.transport.seconds = loopLength;
    repeatCallback(999999);

    mocks.transport.seconds = loopLength + 0.5;
    expect(engine.getCurrentTime()).toBeCloseTo(1 + 0.5 * 0.8);
    mocks.transport.seconds = loopLength + 1;
    expect(engine.getCurrentTime()).toBeCloseTo(1 + 1 * 0.8);
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
