/**
 * Minimal Web MIDI API surface used by `WebMidiAdapter`. TypeScript's bundled DOM
 * lib ships a `MIDIAccess`/`MIDIInput` declaration, but `MIDIInputMap` there only
 * exposes `forEach` — not the `Map`-like `.get()`/`.values()` every browser actually
 * implements — so the subset this adapter needs is declared locally instead.
 */

export interface MIDIMessageEventLike {
  data: Uint8Array | null;
}

export interface MIDIPortLike extends EventTarget {
  id: string;
  name?: string | null;
  manufacturer?: string | null;
  state: 'connected' | 'disconnected';
  connection: 'open' | 'closed' | 'pending';
}

export interface MIDIInputLike extends MIDIPortLike {
  onmidimessage: ((event: MIDIMessageEventLike) => void) | null;
}

export interface MIDIAccessLike extends EventTarget {
  inputs: ReadonlyMap<string, MIDIInputLike>;
  onstatechange: ((event: Event) => void) | null;
}

export interface NavigatorWithMIDI {
  requestMIDIAccess(options?: { sysex?: boolean }): Promise<MIDIAccessLike>;
}

export function getMidiCapableNavigator(): NavigatorWithMIDI | null {
  if (typeof navigator === 'undefined') return null;
  return 'requestMIDIAccess' in navigator ? (navigator as unknown as NavigatorWithMIDI) : null;
}
