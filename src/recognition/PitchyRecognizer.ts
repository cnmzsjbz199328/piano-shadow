import { PitchDetector } from 'pitchy';
import { frequencyToMidi } from '@/music-model';
import type { DetectedNote, NoteRecognizer } from './NoteRecognizer';

/**
 * Monophonic pitch-detection baseline (spec §15/§36 "single-note pitch detection
 * baseline"). Wraps `pitchy`'s McLeod Pitch Method detector (MIT license, spec §14
 * "prefer independently licensed libraries") with a simple frame-based note
 * segmenter: run pitch detection over a sliding window, then collapse contiguous
 * runs of the same stable pitch into discrete `DetectedNote`s.
 *
 * This is a baseline, not a production transcriber — octave errors and missed
 * onsets on legato passages are expected; see doc/MICROPHONE_LAB_FINDINGS.md for
 * measured accuracy.
 */

const FRAME_SIZE = 2048;
const HOP_SIZE = 512;
/** pitchy recommends 0.8-1 for the MPM clarity threshold; skew high to favor precision. */
const CLARITY_THRESHOLD = 0.9;
/** Below this, treat the frame as silence rather than trusting a low-confidence pitch. */
const MIN_VOLUME_DECIBELS = -35;
/** Drop segmented "notes" shorter than this many samples — single-frame blips, not real onsets. */
const MIN_NOTE_SAMPLES = HOP_SIZE * 2;

interface Frame {
  time: number;
  midi: number | null;
  clarity: number;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export class PitchyRecognizer implements NoteRecognizer {
  private detector: PitchDetector<Float32Array> | null = null;

  async initialize(): Promise<void> {
    const detector = PitchDetector.forFloat32Array(FRAME_SIZE);
    detector.clarityThreshold = CLARITY_THRESHOLD;
    detector.minVolumeDecibels = MIN_VOLUME_DECIBELS;
    this.detector = detector;
  }

  async process(audio: Float32Array, sampleRate: number): Promise<DetectedNote[]> {
    const detector = this.detector;
    if (!detector) throw new Error('PitchyRecognizer.process() called before initialize()');

    const frames: Frame[] = [];
    const frameBuffer = new Float32Array(FRAME_SIZE);
    for (let start = 0; start === 0 || start < audio.length; start += HOP_SIZE) {
      const end = Math.min(start + FRAME_SIZE, audio.length);
      frameBuffer.fill(0);
      frameBuffer.set(audio.subarray(start, end));
      const [freq, clarity] = detector.findPitch(frameBuffer, sampleRate);
      const midi = freq > 0 && clarity >= CLARITY_THRESHOLD ? Math.round(frequencyToMidi(freq)) : null;
      frames.push({ time: start / sampleRate, midi, clarity });
      if (end >= audio.length) break;
    }

    const notes: DetectedNote[] = [];
    let run: { midi: number; startTime: number; clarities: number[] } | null = null;
    const hopSeconds = HOP_SIZE / sampleRate;

    const flush = (endTime: number) => {
      if (run && endTime - run.startTime >= MIN_NOTE_SAMPLES / sampleRate) {
        notes.push({
          midi: run.midi,
          startTime: run.startTime,
          duration: endTime - run.startTime,
          confidence: Math.min(1, Math.max(0, average(run.clarities))),
        });
      }
      run = null;
    };

    for (const frame of frames) {
      if (frame.midi === null) {
        flush(frame.time);
        continue;
      }
      if (run && run.midi === frame.midi) {
        run.clarities.push(frame.clarity);
        continue;
      }
      flush(frame.time);
      run = { midi: frame.midi, startTime: frame.time, clarities: [frame.clarity] };
    }
    flush((frames.at(-1)?.time ?? 0) + hopSeconds);

    return notes;
  }
}
