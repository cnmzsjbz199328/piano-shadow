import * as Tone from 'tone';
import { SplendidGrandPiano } from 'smplr';
import { midiToNoteName } from '@/music-model';

/**
 * Audio engine (spec §13 stack, §25 quality rules).
 *
 * A single sampled-piano voice bank, shared by reference playback and audible
 * learner input (on-screen keyboard and live Web MIDI).
 * It is deliberately its own module — a *peer* of `playback-engine` — imported
 * only from `stores` and `playback-engine`, never from a React component, so
 * sound generation stays out of the render tree (spec §25).
 *
 * One authoritative clock is preserved. This adds a second *sound source* on the
 * existing `Tone.Transport` schedule, not a second timer: the instrument renders
 * into `Tone.getContext().rawContext`, so every `when` it is handed — including a
 * `time` value from inside a `Tone.getTransport().scheduleOnce((time) => …)`
 * callback — is already in the same AudioContext time domain.
 *
 * Graceful degradation, never silence. If the sample set cannot be fetched
 * (offline / CDN down / CSP), the instrument transparently falls back to the
 * pre-v0.5 `Tone.PolySynth(Tone.Synth)` reference voicing. The public
 * `attack` / `release` / `dispose` API is identical either way, and `attack`
 * and `release` never throw.
 */

type Mode = 'idle' | 'synth' | 'sampled' | 'silent';
export type VoiceGroup = 'input' | 'reference';

/**
 * Hard ceiling (real audio seconds) on any single voice this module starts,
 * mirroring `playback-engine`'s `MAX_VOICE_SECONDS`. Defense in depth: no
 * duration or `release` time handed in may hold a voice unbounded.
 */
const MAX_VOICE_SECONDS = 30;

