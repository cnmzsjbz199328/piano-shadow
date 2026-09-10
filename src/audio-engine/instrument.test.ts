import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SampledInstrument } from './instrument';

/**
 * The instrument is exercised against a fully mocked `smplr` and `tone` — no real
 * AudioContext. We assert the public API (`attack` / `release` / `dispose`)
 * drives the mocked sampled player, and that a sample-load failure falls back to
 * the Tone synth voicing without throwing.
 */

const mocks = vi.hoisted(() => {
  const pianoStop = vi.fn();
  const pianoStart = vi.fn((_event: Record<string, unknown>) => pianoStop);
  const pianoStopAll = vi.fn();
  const pianoDispose = vi.fn();
  const readyRef: { promise: Promise<void> } = { promise: Promise.resolve() };
  const SplendidGrandPiano = vi.fn(() => ({
    get ready() {
      return readyRef.promise;
    },
    start: pianoStart,
    stop: pianoStopAll,
    dispose: pianoDispose,
  }));

  const synthTriggerAttack = vi.fn();
  const synthTriggerRelease = vi.fn();
  const synthTriggerAttackRelease = vi.fn(
    (_name: string, _dur: number, _when?: number, _gain?: number) => undefined,
  );
  const synthReleaseAll = vi.fn();
  const synthDispose = vi.fn();
  class PolySynth {
    triggerAttack = synthTriggerAttack;
    triggerRelease = synthTriggerRelease;
    triggerAttackRelease = synthTriggerAttackRelease;
    releaseAll = synthReleaseAll;
    dispose = synthDispose;
    toDestination(): this {
      return this;
    }
  }

  return {
    pianoStop,
    pianoStart,
    pianoStopAll,
    pianoDispose,
    readyRef,
    SplendidGrandPiano,
    synthTriggerAttack,
    synthTriggerRelease,
    synthTriggerAttackRelease,
    synthReleaseAll,
    synthDispose,
    PolySynth,
  };
});

vi.mock('smplr', () => ({ SplendidGrandPiano: mocks.SplendidGrandPiano }));
vi.mock('tone', () => ({
  PolySynth: mocks.PolySynth,
  Synth: class Synth {},
  getContext: () => ({ rawContext: {}, currentTime: 0 }),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readyRef.promise = Promise.resolve();
  vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200 }) as unknown as Response));
});

describe('SampledInstrument — sampled path', () => {
  it('routes attack/release/dispose through the mocked sampled player once ready', async () => {
    const inst = new SampledInstrument();
    inst.prepare();
    await flush();
    expect(inst.getMode()).toBe('sampled');

    inst.attack(60, 100);
    expect(mocks.pianoStart).toHaveBeenCalledTimes(1);
    expect(mocks.pianoStart.mock.calls[0]![0]).toMatchObject({ note: 60, velocity: 100 });

    inst.release(60);
    expect(mocks.pianoStop).toHaveBeenCalledTimes(1);

    inst.dispose();
    expect(mocks.pianoDispose).toHaveBeenCalled();
  });

  it('passes the clamped duration straight through for scheduled playback notes', async () => {
    const inst = new SampledInstrument();
    inst.prepare();
    await flush();

    inst.attack(64, 80, 1.5, 2);
    expect(mocks.pianoStart).toHaveBeenCalledTimes(1);
    expect(mocks.pianoStart.mock.calls[0]![0]).toMatchObject({ note: 64, time: 1.5, duration: 2 });
    // a duration note is self-releasing: it is not tracked as an open voice
    inst.release(64);
    expect(mocks.pianoStop).not.toHaveBeenCalled();
  });

  it('collapses two near-simultaneous attacks on the same pitch into one voice', async () => {
    const inst = new SampledInstrument();
    inst.prepare();
    await flush();

    inst.attack(60, 100); // pressVirtualKey
    inst.attack(60, 100); // synchronous handleLearnerNoteOn for the same press
    expect(mocks.pianoStart).toHaveBeenCalledTimes(1);
  });

  it('releaseAll silences ringing voices and the sampled player', async () => {
    const inst = new SampledInstrument();
    inst.prepare();
    await flush();

    inst.attack(60, 100);
    inst.attack(64, 100);
    inst.releaseAll();
    expect(mocks.pianoStop).toHaveBeenCalledTimes(2); // both open voices stopped
    expect(mocks.pianoStopAll).toHaveBeenCalled();
  });
});

describe('SampledInstrument — graceful degradation', () => {
  it('falls back to the Tone synth without throwing when the sample set fails to load', async () => {
    mocks.readyRef.promise = Promise.reject(new Error('offline'));
    const inst = new SampledInstrument();
    inst.prepare();
    await flush();

    expect(inst.getMode()).toBe('synth');
    expect(mocks.pianoDispose).toHaveBeenCalled(); // the failed player was torn down

    expect(() => inst.attack(60, 100)).not.toThrow();
    expect(mocks.pianoStart).not.toHaveBeenCalled();
    expect(mocks.synthTriggerAttack).toHaveBeenCalledTimes(1);

    expect(() => inst.release(60)).not.toThrow();
    expect(mocks.synthTriggerRelease).toHaveBeenCalledTimes(1);
  });

  it('uses the synth fallback for scheduled notes too (triggerAttackRelease)', async () => {
    mocks.readyRef.promise = Promise.reject(new Error('csp'));
    const inst = new SampledInstrument();
    inst.prepare();
    await flush();

    inst.attack(67, 90, 0.5, 1.25);
    expect(mocks.synthTriggerAttackRelease).toHaveBeenCalledTimes(1);
    const [name, dur, when] = mocks.synthTriggerAttackRelease.mock.calls[0]!;
    expect(name).toBe('G4');
    expect(dur).toBe(1.25);
    expect(when).toBe(0.5);
  });

  it('never throws from attack/release even before prepare()', () => {
    const inst = new SampledInstrument();
    expect(() => inst.release(60)).not.toThrow();
    expect(() => inst.attack(60, 100)).not.toThrow();
  });
});
