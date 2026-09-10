import { Midi } from '@tonejs/midi';
import type { NoteEvent, Performance } from '@/music-model';

type NoteGroup = { label: string; notes: NoteEvent[] };

/**
 * Split the performance's notes into the groups that become SMF tracks:
 *  1. by inferred `hand` ('left' / 'right' / 'unknown') when any note carries one;
 *  2. else by the original SMF `track` index;
 *  3. else a single "all" group (the pre-v0.7 behaviour).
 *
 * A grouping only "wins" if it actually produces more than one non-empty group —
 * a single-hand or single-track performance still exports as one track. Groups
 * are ordered deterministically by label so re-exports are byte-stable.
 */
function groupNotesForExport(notes: readonly NoteEvent[]): NoteGroup[] {
  const keyOf = (n: NoteEvent): string | null => {
    if (n.hand) return n.hand;
    if (n.track !== undefined) return `track ${n.track}`;
    return null;
  };

  if (notes.some((n) => keyOf(n) !== null)) {
    const buckets = new Map<string, NoteEvent[]>();
    for (const note of notes) {
      const key = keyOf(note) ?? 'unknown';
      const bucket = buckets.get(key);
      if (bucket) bucket.push(note);
      else buckets.set(key, [note]);
    }
    if (buckets.size > 1) {
      return [...buckets.entries()]
        .map(([label, groupNotes]) => ({ label, notes: groupNotes }))
        .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    }
  }
  return [{ label: 'all', notes: [...notes] }];
}

/**
 * Serialize the canonical performance model back to a Standard MIDI File.
 *
 * Notes are emitted on one SMF track per `hand` group (falling back to the
 * original `track` grouping, then a single track), so a file exported from a
 * two-hand import round-trips its per-hand structure instead of collapsing to
 * one track.
 */
export function writeMidiFile(performance: Performance): Uint8Array {
  const midi = new Midi();
  const firstTempo = performance.tempoMap?.[0];
  if (firstTempo) midi.header.setTempo(firstTempo.bpm);

  const groups = groupNotesForExport(performance.notes);
  for (const group of groups) {
    const track = midi.addTrack();
    track.name = groups.length > 1 ? `${performance.name} · ${group.label}` : performance.name;
    for (const note of group.notes) {
      track.addNote({
        midi: note.midi,
        time: note.startTime,
        duration: note.duration,
        velocity: (note.velocity ?? 100) / 127,
      });
    }
  }
  return midi.toArray();
}
