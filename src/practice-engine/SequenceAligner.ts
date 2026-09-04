import type { NoteEvent } from '@/music-model';
import { DEFAULT_ALIGNER_WEIGHTS, type AlignerWeights } from './constants';

/**
 * Deterministic dynamic-programming sequence alignment (spec §5).
 *
 * Reference and learner notes are aligned by an edit-distance DP whose cost
 * function considers pitch equality, pitch distance, onset-time distance,
 * insertion and deletion. Notes are NEVER matched by array index: a missing or
 * inserted note produces a gap and does not shift the classification of the
 * notes after it (spec §28, §31).
 *
 * Input MUST be sorted in canonical order (onset, then pitch). `evaluatePerformance`
 * guarantees this; call `sortNotes` first if calling the aligner directly.
 */

export type AlignOp =
  | { type: 'match'; expectedIndex: number; actualIndex: number }
  | { type: 'missed'; expectedIndex: number }
  | { type: 'extra'; actualIndex: number };

export interface AlignResult {
  ops: AlignOp[];
  /** Total alignment cost (lower = better fit). Deterministic for identical input. */
  cost: number;
}

/** Substitution cost for aligning one expected note with one actual note. */
export function substitutionCost(
  expected: NoteEvent,
  actual: NoteEvent,
  weights: AlignerWeights = DEFAULT_ALIGNER_WEIGHTS,
): number {
  let pitch = 0;
  if (expected.midi !== actual.midi) {
    const semis = Math.min(Math.abs(expected.midi - actual.midi), weights.pitchMaxSemitones);
    pitch = weights.pitchMismatchBase + weights.pitchPerSemitone * semis;
  }
  const onset = Math.min(
    weights.onsetMaxCost,
    Math.abs(actual.startTime - expected.startTime) * weights.onsetPerSecond,
  );
  return pitch + onset;
}

// Backpointer codes.
const NONE = 0;
const MATCH = 1;
const MISSED = 2; // consumed an expected note (move i-1, j)
const EXTRA = 3; // consumed an actual note (move i, j-1)

export function alignSequences(
  expected: readonly NoteEvent[],
  actual: readonly NoteEvent[],
  weights: AlignerWeights = DEFAULT_ALIGNER_WEIGHTS,
): AlignResult {
  const m = expected.length;
  const n = actual.length;
  const width = n + 1;
  const cost = new Float64Array((m + 1) * width);
  const back = new Uint8Array((m + 1) * width);

  for (let j = 1; j <= n; j++) {
    cost[j] = j * weights.gapCost;
    back[j] = EXTRA;
  }
  for (let i = 1; i <= m; i++) {
    cost[i * width] = i * weights.gapCost;
    back[i * width] = MISSED;
  }

  for (let i = 1; i <= m; i++) {
    const ei = expected[i - 1]!;
    for (let j = 1; j <= n; j++) {
      const aj = actual[j - 1]!;
      const missedCost = cost[(i - 1) * width + j]! + weights.gapCost;
      const extraCost = cost[i * width + (j - 1)]! + weights.gapCost;
      const matchCost = cost[(i - 1) * width + (j - 1)]! + substitutionCost(ei, aj, weights);

      // Fixed tie-break priority: missed, then extra, then match. A strictly
      // lower match cost still wins; on an exact tie the gap "closer to the end"
      // of the sequence is preferred, which keeps trailing notes as the
      // missed/extra ones in ambiguous repeated-note cases.
      let best = missedCost;
      let code = MISSED;
      if (extraCost < best) {
        best = extraCost;
        code = EXTRA;
      }
      if (matchCost < best) {
        best = matchCost;
        code = MATCH;
      }
      cost[i * width + j] = best;
      back[i * width + j] = code;
    }
  }

  const ops: AlignOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const code = back[i * width + j]!;
    if (code === MATCH) {
      ops.push({ type: 'match', expectedIndex: i - 1, actualIndex: j - 1 });
      i--;
      j--;
    } else if (code === MISSED || (code === NONE && j === 0)) {
      ops.push({ type: 'missed', expectedIndex: i - 1 });
      i--;
    } else {
      ops.push({ type: 'extra', actualIndex: j - 1 });
      j--;
    }
  }
  ops.reverse();
  return { ops, cost: cost[m * width + n]! };
}
