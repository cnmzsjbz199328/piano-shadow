import * as Tone from 'tone';
import type { NoteEvent, Performance } from '@/music-model';
import { pin, refFromTransport, transportFromRef, type TimeOrigin } from './timeMapping';
import { beatSeconds, computeBeatGrid } from './Metronome';

/**
 * Reference playback (spec §2.4). A thin, single-clock wrapper around Tone.js:
 * Tone.Transport is the ONE authoritative clock (audio-context-driven, not a
 * setInterval/rAF timer that can drift); every reference time the UI sees is
 * derived from it via `timeMapping`. Play, pause, stop, seek, restart, tempo
 * scale, metronome and count-in all reduce to (re)pinning that mapping and
 * (re)scheduling Tone.Transport events — see `timeMapping.ts` for why this is
 * correct under tempo-scale changes and count-in.
 */

export type PlaybackState = 'idle' | 'counting-in' | 'playing' | 'paused' | 'stopped';

export interface PlaybackEngineOptions {
  onTick?: (referenceSeconds: number) => void;
  onStateChange?: (state: PlaybackState) => void;
  onReferenceNoteStart?: (note: NoteEvent) => void;
  onReferenceNoteEnd?: (note: NoteEvent) => void;
  /** Fires when the song reaches its natural end. `finalTime` is the reference-timeline
   *  time at the moment playback stopped (usually ~= duration) — read it instead of
   *  `getCurrentTime()` from inside the callback, since the engine has already reset
   *  its clock to 0 by the time this fires. */
  onEnded?: (finalTime: number) => void;
}

