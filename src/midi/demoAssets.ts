import { Midi } from '@tonejs/midi';
import type { Performance } from '@/music-model';
import { parseMidiFile } from './parseMidiFile';

/**
 * Built-in demo material (spec §22): the app must be testable immediately after
 * install without the user supplying their own MIDI file. Each demo is generated
 * programmatically and then round-tripped through the real SMF importer, so
 * "load sample MIDI" exercises the same code path as a user import.
 *
 * All melodies here are either the spec's own example or traditional/public-domain
 * folk tunes ("Twinkle, Twinkle" = "Ah! vous dirai-je, maman", pre-1800).
 */

interface DemoNoteSpec {
  midi: number;
  /** Onset in beats from the start. */
  beat: number;
  /** Length in beats. */
  beats: number;
  velocity?: number;
}

interface DemoSpec {
  id: string;
  name: string;
  description: string;
  bpm: number;
  notes: DemoNoteSpec[];
}

const N = (midi: number, beat: number, beats: number, velocity = 100): DemoNoteSpec => ({
  midi,
  beat,
  beats,
  velocity,
});

// MIDI: C4 = 60.
const C4 = 60;
const D4 = 62;
const E4 = 64;
const F4 = 65;
const G4 = 67;
const A4 = 69;

const DEMO_SPECS: DemoSpec[] = [
  {
    id: 'demo-c-major-pentascale',
    name: 'C Major Five-Finger (C D E F G)',
    description: 'The spec reference figure — five even quarter notes, one per beat.',
    bpm: 120,
    notes: [N(C4, 0, 0.9), N(D4, 1, 0.9), N(E4, 2, 0.9), N(F4, 3, 0.9), N(G4, 4, 1.5)],
  },
  {
    id: 'demo-rhythm-study',
    name: 'Rhythm Study',
    description: 'Mixed quarter / eighth / half notes to exercise timing and duration scoring.',
    bpm: 100,
    notes: [
      N(C4, 0, 1),
      N(D4, 1, 0.5),
      N(E4, 1.5, 0.5),
      N(F4, 2, 1),
      N(E4, 3, 0.5),
      N(D4, 3.5, 0.5),
      N(C4, 4, 2),
    ],
  },
  {
    id: 'demo-twinkle',
    name: 'Twinkle, Twinkle (opening)',
    description: 'Traditional / public-domain melody — a longer phrase for full practice runs.',
    bpm: 110,
    notes: [
      N(C4, 0, 1),
      N(C4, 1, 1),
      N(G4, 2, 1),
      N(G4, 3, 1),
      N(A4, 4, 1),
      N(A4, 5, 1),
      N(G4, 6, 2),
      N(F4, 8, 1),
      N(F4, 9, 1),
      N(E4, 10, 1),
      N(E4, 11, 1),
      N(D4, 12, 1),
      N(D4, 13, 1),
      N(C4, 14, 2),
    ],
  },
];

function encodeDemo(spec: DemoSpec): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(spec.bpm);
  const secondsPerBeat = 60 / spec.bpm;
  const track = midi.addTrack();
  track.name = spec.name;
  for (const note of spec.notes) {
    track.addNote({
      midi: note.midi,
      time: note.beat * secondsPerBeat,
      duration: note.beats * secondsPerBeat,
      velocity: (note.velocity ?? 100) / 127,
    });
  }
  return midi.toArray();
}

export interface DemoAsset {
  id: string;
  name: string;
  description: string;
  /** Raw Standard MIDI File bytes. */
  bytes: Uint8Array;
}

export function getDemoAssets(): DemoAsset[] {
  return DEMO_SPECS.map((spec) => ({
    id: spec.id,
    name: spec.name,
    description: spec.description,
    bytes: encodeDemo(spec),
  }));
}

/** Parse a demo asset into a canonical `Performance` via the real SMF importer. */
export function loadDemoPerformance(assetId: string): Performance {
  const asset = getDemoAssets().find((a) => a.id === assetId);
  if (!asset) throw new Error(`Unknown demo asset: ${assetId}`);
  return parseMidiFile(asset.bytes, { name: asset.name, id: asset.id });
}

export function listDemoIds(): string[] {
  return DEMO_SPECS.map((s) => s.id);
}
