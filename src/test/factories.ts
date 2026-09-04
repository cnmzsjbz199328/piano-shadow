import { midiToNoteName, type NoteEvent, type NoteSource } from '@/music-model';

/** Build one canonical `NoteEvent` for tests. */
export function note(
  midi: number,
  startTime: number,
  duration = 0.4,
  overrides: Partial<NoteEvent> = {},
): NoteEvent {
  return {
    id: overrides.id ?? `t-${midi}-${startTime}`,
    midi,
    noteName: midiToNoteName(midi),
    startTime,
    duration,
    source: overrides.source ?? ('virtual-keyboard' as NoteSource),
    ...overrides,
  };
}

/** Build a note sequence from `[midi, startTime, duration?]` tuples. */
export function notes(rows: ReadonlyArray<readonly [number, number, number?]>): NoteEvent[] {
  return rows.map(([midi, start, dur], i) =>
    note(midi, start, dur ?? 0.4, { id: `t${i}-${midi}` }),
  );
}

// Common pitches used across scenarios.
export const PITCH = { C4: 60, Csharp4: 61, D4: 62, Dsharp4: 63, E4: 64, F4: 65, Fsharp4: 66, G4: 67 } as const;
