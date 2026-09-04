import type { NoteEvent } from '@/music-model';

/**
 * Lightweight real-time feedback for Play Along mode (spec §9.2). This is a
 * greedy, preliminary estimate shown while playing — the authoritative,
 * alignment-based evaluation always runs again on the full performance when the
 * attempt finishes (`evaluatePerformance`). Nothing here feeds the final score.
 */

export type LiveResult = 'correct' | 'wrong-note' | 'extra';

export interface LiveFeedbackItem {
  actual: NoteEvent;
  expected?: NoteEvent;
  result: LiveResult;
  onsetErrorMs?: number;
  pitchErrorSemitones?: number;
}

export interface LiveMatcherOptions {
  /** Half-window (ms) around a learner onset to look for an unclaimed reference note. */
  windowMs?: number;
  /** Max |semitones| for a near-miss to count as wrong-note rather than extra. */
  wrongNoteSemitones?: number;
}

export class LiveMatcher {
  private readonly reference: NoteEvent[];
  private readonly claimed = new Set<number>();
  private readonly windowMs: number;
  private readonly wrongNoteSemis: number;

  constructor(referenceNotes: readonly NoteEvent[], options: LiveMatcherOptions = {}) {
    this.reference = [...referenceNotes].sort((a, b) => a.startTime - b.startTime);
    this.windowMs = options.windowMs ?? 400;
    this.wrongNoteSemis = options.wrongNoteSemitones ?? 3;
  }

  /** Feed one learner note-on (with `startTime` already on the reference clock). */
  accept(actual: NoteEvent): LiveFeedbackItem {
    const windowSec = this.windowMs / 1000;
    let bestIdx = -1;
    let bestDelta = Number.POSITIVE_INFINITY;

    for (let i = 0; i < this.reference.length; i++) {
      if (this.claimed.has(i)) continue;
      const ref = this.reference[i]!;
      const delta = Math.abs(ref.startTime - actual.startTime);
      if (delta > windowSec) continue;
      const samePitch = ref.midi === actual.midi;
      // Prefer a same-pitch hit; otherwise fall back to nearest within range.
      const rank = (samePitch ? 0 : 1000) + delta;
      if (rank < bestDelta) {
        bestDelta = rank;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      return { actual, result: 'extra' };
    }

    const expected = this.reference[bestIdx]!;
    this.claimed.add(bestIdx);
    const pitchErrorSemitones = actual.midi - expected.midi;
    const onsetErrorMs = (actual.startTime - expected.startTime) * 1000;

    if (pitchErrorSemitones === 0) {
      return { actual, expected, result: 'correct', onsetErrorMs, pitchErrorSemitones };
    }
    if (Math.abs(pitchErrorSemitones) <= this.wrongNoteSemis) {
      return { actual, expected, result: 'wrong-note', onsetErrorMs, pitchErrorSemitones };
    }
    // Too far to be "this note played wrong" — release the claim, call it extra.
    this.claimed.delete(bestIdx);
    return { actual, result: 'extra' };
  }

  reset(): void {
    this.claimed.clear();
  }
}