export const MIN_TEMPO_SCALE = 0.25;
export const MAX_TEMPO_SCALE = 2;
export const DEFAULT_COUNT_IN_BEATS = 4;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export class PlaybackEngine {
  private currentPerformance: Performance | null = null;
  private state: PlaybackState = 'idle';
  private scale = 1;
  private metronomeEnabled = false;
  private countInEnabled = false;

  private origin: TimeOrigin = pin(0, 0, 1);
  private synth: Tone.PolySynth<Tone.Synth> | null = null;
  private clickSynth: Tone.Synth | null = null;
  private scheduledNoteIds: number[] = [];
  private scheduledClickIds: number[] = [];
  private endEventId: number | null = null;
  private endTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private rafId: number | null = null;
  private disposed = false;

  constructor(private readonly options: PlaybackEngineOptions = {}) {}

  // --- configuration ---

  load(performance: Performance): void {
    this.stop();
    this.currentPerformance = performance;
  }

  getPerformance(): Performance | null {
    return this.currentPerformance;
  }

  getDuration(): number {
    return this.currentPerformance?.duration ?? 0;
  }

  getState(): PlaybackState {
    return this.state;
  }

  getTempoScale(): number {
    return this.scale;
  }

  isMetronomeEnabled(): boolean {
    return this.metronomeEnabled;
  }

  isCountInEnabled(): boolean {
    return this.countInEnabled;
  }

  getCurrentTime(): number {
    return refFromTransport(this.origin, Tone.getTransport().seconds);
  }

  setMetronomeEnabled(on: boolean): void {
    this.metronomeEnabled = on;
    if (this.state === 'playing' || this.state === 'counting-in') this.rescheduleClicks();
  }

  setCountInEnabled(on: boolean): void {
    this.countInEnabled = on;
  }

  /** Clamped to [MIN_TEMPO_SCALE, MAX_TEMPO_SCALE]. 1 = normal speed, 0.5 = half speed, etc. */
  setTempoScale(scaleRaw: number): void {
    const scale = clamp(scaleRaw, MIN_TEMPO_SCALE, MAX_TEMPO_SCALE);
    if (scale === this.scale) return;
    const running = this.state === 'playing' || this.state === 'counting-in';
    const curRef = this.getCurrentTime();
    this.scale = scale;
    this.origin = pin(Tone.getTransport().seconds, curRef, this.scale);
    if (running) this.rescheduleFrom(curRef);
  }

  // --- transport ---

  async play(): Promise<void> {
    if (!this.currentPerformance || this.disposed) return;
    await Tone.start();
    this.ensureSynths();

    if (this.state === 'paused') {
      Tone.getTransport().start();
      this.setState(this.getCurrentTime() < 0 ? 'counting-in' : 'playing');
      this.startTicking();
      return;
    }

    const leadInBeats = this.countInEnabled ? DEFAULT_COUNT_IN_BEATS : 0;
    const startRef = -leadInBeats * beatSeconds(this.currentPerformance);
    Tone.getTransport().seconds = 0;
    this.origin = pin(0, startRef, this.scale);
    this.scheduleAll();
    Tone.getTransport().start();
    this.setState(leadInBeats > 0 ? 'counting-in' : 'playing');
    this.startTicking();
  }

  pause(): void {
    if (this.state !== 'playing' && this.state !== 'counting-in') return;
    Tone.getTransport().pause();
    this.stopTicking();
    this.setState('paused');
  }

  stop(): void {
    Tone.getTransport().stop();
    this.cancelAllScheduled();
    this.stopTicking();
    Tone.getTransport().seconds = 0;
    this.origin = pin(0, 0, this.scale);
    this.setState(this.currentPerformance ? 'stopped' : 'idle');
    // stopTicking() just cancelled the rAF loop, so the store would otherwise
    // be left showing whatever the last tick reported (close to, but not
    // quite, the end) instead of the reset playhead — push the true value once.
    this.options.onTick?.(this.getCurrentTime());
  }

  restart(): void {
    this.stop();
    void this.play();
  }

  seek(refSeconds: number): void {
    if (!this.currentPerformance) return;
    const clamped = clamp(refSeconds, 0, this.currentPerformance.duration);
    const running = this.state === 'playing' || this.state === 'counting-in';
    Tone.getTransport().pause();
    Tone.getTransport().seconds = 0;
    this.origin = pin(0, clamped, this.scale);

    if (running) {
      this.rescheduleFrom(clamped);
      Tone.getTransport().start();
    } else {
      this.cancelAllScheduled();
      this.setState(this.currentPerformance ? 'stopped' : 'idle');
      this.options.onTick?.(this.getCurrentTime());
    }
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    this.synth?.dispose();
    this.clickSynth?.dispose();
  }

  // --- internals ---

  private ensureSynths(): void {
    if (this.synth) return;
    this.synth = new Tone.PolySynth(Tone.Synth, {
      envelope: { attack: 0.005, decay: 0.15, sustain: 0.25, release: 0.3 },
    }).toDestination();
    this.clickSynth = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 },
    }).toDestination();
    this.clickSynth.volume.value = -12;
  }

  private scheduleAll(): void {
    if (!this.currentPerformance) return;
    this.cancelAllScheduled();
    for (const note of this.currentPerformance.notes) this.scheduleNoteEvent(note);
    this.rescheduleClicks();
    this.scheduleEnd();
  }

  /** Reschedule only what has not happened yet — used after a mid-playback tempo/seek repin. */
  private rescheduleFrom(curRef: number): void {
    if (!this.currentPerformance) return;
    this.cancelAllScheduled();
    for (const note of this.currentPerformance.notes) {
      if (note.startTime + note.duration <= curRef) continue;
      this.scheduleNoteEvent(note);
    }
    this.rescheduleClicks();
    this.scheduleEnd();
  }

  private scheduleNoteEvent(note: NoteEvent): void {
    const t = transportFromRef(this.origin, note.startTime);
    if (t < 0) return;
    const id = Tone.getTransport().scheduleOnce((time) => {
      // note.duration is reference-timeline seconds; real (transport/audio) time
      // moves at 1/scale of that, so both the audible sustain and the note-end
      // callback must be scaled — otherwise a tempo scale != 1 cuts notes short
      // (scale < 1, slower) or lets them ring too long (scale > 1, faster).
      const realDuration = note.duration / this.scale;
      const velocity = clamp((note.velocity ?? 100) / 127, 0.05, 1);
      this.synth?.triggerAttackRelease(note.noteName, Math.max(0.05, realDuration), time, velocity);
      Tone.getDraw().schedule(() => this.options.onReferenceNoteStart?.(note), time);
      Tone.getDraw().schedule(() => this.options.onReferenceNoteEnd?.(note), time + realDuration);
    }, t);
    this.scheduledNoteIds.push(id);
  }

  private rescheduleClicks(): void {
    for (const id of this.scheduledClickIds) Tone.getTransport().clear(id);
    this.scheduledClickIds = [];
    if (!this.currentPerformance) return;

    const leadInBeats = this.countInEnabled ? DEFAULT_COUNT_IN_BEATS : 0;
    const grid = computeBeatGrid(this.currentPerformance, { leadInBeats });
    const nowTransportSec = Tone.getTransport().seconds;

    for (const beat of grid) {
      if (beat.time >= 0 && !this.metronomeEnabled) continue; // only the lead-in clicks are unconditional
      const t = transportFromRef(this.origin, beat.time);
      if (t < nowTransportSec - 1e-6) continue; // already passed
      const accent = beat.beatInBar === 0;
      const id = Tone.getTransport().scheduleOnce((time) => {
        this.clickSynth?.triggerAttackRelease(accent ? 'C6' : 'G5', 0.03, time, accent ? 1 : 0.6);
      }, t);
      this.scheduledClickIds.push(id);
    }
  }

  private scheduleEnd(): void {
    if (!this.currentPerformance) return;
    const t = transportFromRef(this.origin, this.currentPerformance.duration);
    this.endEventId = Tone.getTransport().scheduleOnce(() => {
      // Defer off the Transport's own scheduling tick — calling `.stop()`
      // re-entrantly from inside one of the Transport's own scheduled
      // callbacks is unreliable. A macrotask is more than precise enough for
      // "the song just ended," and avoids Tone.Draw's separate
      // anticipation/expiration window, which is meant for audio-visual
      // sync, not for a control-flow action like this one.
      //
      // The timeout id is tracked (and cleared by cancelAllScheduled) so a
      // restart/seek/dispose landing in the brief window before this fires
      // can't have it go off against a session that already moved on.
      this.endTimeoutId = setTimeout(() => {
        this.endTimeoutId = null;
        if (this.disposed) return;
        const finalTime = this.getCurrentTime(); // read before stop() resets the clock
        this.stop();
        this.options.onEnded?.(finalTime);
      }, 0);
    }, t);
  }

  private cancelAllScheduled(): void {
    for (const id of this.scheduledNoteIds) Tone.getTransport().clear(id);
    for (const id of this.scheduledClickIds) Tone.getTransport().clear(id);
    if (this.endEventId !== null) Tone.getTransport().clear(this.endEventId);
    if (this.endTimeoutId !== null) clearTimeout(this.endTimeoutId);
    this.scheduledNoteIds = [];
    this.scheduledClickIds = [];
    this.endEventId = null;
    this.endTimeoutId = null;
  }

  private startTicking(): void {
    this.stopTicking();
    const loop = () => {
      if (this.disposed) return;
      const t = this.getCurrentTime();
      if (this.state === 'counting-in' && t >= 0) this.setState('playing');
      this.options.onTick?.(t);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopTicking(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private setState(state: PlaybackState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange?.(state);
  }
}