type SmplrStorageResponse = {
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

type OpenVoice = { stop: (when?: number) => void; startedAt: number };

export class SampledInstrument {
  private mode: Mode = 'idle';
  private piano: ReturnType<typeof SplendidGrandPiano> | null = null;
  private synth: Tone.PolySynth<Tone.Synth> | null = null;
  private referenceSynth: Tone.PolySynth<Tone.Synth> | null = null;
  private prepared = false;
  private seq = 0;
  /** Release-ended ("open") voices only; keyed by MIDI → the newest live voice. */
  private readonly open = new Map<number, OpenVoice>();
  /** Reference voices have different ownership from learner input voices. */
  private readonly referenceVoices = new Set<OpenVoice>();

  /**
   * Create the fallback synth now and kick off the async sample download.
   * Idempotent, non-blocking, never throws. A no-op where there is no Web Audio
   * (headless tests): the instrument stays in `silent` mode and every call is
   * inert.
   */
  prepare(): void {
    if (this.prepared) return;
    this.prepared = true;
    try {
      const rawContext = Tone.getContext().rawContext as unknown as AudioContext;

      // Fallback first, so the very first note sounds even mid-download.
      this.synth = new Tone.PolySynth(Tone.Synth, {
        envelope: { attack: 0.005, decay: 0.15, sustain: 0.25, release: 0.3 },
      }).toDestination();
      this.referenceSynth = new Tone.PolySynth(Tone.Synth, {
        envelope: { attack: 0.005, decay: 0.15, sustain: 0.25, release: 0.3 },
      }).toDestination();
      this.mode = 'synth';

      // Count sample fetches so a "host answered but every sample 404'd" run
      // degrades to the synth too — `piano.ready` only rejects for a hard
      // network / CSP failure (smplr swallows per-sample non-200s).
      let storageCalls = 0;
      let storageOk = 0;
      const storage = {
        async fetch(url: string): Promise<SmplrStorageResponse> {
          storageCalls += 1;
          const response = (await fetch(url)) as unknown as SmplrStorageResponse;
          if (response && response.status === 200) storageOk += 1;
          return response;
        },
      };

      const piano = SplendidGrandPiano(rawContext, { storage });
      this.piano = piano;
      void piano.ready
        .then(() => {
          if (this.mode === 'silent') return; // disposed while loading
          if (storageCalls > 0 && storageOk === 0) {
            // Nothing actually loaded — keep the synth fallback.
            this.dropPiano();
            return;
          }
          this.mode = 'sampled';
        })
        .catch(() => {
          // Offline / CSP / DNS failure — keep the synth fallback.
          this.dropPiano();
        });
    } catch {
      // No Web Audio in this environment: stay silent, never throw.
      this.mode = 'silent';
      this.synth = null;
      this.piano = null;
    }
  }

  /**
   * Start a note.
   * @param midi     MIDI note number.
   * @param velocity 1–127 (defaults to 100); clamped.
   * @param when     AudioContext time (Tone clock domain). Omit to play now.
   * @param durationSeconds  When given, the voice self-releases after this long
   *   (the reference-playback path passes the clamped `voiceSeconds`). When
   *   omitted, the note rings until `release(midi)` — used for live input.
   */
  attack(midi: number, velocity = 100, when?: number, durationSeconds?: number, group: VoiceGroup = 'input'): (() => void) | undefined {
    try {
      if (!this.prepared) this.prepare();
      if (this.mode === 'silent') return undefined;

      const at = when ?? this.now();
      const vel = clamp(Math.round(velocity), 1, 127);

      if (group === 'reference') {
        const voice: OpenVoice = {
          stop: this.startVoice(midi, vel, when, durationSeconds, group),
          startedAt: at,
        };
        this.referenceVoices.add(voice);
        return (stopWhen?: number) => {
          if (!this.referenceVoices.delete(voice)) return;
          voice.stop(stopWhen);
        };
      }

      if (durationSeconds === undefined) {
        const existing = this.open.get(midi);
        if (existing) existing.stop(at); // retrigger: steal the ringing voice
        const stop = this.startVoice(midi, vel, when, undefined, group);
        this.open.set(midi, { stop, startedAt: at });
      } else {
        const dur = clamp(durationSeconds, 0.05, MAX_VOICE_SECONDS);
        this.startVoice(midi, vel, when, dur, group);
      }
      return undefined;
    } catch {
      // Graceful degradation: a sound source must never break the caller.
      return undefined;
    }
  }

  /** End the ringing "open" voice for `midi`, if any. Never throws. */
  release(midi: number, when?: number): void {
    try {
      const existing = this.open.get(midi);
      if (!existing) return;
      this.open.delete(midi);
      existing.stop(when);
    } catch {
      // never throw out of release (spec §25: don't swallow note-offs — but do
      // it loudly via the store, not by crashing the audio graph)
    }
  }

  /** Silence every voice immediately (used when the user turns sound off). */
  releaseAll(): void {
    try {
      for (const voice of this.open.values()) voice.stop();
    } catch {
      /* ignore */
    }
    this.open.clear();
    this.releaseReferenceVoices();
    try {
      this.piano?.stop();
    } catch {
      /* ignore */
    }
    try {
      this.synth?.releaseAll();
    } catch {
      /* ignore */
    }
  }

  /** Stop only voices started by reference playback, preserving held input notes. */
  releaseReferenceVoices(): void {
    try {
      for (const voice of this.referenceVoices) voice.stop();
    } catch {
      /* ignore */
    }
    this.referenceVoices.clear();
    try {
      this.referenceSynth?.releaseAll();
    } catch {
      /* ignore */
    }
  }

  dispose(): void {
    this.releaseAll();
    this.dropPiano();
    try {
      this.synth?.dispose();
    } catch {
      /* ignore */
    }
    try {
      this.referenceSynth?.dispose();
    } catch {
      /* ignore */
    }
    this.synth = null;
    this.referenceSynth = null;
    this.mode = 'silent';
  }

  /** For tests / diagnostics: which sound source is live. */
  getMode(): Mode {
    return this.mode;
  }

  private dropPiano(): void {
    try {
      this.piano?.dispose();
    } catch {
      /* ignore */
    }
    this.piano = null;
    if (this.mode === 'sampled') this.mode = 'synth';
  }

  private now(): number {
    try {
      return Tone.getContext().currentTime;
    } catch {
      return 0;
    }
  }

  /** Start one voice on whichever source is live; returns its stop function. */
  private startVoice(
    midi: number,
    velocity: number,
    when: number | undefined,
    durationSeconds: number | undefined,
    group: VoiceGroup,
  ): (when?: number) => void {
    if (this.mode === 'sampled' && this.piano) {
      const stopFn = this.piano.start({
        note: midi,
        velocity,
        time: when,
        duration: durationSeconds ?? null,
        stopId: `${midi}:${(this.seq += 1)}`,
      });
      return (t?: number) => {
        try {
          stopFn(t);
        } catch {
          /* ignore */
        }
      };
    }

    const synth = group === 'reference' ? this.referenceSynth : this.synth;
    if (synth) {
      const noteName = midiToNoteName(midi);
      const gain = clamp(velocity / 127, 0.05, 1);
      if (durationSeconds !== undefined) {
        synth.triggerAttackRelease(noteName, durationSeconds, when, gain);
        return () => {
          /* self-releasing */
        };
      }
      synth.triggerAttack(noteName, when, gain);
      return (t?: number) => {
        try {
          synth.triggerRelease(noteName, t);
        } catch {
          /* ignore */
        }
      };
    }

    return () => {
      /* silent */
    };
  }
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * The one shared voice bank for the app's lifetime — the same ownership model as
 * the single `PlaybackEngine` / AudioContext in `stores/useAppStore.ts`. Not a
 * store of performance data (spec §25): `NoteEvent` / `Performance` remain the
 * only source of truth; this just turns note numbers into sound.
 */
export const instrument = new SampledInstrument();
