import { describe, it, expect } from 'vitest';
import { evaluatePerformance } from './evaluatePerformance';
import type { NoteMatchResult } from './types';
import { notes, PITCH } from '@/test/factories';

const { C4, Dsharp4, D4, E4, F4, G4 } = PITCH;

const byResult = (matches: NoteMatchResult[], r: NoteMatchResult['result']) =>
  matches.filter((m) => m.result === r);

describe('evaluatePerformance — acceptance scenarios (spec §27–§31)', () => {
  it('Scenario A — perfect performance scores near 100 with no error notes', () => {
    const ref = notes([[C4, 0], [D4, 0.5], [E4, 1], [G4, 2]]);
    const learner = notes([[C4, 0.01], [D4, 0.5], [E4, 1.02], [G4, 1.99]]);
    const { scores, counts } = evaluatePerformance(ref, learner);

    expect(scores.pitch).toBeGreaterThanOrEqual(99);
    expect(scores.timing).toBeGreaterThanOrEqual(95);
    expect(scores.rhythm).toBeGreaterThanOrEqual(98);
    expect(scores.completeness).toBe(100);
    expect(scores.overall).toBeGreaterThanOrEqual(97);
    expect(counts).toMatchObject({ correct: 4, missed: 0, wrongNote: 0, extra: 0 });
  });

  it('Scenario B — a missing note is "missed" and later notes are NOT shifted', () => {
    const ref = notes([[C4, 0], [D4, 1], [E4, 2], [F4, 3], [G4, 4]]);
    const learner = notes([[C4, 0], [D4, 1], [F4, 3], [G4, 4]]);
    const { matches, counts } = evaluatePerformance(ref, learner);

    expect(counts).toMatchObject({ correct: 4, missed: 1, wrongNote: 0, extra: 0 });
    const missed = byResult(matches, 'missed');
    expect(missed).toHaveLength(1);
    expect(missed[0]!.expected!.midi).toBe(E4);
    // F and G matched their own reference notes.
    const correctPairs = byResult(matches, 'correct').map((m) => [m.expected!.midi, m.actual!.midi]);
    expect(correctPairs).toEqual([
      [C4, C4],
      [D4, D4],
      [F4, F4],
      [G4, G4],
    ]);
  });

  it('Scenario C — a wrong note is explicitly identified with a pitch error', () => {
    const ref = notes([[C4, 0], [D4, 1], [E4, 2]]);
    const learner = notes([[C4, 0], [D4, 1], [F4, 2]]);
    const { matches, counts } = evaluatePerformance(ref, learner);

    expect(counts).toMatchObject({ correct: 2, wrongNote: 1, missed: 0, extra: 0 });
    const wrong = byResult(matches, 'wrong-note')[0]!;
    expect(wrong.expected!.midi).toBe(E4);
    expect(wrong.actual!.midi).toBe(F4);
    expect(wrong.pitchErrorSemitones).toBe(1); // F is +1 semitone above E
    expect(wrong.pitchScore).toBeLessThan(100);
  });

  it('Scenario D — slower but rhythmically even: rhythm >> absolute timing, pitch intact', () => {
    const ref = notes([[C4, 0], [D4, 0.5], [E4, 1], [G4, 2]]);
    const learner = notes([[C4, 0], [D4, 0.7], [E4, 1.4], [G4, 2.8]]); // uniform x1.4
    const { scores, normalization } = evaluatePerformance(ref, learner);

    expect(normalization.tempoRatio).toBeCloseTo(1.4, 1);
    expect(scores.pitch).toBe(100);
    expect(scores.rhythm).toBeGreaterThanOrEqual(95);
    expect(scores.timing).toBeLessThan(scores.rhythm);
    // Crucially: rhythm is NOT scored as wrong just because tempo is slower.
    expect(scores.rhythm).toBeGreaterThan(scores.timing + 20);
  });

  it('Scenario E — an extra note is "extra" and the following note still matches', () => {
    const ref = notes([[C4, 0], [D4, 1], [E4, 2]]);
    const learner = notes([[C4, 0], [D4, 1], [Dsharp4, 1.5], [E4, 2]]);
    const { matches, counts } = evaluatePerformance(ref, learner);

    expect(counts).toMatchObject({ correct: 3, extra: 1, missed: 0, wrongNote: 0 });
    const extra = byResult(matches, 'extra')[0]!;
    expect(extra.actual!.midi).toBe(Dsharp4);
    const lastCorrect = byResult(matches, 'correct').at(-1)!;
    expect(lastCorrect.expected!.midi).toBe(E4);
    expect(lastCorrect.actual!.midi).toBe(E4);
  });
});

describe('evaluatePerformance — determinism (spec §21.1)', () => {
  it('produces byte-identical results for identical input', () => {
    const ref = notes([[C4, 0], [E4, 1], [G4, 2], [C4, 3], [E4, 4]]);
    const learner = notes([[C4, 0.03], [Dsharp4, 1.08], [G4, 2.1], [C4, 3.2]]);
    const a = evaluatePerformance(ref, learner);
    const b = evaluatePerformance(ref, learner);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('is order-independent of the input arrays (sorts internally)', () => {
    const ref = notes([[C4, 0], [D4, 1], [E4, 2]]);
    const learner = notes([[C4, 0], [D4, 1], [E4, 2]]);
    const straight = evaluatePerformance(ref, learner);
    const shuffled = evaluatePerformance([...ref].reverse(), [...learner].reverse());
    expect(shuffled.scores).toEqual(straight.scores);
    expect(shuffled.counts).toEqual(straight.counts);
  });

  it('handles the learner playing nothing', () => {
    const ref = notes([[C4, 0], [D4, 1], [E4, 2]]);
    const { scores, counts } = evaluatePerformance(ref, []);
    expect(counts).toMatchObject({ missed: 3, correct: 0 });
    expect(scores.completeness).toBe(0);
    expect(scores.overall).toBe(0);
  });
});
