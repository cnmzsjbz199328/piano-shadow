import type { NoteEvent, Performance } from '@/music-model';

export type PracticeVoice = 'both' | 'left' | 'right';

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

/**
 * Slack around a group's onset when deciding whether it is "now", absorbing
 * the gap between successive `currentTime` ticks (a `requestAnimationFrame`
 * cadence) so the target doesn't flicker off for a frame right at the onset.
 */
export const CURRENT_ONSET_WINDOW_SECONDS = 0.05;

/**
 * The onset group sounding now — the chord a learner should be playing this
 * instant. This is the *most recent* onset at or before `currentTime`, not
 * just any still-sounding one: an older sustained note (already played, still
 * ringing under a later chord) must never outrank that later chord as "the"
 * current target. Empty once the most recent onset has already finished (a
 * rest) rather than falling back to that earlier sustain.
 */
export function currentOnsetGroup(notes: readonly NoteEvent[], currentTime: number): NoteEvent[] {
  const groups = groupNotesByOnset(notes);
  let candidate: OnsetGroup | undefined;
  for (const group of groups) {
    if (group.startTime > currentTime + CURRENT_ONSET_WINDOW_SECONDS) break;
    candidate = group;
  }
  if (!candidate) return [];
  const stillSounding = candidate.notes.some((note) => note.startTime + note.duration > currentTime - CURRENT_ONSET_WINDOW_SECONDS);
  return stillSounding ? candidate.notes : [];
}

/** The onset group immediately after the current one, for a one-chord preview. */
export function nextOnsetGroup(notes: readonly NoteEvent[], currentTime: number): NoteEvent[] {
  const groups = groupNotesByOnset(notes);
  const next = groups.find((group) => group.startTime > currentTime + CURRENT_ONSET_WINDOW_SECONDS);
  return next?.notes ?? [];
}
