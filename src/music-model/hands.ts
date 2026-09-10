import type { Hand, NoteEvent } from './types';

/**
 * Middle C (MIDI 60). The fixed, deterministic split point for the
 * single-track / no-track fallback: notes strictly below middle C are the left
 * hand, middle C and above are the right hand.
 *
 * A running-median split was considered and rejected — it makes one note's
 * classification depend on its neighbours' onsets, which is harder to reason
 * about and to keep stable across re-imports, for no real accuracy gain on the
 * largely monophonic material this app targets.
 */
export const HAND_SPLIT_MIDI = 60;

/**
 * Assign a `hand` to every note. Pure and deterministic — same input array
 * yields the same output, and the input notes are never mutated (a shallow
 * clone of each note is returned).
 *
 * Strategy:
 *  1. **Track-based.** If the notes come from ≥2 distinct SMF tracks that each
 *     contain notes (the common "left hand / right hand on separate staves"
 *     export), rank those tracks by mean pitch (centroid), ties broken by track
 *     index. The lowest-centroid track becomes `'left'`, the next `'right'`. Any
 *     further tracks are assigned per track by their own centroid relative to
 *     middle C (`< HAND_SPLIT_MIDI` → `'left'`, else `'right'`), so a third
 *     stave still lands on a usable hand rather than `'unknown'`.
 *  2. **Pitch-split fallback.** With one track (or no track info at all — e.g. a
 *     recognised take), split each note around middle C (`HAND_SPLIT_MIDI`).
 *
 * Writes the existing `NoteEvent.hand` field (music-model/types.ts). `'unknown'`
 * stays a reserved value in the `Hand` union; this function only ever emits
 * `'left'` / `'right'` so the per-hand practice filter is always meaningful.
 */
export function inferHands(notes: readonly NoteEvent[]): NoteEvent[] {
  if (notes.length === 0) return [];

  // Group note indices by track. Notes with no `track` share the -1 bucket.
  const byTrack = new Map<number, number[]>();
  for (let i = 0; i < notes.length; i += 1) {
    const key = notes[i]!.track ?? -1;
    const bucket = byTrack.get(key);
    if (bucket) bucket.push(i);
    else byTrack.set(key, [i]);
  }

  const handForTrack = new Map<number, Hand>();
  if (byTrack.size >= 2) {
    const centroidOf = (indices: number[]): number =>
      indices.reduce((sum, i) => sum + notes[i]!.midi, 0) / indices.length;
    const ranked = [...byTrack.entries()]
      .map(([track, indices]) => ({ track, centroid: centroidOf(indices) }))
      .sort((a, b) => a.centroid - b.centroid || a.track - b.track);
    ranked.forEach(({ track, centroid }, rank) => {
      if (rank === 0) handForTrack.set(track, 'left');
      else if (rank === 1) handForTrack.set(track, 'right');
      else handForTrack.set(track, centroid < HAND_SPLIT_MIDI ? 'left' : 'right');
    });
  }

  return notes.map((note) => {
    const fromTrack = handForTrack.get(note.track ?? -1);
    const hand: Hand = fromTrack ?? (note.midi < HAND_SPLIT_MIDI ? 'left' : 'right');
    return { ...note, hand };
  });
}
