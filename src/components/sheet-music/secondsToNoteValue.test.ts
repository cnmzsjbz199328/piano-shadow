import { describe, it, expect } from 'vitest';
import {
  decomposeRest,
  noteValueSeconds,
  secondsPerQuarter,
  secondsToNoteValue,
} from './secondsToNoteValue';

// Fixture: 4/4 at 120 bpm -> one quarter-note beat is 0.5 s, one whole note 2 s.
const BPM = 120;

describe('secondsPerQuarter', () => {
  it('is 0.5 s at 120 bpm and falls back to 120 for a bad tempo', () => {
    expect(secondsPerQuarter(120)).toBeCloseTo(0.5, 10);
    expect(secondsPerQuarter(0)).toBeCloseTo(0.5, 10);
    expect(secondsPerQuarter(Number.NaN)).toBeCloseTo(0.5, 10);
    expect(secondsPerQuarter(60)).toBeCloseTo(1, 10);
  });
});

describe('secondsToNoteValue (120 bpm, 4/4)', () => {
  it('maps the exact plain note values', () => {
    expect(secondsToNoteValue(2.0, BPM)).toBe('1'); // whole
    expect(secondsToNoteValue(1.0, BPM)).toBe('2'); // half
    expect(secondsToNoteValue(0.5, BPM)).toBe('4'); // quarter
    expect(secondsToNoteValue(0.25, BPM)).toBe('8'); // eighth
    expect(secondsToNoteValue(0.125, BPM)).toBe('16'); // sixteenth
  });

  it('snaps a near-miss onset/duration to the closest plain value', () => {
    expect(secondsToNoteValue(0.47, BPM)).toBe('4');
    expect(secondsToNoteValue(0.27, BPM)).toBe('8');
    expect(secondsToNoteValue(0.11, BPM)).toBe('16');
  });

  it('clamps out-of-range durations into 1/1 … 1/16', () => {
    expect(secondsToNoteValue(10, BPM)).toBe('1');
    expect(secondsToNoteValue(0.0001, BPM)).toBe('16');
    expect(secondsToNoteValue(0, BPM)).toBe('16');
    expect(secondsToNoteValue(-1, BPM)).toBe('16');
    expect(secondsToNoteValue(Number.NaN, BPM)).toBe('16');
  });

  it('tracks tempo — a quarter note at 60 bpm is 1.0 s', () => {
    expect(secondsToNoteValue(1.0, 60)).toBe('4');
    expect(secondsToNoteValue(0.5, 60)).toBe('8');
  });
});

describe('noteValueSeconds', () => {
  it('is the inverse of the plain note values at 120 bpm', () => {
    expect(noteValueSeconds('1', BPM)).toBeCloseTo(2.0, 10);
    expect(noteValueSeconds('2', BPM)).toBeCloseTo(1.0, 10);
    expect(noteValueSeconds('4', BPM)).toBeCloseTo(0.5, 10);
    expect(noteValueSeconds('8', BPM)).toBeCloseTo(0.25, 10);
    expect(noteValueSeconds('16', BPM)).toBeCloseTo(0.125, 10);
  });
});

describe('decomposeRest', () => {
  it('returns nothing for a sub-sixteenth gap', () => {
    expect(decomposeRest(0.02, BPM)).toEqual([]);
    expect(decomposeRest(0, BPM)).toEqual([]);
  });

  it('greedily splits a gap into plain rests, longest first', () => {
    expect(decomposeRest(0.5, BPM)).toEqual(['4']); // one beat
    expect(decomposeRest(0.75, BPM)).toEqual(['4', '8']); // 1.5 beats
    expect(decomposeRest(1.5, BPM)).toEqual(['2', '4']); // 3 beats
    expect(decomposeRest(2.0, BPM)).toEqual(['1']); // full 4/4 bar
  });

  it('produces rests whose total length matches the gap', () => {
    const gap = 1.75;
    const total = decomposeRest(gap, BPM).reduce((sum, code) => sum + noteValueSeconds(code, BPM), 0);
    expect(total).toBeCloseTo(gap, 6);
  });
});
