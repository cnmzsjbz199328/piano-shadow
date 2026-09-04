import { describe, it, expect } from 'vitest';
import { beatSeconds, beatsPerBar, computeBeatGrid } from './Metronome';

describe('beatSeconds / beatsPerBar', () => {
  it('derives from the first tempo/time-signature point, defaulting sensibly', () => {
    expect(beatSeconds({ tempoMap: [{ time: 0, bpm: 120 }] })).toBeCloseTo(0.5, 6);
    expect(beatSeconds({})).toBeCloseTo(0.5, 6); // default 120bpm
    expect(beatsPerBar({ timeSignatureMap: [{ time: 0, numerator: 3, denominator: 4 }] })).toBe(3);
    expect(beatsPerBar({})).toBe(4);
  });
});

describe('computeBeatGrid', () => {
  it('produces one beat per beatSeconds through the duration, marking downbeats', () => {
    const grid = computeBeatGrid({ tempoMap: [{ time: 0, bpm: 120 }], timeSignatureMap: [{ time: 0, numerator: 4, denominator: 4 }], duration: 2 });
    const times = grid.map((b) => Number(b.time.toFixed(3)));
    expect(times).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
    expect(grid.map((b) => b.beatInBar)).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('extends before t=0 for a count-in, without disturbing downbeat alignment', () => {
    const grid = computeBeatGrid(
      { tempoMap: [{ time: 0, bpm: 120 }], timeSignatureMap: [{ time: 0, numerator: 4, denominator: 4 }], duration: 1 },
      { leadInBeats: 4 },
    );
    const leadIn = grid.filter((b) => b.time < 0);
    expect(leadIn.map((b) => Number(b.time.toFixed(3)))).toEqual([-2, -1.5, -1, -0.5]);
    expect(leadIn.map((b) => b.beatInBar)).toEqual([0, 1, 2, 3]);
    // the song's own downbeat (time 0) still lands on beatInBar 0
    expect(grid.find((b) => Math.abs(b.time) < 1e-9)?.beatInBar).toBe(0);
  });
});
