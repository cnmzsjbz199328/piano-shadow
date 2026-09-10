/**
 * Seconds -> beats -> note-value mapping for the staff-notation view (Track F,
 * v0.8.0). Kept as a pure module with no VexFlow / DOM dependency so it is unit
 * testable in isolation (spec §12 layer separation).
 *
 * APPROXIMATE BY DESIGN (v0.8.0): every duration is mapped to a single plain
 * note value from {1/1, 1/2, 1/4, 1/8, 1/16}. There is no dotted-note, tuplet,
 * or tied-note support, so e.g. a 1.5-beat duration is reported as the single
 * closest plain value. `ScoreView` decomposes *rests* greedily (a gap of 1.5
 * beats becomes a quarter + an eighth rest) but *notes* are always one symbol.
 * This is a display transform of user-supplied MIDI, not transcription — see
 * `doc/ARCHITECTURE.md` "Staff-notation view — scope".
 */

/** VexFlow duration codes for the plain note values we bucket to. */
export type NoteValueCode = '1' | '2' | '4' | '8' | '16';

/** One whole note spans four quarter-note beats (independent of time signature). */
const QUARTERS_PER_WHOLE = 4;

/** Each supported note value as a fraction of a whole note, longest first. */
export const NOTE_VALUE_FRACTIONS: ReadonlyArray<{ code: NoteValueCode; fraction: number }> = [
  { code: '1', fraction: 1 },
  { code: '2', fraction: 1 / 2 },
  { code: '4', fraction: 1 / 4 },
  { code: '8', fraction: 1 / 8 },
  { code: '16', fraction: 1 / 16 },
];

/** Seconds per quarter-note beat at `bpm` (falls back to 120 for a bad tempo). */
export function secondsPerQuarter(bpm: number): number {
  return 60 / (Number.isFinite(bpm) && bpm > 0 ? bpm : 120);
}

/** Length in seconds of one whole note at `bpm`. */
export function wholeNoteSeconds(bpm: number): number {
  return secondsPerQuarter(bpm) * QUARTERS_PER_WHOLE;
}

/** Length in seconds of a given plain note value at `bpm`. */
export function noteValueSeconds(code: NoteValueCode, bpm: number): number {
  const entry = NOTE_VALUE_FRACTIONS.find((n) => n.code === code);
  return (entry ? entry.fraction : 1 / 4) * wholeNoteSeconds(bpm);
}

/**
 * Map a duration in seconds to the nearest plain note value (1/1 … 1/16) at a
 * given quarter-note tempo.
 *
 * "Nearest" is measured on a log2 (musical) scale: the gap between a quarter and
 * an eighth is the same as between an eighth and a sixteenth, matching how note
 * values actually relate. Anything longer than a whole note clamps to "1";
 * anything shorter than a sixteenth (or non-finite / non-positive) clamps to
 * "16".
 *
 * Examples (4/4, 120 bpm -> 0.5 s per quarter):
 *   0.5  s -> "4"   (quarter)
 *   0.25 s -> "8"   (eighth)
 *   1.0  s -> "2"   (half)
 *   2.0  s -> "1"   (whole)
 *   0.125 s -> "16" (sixteenth)
 */
export function secondsToNoteValue(seconds: number, bpm: number): NoteValueCode {
  const fraction = seconds / wholeNoteSeconds(bpm);
  if (!Number.isFinite(fraction) || fraction <= 0) return '16';
  if (fraction >= 1) return '1';
  if (fraction <= 1 / 16) return '16';

  const target = Math.log2(fraction);
  let best: NoteValueCode = '4';
  let bestDistance = Infinity;
  for (const { code, fraction: candidate } of NOTE_VALUE_FRACTIONS) {
    const distance = Math.abs(target - Math.log2(candidate));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = code;
    }
  }
  return best;
}

/**
 * Greedily decompose a gap in seconds into a sequence of plain rest values,
 * longest first (e.g. 1.5 beats -> ["4", "8"], 3 beats -> ["2", "4"]). Used for
 * rests only — rests don't need ties, so this stays exact-ish without dotted
 * values. Returns [] for a gap shorter than ~half a sixteenth.
 */
export function decomposeRest(seconds: number, bpm: number): NoteValueCode[] {
  const sixteenth = noteValueSeconds('16', bpm);
  if (!Number.isFinite(seconds) || seconds < sixteenth * 0.5) return [];

  const out: NoteValueCode[] = [];
  let remaining = seconds;
  // Bounded: each iteration removes at least one sixteenth of duration.
  for (let guard = 0; guard < 64 && remaining >= sixteenth * 0.5; guard += 1) {
    const pick =
      NOTE_VALUE_FRACTIONS.find((n) => noteValueSeconds(n.code, bpm) <= remaining + sixteenth * 0.25)
        ?.code ?? '16';
    out.push(pick);
    remaining -= noteValueSeconds(pick, bpm);
  }
  return out;
}
