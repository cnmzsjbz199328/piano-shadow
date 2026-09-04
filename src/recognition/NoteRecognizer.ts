/**
 * Microphone recognition boundary (spec §15). NOT part of the v0.1 mandatory MVP —
 * no implementation ships yet. This interface exists so a future adapter
 * (PitchyRecognizer, BasicPitchRecognizer, TranskunRecognizer, …) can plug into the
 * same `NoteInputAdapter` pipeline without the practice engine ever knowing a
 * microphone was involved: the engine only ever receives `NoteEvent[]`.
 *
 * Do not implement against this interface until an approach has been benchmarked
 * (spec §25: "claim microphone transcription works before it is actually benchmarked").
 */

export interface DetectedNote {
  midi: number;
  startTime: number;
  duration: number;
  /** 0–1 recognizer confidence, surfaced as `NoteEvent.confidence`. */
  confidence: number;
}

export interface NoteRecognizer {
  initialize(): Promise<void>;
  process(audio: Float32Array, sampleRate: number): Promise<DetectedNote[]>;
}
