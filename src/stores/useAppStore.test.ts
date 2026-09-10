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

import { useAppStore } from './useAppStore';

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
