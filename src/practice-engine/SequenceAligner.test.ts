import { describe, it, expect } from 'vitest';
import { alignSequences, substitutionCost, type AlignOp } from './SequenceAligner';
import { note, notes, PITCH } from '@/test/factories';

const { C4, D4, Dsharp4, E4, F4, G4 } = PITCH;

/** Compact string view of an alignment for readable assertions. */
function shape(ops: AlignOp[]): string {
  return ops
    .map((op) =>
      op.type === 'match'
        ? `m(${op.expectedIndex},${op.actualIndex})`
        : op.type === 'missed'
          ? `miss(${op.expectedIndex})`
          : `extra(${op.actualIndex})`,
    )
    .join(' ');
}

describe('alignSequences — spec §21.1 cases', () => {
  it('exact match: every note aligns 1:1, no gaps', () => {
    const ref = notes([[C4, 0], [D4, 1], [E4, 2], [F4, 3], [G4, 4]]);
    const { ops } = alignSequences(ref, ref);
    expect(shape(ops)).toBe('m(0,0) m(1,1) m(2,2) m(3,3) m(4,4)');
  });

  it('one missed note does NOT shift later notes (C D E F G / C D F G)', () => {
    const ref = notes([[C4, 0], [D4, 1], [E4, 2], [F4, 3], [G4, 4]]);
    const learner = notes([[C4, 0], [D4, 1], [F4, 2], [G4, 3]]);
    const { ops } = alignSequences(ref, learner);
    expect(shape(ops)).toBe('m(0,0) m(1,1) miss(2) m(3,2) m(4,3)');
    // F and G still map to F and G, not shifted onto the wrong reference note.
  });

  it('one extra note does NOT shift later notes (C D E / C D D# E)', () => {
    const ref = notes([[C4, 0], [D4, 1], [E4, 2]]);
    const learner = notes([[C4, 0], [D4, 1], [Dsharp4, 1.5], [E4, 2]]);
    const { ops } = alignSequences(ref, learner);
    expect(shape(ops)).toBe('m(0,0) m(1,1) extra(2) m(2,3)');
  });

  it('one wrong note is a substitution, not missed+extra (C D E / C D F)', () => {
    const ref = notes([[C4, 0], [D4, 1], [E4, 2]]);
    const learner = notes([[C4, 0], [D4, 1], [F4, 2]]);
    const { ops } = alignSequences(ref, learner);
    expect(shape(ops)).toBe('m(0,0) m(1,1) m(2,2)');
  });

  it('multiple consecutive misses (C D E F G / C G)', () => {
    const ref = notes([[C4, 0], [D4, 1], [E4, 2], [F4, 3], [G4, 4]]);
    const learner = notes([[C4, 0], [G4, 4]]);
    const { ops } = alignSequences(ref, learner);
    expect(shape(ops)).toBe('m(0,0) miss(1) miss(2) miss(3) m(4,1)');
  });

  it('repeated notes: the trailing repeat is the gap (C C C / C C)', () => {
    const ref = notes([[C4, 0], [C4, 1], [C4, 2]]);
    const learner = notes([[C4, 0], [C4, 1]]);
    const { ops } = alignSequences(ref, learner);
    expect(shape(ops)).toBe('m(0,0) m(1,1) miss(2)');
  });

  it('same pitch, different timing still matches (not missed+extra)', () => {
    const ref = notes([[C4, 0], [D4, 0.5], [E4, 1]]);
    const learner = notes([[C4, 0], [D4, 1.3], [E4, 2]]); // sluggish but same notes
    const { ops } = alignSequences(ref, learner);
    expect(shape(ops)).toBe('m(0,0) m(1,1) m(2,2)');
  });

  it('is deterministic for identical input', () => {
    const ref = notes([[C4, 0], [E4, 1], [G4, 2], [C4, 3]]);
    const learner = notes([[C4, 0.05], [Dsharp4, 1.1], [G4, 2.2]]);
    const a = alignSequences(ref, learner);
    const b = alignSequences(ref, learner);
    expect(a).toEqual(b);
  });

  it('handles empty sequences', () => {
    expect(alignSequences([], []).ops).toEqual([]);
    expect(shape(alignSequences(notes([[C4, 0]]), []).ops)).toBe('miss(0)');
    expect(shape(alignSequences([], notes([[C4, 0]])).ops)).toBe('extra(0)');
  });
});

describe('substitutionCost', () => {
  it('is zero for the same pitch at the same time', () => {
    expect(substitutionCost(note(C4, 1), note(C4, 1))).toBe(0);
  });

  it('grows with pitch distance and with onset distance', () => {
    const base = substitutionCost(note(C4, 1), note(C4, 1));
    expect(substitutionCost(note(C4, 1), note(C4, 1.2))).toBeGreaterThan(base);
    expect(substitutionCost(note(C4, 1), note(D4, 1))).toBeGreaterThan(base);
    expect(substitutionCost(note(C4, 1), note(G4, 1))).toBeGreaterThan(
      substitutionCost(note(C4, 1), note(D4, 1)),
    );
  });

  it('caps the onset term so one outlier cannot dominate', () => {
    const far = substitutionCost(note(C4, 0), note(C4, 100));
    expect(far).toBeLessThanOrEqual(3); // onsetMaxCost
  });
});
