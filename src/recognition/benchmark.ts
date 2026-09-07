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

/**
 * Equal-amplitude additive synthesis of several pitches at once, peak-normalised
 * so the sum never clips. This is the crux of the polyphony benchmark: a
 * monophonic detector (autocorrelation / MPM, i.e. `PitchyRecognizer`) sees one
 * periodic waveform and can only ever report one fundamental, so on a chord it
 * locks to a single voice (or nothing, when the summed signal has no clear
 * period). A polyphonic model (`BasicPitchRecognizer`) can pull the separate
 * notes back out.
 */
function additiveChord(midis: readonly number[], seconds: number, sampleRate: number): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const buf = new Float32Array(n);
  const freqs = midis.map(midiToFrequency);
  const scale = freqs.length > 0 ? 1 / freqs.length : 1;
  for (let i = 0; i < n; i++) {
    let sample = 0;
    for (const freq of freqs) sample += Math.sin((2 * Math.PI * freq * i) / sampleRate);
    buf[i] = sample * scale;
  }
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

// --- polyphony / chord benchmark (ROUND_3_REQUIREMENTS §D.1.1) ---

export interface BenchmarkChord {
  label: string;
  /** The simultaneous pitches, low to high. */
  midis: number[];
  durationSeconds: number;
}

export interface ChordCaseResult {
  label: string;
  expectedMidis: number[];
  /** Distinct pitches the recognizer reported anywhere in the clip. */
  detectedMidis: number[];
  /** `expected ∩ detected` — the chord tones it actually resolved. */
  matchedMidis: number[];
  /** `detected \ expected` — phantom pitches (difference tones, octave errors). */
  extraMidis: number[];
  /** `matchedMidis.length / expectedMidis.length`, 0–1. */
  recall: number;
  processingMs: number;
}

export interface PolyphonyBenchmarkResult {
  recognizerName: string;
  cases: ChordCaseResult[];
  meanRecall: number;
  meanProcessingMs: number;
  /** Most chord tones any single case resolved. */
  maxVoicesResolved: number;
  /** True when no case resolved more than one chord tone — a monophonic detector. */
  monophonicOnly: boolean;
}

/** Intervals then triads then a 7th — increasing polyphony, all in a practical range. */
export const DEFAULT_BENCHMARK_CHORDS: BenchmarkChord[] = [
  { label: 'M3 (C4+E4)', midis: [60, 64], durationSeconds: 0.6 },
  { label: 'P5 (C4+G4)', midis: [60, 67], durationSeconds: 0.6 },
  { label: 'C major (C4+E4+G4)', midis: [60, 64, 67], durationSeconds: 0.6 },
  { label: 'A minor (A3+C4+E4)', midis: [57, 60, 64], durationSeconds: 0.6 },
  { label: 'G7 (G3+B3+D4+F4)', midis: [55, 59, 62, 65], durationSeconds: 0.6 },
];

export async function benchmarkPolyphony(
  recognizerName: string,
  recognizer: NoteRecognizer,
  chords: readonly BenchmarkChord[] = DEFAULT_BENCHMARK_CHORDS,
  sampleRate = SAMPLE_RATE,
): Promise<PolyphonyBenchmarkResult> {
  await recognizer.initialize();

  const cases: ChordCaseResult[] = [];
  for (const chord of chords) {
    const audio = additiveChord(chord.midis, chord.durationSeconds, sampleRate);
    const start = performance.now();
    const detected = await recognizer.process(audio, sampleRate);
    const processingMs = performance.now() - start;

    const expected = [...chord.midis].sort((a, b) => a - b);
    const detectedMidis = [...new Set(detected.map((n) => n.midi))].sort((a, b) => a - b);
    const expectedSet = new Set(expected);
    const matchedMidis = detectedMidis.filter((m) => expectedSet.has(m));
    const extraMidis = detectedMidis.filter((m) => !expectedSet.has(m));

    cases.push({
      label: chord.label,
      expectedMidis: expected,
      detectedMidis,
      matchedMidis,
      extraMidis,
      recall: expected.length > 0 ? matchedMidis.length / expected.length : 0,
      processingMs,
    });
  }

  const maxVoicesResolved = cases.reduce((max, c) => Math.max(max, c.matchedMidis.length), 0);
  return {
    recognizerName,
    cases,
    meanRecall: cases.reduce((sum, c) => sum + c.recall, 0) / cases.length,
    meanProcessingMs: cases.reduce((sum, c) => sum + c.processingMs, 0) / cases.length,
    maxVoicesResolved,
    monophonicOnly: maxVoicesResolved <= 1,
  };
}
