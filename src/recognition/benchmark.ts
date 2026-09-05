import { midiToFrequency, midiToNoteName } from '@/music-model';
import type { DetectedNote, NoteRecognizer } from './NoteRecognizer';

/**
 * Synthetic-audio latency/accuracy benchmark (spec §36 "latency measurements",
 * doc/NEXT_ROUND_REQUIREMENTS.md B.4's "written findings"). Generates known
 * sine-wave tones and measures each recognizer's pitch accuracy and processing
 * latency against ground truth this module controls — deterministic and
 * repeatable, unlike a live microphone/room-noise test.
 *
 * Environment-agnostic: it only calls `NoteRecognizer.initialize()`/`process()`,
 * so it runs headlessly (Vitest/Node) against `PitchyRecognizer`, and in a real
 * browser against `BasicPitchRecognizer` too (which needs `OfflineAudioContext` —
 * unavailable under jsdom/Node, so that recognizer's numbers come from running
 * this same function from the Lab page, not from the Node test run).
 */

export interface BenchmarkTone {
  label: string;
  midi: number;
  durationSeconds: number;
}

export interface BenchmarkCaseResult {
  label: string;
  expectedMidi: number;
  detectedMidi: number | null;
  correct: boolean;
  confidence: number | null;
  processingMs: number;
}

export interface RecognizerBenchmarkResult {
  recognizerName: string;
  cases: BenchmarkCaseResult[];
  accuracyPercent: number;
  meanProcessingMs: number;
}

const SAMPLE_RATE = 44100;

/** A spread across the piano's practical range, one tone per octave-ish step. */
export const DEFAULT_BENCHMARK_TONES: BenchmarkTone[] = [48, 55, 60, 64, 67, 69, 72, 76, 81].map((midi) => ({
  label: midiToNoteName(midi),
  midi,
  durationSeconds: 0.5,
}));

function sineWave(freqHz: number, seconds: number, sampleRate: number): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  return buf;
}

/** The most prominent detection for a single-tone case: the longest-duration note. */
function primaryDetection(detected: readonly DetectedNote[]): DetectedNote | null {
  if (detected.length === 0) return null;
  return detected.reduce((best, n) => (n.duration > best.duration ? n : best));
}

export async function benchmarkRecognizer(
  recognizerName: string,
  recognizer: NoteRecognizer,
  tones: readonly BenchmarkTone[] = DEFAULT_BENCHMARK_TONES,
  sampleRate = SAMPLE_RATE,
): Promise<RecognizerBenchmarkResult> {
  await recognizer.initialize();

  const cases: BenchmarkCaseResult[] = [];
  for (const tone of tones) {
    const audio = sineWave(midiToFrequency(tone.midi), tone.durationSeconds, sampleRate);
    const start = performance.now();
    const detected = await recognizer.process(audio, sampleRate);
    const processingMs = performance.now() - start;
    const best = primaryDetection(detected);
    cases.push({
      label: tone.label,
      expectedMidi: tone.midi,
      detectedMidi: best?.midi ?? null,
      correct: best?.midi === tone.midi,
      confidence: best?.confidence ?? null,
      processingMs,
    });
  }

  const correctCount = cases.filter((c) => c.correct).length;
  return {
    recognizerName,
    cases,
    accuracyPercent: (correctCount / cases.length) * 100,
    meanProcessingMs: cases.reduce((sum, c) => sum + c.processingMs, 0) / cases.length,
  };
}
