import { describe, it, expect } from 'vitest';
import { pin, refFromTransport, transportFromRef } from './timeMapping';

describe('timeMapping', () => {
  it('at scale 1 and a zero pin, ref and transport time are identical', () => {
    const origin = pin(0, 0, 1);
    expect(refFromTransport(origin, 5)).toBeCloseTo(5, 6);
    expect(transportFromRef(origin, 5)).toBeCloseTo(5, 6);
  });

  it('half speed (scale 0.5): the song takes twice as long in transport time', () => {
    const origin = pin(0, 0, 0.5);
    // reference second 2 should occur 4 transport-seconds in
    expect(transportFromRef(origin, 2)).toBeCloseTo(4, 6);
    expect(refFromTransport(origin, 4)).toBeCloseTo(2, 6);
  });

  it('double speed (scale 2): the song takes half as long in transport time', () => {
    const origin = pin(0, 0, 2);
    expect(transportFromRef(origin, 4)).toBeCloseTo(2, 6);
  });

  it('a mid-stream pin (e.g. after a seek) offsets correctly', () => {
    // seeked to reference second 10 while transport reads 3, then played at scale 1
    const origin = pin(3, 10, 1);
    expect(refFromTransport(origin, 3)).toBeCloseTo(10, 6);
    expect(refFromTransport(origin, 5)).toBeCloseTo(12, 6);
    expect(transportFromRef(origin, 12)).toBeCloseTo(5, 6);
  });

  it('round-trips for arbitrary origins and scales', () => {
    for (const scale of [0.25, 0.5, 1, 1.5, 2]) {
      const origin = pin(7.3, -2.5, scale); // negative refSec models a count-in
      for (const ref of [-2.5, -1, 0, 3.14, 20]) {
        const t = transportFromRef(origin, ref);
        expect(refFromTransport(origin, t)).toBeCloseTo(ref, 6);
      }
    }
  });
});
