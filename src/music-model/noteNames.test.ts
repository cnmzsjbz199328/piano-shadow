import { describe, it, expect } from 'vitest';
import { midiToNoteName, noteNameToMidi, isBlackKey, midiToFrequency, frequencyToMidi } from './noteNames';

describe('midiToNoteName', () => {
  it('places middle C at MIDI 60 = C4', () => {
    expect(midiToNoteName(60)).toBe('C4');
    expect(midiToNoteName(69)).toBe('A4');
    expect(midiToNoteName(21)).toBe('A0');
    expect(midiToNoteName(108)).toBe('C8');
    expect(midiToNoteName(61)).toBe('C#4');
    expect(midiToNoteName(0)).toBe('C-1');
  });
});

describe('noteNameToMidi', () => {
  it('parses sharps and flats', () => {
    expect(noteNameToMidi('C4')).toBe(60);
    expect(noteNameToMidi('C#4')).toBe(61);
    expect(noteNameToMidi('Db4')).toBe(61);
    expect(noteNameToMidi('A0')).toBe(21);
    expect(noteNameToMidi('C-1')).toBe(0);
  });

  it('round-trips every MIDI note 0..127', () => {
    for (let m = 0; m <= 127; m++) {
      expect(noteNameToMidi(midiToNoteName(m))).toBe(m);
    }
  });

  it('returns NaN for garbage', () => {
    expect(Number.isNaN(noteNameToMidi('nope'))).toBe(true);
    expect(Number.isNaN(noteNameToMidi('H3'))).toBe(true);
  });
});

describe('isBlackKey', () => {
  it('identifies the five black keys per octave', () => {
    const blacks = [61, 63, 66, 68, 70].map(isBlackKey);
    expect(blacks.every(Boolean)).toBe(true);
    const whites = [60, 62, 64, 65, 67, 69, 71].map(isBlackKey);
    expect(whites.some(Boolean)).toBe(false);
  });
});

describe('midiToFrequency', () => {
  it('anchors A4 = 440 Hz', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 6);
    expect(midiToFrequency(57)).toBeCloseTo(220, 6);
  });
});

describe('frequencyToMidi', () => {
  it('is the inverse of midiToFrequency', () => {
    expect(frequencyToMidi(440)).toBeCloseTo(69, 6);
    expect(frequencyToMidi(220)).toBeCloseTo(57, 6);
    expect(frequencyToMidi(261.6255653005986)).toBeCloseTo(60, 6);
  });

  it('round-trips through midiToFrequency for arbitrary notes', () => {
    for (const midi of [21, 40, 60, 69, 88, 108]) {
      expect(frequencyToMidi(midiToFrequency(midi))).toBeCloseTo(midi, 6);
    }
  });
});
