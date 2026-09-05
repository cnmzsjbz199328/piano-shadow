import { describe, it, expect } from 'vitest';
import { benchmarkRecognizer, DEFAULT_BENCHMARK_TONES } from './benchmark';
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
