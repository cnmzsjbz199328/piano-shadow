export type {
  NoteEvent,
  NoteSource,
  Hand,
  Performance,
  TempoPoint,
  TimeSignaturePoint,
} from './types';
export {
  midiToNoteName,
  noteNameToMidi,
  isBlackKey,
  semitoneDistance,
  midiToFrequency,
  frequencyToMidi,
} from './noteNames';
export { makeIdFactory, randomId } from './ids';
export { inferHands, HAND_SPLIT_MIDI } from './hands';
export {
  sortNotes,
  normalizeNotes,
  buildPerformance,
  performanceDuration,
  MIN_NOTE_DURATION,
  type NormalizeOptions,
  type BuildPerformanceOptions,
} from './performance';
