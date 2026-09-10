import { describe, it, expect } from 'vitest';
import { Midi } from '@tonejs/midi';
import { writeMidiFile } from './writeMidiFile';
import { parseMidiFile } from './parseMidiFile';
import { buildPerformance, inferHands, type Performance } from '@/music-model';

function twoHandPerformance(): Performance {
  const perf = buildPerformance(
    [
      { midi: 48, startTime: 0, duration: 0.5 }, // C3  → left
      { midi: 55, startTime: 0.5, duration: 0.5 }, // G3  → left
      { midi: 64, startTime: 1, duration: 0.5 }, // E4  → right
      { midi: 67, startTime: 1.5, duration: 0.5 }, // G4  → right
    ],
    { name: 'Two hands', source: 'midi-file', idPrefix: 'ref', tempoMap: [{ time: 0, bpm: 120 }] },
  );
  perf.notes = inferHands(perf.notes);
  return perf;
}

const fingerprint = (notes: readonly { midi: number; startTime: number; duration: number }[]) =>
  notes
    .map((n) => `${n.midi}@${n.startTime.toFixed(2)}+${n.duration.toFixed(2)}`)
    .sort();

describe('writeMidiFile — per-hand / multi-track export', () => {
  it('emits ≥2 SMF tracks for a performance with mixed hand values and preserves the note set', () => {
    const perf = twoHandPerformance();
    expect(new Set(perf.notes.map((n) => n.hand))).toEqual(new Set(['left', 'right']));

    const bytes = writeMidiFile(perf);

    const raw = new Midi(bytes);
    const tracksWithNotes = raw.tracks.filter((t) => t.notes.length > 0);
    expect(tracksWithNotes.length).toBeGreaterThanOrEqual(2);

    const reparsed = parseMidiFile(bytes, { name: 'round-trip' });
    expect(new Set(reparsed.notes.map((n) => n.track)).size).toBeGreaterThanOrEqual(2);
    expect(fingerprint(reparsed.notes)).toEqual(fingerprint(perf.notes));
  });

  it('round-trips the hand assignment (left stave stays left, right stays right)', () => {
    const bytes = writeMidiFile(twoHandPerformance());
    const reparsed = parseMidiFile(bytes);
    const handOf = (midi: number) => reparsed.notes.find((n) => n.midi === midi)?.hand;
    expect(handOf(48)).toBe('left');
    expect(handOf(55)).toBe('left');
    expect(handOf(64)).toBe('right');
    expect(handOf(67)).toBe('right');
  });

  it('still writes a single track when every note is one hand', () => {
    const perf = buildPerformance(
      [
        { midi: 64, startTime: 0, duration: 0.5 },
        { midi: 67, startTime: 0.5, duration: 0.5 },
      ],
      { name: 'Right only', source: 'midi-file', idPrefix: 'ref', tempoMap: [{ time: 0, bpm: 120 }] },
    );
    perf.notes = inferHands(perf.notes); // both land on 'right'
    const raw = new Midi(writeMidiFile(perf));
    expect(raw.tracks.filter((t) => t.notes.length > 0).length).toBe(1);
  });
});
