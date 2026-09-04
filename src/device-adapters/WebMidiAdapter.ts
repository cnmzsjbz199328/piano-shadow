import type { NoteSource } from '@/music-model';
import { Emitter } from './emitter';
import type { AdapterNoteOff, AdapterNoteOn, AdapterStatus, ClockFn, NoteInputAdapter } from './types';
import { getMidiCapableNavigator, type MIDIAccessLike, type MIDIInputLike } from './webMidiTypes';

export class WebMidiError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WebMidiError';
  }
}

export interface MidiInputInfo {
  id: string;
  name: string;
  manufacturer?: string;
}

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;

/**
 * Web MIDI input (spec §2.2.B). Feature-detects on `connect()` and reports
 * `'unsupported'` rather than throwing — the app MUST start and run with no MIDI
 * device connected, and Web MIDI is never required at startup (spec §2.2, §17, §25).
 */
export class WebMidiAdapter implements NoteInputAdapter {
  readonly source: NoteSource = 'midi-device';
  status: AdapterStatus;

  private access: MIDIAccessLike | null = null;
  private currentInput: MIDIInputLike | null = null;
  private readonly clock: ClockFn;
  private readonly startEmitter = new Emitter<AdapterNoteOn>();
  private readonly endEmitter = new Emitter<AdapterNoteOff>();
  private readonly statusEmitter = new Emitter<AdapterStatus>();

  constructor(clock: ClockFn) {
    this.clock = clock;
    this.status = WebMidiAdapter.isSupported() ? 'disconnected' : 'unsupported';
  }

  static isSupported(): boolean {
    return getMidiCapableNavigator() !== null;
  }

  /** Request browser MIDI permission and populate `listInputs()`. Does not select a device. */
  async connect(): Promise<void> {
    const nav = getMidiCapableNavigator();
    if (!nav) {
      this.setStatus('unsupported');
      return;
    }
    this.setStatus('connecting');
    try {
      this.access = await nav.requestMIDIAccess();
    } catch (err) {
      this.setStatus('error');
      throw new WebMidiError('MIDI access was denied or is unavailable.', { cause: err });
    }
    this.access.onstatechange = () => this.handlePortStateChange();
    this.setStatus('disconnected'); // access granted; caller still needs to selectInput()
  }

  async disconnect(): Promise<void> {
    this.selectInput(null);
    this.access = null;
    this.setStatus(WebMidiAdapter.isSupported() ? 'disconnected' : 'unsupported');
  }

  listInputs(): MidiInputInfo[] {
    if (!this.access) return [];
    return Array.from(this.access.inputs.values()).map((input) => ({
      id: input.id,
      name: input.name?.trim() || 'Unknown MIDI device',
      manufacturer: input.manufacturer?.trim() || undefined,
    }));
  }

  selectInput(id: string | null): void {
    if (this.currentInput) {
      this.currentInput.onmidimessage = null;
      this.currentInput = null;
    }
    if (!id) {
      this.setStatus(this.access ? 'disconnected' : WebMidiAdapter.isSupported() ? 'disconnected' : 'unsupported');
      return;
    }
    const input = this.access?.inputs.get(id);
    if (!input) {
      this.setStatus('error');
      return;
    }
    input.onmidimessage = (event) => this.handleMessage(event.data);
    this.currentInput = input;
    this.setStatus('connected');
  }

  get selectedInputId(): string | null {
    return this.currentInput?.id ?? null;
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

  private handleMessage(data: Uint8Array | null): void {
    if (!data || data.length < 2) return;
    const command = data[0]! & 0xf0;
    const midi = data[1]!;
    const velocity = data[2] ?? 0;
    const time = this.clock();

    if (command === NOTE_ON && velocity > 0) {
      this.startEmitter.emit({ midi, time, velocity });
    } else if (command === NOTE_OFF || (command === NOTE_ON && velocity === 0)) {
      // Real MIDI hardware commonly sends note-on/velocity-0 in place of note-off;
      // both MUST be honoured (spec §25: never silently ignore a note-off).
      this.endEmitter.emit({ midi, time });
    }
  }

  /**
   * The browser reuses the same MIDIPort object across connect/disconnect —
   * it flips `.state` rather than removing it from `access.inputs` — so a
   * naive `onstatechange` handler that just re-emits the cached status would
   * keep reporting 'connected' forever after the device is unplugged
   * (spec §25: never silently swallow a device error).
   */
  private handlePortStateChange(): void {
    if (this.currentInput && this.currentInput.state === 'disconnected') {
      this.currentInput.onmidimessage = null;
      this.currentInput = null;
      this.setStatus('disconnected');
      return;
    }
    this.statusEmitter.emit(this.status);
  }

  private setStatus(status: AdapterStatus): void {
    this.status = status;
    this.statusEmitter.emit(status);
  }
}
