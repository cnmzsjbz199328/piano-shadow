import { normalizeNotes, type NoteEvent, type NoteSource } from '@/music-model';
import type { DetectedNote } from './NoteRecognizer';

/**
 * Shapes a recognizer's raw `DetectedNote[]` into canonical `NoteEvent[]` so it can
 * be handed to `practice-engine`'s `evaluatePerformance` for a MIDI-ground-truth
 * comparison (spec §36). Reuses `music-model.normalizeNotes` for id assignment,
 * note-name derivation, and sorting rather than duplicating that logic here.
 *
 * `normalizeNotes`'s shared `RawNote` shape doesn't carry `confidence` through (no
 * other adapter sets it), so it's dropped here too — harmless, since
 * `evaluatePerformance` never reads it. The Lab visualizes confidence straight off
 * each recognizer's `DetectedNote[]`, before this conversion.
 */
export function detectedNotesToNoteEvents(
  detected: readonly DetectedNote[],
  source: NoteSource = 'microphone',
): NoteEvent[] {
  return normalizeNotes(detected, { source, idPrefix: source });
}
