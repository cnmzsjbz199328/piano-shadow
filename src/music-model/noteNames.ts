/** MIDI note number <-> scientific pitch name, plus small pitch helpers. */

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/**
 * Scientific pitch notation with middle C (MIDI 60) = C4.
 * MIDI 0 = C-1, MIDI 127 = G9.
 */
export function midiToNoteName(midi: number): string {
  const m = Math.round(midi);
  const pitchClass = ((m % 12) + 12) % 12;
  const octave = Math.floor(m / 12) - 1;
  return `${SHARP_NAMES[pitchClass]}${octave}`;
}

const NAME_TO_PITCH_CLASS: Record<string, number> = {
  C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5,
  'F#': 6, GB: 6, G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11,
};

/** Parse "C4", "F#3", "Bb2" -> MIDI number. Returns NaN if unparseable. */
export function noteNameToMidi(name: string): number {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim());
  if (!match) return NaN;
  const letter = match[1]!;
  const accidental = match[2] ?? '';
  const octaveStr = match[3]!;
  const key = (letter.toUpperCase() + (accidental === 'b' ? 'B' : accidental)).toUpperCase();
  const pitchClass = NAME_TO_PITCH_CLASS[key];
  if (pitchClass === undefined) return NaN;
  const octave = Number.parseInt(octaveStr, 10);
  return (octave + 1) * 12 + pitchClass;
}

export function isBlackKey(midi: number): boolean {
  const pitchClass = ((Math.round(midi) % 12) + 12) % 12;
  return pitchClass === 1 || pitchClass === 3 || pitchClass === 6 || pitchClass === 8 || pitchClass === 10;
}

/** Signed semitone distance from `a` to `b` (b - a). */
export function semitoneDistance(a: number, b: number): number {
  return b - a;
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Inverse of {@link midiToFrequency}: Hz -> fractional MIDI note number (not rounded). */
export function frequencyToMidi(frequencyHz: number): number {
  return 69 + 12 * Math.log2(frequencyHz / 440);
}
