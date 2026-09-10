import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPerformance } from '@/music-model';

const mocks = vi.hoisted(() => ({
  transport: {
    seconds: 0,
    stop: vi.fn(),
    pause: vi.fn(),
    start: vi.fn(),
    clear: vi.fn(),
  },
  releaseReferenceVoices: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock('tone', () => ({
  getTransport: () => mocks.transport,
  getDraw: () => ({ schedule: vi.fn() }),
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
