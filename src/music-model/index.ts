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
} from './noteNames';
export { makeIdFactory, randomId } from './ids';
export {
  sortNotes,
  normalizeNotes,
  buildPerformance,
  performanceDuration,
  MIN_NOTE_DURATION,
  type NormalizeOptions,
  type BuildPerformanceOptions,
} from './performance';
