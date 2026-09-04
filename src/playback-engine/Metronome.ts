import type { Performance } from '@/music-model';

/**
 * Pure beat-grid math for the metronome / count-in (spec §2.4). Kept free of
 * Tone/AudioContext so it is unit-testable; `PlaybackEngine` schedules the actual
 * clicks from the grid this returns.
 *
 * Simplification for v0.1: the grid follows the performance's first tempo point
 * only. A tempo-map-aware (mid-piece tempo change) metronome is a known limitation.
 */

export interface BeatGridOptions {
  /** Extra reference-seconds to render before t=0 (for a count-in of N beats). */
  leadInBeats?: number;
}

export interface Beat {
  /** Reference-timeline seconds (negative during count-in). */
  time: number;
  /** 0 = downbeat of the bar. */
  beatInBar: number;
}

export function beatSeconds(performance: Pick<Performance, 'tempoMap'>): number {
  const bpm = performance.tempoMap?.[0]?.bpm ?? 120;
  return 60 / bpm;
}

export function beatsPerBar(performance: Pick<Performance, 'timeSignatureMap'>): number {
  return performance.timeSignatureMap?.[0]?.numerator ?? 4;
}

/** Every beat from (optionally) `leadInBeats` before 0 through the end of the performance. */
export function computeBeatGrid(
  performance: Pick<Performance, 'tempoMap' | 'timeSignatureMap' | 'duration'>,
  options: BeatGridOptions = {},
): Beat[] {
  const secPerBeat = beatSeconds(performance);
  const bar = beatsPerBar(performance);
  const leadIn = Math.max(0, Math.floor(options.leadInBeats ?? 0));
  const totalBeats = Math.ceil(performance.duration / secPerBeat) + 1;

  const beats: Beat[] = [];
  for (let i = -leadIn; i <= totalBeats; i++) {
    const beatInBar = ((i % bar) + bar) % bar;
    beats.push({ time: i * secPerBeat, beatInBar });
  }
  return beats;
}
