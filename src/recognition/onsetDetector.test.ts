import { describe, it, expect } from 'vitest';
import { detectOnsetTime } from './onsetDetector';

const SAMPLE_RATE = 44100;

function silenceThenTone(silenceSeconds: number, toneSeconds: number, freqHz = 440): Float32Array {
  const silenceSamples = Math.round(silenceSeconds * SAMPLE_RATE);
  const toneSamples = Math.round(toneSeconds * SAMPLE_RATE);
  const buf = new Float32Array(silenceSamples + toneSamples);
  for (let i = 0; i < toneSamples; i++) {
    buf[silenceSamples + i] = Math.sin((2 * Math.PI * freqHz * i) / SAMPLE_RATE);
  }
  return buf;
}

describe('detectOnsetTime', () => {
  it('finds the onset shortly after the silence ends', () => {
    const audio = silenceThenTone(0.3, 0.3);
    const onset = detectOnsetTime(audio, SAMPLE_RATE);
    expect(onset).not.toBeNull();
    // A window-based detector reports the start of the first window whose RMS
    // crosses the threshold, so it can fire up to one window early/late.
    const windowSeconds = 512 / SAMPLE_RATE;
    expect(onset!).toBeGreaterThanOrEqual(0.3 - windowSeconds);
    expect(onset!).toBeLessThan(0.3 + windowSeconds);
  });

  it('returns null for pure silence', () => {
    const silence = new Float32Array(SAMPLE_RATE * 0.5);
    expect(detectOnsetTime(silence, SAMPLE_RATE)).toBeNull();
  });

  it('finds an onset at time 0 when the signal starts immediately', () => {
    const audio = silenceThenTone(0, 0.2);
    expect(detectOnsetTime(audio, SAMPLE_RATE)).toBe(0);
  });
});
