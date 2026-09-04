import { buildPerformance, MIN_NOTE_DURATION, type NoteSource, type Performance } from '@/music-model';
import type { AdapterNoteOff, AdapterNoteOn, NoteInputAdapter } from './types';

/**
 * Records note-on/note-off pairs from one adapter into a `Performance` (spec §2.2,
 * §17). Never silently drops a note-off: an off with no matching open note is kept
 * as a warning, and any note still held when the attempt stops is closed at the
 * stop time rather than discarded (spec §25).
 */

export type RecorderWarning =
  | { type: 'unmatched-note-off'; midi: number; time: number }
  | { type: 'held-at-stop'; midi: number; startTime: number; stopTime: number };

interface OpenNote {
  startTime: number;
  velocity?: number;
}

export class PerformanceRecorder {
  private readonly source: NoteSource;
  private readonly pending = new Map<number, OpenNote[]>();
  private completed: Array<{ midi: number; startTime: number; duration: number; velocity?: number }> = [];
  private warnings: RecorderWarning[] = [];
  private recording = false;
  private unsubscribers: Array<() => void> = [];

  constructor(source: NoteSource) {
    this.source = source;
  }

  /** Subscribe to an adapter's note-on/off events for the duration of the recording. */
  attach(adapter: NoteInputAdapter): () => void {
    const offStart = adapter.onNoteStart((n) => this.handleStart(n));
    const offEnd = adapter.onNoteEnd((n) => this.handleEnd(n));
    const unsub = () => {
      offStart();
      offEnd();
    };
    this.unsubscribers.push(unsub);
    return unsub;
  }

  start(): void {
    this.recording = true;
    this.pending.clear();
    this.completed = [];
    this.warnings = [];
  }

  private handleStart(n: AdapterNoteOn): void {
    if (!this.recording) return;
    const stack = this.pending.get(n.midi) ?? [];
    stack.push({ startTime: n.time, velocity: n.velocity });
    this.pending.set(n.midi, stack);
  }

  private handleEnd(n: AdapterNoteOff): void {
    if (!this.recording) return;
    const stack = this.pending.get(n.midi);
    const open = stack?.shift(); // FIFO: the earliest open note-on this pitch closes first
    if (!open) {
      this.warnings.push({ type: 'unmatched-note-off', midi: n.midi, time: n.time });
      return;
    }
    this.completed.push({
      midi: n.midi,
      startTime: open.startTime,
      duration: Math.max(MIN_NOTE_DURATION, n.time - open.startTime),
      velocity: open.velocity,
    });
  }

  /** Number of notes currently held, for a live "learner active notes" display. */
  get activeCount(): number {
    let n = 0;
    for (const stack of this.pending.values()) n += stack.length;
    return n;
  }

  get activeMidiNotes(): number[] {
    const out: number[] = [];
    for (const [midi, stack] of this.pending) if (stack.length > 0) out.push(midi);
    return out;
  }

  getWarnings(): RecorderWarning[] {
    return [...this.warnings];
  }

  /** Stop recording, closing any still-held notes at `atTime`, and return the attempt. */
  stop(atTime: number, name = 'Attempt'): Performance {
    this.recording = false;
    for (const [midi, stack] of this.pending) {
      for (const open of stack) {
        this.warnings.push({ type: 'held-at-stop', midi, startTime: open.startTime, stopTime: atTime });
        this.completed.push({
          midi,
          startTime: open.startTime,
          duration: Math.max(MIN_NOTE_DURATION, atTime - open.startTime),
          velocity: open.velocity,
        });
      }
    }
    this.pending.clear();

    return buildPerformance(this.completed, { name, source: this.source, idPrefix: 'learner' });
  }

  dispose(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
  }
}
