import type { NoteEvent } from '@/music-model';
import type { TimingBand } from './constants';

/** Spec §4. */
export type MatchType = 'correct' | 'wrong-note' | 'missed' | 'extra';

/**
 * The result of aligning one expected note and/or one actual note.
 * Contains data only — no user-facing strings (spec §7, §25). The UI turns
 * `result` / `timingBand` / the signed error fields into language.
 */
export interface NoteMatchResult {
  /** Position of the expected note in the (sorted) reference sequence, if any. */
  expectedIndex?: number;
  /** Position of the actual note in the (sorted) learner sequence, if any. */
  actualIndex?: number;
  expected?: NoteEvent;
  actual?: NoteEvent;

  result: MatchType;

  /** actual.midi - expected.midi, when both present. */
  pitchErrorSemitones?: number;
  /** (actual.startTime - expected.startTime) * 1000; positive = late. */
  onsetErrorMs?: number;
  /** (actual.duration - expected.duration) * 1000; positive = held too long. */
  durationErrorMs?: number;
  /** Onset error after removing the learner's global tempo/offset (spec §8). */
  rhythmResidualMs?: number;
  timingBand?: TimingBand;

  /** 0–100. For missed/extra, the dimension that does not apply is 0. */
  pitchScore: number;
  timingScore: number;
  durationScore: number;
}

/** Spec §6 / §11. */
export interface ScoreBreakdown {
  pitch: number;
  timing: number;
  rhythm: number;
  duration: number;
  completeness: number;
  overall: number;
}

export interface MatchCounts {
  expected: number;
  actual: number;
  correct: number;
  wrongNote: number;
  missed: number;
  extra: number;
}

/** How the learner's timeline maps onto the reference (spec §8). */
export interface TimingNormalization {
  /** Learner seconds per reference second. >1 = slower than reference. */
  tempoRatio: number;
  /** Constant lead/lag in milliseconds after tempo is removed. */
  offsetMs: number;
  /** Number of matched pairs the fit was computed from. */
  sampleSize: number;
}

export interface EvaluationResult {
  matches: NoteMatchResult[];
  scores: ScoreBreakdown;
  counts: MatchCounts;
  normalization: TimingNormalization;
}
