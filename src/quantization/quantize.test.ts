import { describe, it, expect } from 'vitest';
import { quantizeTime, quantizeNotes, gridSecondsFor, secondsPerBeat } from './quantize';
import { note } from '@/test/factories';

describe('quantizeTime', () => {
  it('snaps to the nearest grid line at full strength', () => {
    expect(quantizeTime(0.24, { gridSeconds: 0.25 })).toBeCloseTo(0.25, 5);
    expect(quantizeTime(0.1, { gridSeconds: 0.25 })).toBeCloseTo(0, 5);
  });

  it('partial strength moves only part-way toward the grid', () => {
    const q = quantizeTime(0.2, { gridSeconds: 0.25, strength: 0.5 });
    expect(q).toBeGreaterThan(0.2);
    expect(q).toBeLessThan(0.25);
  });

  it('strength 0 leaves raw timing untouched', () => {
    expect(quantizeTime(0.137, { gridSeconds: 0.25, strength: 0 })).toBe(0.137);
  });
});

describe('quantizeNotes', () => {
  it('returns a new array and does not mutate the input (raw timing preserved)', () => {
    const raw = [note(60, 0.24, 0.23)];
    const quantized = quantizeNotes(raw, { gridSeconds: 0.25 });
    expect(raw[0]!.startTime).toBe(0.24); // untouched
    expect(quantized[0]!.startTime).toBeCloseTo(0.25, 5);
    expect(quantized).not.toBe(raw);
  });
});

describe('tempo grid helpers', () => {
  it('derives grid spacing from bpm and subdivision', () => {
    expect(secondsPerBeat(120)).toBeCloseTo(0.5, 5);
    expect(gridSecondsFor(120, 4)).toBeCloseTo(0.125, 5);
  });
});
