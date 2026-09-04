import type { NoteEvent, NoteSource } from '@/music-model';

/**
 * Device adapter boundary (spec §17). Every learner input method — virtual
 * keyboard, Web MIDI, and future microphone / ESP32 adapters — implements this
 * interface and reports plain note-on / note-off events on a shared clock. The
 * practice engine and recorder never know which adapter produced an event.
 */

export interface AdapterNoteOn {
  midi: number;
  /** Seconds, on the clock the adapter was constructed with. */
  time: number;
  velocity?: number;
}

export interface AdapterNoteOff {
  midi: number;
  time: number;
}

export type AdapterStatus = 'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'error';

export interface NoteInputAdapter {
  readonly source: NoteSource;
  readonly status: AdapterStatus;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  onNoteStart(callback: (note: AdapterNoteOn) => void): () => void;
  onNoteEnd(callback: (note: AdapterNoteOff) => void): () => void;
  onStatusChange(callback: (status: AdapterStatus) => void): () => void;
}

/** Injected so an adapter timestamps events on the practice session's clock, not Date.now(). */
export type ClockFn = () => number;

export type { NoteEvent };
