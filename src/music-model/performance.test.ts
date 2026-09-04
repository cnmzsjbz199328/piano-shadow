import { describe, it, expect } from 'vitest';
import { normalizeNotes, buildPerformance, sortNotes, performanceDuration, MIN_NOTE_DURATION } from './performance';

describe('normalizeNotes', () => {
  it('fills note names, assigns deterministic ids, and sorts by onset then pitch', () => {
    const out = normalizeNotes(
      [
        { midi: 64, startTime: 1, duration: 0.5 },
        { midi: 60, startTime: 1, duration: 0.5 },
        { midi: 62, startTime: 0, duration: 0.5 },
      ],
      { source: 'midi-file', idPrefix: 'ref' },
    );
    expect(out.map((n) => n.noteName)).toEqual(['D4', 'C4', 'E4']);
    // ids are assigned in canonical (sorted) order: ref-0 is the earliest note.
    expect(out.map((n) => n.id)).toEqual(['ref-0', 'ref-1', 'ref-2']);
    expect(out.map((n) => n.midi)).toEqual([62, 60, 64]);
  });

  it('clamps pitch to 0..127 and enforces a minimum duration', () => {
    const [lo, hi] = normalizeNotes(
      [
        { midi: -5, startTime: 0, duration: 0 },
        { midi: 200, startTime: 0.5, duration: -1 },
      ],
      { source: 'virtual-keyboard' },
    );
    expect(lo!.midi).toBe(0);
    expect(hi!.midi).toBe(127);
    expect(lo!.duration).toBe(MIN_NOTE_DURATION);
  });

  it('drops notes with non-finite midi/onset', () => {
    const out = normalizeNotes(
      [{ midi: Number.NaN, startTime: 0, duration: 1 }, { midi: 60, startTime: 0, duration: 1 }],
      { source: 'midi-file' },
    );
    expect(out).toHaveLength(1);
  });
});

describe('buildPerformance', () => {
  it('derives duration from the last note end', () => {
    const perf = buildPerformance(
      [
        { midi: 60, startTime: 0, duration: 1 },
        { midi: 62, startTime: 2, duration: 0.5 },
      ],
      { name: 'x', source: 'midi-file', createdAt: '2020-01-01T00:00:00.000Z' },
    );
    expect(perf.duration).toBe(2.5);
    expect(perf.name).toBe('x');
    expect(perf.createdAt).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('sortNotes / performanceDuration', () => {
  it('sortNotes is stable on id and does not mutate input', () => {
    const input = [
      { id: 'b', midi: 60, noteName: 'C4', startTime: 0, duration: 1, source: 'midi-file' as const },
      { id: 'a', midi: 60, noteName: 'C4', startTime: 0, duration: 1, source: 'midi-file' as const },
    ];
    const sorted = sortNotes(input);
    expect(sorted.map((n) => n.id)).toEqual(['a', 'b']);
    expect(input[0]!.id).toBe('b');
  });

  it('performanceDuration honours a minimum', () => {
    expect(performanceDuration([], 3)).toBe(3);
  });
});
