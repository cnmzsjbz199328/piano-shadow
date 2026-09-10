import { MicrophoneCapture, MicrophoneCaptureError, PitchyRecognizer } from '@/recognition';
import type { NoteInputAdapter, AdapterNoteOff, AdapterNoteOn, AdapterStatus, ClockFn } from './types';
import { Emitter } from './emitter';

/**
 * Monophonic microphone input.  Recognition remains deliberately conservative:
 * Pitchy is used for the first version and the adapter emits the same note-on /
 * note-off contract as MIDI, so recording and scoring never need to know where
 * the notes came from.
 */
export interface MicrophoneAdapterOptions {
  clock?: ClockFn;
  onLevel?: (rms: number) => void;
}

interface ActiveNote {
  midi: number;
  startTime: number;
  lastSeen: number;
}

export const POLL_MS = 60;
const SILENCE_TIMEOUT_MS = 180;
const DETECTION_WINDOW_SECONDS = 0.45;

export class MicrophoneAdapter implements NoteInputAdapter {
  readonly source = 'microphone' as const;
  status: AdapterStatus = 'disconnected';

  private readonly clock: ClockFn;
  private readonly onLevel?: (rms: number) => void;
  private readonly starts = new Emitter<AdapterNoteOn>();
  private readonly ends = new Emitter<AdapterNoteOff>();
  private readonly statusChanges = new Emitter<AdapterStatus>();
  private capture: MicrophoneCapture | null = null;
  private recognizer: PitchyRecognizer | null = null;
  private active: ActiveNote | null = null;
  private pollHandle: number | null = null;

  constructor(options: MicrophoneAdapterOptions = {}) {
    this.clock = options.clock ?? (() => performance.now() / 1000);
    this.onLevel = options.onLevel;
  }

  async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') return;
    this.setStatus('connecting');
    try {
      const recognizer = new PitchyRecognizer();
      await recognizer.initialize();
      const capture = new MicrophoneCapture({
        maxBufferSeconds: 20,
        onLevel: this.onLevel,
        onStatusChange: (status, error) => {
          if (status === 'error') this.setStatus('error', error);
        },
      });
      this.capture = capture;
      await capture.start();
      this.recognizer = recognizer;
      this.active = null;
      this.setStatus('connected');
      this.pollHandle = window.setInterval(() => void this.poll(), POLL_MS);
    } catch (error) {
      await this.capture?.stop().catch(() => undefined);
      this.capture = null;
      this.recognizer = null;
      this.setStatus('error', error instanceof MicrophoneCaptureError ? error : undefined);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.pollHandle !== null) window.clearInterval(this.pollHandle);
    this.pollHandle = null;
    const now = this.clock();
    this.endActive(now);
    await this.capture?.stop();
    this.capture = null;
    this.recognizer = null;
    this.setStatus('disconnected');
  }

  onNoteStart(callback: (note: AdapterNoteOn) => void): () => void {
    return this.starts.on(callback);
  }

  onNoteEnd(callback: (note: AdapterNoteOff) => void): () => void {
    return this.ends.on(callback);
  }

  onStatusChange(callback: (status: AdapterStatus) => void): () => void {
    return this.statusChanges.on(callback);
  }

  private setStatus(status: AdapterStatus, error?: MicrophoneCaptureError): void {
    this.status = status;
    this.statusChanges.emit(status);
    if (error) this.statusChanges.emit('error');
  }

  private async poll(): Promise<void> {
    const capture = this.capture;
    const recognizer = this.recognizer;
    if (!capture || !recognizer || this.status !== 'connected') return;
    const buffer = capture.getBuffer();
    if (buffer.audio.length === 0) return;
    const windowSamples = Math.max(2048, Math.round(DETECTION_WINDOW_SECONDS * buffer.sampleRate));
    const windowStartSamples = Math.max(0, buffer.audio.length - windowSamples);
    const audioWindow = buffer.audio.subarray(windowStartSamples);
    // Real-time span of the detection window. It always ends at "now", so a note
    // detected at offset `startTime` inside it began at
    // `now - windowSeconds + startTime` on the one session clock. Anchoring every
    // boundary on that clock (never on the rolling buffer's sample offset) is
    // what keeps note-on and note-off comparable — and keeps onsets correct past
    // the ~20s buffer cap, where the old buffer-relative anchor saturated.
    const windowSeconds = audioWindow.length / buffer.sampleRate;
    try {
      const notes = await recognizer.process(audioWindow, buffer.sampleRate);
      const latest = notes.at(-1);
      const nowSec = this.clock();
      if (!latest) {
        if (this.active && nowSec - this.active.lastSeen > SILENCE_TIMEOUT_MS / 1000) this.endActive(nowSec);
        return;
      }
      const detectedTime = Math.max(0, nowSec - windowSeconds + latest.startTime);
      if (!this.active || this.active.midi !== latest.midi) {
        this.endActive(detectedTime);
        this.active = { midi: latest.midi, startTime: detectedTime, lastSeen: nowSec };
        this.starts.emit({ midi: latest.midi, time: detectedTime, velocity: 100 });
      } else {
        this.active.lastSeen = nowSec;
      }
    } catch {
      // A transient short/empty audio frame should not terminate a session.
    }
  }

  private endActive(time: number): void {
    if (!this.active) return;
    this.ends.emit({ midi: this.active.midi, time: Math.max(time, this.active.startTime) });
    this.active = null;
  }
}
