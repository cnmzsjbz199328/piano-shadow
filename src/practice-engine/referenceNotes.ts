import type { NoteEvent, Performance } from '@/music-model';

export type PracticeVoice = 'both' | 'left' | 'right';
export const LOOK_AHEAD_SECONDS = 2.5;

/**
 * The one reference-note selection rule shared by playback, scoring and the
 * guidance surfaces. Older imports and recognised performances have no hand
 * metadata, so selecting one hand deliberately falls back to the whole song.
 */
export function voiceFilteredNotes(song: Performance, voice: PracticeVoice): NoteEvent[] {
  if (voice === 'both') return song.notes;
  const filtered = song.notes.filter((note) => note.hand === voice);
  return filtered.length > 0 ? filtered : song.notes;
}

export function voiceFilteredPerformance(song: Performance, voice: PracticeVoice): Performance {
  return voice === 'both' ? song : { ...song, notes: voiceFilteredNotes(song, voice) };
}

export interface OnsetGroup {
  startTime: number;
  notes: NoteEvent[];
}

/**
 * Group only genuinely simultaneous events. The small tolerance absorbs MIDI
 * tick-to-second conversion noise while keeping normal arpeggios separate.
 */
export function groupNotesByOnset(notes: readonly NoteEvent[], tolerance = 0.001): OnsetGroup[] {
  const sorted = [...notes].sort((a, b) => a.startTime - b.startTime || a.midi - b.midi);
  const groups: OnsetGroup[] = [];
  for (const note of sorted) {
    const last = groups[groups.length - 1];
    if (!last || note.startTime - last.startTime > tolerance) {
      groups.push({ startTime: note.startTime, notes: [note] });
    } else {
      last.notes.push(note);
    }
  }
  return groups;
}

function lowerBound(notes: readonly NoteEvent[], time: number): number {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (notes[middle]!.startTime < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Active sustains plus a stable, reference-time look-ahead window. */
export function notesInLookAheadWindow(notes: readonly NoteEvent[], currentTime: number): NoteEvent[] {
  const sorted = [...notes].sort((a, b) => a.startTime - b.startTime || a.midi - b.midi);
  const firstFuture = lowerBound(sorted, currentTime);
  const active = sorted.filter((note, index) => index < firstFuture && note.startTime + note.duration > currentTime);
  const future = sorted.slice(firstFuture).filter((note) =>
    note.startTime <= currentTime + LOOK_AHEAD_SECONDS
    && note.startTime + note.duration > currentTime,
  );
  return [...active, ...future];
}

export function noteNames(notes: readonly NoteEvent[]): string[] {
  return [...new Set(notes.map((note) => note.noteName || String(note.midi)))];
}
