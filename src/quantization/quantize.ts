import type { NoteEvent } from '@/music-model';

/**
 * Rhythm quantization (spec §16). Kept as a pure, non-destructive transform: it
 * always returns a *new* note array, so a caller can keep both the raw performance
 * timing and the quantized musical timing side by side — required for the future
 * Teach Mode capture pipeline (record → transcribe → quantize → reference).
 */

export interface QuantizeOptions {
  /** Grid spacing in seconds (e.g. one 16th note at the reference tempo). */
  gridSeconds: number;
  /** 0 = no snapping (raw), 1 = snap fully onto the grid. Default 1. */
  strength?: number;
}

export function secondsPerBeat(bpm: number): number {
  return 60 / bpm;
}

/** Grid spacing for a beat subdivided into `subdivision` equal parts (4 = 16th notes at a quarter-note beat). */
export function gridSecondsFor(bpm: number, subdivision = 4): number {
  return secondsPerBeat(bpm) / subdivision;
}

export function quantizeTime(time: number, options: QuantizeOptions): number {
  const strength = options.strength ?? 1;
  if (options.gridSeconds <= 0 || strength <= 0) return time;
  const snapped = Math.round(time / options.gridSeconds) * options.gridSeconds;
  return time + (snapped - time) * Math.min(1, strength);
}

/** Snap note onsets (and shift durations to match) onto a fixed grid; input is left untouched. */
export function quantizeNotes(notes: readonly NoteEvent[], options: QuantizeOptions): NoteEvent[] {
  return notes.map((n) => {
    const start = quantizeTime(n.startTime, options);
    const end = quantizeTime(n.startTime + n.duration, options);
    return { ...n, startTime: start, duration: Math.max(0.01, end - start) };
  });
}
