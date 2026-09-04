/**
 * Canonical music data model — the single source of truth for all practice logic.
 *
 * Spec §3: the application MUST NOT use UI state, raw MIDI events, MusicXML, or DOM
 * elements as the source of truth. Every input adapter (MIDI file, MIDI device,
 * virtual keyboard, microphone, ESP32, …) ultimately emits `NoteEvent` objects, and
 * the practice engine consumes `NoteEvent[]` only.
 */

export type NoteSource =
  | 'midi-file'
  | 'midi-device'
  | 'virtual-keyboard'
  | 'microphone'
  | 'audio-file'
  | 'esp32';

export type Hand = 'left' | 'right' | 'unknown';

/** A single sounded note, normalized to seconds-from-performance-start. */
export interface NoteEvent {
  /** Stable, deterministic identifier within a performance. */
  id: string;
  /** MIDI note number, 0–127. */
  midi: number;
  /** Scientific pitch name, e.g. "C4", "F#3". Derived from `midi`. */
  noteName: string;
  /** Onset time in seconds from the start of the performance. */
  startTime: number;
  /** Sounding duration in seconds (always > 0). */
  duration: number;
  /** MIDI velocity 0–127 when the source provides it. */
  velocity?: number;
  source: NoteSource;
  /** Reserved for microphone / model-based recognition (0–1). */
  confidence?: number;
  channel?: number;
  track?: number;
  hand?: Hand;
}

/** A point in a tempo map: at `time` seconds the tempo is `bpm` beats per minute. */
export interface TempoPoint {
  time: number;
  bpm: number;
}

/** A time-signature change, kept for metronome / beat-grid rendering. */
export interface TimeSignaturePoint {
  time: number;
  numerator: number;
  denominator: number;
}

/**
 * A complete performance: the reference to follow, or a learner attempt.
 * This is what gets persisted and what the practice engine compares.
 */
export interface Performance {
  id: string;
  name: string;
  notes: NoteEvent[];
  /** Total length in seconds (>= last note end). */
  duration: number;
  tempoMap?: TempoPoint[];
  timeSignatureMap?: TimeSignaturePoint[];
  sourceType: NoteSource;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}
