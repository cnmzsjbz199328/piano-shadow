import { describe, it, expect } from 'vitest';
import {
  benchmarkRecognizer,
  benchmarkPolyphony,
  DEFAULT_BENCHMARK_TONES,
  DEFAULT_BENCHMARK_CHORDS,
} from './benchmark';
import { PitchyRecognizer } from './PitchyRecognizer';

describe('benchmarkRecognizer', () => {
  it('runs the default tone set against PitchyRecognizer and reports per-case results', async () => {
    const result = await benchmarkRecognizer('Pitchy', new PitchyRecognizer());

    expect(result.cases).toHaveLength(DEFAULT_BENCHMARK_TONES.length);
    expect(result.accuracyPercent).toBeGreaterThanOrEqual(0);
    expect(result.accuracyPercent).toBeLessThanOrEqual(100);
    // A clean, standalone sine wave per tone is the easiest possible case for a
    // pitch detector -- Pitchy should get nearly all of these right.
    expect(result.accuracyPercent).toBeGreaterThanOrEqual(80);
    expect(result.meanProcessingMs).toBeGreaterThanOrEqual(0);
    for (const c of result.cases) {
      expect(c.processingMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('benchmarkPolyphony', () => {
  it('documents that PitchyRecognizer is monophonic-only: it never resolves more than one chord tone', async () => {
    const result = await benchmarkPolyphony('Pitchy', new PitchyRecognizer());

    expect(result.cases).toHaveLength(DEFAULT_BENCHMARK_CHORDS.length);
    // The core failure mode: an autocorrelation / MPM detector sees one periodic
    // waveform for the whole chord, so per chord it resolves at most one voice
    // (often none — the summed signal has no clear period above the clarity
    // threshold). This is why microphone chord practice stays out of scope.
    for (const c of result.cases) {
      expect(c.matchedMidis.length).toBeLessThanOrEqual(1);
    }
    expect(result.maxVoicesResolved).toBeLessThanOrEqual(1);
    expect(result.monophonicOnly).toBe(true);
    // With triads and a 7th chord dragging it down, mean recall stays well below
    // "half the notes".
    expect(result.meanRecall).toBeLessThan(0.5);
    expect(result.meanProcessingMs).toBeGreaterThanOrEqual(0);
  });

  it('reports the same shape for every chord case', async () => {
    const result = await benchmarkPolyphony('Pitchy', new PitchyRecognizer());
    for (const c of result.cases) {
      expect(c.expectedMidis.length).toBeGreaterThanOrEqual(2);
      expect(c.recall).toBeGreaterThanOrEqual(0);
      expect(c.recall).toBeLessThanOrEqual(1);
      // detected = matched ∪ extra, no overlap
      expect(new Set([...c.matchedMidis, ...c.extraMidis]).size).toBe(c.detectedMidis.length);
    }
  });
});
