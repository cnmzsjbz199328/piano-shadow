/**
 * Microphone recognition boundary (spec §15). The UI currently uses the
 * conservative monophonic Pitchy implementation through MicrophoneAdapter.
 * This interface keeps future recognizers replaceable so a future adapter
 * (PitchyRecognizer, BasicPitchRecognizer, TranskunRecognizer, …) can plug into the
 * same `NoteInputAdapter` pipeline without the practice engine ever knowing a
 * microphone was involved: the engine only ever receives `NoteEvent[]`.
 *
 * Recognizers remain replaceable and the product UI labels microphone input as
 * single-note recognition with clear failure states.
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
