export {
  DEFAULT_ENGINE_CONFIG,
  DEFAULT_TIMING_TOLERANCES,
  DEFAULT_ALIGNER_WEIGHTS,
  DEFAULT_SCORE_ANCHORS,
  DEFAULT_OVERALL_WEIGHTS,
  LIVE_MATCH_WINDOW_MS,
  LIVE_MATCH_WRONG_NOTE_SEMITONES,
  classifyTimingError,
  resolveConfig,
  type TimingBand,
  type TimingTolerances,
  type AlignerWeights,
  type ScoreAnchors,
  type OverallWeights,
  type PracticeEngineConfig,
} from './constants';
export type {
  MatchType,
  NoteMatchResult,
  ScoreBreakdown,
  MatchCounts,
  TimingNormalization,
  EvaluationResult,
} from './types';
export {
  alignSequences,
  substitutionCost,
  type AlignOp,
  type AlignResult,
} from './SequenceAligner';
export {
  fitTimeline,
  onsetErrorMs,
  durationErrorMs,
  rhythmResidualMs,
  type MatchedPair,
} from './timingAnalyzer';
export {
  interpolateScore,
  pitchScoreFor,
  timingScoreFor,
  durationScoreFor,
  rhythmScoreFor,
  countMatches,
  aggregateScores,
} from './scoring';
export { evaluatePerformance, evaluatePerformances } from './evaluatePerformance';
export {
  LiveMatcher,
  type LiveFeedbackItem,
  type LiveResult,
  type LiveMatcherOptions,
} from './liveMatcher';
export {
  voiceFilteredNotes,
  voiceFilteredPerformance,
  groupNotesByOnset,
  notesInLookAheadWindow,
  LOOK_AHEAD_SECONDS,
  noteNames,
  type PracticeVoice,
  type OnsetGroup,
} from './referenceNotes';
