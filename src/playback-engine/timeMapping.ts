/**
 * The reference-time <-> transport-time mapping (spec §2.4: "Playback timing and
 * the UI playhead MUST derive from the same authoritative clock. Avoid independent
 * timers that can drift.").
 *
 * `PlaybackEngine` drives everything from a single running clock — Tone.Transport's
 * `seconds`, which advances at real-audio-clock speed and is unaffected by tempo
 * scale or count-in. This module is the pure math that maps a point on that clock
 * to "where we are in the performance" (reference seconds) and back, pinned at
 * whichever moment playback last started, seeked, or had its tempo scale changed.
 * Kept dependency-free from Tone/AudioContext so it is unit-testable in isolation.
 */

export interface TimeOrigin {
  /** Transport.seconds at the pin point. */
  transportSec: number;
  /** The reference-time that transportSec corresponds to. */
  refSec: number;
  /** Reference-seconds elapsed per transport-second (1 / playback speed). */
  scale: number;
}

export function pin(transportSec: number, refSec: number, scale: number): TimeOrigin {
  return { transportSec, refSec, scale };
}

/** Reference-timeline seconds at a given transport time. */
export function refFromTransport(origin: TimeOrigin, transportSec: number): number {
  return origin.refSec + (transportSec - origin.transportSec) * origin.scale;
}

/** Transport time at which a given reference-timeline second occurs. */
export function transportFromRef(origin: TimeOrigin, refSec: number): number {
  return origin.transportSec + (refSec - origin.refSec) / origin.scale;
}
