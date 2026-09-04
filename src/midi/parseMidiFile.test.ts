import { describe, it, expect } from 'vitest';
import { Midi } from '@tonejs/midi';
import { parseMidiFile, MidiImportError } from './parseMidiFile';
import { getDemoAssets, loadDemoPerformance } from './demoAssets';

function buildSmf(bpm: number, notes: Array<{ midi: number; time: number; duration: number; velocity?: number }>): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  const track = midi.addTrack();
  for (const n of notes) track.addNote({ midi: n.midi, time: n.time, duration: n.duration, velocity: (n.velocity ?? 100) / 127 });
  return midi.toArray();
}

describe('parseMidiFile', () => {
  it('normalises an SMF into canonical NoteEvent[] with seconds-based timing', () => {
    const bytes = buildSmf(120, [
      { midi: 60, time: 0, duration: 0.5 },
      { midi: 62, time: 0.5, duration: 0.5 },
      { midi: 64, time: 1, duration: 0.5, velocity: 80 },
    ]);
    const perf = parseMidiFile(bytes, { name: 'Scale' });

    expect(perf.name).toBe('Scale');
    expect(perf.sourceType).toBe('midi-file');
    expect(perf.notes.map((n) => n.noteName)).toEqual(['C4', 'D4', 'E4']);
    expect(perf.notes[1]!.startTime).toBeCloseTo(0.5, 3);
    expect(perf.notes[2]!.velocity).toBeCloseTo(80, 0);
    expect(perf.duration).toBeCloseTo(1.5, 3);
    expect(perf.tempoMap?.[0]?.bpm).toBeCloseTo(120, 3);
  });

  it('assigns stable ids and canonical sort order', () => {
    const bytes = buildSmf(100, [
      { midi: 67, time: 1, duration: 0.5 },
      { midi: 60, time: 0, duration: 0.5 },
    ]);
    const a = parseMidiFile(bytes);
    const b = parseMidiFile(bytes);
    expect(a.notes.map((n) => n.id)).toEqual(b.notes.map((n) => n.id));
    expect(a.notes.map((n) => n.midi)).toEqual([60, 67]);
  });

  it('rejects non-MIDI bytes with a typed error', () => {
    expect(() => parseMidiFile(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(MidiImportError);
  });

  it('rejects a MIDI file with no notes', () => {
    const empty = new Midi();
    empty.addTrack();
    expect(() => parseMidiFile(empty.toArray())).toThrow(/no playable notes/i);
  });
});

describe('demo assets (spec §22)', () => {
  it('exposes at least one demo, each parseable via the real importer', () => {
    const assets = getDemoAssets();
    expect(assets.length).toBeGreaterThanOrEqual(1);
    for (const asset of assets) {
      const perf = loadDemoPerformance(asset.id);
      expect(perf.notes.length).toBeGreaterThan(0);
      expect(perf.duration).toBeGreaterThan(0);
    }
  });

  it('includes the spec reference figure C D E F G', () => {
    const perf = loadDemoPerformance('demo-c-major-pentascale');
    expect(perf.notes.slice(0, 5).map((n) => n.noteName)).toEqual(['C4', 'D4', 'E4', 'F4', 'G4']);
  });

  it('is deterministic — same bytes every call', () => {
    const first = getDemoAssets().map((a) => Array.from(a.bytes));
    const second = getDemoAssets().map((a) => Array.from(a.bytes));
    expect(first).toEqual(second);
  });
});
