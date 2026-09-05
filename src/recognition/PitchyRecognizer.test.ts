import { describe, it, expect, beforeEach } from 'vitest';
import { PitchyRecognizer } from './PitchyRecognizer';

const SAMPLE_RATE = 44100;

/** A pure sine wave at `freqHz`, `seconds` long, at `sampleRate`. */
function sineWave(freqHz: number, seconds: number, sampleRate = SAMPLE_RATE): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    buf[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return buf;
}

describe('PitchyRecognizer', () => {
  let recognizer: PitchyRecognizer;

  beforeEach(async () => {
    recognizer = new PitchyRecognizer();
    await recognizer.initialize();
  });

  it('detects a 440 Hz sine wave as A4 (MIDI 69)', async () => {
    const notes = await recognizer.process(sineWave(440, 0.5), SAMPLE_RATE);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]!.midi).toBe(69);
    expect(notes[0]!.confidence).toBeGreaterThan(0.8);
    expect(notes[0]!.confidence).toBeLessThanOrEqual(1);
  });

  it('detects a 261.63 Hz sine wave as C4 (MIDI 60)', async () => {
    const notes = await recognizer.process(sineWave(261.63, 0.5), SAMPLE_RATE);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]!.midi).toBe(60);
  });

  it('reports an onset near the start and a duration close to the input length', async () => {
    const notes = await recognizer.process(sineWave(440, 0.5), SAMPLE_RATE);
    expect(notes[0]!.startTime).toBeLessThan(0.05);
    expect(notes[0]!.duration).toBeGreaterThan(0.3);
  });

  it('detects a change in pitch as two separate notes', async () => {
    const a = sineWave(440, 0.3);
    const b = sineWave(523.25, 0.3); // C5
    const combined = new Float32Array(a.length + b.length);
    combined.set(a, 0);
    combined.set(b, a.length);
    const notes = await recognizer.process(combined, SAMPLE_RATE);
    const midiSequence = notes.map((n) => n.midi);
    expect(midiSequence).toContain(69);
    expect(midiSequence).toContain(72);
  });

  it('returns no notes for silence', async () => {
    const silence = new Float32Array(SAMPLE_RATE * 0.5);
    const notes = await recognizer.process(silence, SAMPLE_RATE);
    expect(notes).toEqual([]);
  });

  it('throws if process() is called before initialize()', async () => {
    const fresh = new PitchyRecognizer();
    await expect(fresh.process(sineWave(440, 0.1), SAMPLE_RATE)).rejects.toThrow(/initialize/);
  });
});
