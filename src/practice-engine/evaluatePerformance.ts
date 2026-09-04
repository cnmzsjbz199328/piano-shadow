import { sortNotes, type NoteEvent, type Performance } from '@/music-model';
import { alignSequences } from './SequenceAligner';
import {
  fitTimeline,
  onsetErrorMs as onsetErr,
  durationErrorMs as durationErr,
  rhythmResidualMs as rhythmResidual,
  type MatchedPair,
} from './timingAnalyzer';
import {
  aggregateScores,
  countMatches,
  durationScoreFor,
  pitchScoreFor,
  timingScoreFor,
} from './scoring';
import { classifyTimingError, resolveConfig, type PracticeEngineConfig } from './constants';
import type { EvaluationResult, NoteMatchResult } from './types';

type ConfigOverrides = Parameters<typeof resolveConfig>[0];

/**
 * The core practice comparison (spec §4). Aligns the learner's notes against the
 * reference, then derives explicit, explainable per-note results and the five
 * category scores. Pure and deterministic: the same inputs always yield the same
 * `EvaluationResult`.
 *
 * @param expected reference notes (canonical `NoteEvent[]`)
 * @param actual   learner notes (canonical `NoteEvent[]`)
 */
export function evaluatePerformance(
  expected: readonly NoteEvent[],
  actual: readonly NoteEvent[],
  overrides?: ConfigOverrides,
): EvaluationResult {
  const config: PracticeEngineConfig = resolveConfig(overrides);
  const ref = sortNotes(expected);
  const learner = sortNotes(actual);

  const { ops } = alignSequences(ref, learner, config.alignerWeights);

  const pairs: MatchedPair[] = ops
    .filter((op): op is Extract<typeof op, { type: 'match' }> => op.type === 'match')
    .map((op) => ({ expected: ref[op.expectedIndex]!, actual: learner[op.actualIndex]! }));

  const normalization = fitTimeline(pairs);

  const matches: NoteMatchResult[] = ops.map((op) => {
    if (op.type === 'missed') {
      const e = ref[op.expectedIndex]!;
      return { expectedIndex: op.expectedIndex, expected: e, result: 'missed', pitchScore: 0, timingScore: 0, durationScore: 0 };
    }
    if (op.type === 'extra') {
      const a = learner[op.actualIndex]!;
      return { actualIndex: op.actualIndex, actual: a, result: 'extra', pitchScore: 0, timingScore: 0, durationScore: 0 };
    }
    const e = ref[op.expectedIndex]!;
    const a = learner[op.actualIndex]!;
    const pair: MatchedPair = { expected: e, actual: a };
    const pitchErrorSemitones = a.midi - e.midi;
    const onsetErrorMs = onsetErr(pair);
    const durationErrorMs = durationErr(pair);
    const rhythmResidualMs = rhythmResidual(pair, normalization);
    const result = pitchErrorSemitones === 0 ? 'correct' : 'wrong-note';
    return {
      expectedIndex: op.expectedIndex,
      actualIndex: op.actualIndex,
      expected: e,
      actual: a,
      result,
      pitchErrorSemitones,
      onsetErrorMs,
      durationErrorMs,
      rhythmResidualMs,
      timingBand: classifyTimingError(Math.abs(onsetErrorMs), config.tolerances),
      pitchScore: pitchScoreFor(result, pitchErrorSemitones, config.scoreAnchors),
      timingScore: timingScoreFor(result, onsetErrorMs, config.scoreAnchors),
      durationScore: durationScoreFor(result, durationErrorMs, config.scoreAnchors),
    };
  });

  const counts = countMatches(matches);
  const rhythmResidualsMs = matches
    .filter((m) => m.result === 'correct' || m.result === 'wrong-note')
    .map((m) => m.rhythmResidualMs ?? 0);

  const scores = aggregateScores({
    matches,
    rhythmResidualsMs,
    counts,
    overallWeights: config.overallWeights,
    anchors: config.scoreAnchors,
  });

  return { matches, scores, counts, normalization };
}

/** Convenience wrapper for two `Performance` objects. */
export function evaluatePerformances(
  reference: Performance,
  learner: Performance,
  overrides?: ConfigOverrides,
): EvaluationResult {
  return evaluatePerformance(reference.notes, learner.notes, overrides);
}
