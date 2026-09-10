import { describe, it, expect } from 'vitest';
import { inferHands, HAND_SPLIT_MIDI } from './hands';
import { normalizeNotes } from './performance';
import type { NoteEvent } from './types';

/** Build canonical NoteEvents, optionally overriding `track` per raw note. */
function notes(
  raw: Array<{ midi: number; startTime: number; track?: number }>,
): NoteEvent[] {
  return normalizeNotes(
    raw.map((n) => ({ ...n, duration: 0.4 })),
    { source: 'midi-file', idPrefix: 'ref' },
  );
}

describe('inferHands', () => {
  it('splits a 2-track (SMF-shaped) input by track: lower centroid → left', () => {
    const input = notes([
      { midi: 48, startTime: 0, track: 0 },
      { midi: 52, startTime: 0.5, track: 0 },
      { midi: 72, startTime: 0, track: 1 },
      { midi: 76, startTime: 0.5, track: 1 },
    ]);
    const out = inferHands(input);
    const handOf = (midi: number) => out.find((n) => n.midi === midi)?.hand;
    expect(handOf(48)).toBe('left');
    expect(handOf(52)).toBe('left');
    expect(handOf(72)).toBe('right');
    expect(handOf(76)).toBe('right');
  });

  it('assigns by track centroid regardless of which track index is lower-pitched', () => {
    // Track 0 is the HIGH stave, track 1 is the LOW stave — hand follows pitch,
    // not the raw track number.
    const input = notes([
      { midi: 80, startTime: 0, track: 0 },
      { midi: 40, startTime: 0, track: 1 },
    ]);
    const out = inferHands(input);
    expect(out.find((n) => n.midi === 40)?.hand).toBe('left');
    expect(out.find((n) => n.midi === 80)?.hand).toBe('right');
  });

  it('ranks tracks by centroid: rank 0 → left, rank 1 → right, further tracks split at middle C', () => {
    const input = notes([
      { midi: 36, startTime: 0, track: 0 }, // centroid 36 → rank 0 → left
      { midi: 43, startTime: 0, track: 1 }, // centroid 43 → rank 1 → right
      { midi: 52, startTime: 0, track: 2 }, // centroid 52 → rank 2, 52 < 60 → left
      { midi: 90, startTime: 0, track: 3 }, // centroid 90 → rank 3, 90 ≥ 60 → right
    ]);
    const out = inferHands(input);
    const handOf = (midi: number) => out.find((n) => n.midi === midi)?.hand;
    expect(handOf(36)).toBe('left');
    expect(handOf(43)).toBe('right');
    expect(handOf(52)).toBe('left');
    expect(handOf(90)).toBe('right');
  });

  it('falls back to a middle-C pitch split when there is only one track', () => {
    const input = notes([
      { midi: 55, startTime: 0, track: 0 },
      { midi: HAND_SPLIT_MIDI - 1, startTime: 0.5, track: 0 },
      { midi: HAND_SPLIT_MIDI, startTime: 1, track: 0 },
      { midi: 72, startTime: 1.5, track: 0 },
    ]);
    const out = inferHands(input);
    expect(out.map((n) => [n.midi, n.hand])).toEqual([
      [55, 'left'],
      [HAND_SPLIT_MIDI - 1, 'left'],
      [HAND_SPLIT_MIDI, 'right'],
      [72, 'right'],
    ]);
  });

  it('pitch-splits when notes carry no track info at all', () => {
    const input = notes([
      { midi: 50, startTime: 0 },
      { midi: 67, startTime: 0.5 },
    ]);
    const out = inferHands(input);
    expect(out.find((n) => n.midi === 50)?.hand).toBe('left');
    expect(out.find((n) => n.midi === 67)?.hand).toBe('right');
  });

  it('is pure: does not mutate the input notes', () => {
    const input = notes([{ midi: 48, startTime: 0, track: 0 }]);
    const snapshot = JSON.stringify(input);
    inferHands(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('is deterministic: same input → identical output', () => {
    const input = notes([
      { midi: 48, startTime: 0, track: 0 },
      { midi: 72, startTime: 0, track: 1 },
      { midi: 60, startTime: 1, track: 0 },
    ]);
    expect(JSON.stringify(inferHands(input))).toBe(JSON.stringify(inferHands(input)));
  });

  it('returns [] for an empty input', () => {
    expect(inferHands([])).toEqual([]);
  });
});
