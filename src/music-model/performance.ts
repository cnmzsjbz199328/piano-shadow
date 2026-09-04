import type { NoteEvent, NoteSource, Performance } from './types';
import { midiToNoteName } from './noteNames';
import { makeIdFactory, randomId } from './ids';

/** Sort notes into a canonical order: by onset, then pitch, then id. */
export function sortNotes(notes: readonly NoteEvent[]): NoteEvent[] {
  return [...notes].sort(
    (a, b) => a.startTime - b.startTime || a.midi - b.midi || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Minimum enforced note duration in seconds (guards against zero-length notes). */
export const MIN_NOTE_DURATION = 0.01;

export interface NormalizeOptions {
  source: NoteSource;
  /** Prefix for generated note ids; keep stable for deterministic output. */
  idPrefix?: string;
}

interface RawNote {
  midi: number;
  startTime: number;
  duration: number;
  velocity?: number;
  channel?: number;
  track?: number;
}

/**
 * Turn loosely-shaped notes (from any adapter) into canonical `NoteEvent[]`:
 * fills `noteName`, assigns deterministic ids, clamps pitch/duration, and sorts.
 */
export function normalizeNotes(raw: readonly RawNote[], opts: NormalizeOptions): NoteEvent[] {
  const nextId = makeIdFactory(opts.idPrefix ?? 'n');
  // Sort by canonical order *before* assigning ids so `${prefix}-0` is always the
  // first note chronologically, regardless of the order the adapter emitted them.
  const ordered = raw
    .filter((n) => Number.isFinite(n.midi) && Number.isFinite(n.startTime))
    .slice()
    .sort((a, b) => a.startTime - b.startTime || a.midi - b.midi);
  const events: NoteEvent[] = ordered
    .map((n) => {
      const midi = Math.min(127, Math.max(0, Math.round(n.midi)));
      const startTime = Math.max(0, n.startTime);
      const duration = Math.max(MIN_NOTE_DURATION, n.duration);
      const event: NoteEvent = {
        id: nextId(),
        midi,
        noteName: midiToNoteName(midi),
        startTime,
        duration,
        source: opts.source,
      };
      if (n.velocity !== undefined) event.velocity = clamp(Math.round(n.velocity), 0, 127);
      if (n.channel !== undefined) event.channel = n.channel;
      if (n.track !== undefined) event.track = n.track;
      return event;
    });
  return sortNotes(events);
}

export function performanceDuration(notes: readonly NoteEvent[], min = 0): number {
  let end = min;
  for (const n of notes) end = Math.max(end, n.startTime + n.duration);
  return end;
}

export interface BuildPerformanceOptions extends NormalizeOptions {
  name: string;
  id?: string;
  createdAt?: string;
  tempoMap?: Performance['tempoMap'];
  timeSignatureMap?: Performance['timeSignatureMap'];
}

export function buildPerformance(raw: readonly RawNote[], opts: BuildPerformanceOptions): Performance {
  const notes = normalizeNotes(raw, opts);
  const performance: Performance = {
    id: opts.id ?? randomId('perf'),
    name: opts.name,
    notes,
    duration: performanceDuration(notes),
    sourceType: opts.source,
    createdAt: opts.createdAt ?? new Date().toISOString(),
  };
  if (opts.tempoMap) performance.tempoMap = opts.tempoMap;
  if (opts.timeSignatureMap) performance.timeSignatureMap = opts.timeSignatureMap;
  return performance;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
