/**
 * All practice-engine tuning lives here as named configuration (spec §7:
 * "These values MUST be constants/configuration, not scattered magic numbers").
 * No user-facing language belongs in this module (spec §7, §25).
 */

/** Timing tolerance bands, in milliseconds, applied to |onset error|. */
export interface TimingTolerances {
  /** |error| <= perfectMs  -> "perfect" band. */
  perfectMs: number;
  /** |error| <= goodMs     -> "good" band. */
  goodMs: number;
  /** |error| <= warnMs     -> "early"/"late" warning band. */
  warnMs: number;
  /** |error| >  warnMs     -> "severe" timing error. */
}

export const DEFAULT_TIMING_TOLERANCES: TimingTolerances = {
  perfectMs: 60,
  goodMs: 120,
  warnMs: 250,
};

/** Classification keys for a matched note's timing (not display text). */
export type TimingBand = 'perfect' | 'good' | 'warn' | 'severe';

export function classifyTimingError(absErrorMs: number, tol: TimingTolerances = DEFAULT_TIMING_TOLERANCES): TimingBand {
  if (absErrorMs <= tol.perfectMs) return 'perfect';
  if (absErrorMs <= tol.goodMs) return 'good';
  if (absErrorMs <= tol.warnMs) return 'warn';
  return 'severe';
}

/**
 * Sequence-alignment cost weights (spec §5). Calibrated so that:
 *  - an exact-pitch note stays "matched" even when badly mistimed
 *    (scenario D: 800 ms slow is still the same note);
 *  - a near wrong note is a substitution, not missed+extra
 *    (scenario C: E vs F = one wrong note);
 *  - a genuinely absent / inserted note is a gap, and gaps do NOT shift the
 *    classification of later notes (scenarios B, E).
 */
export interface AlignerWeights {
  /** Flat cost added for any pitch mismatch (independent of distance). */
  pitchMismatchBase: number;
  /** Extra cost per semitone of pitch error, capped at `pitchMaxSemitones`. */
  pitchPerSemitone: number;
  pitchMaxSemitones: number;
  /** Cost per second of |onset difference| between two candidate-matched notes. */
  onsetPerSecond: number;
  /** Cap on the onset term so one wild outlier cannot dominate. */
  onsetMaxCost: number;
  /** Cost of leaving an expected note unmatched (missed) or an actual note unmatched (extra). */
  gapCost: number;
}

export const DEFAULT_ALIGNER_WEIGHTS: AlignerWeights = {
  pitchMismatchBase: 3,
  pitchPerSemitone: 0.5,
  pitchMaxSemitones: 12,
  onsetPerSecond: 1,
  onsetMaxCost: 3,
  gapCost: 3,
};

/**
 * Score curves. Each maps an absolute error to 0–100 via piecewise-linear
 * interpolation between (errorValue, score) anchor points. Anchors are derived
 * from the timing tolerances above where relevant, so tightening a tolerance
 * tightens the score.
 */
export interface ScoreAnchors {
  timingMs: Array<[error: number, score: number]>;
  durationMs: Array<[error: number, score: number]>;
  rhythmResidualMs: Array<[error: number, score: number]>;
  /** Wrong-note pitch score by |semitone| distance. */
  wrongNoteSemitones: Array<[error: number, score: number]>;
}

export const DEFAULT_SCORE_ANCHORS: ScoreAnchors = {
  timingMs: [
    [0, 100],
    [60, 95],
    [120, 82],
    [250, 55],
    [450, 20],
    [800, 0],
  ],
  durationMs: [
    [0, 100],
    [100, 92],
    [250, 75],
    [500, 45],
    [1000, 10],
    [1600, 0],
  ],
  rhythmResidualMs: [
    [0, 100],
    [40, 96],
    [90, 85],
    [180, 60],
    [350, 25],
    [600, 0],
  ],
  wrongNoteSemitones: [
    [1, 70],
    [2, 45],
    [4, 15],
    [7, 0],
  ],
};

/** Weights for combining the five category scores into the Overall score (spec §6). */
export interface OverallWeights {
  pitch: number;
  timing: number;
  rhythm: number;
  duration: number;
  completeness: number;
  /** Overall penalty (points) per extra note, applied after the weighted mean. */
  extraNotePenalty: number;
}

export const DEFAULT_OVERALL_WEIGHTS: OverallWeights = {
  pitch: 0.3,
  timing: 0.2,
  rhythm: 0.2,
  duration: 0.1,
  completeness: 0.2,
  extraNotePenalty: 4,
};

/** Full engine configuration. Every field has a documented default above. */
export interface PracticeEngineConfig {
  tolerances: TimingTolerances;
  alignerWeights: AlignerWeights;
  scoreAnchors: ScoreAnchors;
  overallWeights: OverallWeights;
}

export const DEFAULT_ENGINE_CONFIG: PracticeEngineConfig = {
  tolerances: DEFAULT_TIMING_TOLERANCES,
  alignerWeights: DEFAULT_ALIGNER_WEIGHTS,
  scoreAnchors: DEFAULT_SCORE_ANCHORS,
  overallWeights: DEFAULT_OVERALL_WEIGHTS,
};

export function resolveConfig(overrides?: DeepPartial<PracticeEngineConfig>): PracticeEngineConfig {
  if (!overrides) return DEFAULT_ENGINE_CONFIG;
  return {
    tolerances: { ...DEFAULT_TIMING_TOLERANCES, ...overrides.tolerances },
    alignerWeights: { ...DEFAULT_ALIGNER_WEIGHTS, ...overrides.alignerWeights },
    scoreAnchors: { ...DEFAULT_SCORE_ANCHORS, ...overrides.scoreAnchors },
    overallWeights: { ...DEFAULT_OVERALL_WEIGHTS, ...overrides.overallWeights },
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };
