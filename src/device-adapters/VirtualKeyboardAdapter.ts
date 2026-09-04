import type { NoteSource } from '@/music-model';
import { Emitter } from './emitter';
import type { AdapterNoteOff, AdapterNoteOn, AdapterStatus, ClockFn, NoteInputAdapter } from './types';

/**
 * The on-screen piano keyboard (spec §2.2.A). Always available — this is what
 * makes the app usable and testable with no hardware attached. The `PianoKeyboard`
 * component calls `press`/`release`; this adapter just timestamps and emits.
 */
export class VirtualKeyboardAdapter implements NoteInputAdapter {
  readonly source: NoteSource = 'virtual-keyboard';
  status: AdapterStatus = 'disconnected';

  private readonly clock: ClockFn;
  private readonly held = new Set<number>();
  private readonly startEmitter = new Emitter<AdapterNoteOn>();
  private readonly endEmitter = new Emitter<AdapterNoteOff>();
  private readonly statusEmitter = new Emitter<AdapterStatus>();

  constructor(clock: ClockFn) {
    this.clock = clock;
  }

  async connect(): Promise<void> {
    this.setStatus('connected');
  }

  async disconnect(): Promise<void> {
    this.releaseAll();
    this.setStatus('disconnected');
  }

  press(midi: number, velocity = 100): void {
    if (this.held.has(midi)) return; // ignore a repeated press while already held
    this.held.add(midi);
    this.startEmitter.emit({ midi, time: this.clock(), velocity });
  }

  release(midi: number): void {
    if (!this.held.has(midi)) return;
    this.held.delete(midi);
    this.endEmitter.emit({ midi, time: this.clock() });
  }

  releaseAll(): void {
    for (const midi of [...this.held]) this.release(midi);
  }

  isHeld(midi: number): boolean {
    return this.held.has(midi);
  }

  get heldNotes(): number[] {
    return [...this.held];
  }

  onNoteStart(callback: (note: AdapterNoteOn) => void): () => void {
    return this.startEmitter.on(callback);
  }

  onNoteEnd(callback: (note: AdapterNoteOff) => void): () => void {
    return this.endEmitter.on(callback);
  }

  onStatusChange(callback: (status: AdapterStatus) => void): () => void {
    return this.statusEmitter.on(callback);
  }

  private setStatus(status: AdapterStatus): void {
    this.status = status;
    this.statusEmitter.emit(status);
  }
}
