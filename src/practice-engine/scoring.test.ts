import { describe, it, expect } from 'vitest';
import { interpolateScore, aggregateScores, countMatches } from './scoring';
import { DEFAULT_SCORE_ANCHORS } from './constants';
import type { NoteMatchResult } from './types';
import { note, PITCH } from '@/test/factories';

const { C4, D4 } = PITCH;

describe('interpolateScore', () => {
  const anchors = DEFAULT_SCORE_ANCHORS.timingMs;

  it('clamps below the first and above the last anchor, and scores by magnitude', () => {
    expect(interpolateScore(0, anchors)).toBe(100);
    expect(interpolateScore(99999, anchors)).toBe(0);
    // signed errors are scored by their absolute size
    expect(interpolateScore(-90, anchors)).toBe(interpolateScore(90, anchors));
  });

  it('interpolates linearly between anchors', () => {
    // between (60,95) and (120,82): midpoint 90ms -> 88.5
    expect(interpolateScore(90, anchors)).toBeCloseTo(88.5, 5);
  });

  it('is monotonic non-increasing in error', () => {
    let prev = 101;
    for (let e = 0; e <= 1000; e += 25) {
      const s = interpolateScore(e, anchors);
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
  });
});

describe('aggregateScores', () => {
  it('a clean run with no extras scores near 100 on every axis', () => {
    const matches: NoteMatchResult[] = [0, 1, 2].map((i) => ({
      expectedIndex: i,
      actualIndex: i,
      expected: note(C4 + i, i),
      actual: note(C4 + i, i),
      result: 'correct',
      pitchErrorSemitones: 0,
      onsetErrorMs: 0,
      durationErrorMs: 0,
      rhythmResidualMs: 0,
      pitchScore: 100,
      timingScore: 100,
      durationScore: 100,
    }));
    const scores = aggregateScores({
      matches,
      rhythmResidualsMs: [0, 0, 0],
      counts: countMatches(matches),
    });
    expect(scores).toEqual({ pitch: 100, timing: 100, rhythm: 100, duration: 100, completeness: 100, overall: 100 });
  });

  it('completeness reflects missed coverage and overall is penalised for extras', () => {
    const matches: NoteMatchResult[] = [
      { expectedIndex: 0, actualIndex: 0, expected: note(C4, 0), actual: note(C4, 0), result: 'correct', pitchErrorSemitones: 0, onsetErrorMs: 0, durationErrorMs: 0, rhythmResidualMs: 0, pitchScore: 100, timingScore: 100, durationScore: 100 },
      { expectedIndex: 1, expected: note(D4, 1), result: 'missed', pitchScore: 0, timingScore: 0, durationScore: 0 },
      { actualIndex: 1, actual: note(D4 + 1, 1.4), result: 'extra', pitchScore: 0, timingScore: 0, durationScore: 0 },
    ];
    const scores = aggregateScores({ matches, rhythmResidualsMs: [0], counts: countMatches(matches) });
    expect(scores.completeness).toBe(50); // 1 of 2 reference notes covered
    expect(scores.overall).toBeLessThan(scores.pitch); // extra-note penalty pulls overall down
  });

  it('is deterministic', () => {
    const matches: NoteMatchResult[] = [
      { expectedIndex: 0, actualIndex: 0, expected: note(C4, 0), actual: note(C4, 0.05), result: 'correct', pitchErrorSemitones: 0, onsetErrorMs: 50, durationErrorMs: -20, rhythmResidualMs: 3, pitchScore: 100, timingScore: 96, durationScore: 98 },
    ];
    const a = aggregateScores({ matches, rhythmResidualsMs: [3], counts: countMatches(matches) });
    const b = aggregateScores({ matches, rhythmResidualsMs: [3], counts: countMatches(matches) });
    expect(a).toEqual(b);
  });
});
