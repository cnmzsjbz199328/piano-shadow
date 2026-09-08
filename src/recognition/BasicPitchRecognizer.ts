import type * as BasicPitchModule from '@spotify/basic-pitch';
import type { DetectedNote, NoteRecognizer } from './NoteRecognizer';

/** Basic Pitch's model expects mono audio at exactly this sample rate. */
const MODEL_SAMPLE_RATE = 22050;
const ONSET_THRESHOLD = 0.5;
const FRAME_THRESHOLD = 0.3;
const MIN_NOTE_LEN_FRAMES = 5;

/**
 * Polyphonic-capable benchmark recognizer (spec §36 "Basic Pitch benchmark"),
 * wrapping Spotify's Basic Pitch (Apache-2.0 — spec §14 "prefer independently
 * licensed libraries/models"). `@spotify/basic-pitch` (and the TensorFlow.js it
 * depends on) is imported dynamically in `initialize()`, not at module load time,
 * so it never touches the main app bundle — only this experimental Lab page pays
 * for it, and only once a user actually runs a Basic Pitch comparison. The model
 * weights are served from `public/basic-pitch-model/` (copied from the installed
 * package) rather than fetched from a third-party CDN.
 */
export class BasicPitchRecognizer implements NoteRecognizer {
  private basicPitch: BasicPitchModule.BasicPitch | null = null;
  private exports: typeof BasicPitchModule | null = null;

  async initialize(): Promise<void> {
    const mod = await import('@spotify/basic-pitch');
    this.exports = mod;
    const modelUrl = `${import.meta.env.BASE_URL}basic-pitch-model/model.json`;
    this.basicPitch = new mod.BasicPitch(modelUrl);
  }

  async process(audio: Float32Array, sampleRate: number): Promise<DetectedNote[]> {
    if (!this.basicPitch || !this.exports) {
      throw new Error('BasicPitchRecognizer.process() called before initialize()');
    }
    if (audio.length === 0) return [];

    const resampled = await resampleTo(audio, sampleRate, MODEL_SAMPLE_RATE);

    let frames: number[][] = [];
    let onsets: number[][] = [];
    let contours: number[][] = [];
    await this.basicPitch.evaluateModel(
      resampled,
      (f, o, c) => {
        frames = f;
        onsets = o;
        contours = c;
      },
      () => {
        /* progress callback: no incremental UI for a batch Lab run */
      },
    );

    const { outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } = this.exports;
    const notes = noteFramesToTime(
      addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, ONSET_THRESHOLD, FRAME_THRESHOLD, MIN_NOTE_LEN_FRAMES)),
    );

    return notes.map((n) => ({
      midi: Math.round(n.pitchMidi),
      startTime: n.startTimeSeconds,
      duration: n.durationSeconds,
      confidence: Math.min(1, Math.max(0, n.amplitude)),
    }));
  }
}

/**
 * Resamples mono audio from `fromRate` to `toRate` via an `OfflineAudioContext`
 * render pass, returned as an `AudioBuffer` — the shape `BasicPitch.evaluateModel`
 * validates against (it only checks sample rate/channel count on the `AudioBuffer`
 * path, not on a raw `Float32Array`, so passing an un-resampled array would be
 * silently misinterpreted rather than rejected).
 */
async function resampleTo(audio: Float32Array, fromRate: number, toRate: number): Promise<AudioBuffer> {
  const sourceCtx = new OfflineAudioContext(1, audio.length, fromRate);
  const sourceBuffer = sourceCtx.createBuffer(1, audio.length, fromRate);
  // `copyToChannel` wants a plain-`ArrayBuffer`-backed Float32Array; `audio` is
  // typed as the more general `ArrayBufferLike`-backed variant, so copy it in.
  sourceBuffer.copyToChannel(Float32Array.from(audio), 0);

  const targetLength = Math.max(1, Math.ceil((audio.length * toRate) / fromRate));
  const offlineCtx = new OfflineAudioContext(1, targetLength, toRate);
  const bufferSource = offlineCtx.createBufferSource();
  bufferSource.buffer = sourceBuffer;
  bufferSource.connect(offlineCtx.destination);
  bufferSource.start();
  return offlineCtx.startRendering();
}
