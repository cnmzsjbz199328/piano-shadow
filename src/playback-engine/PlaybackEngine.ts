import * as Tone from 'tone';
import type { NoteEvent, Performance } from '@/music-model';
import { instrument } from '@/audio-engine';
import { pin, refFromTransport, transportFromRef, type TimeOrigin } from './timeMapping';
import { beatSeconds, computeBeatGrid } from './Metronome';
import type { LoopRange } from './loopSelection';

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

export const MIN_TEMPO_SCALE = 0.1;
export const MAX_TEMPO_SCALE = 1;
export const DEFAULT_COUNT_IN_BEATS = 4;

/**
 * Hard ceiling (real audio seconds) on any single scheduled voice / draw-end.
 * Defense in depth: a bad import or a mistimed recognised note-off must never
 * hold a Tone voice ~forever — which also balloons the perceived song length so
 * playback never auto-stops (Bug 2). Far above any musically real sustain, even
 * at MIN_TEMPO_SCALE.
 */
const MAX_VOICE_SECONDS = 30;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export class PlaybackEngine {
  private currentPerformance: Performance | null = null;
  private state: PlaybackState = 'idle';
  private scale = 0.8;
  private metronomeEnabled = false;
  private countInEnabled = false;

  private origin: TimeOrigin = pin(0, 0, 1);
  private clickSynth: Tone.Synth | null = null;
  private scheduledNoteIds: number[] = [];
  private scheduledClickIds: number[] = [];
  private endEventId: number | null = null;
  private endTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private loopRange: LoopRange | null = null;
  private loopRepeatId: number | null = null;
  private loopCycleStartTransport = 0;
  private loopCycleStartRef = 0;
  private scheduleVersion = 0;
  private rafId: number | null = null;
  private disposed = false;
  /** Invalidates a play that is waiting for Tone.start() to resolve. */
  private playRequestId = 0;

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
    if (this.loopRange) {
      const cycleLength = (this.loopRange.endTime - this.loopRange.startTime) / this.scale;
      const elapsed = Math.max(0, Tone.getTransport().seconds - this.loopCycleStartTransport);
      const firstLength = Math.max(0, (this.loopRange.endTime - this.loopCycleStartRef) / this.scale);
      if (elapsed <= firstLength || cycleLength <= 0) return this.loopCycleStartRef + elapsed * this.scale;
      return this.loopRange.startTime + ((elapsed - firstLength) % cycleLength) * this.scale;
    }
    return refFromTransport(this.origin, Tone.getTransport().seconds);
  }

  getLoopRange(): LoopRange | null {
    return this.loopRange;
  }

  /** Store the validated reference-time range; scheduling starts via startLoop. */
  setLoopRange(range: LoopRange): boolean {
    if (!this.currentPerformance || !Number.isFinite(range.startTime) || !Number.isFinite(range.endTime)) return false;
    if (!(range.startTime >= 0 && range.endTime > range.startTime && range.endTime <= this.currentPerformance.duration + 1e-6)) return false;
    this.loopRange = range;
    return true;
  }

  /** Atomically replaces the active schedule and starts the loop at A. */
  startLoop(): boolean {
    const range = this.loopRange;
    if (!this.currentPerformance || !range || !(range.endTime > range.startTime) || this.disposed) return false;
    this.playRequestId += 1;
    this.ensureSynths();
    Tone.getTransport().stop();
    this.cancelAllScheduled();
    Tone.getTransport().seconds = 0;
    this.origin = pin(0, range.startTime, this.scale);
    this.loopCycleStartTransport = 0;
    this.loopCycleStartRef = range.startTime;
    this.scheduleLoopCycle(0, range.startTime);
    this.scheduleLoopBoundary((range.endTime - range.startTime) / this.scale);
    Tone.getTransport().start();
    this.setState('playing');
    this.startTicking();
    return true;
  }

  /** Leaves the current clock position intact and returns to normal playback. */
  clearLoopRange(): void {
    if (!this.loopRange) return;
    const current = this.getCurrentTime();
    const currentTransport = Tone.getTransport().seconds;
    const running = this.state === 'playing' || this.state === 'counting-in';
    this.loopRange = null;
    this.cancelAllScheduled();
    if (this.currentPerformance) {
      this.origin = pin(currentTransport, current, this.scale);
      this.rescheduleFrom(current);
      if (running) Tone.getTransport().start();
    }
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
    if (running || this.state === 'paused') this.rescheduleFrom(curRef);
  }

  // --- transport ---

  async play(): Promise<void> {
    if (!this.currentPerformance || this.disposed) return;
    const requestId = ++this.playRequestId;
    await Tone.start();
    if (requestId !== this.playRequestId || !this.currentPerformance || this.disposed) return;
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
    this.playRequestId += 1;
    Tone.getTransport().pause();
    this.stopTicking();
    this.setState('paused');
  }

  stop(): void {
    this.playRequestId += 1;
    Tone.getTransport().stop();
    this.cancelAllScheduled();
    this.stopTicking();
    Tone.getTransport().seconds = 0;
    this.loopRange = null;
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
    const loop = this.loopRange;
    if (loop && (refSeconds < loop.startTime || refSeconds >= loop.endTime)) {
      this.clearLoopRange();
    }
    const clamped = clamp(refSeconds, 0, this.currentPerformance.duration);
    const running = this.state === 'playing' || this.state === 'counting-in';
    Tone.getTransport().pause();
    Tone.getTransport().seconds = 0;
    this.origin = pin(0, clamped, this.scale);

    if (this.loopRange) {
      Tone.getTransport().seconds = 0;
      this.origin = pin(0, clamped, this.scale);
      this.loopCycleStartTransport = 0;
      this.loopCycleStartRef = clamped;
      this.cancelAllScheduled();
      this.scheduleLoopCycle(0, clamped);
      this.scheduleLoopBoundary((this.loopRange.endTime - clamped) / this.scale);
      if (running) Tone.getTransport().start();
      else this.setState('paused');
    } else if (running) {
      this.rescheduleFrom(clamped);
      Tone.getTransport().start();
    } else {
      this.cancelAllScheduled();
      const wasPaused = this.state === 'paused';
      this.setState(this.currentPerformance ? (wasPaused ? 'paused' : 'stopped') : 'idle');
      if (wasPaused) this.rescheduleFrom(clamped);
      this.options.onTick?.(this.getCurrentTime());
    }
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    this.clickSynth?.dispose();
    // The shared `instrument` is an app-lifetime singleton (like this engine
    // itself in the store) — it is not owned here, so it is not disposed here.
  }

  // --- internals ---

  private ensureSynths(): void {
    // Reference notes are voiced by the shared sampled-piano `instrument`
    // (audio-engine). Kick off its lazy sample load here — non-blocking; until
    // the samples are ready it voices notes with the Tone synth fallback.
    instrument.prepare();
    if (this.clickSynth) return;
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
    if (this.loopRange) {
      const from = clamp(curRef, this.loopRange.startTime, this.loopRange.endTime - 1e-6);
      const wasRunning = this.state === 'playing' || this.state === 'counting-in';
      Tone.getTransport().pause();
      Tone.getTransport().seconds = 0;
      this.origin = pin(0, from, this.scale);
      this.loopCycleStartTransport = 0;
      this.loopCycleStartRef = from;
      this.scheduleLoopCycle(0, from);
      this.scheduleLoopBoundary((this.loopRange.endTime - from) / this.scale);
      if (wasRunning) Tone.getTransport().start();
      return;
    }
    for (const note of this.currentPerformance.notes) {
      if (note.startTime + note.duration <= curRef) continue;
      this.scheduleNoteEvent(note);
    }
    this.rescheduleClicks();
    this.scheduleEnd();
  }

  private scheduleNoteEvent(note: NoteEvent): void {
    const t = transportFromRef(this.origin, note.startTime);
    if (t < Tone.getTransport().seconds - 1e-6) return;
    this.scheduleNoteAtTransport(note, t, note.duration);
  }

  private scheduleNoteAtTransport(note: NoteEvent, t: number, durationOverride?: number): void {
    const generation = this.scheduleVersion;
    const id = Tone.getTransport().scheduleOnce((time) => {
      // note.duration is reference-timeline seconds; real (transport/audio) time
      // moves at 1/scale of that, so both the audible sustain and the note-end
      // callback must be scaled — otherwise a tempo scale != 1 cuts notes short
      // (scale < 1, slower) or lets them ring too long (scale > 1, faster).
      // The min against the whole-piece duration and the MAX_VOICE_SECONDS ceiling
      // are defense in depth: no single note may outlast the song or hold a voice
      // unbounded (Bug 2). The 0.05s floor stays so very short notes still sound.
      if (generation !== this.scheduleVersion) return;
      const refDuration = Math.min(durationOverride ?? note.duration, this.currentPerformance?.duration ?? note.duration);
      const realDuration = refDuration / this.scale;
      const voiceSeconds = Math.min(Math.max(0.05, realDuration), MAX_VOICE_SECONDS);
      // Same clamped `voiceSeconds` and same `time` the old synth call took —
      // the instrument self-releases the voice after `voiceSeconds` (no separate
      // scheduled note-off), preserving the single-clock schedule.
      instrument.attack(note.midi, note.velocity ?? 100, time, voiceSeconds, 'reference');
      Tone.getDraw().schedule(() => {
        if (generation === this.scheduleVersion) this.options.onReferenceNoteStart?.(note);
      }, time);
      Tone.getDraw().schedule(() => {
        if (generation === this.scheduleVersion) this.options.onReferenceNoteEnd?.(note);
      }, time + voiceSeconds);
    }, t);
    this.scheduledNoteIds.push(id);
  }

  private scheduleLoopCycle(cycleStartTransport: number, fromRef: number): void {
    const range = this.loopRange;
    if (!this.currentPerformance || !range) return;
    const generation = ++this.scheduleVersion;
    for (const note of this.currentPerformance.notes) {
      const noteEnd = note.startTime + note.duration;
      if (note.startTime < fromRef || note.startTime >= range.endTime || noteEnd <= range.startTime) continue;
      const startRef = Math.max(note.startTime, fromRef);
      const duration = Math.min(noteEnd, range.endTime) - startRef;
      if (!(duration > 0)) continue;
      const t = cycleStartTransport + (startRef - fromRef) / this.scale;
      const previousVersion = this.scheduleVersion;
      this.scheduleVersion = generation;
      this.scheduleNoteAtTransport(note, t, duration);
      this.scheduleVersion = previousVersion;
    }
  }

  private scheduleLoopBoundary(transportSeconds: number): void {
    const range = this.loopRange;
    if (!range || !this.currentPerformance) return;
    const loopLength = (range.endTime - range.startTime) / this.scale;
    this.loopRepeatId = Tone.getTransport().scheduleRepeat((time) => {
      if (!this.loopRange || this.loopRange !== range) return;
      instrument.releaseReferenceVoices();
      this.loopCycleStartTransport = time;
      this.loopCycleStartRef = range.startTime;
      this.scheduleLoopCycle(time, range.startTime);
    }, loopLength, transportSeconds);
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
    // Clearing Transport events only prevents future notes. Notes whose
    // callbacks already fired need their own ownership-aware stop path.
    instrument.releaseReferenceVoices();
    this.scheduleVersion += 1;
    for (const id of this.scheduledNoteIds) Tone.getTransport().clear(id);
    for (const id of this.scheduledClickIds) Tone.getTransport().clear(id);
    if (this.endEventId !== null) Tone.getTransport().clear(this.endEventId);
    if (this.endTimeoutId !== null) clearTimeout(this.endTimeoutId);
    if (this.loopRepeatId !== null) Tone.getTransport().clear(this.loopRepeatId);
    this.scheduledNoteIds = [];
    this.scheduledClickIds = [];
    this.endEventId = null;
    this.endTimeoutId = null;
    this.loopRepeatId = null;
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
