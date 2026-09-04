import { describe, it, expect } from 'vitest';
import { fitTimeline, onsetErrorMs, rhythmResidualMs, type MatchedPair } from './timingAnalyzer';
import { note, PITCH } from '@/test/factories';

const { C4, D4, E4, G4 } = PITCH;

/** Pair reference onsets with learner onsets at the same pitch sequence. */
function pairs(refTimes: number[], learnerTimes: number[]): MatchedPair[] {
  const pitches = [C4, D4, E4, G4, C4, D4, E4, G4];
  return refTimes.map((t, i) => ({
    expected: note(pitches[i % pitches.length]!, t),
    actual: note(pitches[i % pitches.length]!, learnerTimes[i]!),
  }));
}

describe('fitTimeline — spec §6 / §8 (absolute timing vs relative rhythm)', () => {
  it('on-time: tempoRatio ~1, offset ~0', () => {
    const p = pairs([0, 0.5, 1, 2], [0, 0.5, 1, 2]);
    const fit = fitTimeline(p);
    expect(fit.tempoRatio).toBeCloseTo(1, 3);
    expect(fit.offsetMs).toBeCloseTo(0, 3);
  });

  it('uniformly late: tempoRatio ~1, positive offset', () => {
    const p = pairs([0, 0.5, 1, 2], [0.15, 0.65, 1.15, 2.15]);
    const fit = fitTimeline(p);
    expect(fit.tempoRatio).toBeCloseTo(1, 2);
    expect(fit.offsetMs).toBeCloseTo(150, 0);
  });

  it('uniformly early: negative offset', () => {
    const p = pairs([0, 0.5, 1, 2], [-0.08, 0.42, 0.92, 1.92]);
    expect(fitTimeline(p).offsetMs).toBeCloseTo(-80, 0);
  });

  it('global slower tempo (scenario D): tempoRatio > 1, tiny residuals', () => {
    // reference 0,0.5,1,2  ->  learner 0,0.7,1.4,2.8  (x1.4, perfectly even)
    const p = pairs([0, 0.5, 1, 2], [0, 0.7, 1.4, 2.8]);
    const fit = fitTimeline(p);
    expect(fit.tempoRatio).toBeCloseTo(1.4, 2);
    for (const pair of p) {
      expect(Math.abs(rhythmResidualMs(pair, fit))).toBeLessThan(5);
    }
    // ...while the raw absolute error is large and growing.
    expect(Math.abs(onsetErrorMs(p[3]!))).toBeCloseTo(800, 0);
  });

  it('global faster tempo: tempoRatio < 1, tiny residuals', () => {
    const p = pairs([0, 0.5, 1, 2], [0, 0.4, 0.8, 1.6]); // x0.8
    const fit = fitTimeline(p);
    expect(fit.tempoRatio).toBeCloseTo(0.8, 2);
    for (const pair of p) {
      expect(Math.abs(rhythmResidualMs(pair, fit))).toBeLessThan(5);
    }
  });

  it('uneven playing leaves a real residual even at tempo 1', () => {
    const p = pairs([0, 0.5, 1, 2], [0, 0.5, 1.25, 2]); // 3rd note dragged
    const fit = fitTimeline(p);
    const residuals = p.map((pair) => Math.abs(rhythmResidualMs(pair, fit)));
    expect(Math.max(...residuals)).toBeGreaterThan(80);
  });

  it('degenerates safely with < 2 pairs', () => {
    expect(fitTimeline([])).toEqual({ tempoRatio: 1, offsetMs: 0, sampleSize: 0 });
    const one = fitTimeline([{ expected: note(C4, 1), actual: note(C4, 1.2) }]);
    expect(one.tempoRatio).toBe(1);
    expect(one.offsetMs).toBeCloseTo(200, 0);
  });
});
