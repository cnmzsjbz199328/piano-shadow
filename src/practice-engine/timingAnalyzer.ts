import type { NoteEvent } from '@/music-model';
import type { TimingNormalization } from './types';

/**
 * Timing model (spec §6, §8): the engine distinguishes **absolute timing**
 * correctness from **relative rhythm** correctness. A learner who plays evenly
 * but at a slower global tempo has poor absolute timing yet good rhythm
 * (acceptance scenario D), so this module fits the learner's timeline to the
 * reference and reports the residual that remains after tempo + offset are removed.
 */

export interface MatchedPair {
  expected: NoteEvent;
  actual: NoteEvent;
}

const MIN_TEMPO_RATIO = 0.25;
const MAX_TEMPO_RATIO = 4;

/**
 * Least-squares fit of `actual.startTime ≈ tempoRatio * expected.startTime + offset`
 * over the matched pairs. `tempoRatio > 1` means the learner played slower than
 * the reference; `offsetMs` is the residual constant lead (−) / lag (+).
 */
export function fitTimeline(pairs: readonly MatchedPair[]): TimingNormalization {
  const n = pairs.length;
  if (n === 0) return { tempoRatio: 1, offsetMs: 0, sampleSize: 0 };

  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const { expected, actual } of pairs) {
    const x = expected.startTime;
    const y = actual.startTime;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }

  const denom = n * sxx - sx * sx;
  let tempoRatio: number;
  let offsetSec: number;

  if (n < 2 || Math.abs(denom) < 1e-9) {
    // Not enough spread in reference onsets to estimate a slope.
    tempoRatio = 1;
    offsetSec = sy / n - sx / n;
  } else {
    tempoRatio = (n * sxy - sx * sy) / denom;
    if (!Number.isFinite(tempoRatio)) tempoRatio = 1;
    tempoRatio = clamp(tempoRatio, MIN_TEMPO_RATIO, MAX_TEMPO_RATIO);
    // Re-derive the offset for the (possibly clamped) slope: mean(y - a*x).
    offsetSec = (sy - tempoRatio * sx) / n;
  }

  return { tempoRatio, offsetMs: offsetSec * 1000, sampleSize: n };
}

/** Raw absolute onset error in ms (positive = late). */
export function onsetErrorMs(pair: MatchedPair): number {
  return (pair.actual.startTime - pair.expected.startTime) * 1000;
}

/** Onset error in ms after removing the learner's global tempo + offset (spec §8). */
export function rhythmResidualMs(pair: MatchedPair, norm: TimingNormalization): number {
  const predicted = norm.tempoRatio * pair.expected.startTime + norm.offsetMs / 1000;
  return (pair.actual.startTime - predicted) * 1000;
}

/** Duration error in ms (positive = held too long). */
export function durationErrorMs(pair: MatchedPair): number {
  return (pair.actual.duration - pair.expected.duration) * 1000;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
