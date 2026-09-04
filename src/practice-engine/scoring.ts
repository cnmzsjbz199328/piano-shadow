import {
  DEFAULT_SCORE_ANCHORS,
  DEFAULT_OVERALL_WEIGHTS,
  type ScoreAnchors,
  type OverallWeights,
} from './constants';
import type { MatchType, NoteMatchResult, ScoreBreakdown, MatchCounts } from './types';

/**
 * Deterministic scoring (spec §6, §21.1). Every score is derived from note-level
 * results by pure functions — no randomness, no wall-clock, stable iteration —
 * so identical inputs always produce an identical `ScoreBreakdown`.
 */

/** Piecewise-linear interpolation of `absError` over ascending `(error, score)` anchors. */
export function interpolateScore(absError: number, anchors: ReadonlyArray<readonly [number, number]>): number {
  const e = Math.abs(absError);
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (e <= first[0]) return first[1];
  if (e >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i]!;
    const [x0, y0] = anchors[i - 1]!;
    if (e <= x1) {
      const t = (e - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

export function pitchScoreFor(result: MatchType, semitoneError: number | undefined, anchors: ScoreAnchors = DEFAULT_SCORE_ANCHORS): number {
  if (result === 'correct') return 100;
  if (result === 'wrong-note') return Math.round(interpolateScore(Math.abs(semitoneError ?? 0), anchors.wrongNoteSemitones));
  return 0; // missed / extra
}

export function timingScoreFor(result: MatchType, onsetErrMs: number | undefined, anchors: ScoreAnchors = DEFAULT_SCORE_ANCHORS): number {
  if (result === 'missed' || result === 'extra' || onsetErrMs === undefined) return 0;
  return Math.round(interpolateScore(onsetErrMs, anchors.timingMs));
}

export function durationScoreFor(result: MatchType, durationErrMs: number | undefined, anchors: ScoreAnchors = DEFAULT_SCORE_ANCHORS): number {
  if (result === 'missed' || result === 'extra' || durationErrMs === undefined) return 0;
  return Math.round(interpolateScore(durationErrMs, anchors.durationMs));
}

export function rhythmScoreFor(residualMs: number, anchors: ScoreAnchors = DEFAULT_SCORE_ANCHORS): number {
  return Math.round(interpolateScore(residualMs, anchors.rhythmResidualMs));
}

export function countMatches(matches: readonly NoteMatchResult[]): MatchCounts {
  const counts: MatchCounts = { expected: 0, actual: 0, correct: 0, wrongNote: 0, missed: 0, extra: 0 };
  for (const m of matches) {
    if (m.expected) counts.expected++;
    if (m.actual) counts.actual++;
    if (m.result === 'correct') counts.correct++;
    else if (m.result === 'wrong-note') counts.wrongNote++;
    else if (m.result === 'missed') counts.missed++;
    else counts.extra++;
  }
  return counts;
}

function meanOr(values: readonly number[], fallback: number): number {
  if (values.length === 0) return fallback;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export interface AggregateInput {
  matches: readonly NoteMatchResult[];
  /** Rhythm residuals (ms) for the matched pairs, in match order. */
  rhythmResidualsMs: readonly number[];
  counts: MatchCounts;
  overallWeights?: OverallWeights;
  anchors?: ScoreAnchors;
}

export function aggregateScores(input: AggregateInput): ScoreBreakdown {
  const { matches, rhythmResidualsMs, counts } = input;
  const weights = input.overallWeights ?? DEFAULT_OVERALL_WEIGHTS;
  const anchors = input.anchors ?? DEFAULT_SCORE_ANCHORS;

  const played = matches.filter((m) => m.result === 'correct' || m.result === 'wrong-note');
  const nothingExpected = counts.expected === 0;

  const pitch = played.length > 0 ? meanOr(played.map((m) => m.pitchScore), 0) : nothingExpected ? 100 : 0;
  const timing = played.length > 0 ? meanOr(played.map((m) => m.timingScore), 0) : nothingExpected ? 100 : 0;
  const duration = played.length > 0 ? meanOr(played.map((m) => m.durationScore), 0) : nothingExpected ? 100 : 0;
  const rhythm =
    rhythmResidualsMs.length > 0
      ? meanOr(rhythmResidualsMs.map((r) => rhythmScoreFor(r, anchors)), 0)
      : nothingExpected
        ? 100
        : 0;
  const completeness = nothingExpected ? 100 : ((counts.expected - counts.missed) / counts.expected) * 100;

  const weightedMean =
    pitch * weights.pitch +
    timing * weights.timing +
    rhythm * weights.rhythm +
    duration * weights.duration +
    completeness * weights.completeness;
  const overall = clamp(weightedMean - weights.extraNotePenalty * counts.extra, 0, 100);

  return {
    pitch: Math.round(pitch),
    timing: Math.round(timing),
    rhythm: Math.round(rhythm),
    duration: Math.round(duration),
    completeness: Math.round(completeness),
    overall: Math.round(overall),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
