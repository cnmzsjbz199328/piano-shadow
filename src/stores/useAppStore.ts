import { create } from 'zustand';
import { buildPerformance, midiToNoteName, type NoteEvent, type Performance } from '@/music-model';
import { parseMidiFile, loadDemoPerformance, MidiImportError } from '@/midi';
import { PlaybackEngine, type PlaybackState as EnginePlaybackState } from '@/playback-engine';
import {
  VirtualKeyboardAdapter,
  WebMidiAdapter,
  PerformanceRecorder,
  MicrophoneAdapter,
  type AdapterStatus,
  type MidiInputInfo,
} from '@/device-adapters';
import {
  evaluatePerformance,
  LiveMatcher,
  voiceFilteredNotes,
  voiceFilteredPerformance,
  type EvaluationResult,
  type LiveFeedbackItem,
} from '@/practice-engine';
import { instrument } from '@/audio-engine';
import * as persistence from '@/services/persistence';
import type { AttemptRecord, SettingsRecord, SongRecord } from '@/services/persistence';

/**
 * The application store (Zustand). Holds serializable, observable UI/practice
 * state only — never the source of truth for scoring (that is always recomputed
 * by `evaluatePerformance`, spec §25). The audio/input engines below it
 * (`PlaybackEngine`, the adapters, the recorder) are created once as module-scoped
 * instances — analogous to any React app owning one AudioContext — and only ever
 * communicate with the UI by pushing plain snapshots into this store.
 */

export type PracticeMode = 'listen' | 'play-along' | 'wait';

/** Which hand(s) of the reference to play back and score. */
export type PracticeVoice = 'both' | 'left' | 'right';
export type FallingNotesMode = 'guidance' | 'subtle' | 'off';

/**
 * Which face of the shared Practice workspace is currently operable
 * (doc/UI_OPTIMIZATION_PLAN.md §5.1). `score` shows the staff notation; `library`
 * shows the song list. They are mutually exclusive surfaces of one container —
 * never stacked. UI-only state: it never touches the note model, matcher,
 * playback clock, or scoring, and is not persisted.
 */
export type PracticeSurface = 'score' | 'library';

export interface DebugSnapshot {
  playheadTime: number;
  lastMidiEvent: string | null;
  lastMatchingDecisions: LiveFeedbackItem[];
}

interface AppState {
  // song / library
  song: Performance | null;
  songRecord: SongRecord | null;
  savedSongs: SongRecord[];
  importError: string | null;
  isLoadingSong: boolean;

  /** Which face of the shared Practice workspace is operable (see PracticeSurface). */
  practiceSurface: PracticeSurface;

  // practice session
  mode: PracticeMode;
  transportState: EnginePlaybackState;
  currentTime: number;
  duration: number;
  tempoScale: number;
  metronomeEnabled: boolean;
  countInEnabled: boolean;
  isAttemptRunning: boolean;
  waitingForMidi: number[] | null;
  learnerActiveMidi: number[];
  liveFeedback: LiveFeedbackItem[];
  lastInputFeedback: LiveFeedbackItem | null;
  fallingNotesMode: FallingNotesMode;

  // results
  lastResult: EvaluationResult | null;
  lastLearnerPerformance: Performance | null;
  attemptHistory: AttemptRecord[];

  // MIDI device
  midiSupported: boolean;
  midiStatus: AdapterStatus;
  midiInputs: MidiInputInfo[];
  selectedMidiInputId: string | null;
  midiError: string | null;

  // settings + debug
  settings: SettingsRecord;
  /** UI mirror of `settings.inputLatencyMs`. The offset itself is applied at the
   *  module-level `learnerClock` (spec §6) — this is just for the control. */
  inputLatencyMs: number;
  showDebugPanel: boolean;
  debug: DebugSnapshot;

  /** Whether note-on input (keyboard / MIDI / recognised notes) is audible via
   *  the sampled instrument. In-memory only for now — persistence is a later
   *  track's job. Off in headless tests keeps them silent. */
  soundEnabled: boolean;

  /** Which hand(s) of the reference to play back and score. 'both' (default) is
   *  the whole song; 'left' / 'right' filter by the `hand` inferred at import
   *  (music-model/inferHands). The filter is applied to a clone of `song.notes`
   *  BEFORE the engine / `evaluatePerformance` see it — they stay pure. */
  practiceVoice: PracticeVoice;

  // actions
  init(): Promise<void>;
  importMidiFile(bytes: ArrayBuffer, name?: string): Promise<void>;
  loadDemo(id: string): Promise<void>;
  loadSavedSong(id: string): Promise<void>;
  refreshSavedSongs(): Promise<void>;
  loadAttemptHistory(songId: string): Promise<void>;

  setMode(mode: PracticeMode): void;
  setPracticeSurface(surface: PracticeSurface): void;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  restart(): void;
  seek(seconds: number): void;
  setTempoScale(scale: number): void;
  setMetronomeEnabled(on: boolean): void;
  setCountInEnabled(on: boolean): void;
  setShowDebugPanel(on: boolean): void;
  setSoundEnabled(on: boolean): void;
  setPracticeVoice(voice: PracticeVoice): void;
  setFallingNotesMode(mode: FallingNotesMode): void;
  setInputLatencyMs(ms: number): void;

  connectMidi(): Promise<void>;
  selectMidiInput(id: string | null): void;

  pressVirtualKey(midi: number, velocity?: number): void;
  releaseVirtualKey(midi: number): void;

  startAttempt(): void;
  finishAttempt(atTime?: number): Promise<void>;

  // single-page recognition
  recognitionState: RecognitionState;
  recognitionSource: RecognitionSource | null;
  recognitionNotes: NoteEvent[];
  recognitionActiveMidi: number[];
  recognitionElapsed: number;
  recognitionLevel: number;
  recognitionError: string | null;
  startRecognition(source?: RecognitionSource): Promise<void>;
  stopRecognition(): Promise<void>;
  retryRecognition(): Promise<void>;
  deleteSong(id: string): Promise<void>;
  clearSong(): void;
}

export type RecognitionState = 'idle' | 'initializing' | 'listening' | 'stopped' | 'error';
export type RecognitionSource = 'microphone' | 'midi';

// --- module-scoped engines (one AudioContext / input pipeline for the app's lifetime) ---

const engine = new PlaybackEngine({
  onTick: (t) => useAppStore.setState({ currentTime: t, debug: { ...useAppStore.getState().debug, playheadTime: t } }),
  onStateChange: (s) => useAppStore.setState({ transportState: s }),
  onReferenceNoteStart: (note) => handleReferenceNoteStart(note),
  onEnded: (finalTime) => {
    // The reference reached its natural end. If an attempt (Play Along / Wait)
    // is still recording, finish it now — otherwise the recorder and live
    // matcher are left running against a clock the engine has already reset
    // to 0, and any further input would be timestamped near zero.
    if (useAppStore.getState().isAttemptRunning) void useAppStore.getState().finishAttempt(finalTime);
    else useAppStore.setState({ waitingForMidi: null, liveFeedback: [], lastInputFeedback: null });
  },
});

/**
 * Fixed input-latency compensation, in milliseconds (spec §6, §25). A positive
 * value means the learner's note-ons physically register late (device / OS /
 * audio-scan latency), so we shift every recorded learner onset *earlier* by
 * this amount — correcting an on-time performance back to on-time. It is applied
 * in exactly ONE place: the shared learner clock the input adapters timestamp
 * against. This is a scalar offset on the single authoritative clock, not a new
 * timer. Loaded from settings in `init()`, changed via `setInputLatencyMs`.
 */
let inputLatencyMs = 0;
const learnerClock = () => engine.getCurrentTime() - inputLatencyMs / 1000;

const keyboardAdapter = new VirtualKeyboardAdapter(learnerClock);
const midiAdapter = new WebMidiAdapter(learnerClock);
let recorder: PerformanceRecorder | null = null;
let liveMatcher: LiveMatcher | null = null;
let microphoneAdapter: MicrophoneAdapter | null = null;
let recognitionClockStart = 0;
let recognitionTimer: number | null = null;
let recognitionUnsubscribers: Array<() => void> = [];
let recognitionSessionId = 0;
const recognitionPending = new Map<number, Array<{ startTime: number; velocity?: number }>>();
let recognitionRawNotes: Array<{ midi: number; startTime: number; duration: number; velocity?: number }> = [];

/**
 * Hard ceiling on any single recognised note's duration (seconds). No musically
 * real single note lasts longer, and it is also defense in depth: a mistimed
 * note-off must never inflate `performance.duration` so far that playback can't
 * auto-stop (Bug 2). Clamped alongside the live session elapsed time.
 */
const MAX_RECOGNISED_NOTE_SECONDS = 12;

/** Sane bounds for the user-set input-latency compensation (ms). */
const INPUT_LATENCY_MIN_MS = -200;
const INPUT_LATENCY_MAX_MS = 500;

function recognitionTime(): number {
  return Math.max(0, (performance.now() - recognitionClockStart) / 1000);
}

function isRecognitionActive(state = useAppStore.getState()): boolean {
  return state.recognitionState === 'initializing' || state.recognitionState === 'listening';
}

function canStartPlayback(state = useAppStore.getState()): boolean {
  return !isRecognitionActive(state);
}

function clearRecognitionListeners(): void {
  for (const unsubscribe of recognitionUnsubscribers) unsubscribe();
  recognitionUnsubscribers = [];
  recognitionPending.clear();
  if (recognitionTimer !== null) window.clearInterval(recognitionTimer);
  recognitionTimer = null;
}

/**
 * Make learner input audible through the shared sampled instrument. Recognition
 * events themselves never call these functions; the global keyboard/MIDI route
 * decides whether input audio is allowed for the current recognition source.
 */
function audibleAttack(midi: number, velocity?: number): void {
  if (useAppStore.getState().soundEnabled) instrument.attack(midi, velocity);
}
function audibleRelease(midi: number): void {
  // Releases must still be delivered when sound is toggled or recognition has
  // just ended; otherwise a note held across a state transition can stick.
  instrument.release(midi);
}

function noteStartedForRecognition(midi: number, velocity?: number, source: 'microphone' | 'midi-device' | 'virtual-keyboard' = 'microphone', time = recognitionTime()): void {
  const stack = recognitionPending.get(midi) ?? [];
  stack.push({ startTime: time, velocity });
  recognitionPending.set(midi, stack);
  useAppStore.setState((s) => ({
    recognitionActiveMidi: [...new Set([...s.recognitionActiveMidi, midi])],
    recognitionNotes: [...s.recognitionNotes, {
      id: `recognition-${midi}-${Math.round(time * 1000)}`,
      midi,
      noteName: midiToNoteName(midi),
      startTime: time,
      duration: 0.12,
      source,
      velocity,
    }],
  }));
}

function noteEndedForRecognition(midi: number, time = recognitionTime()): void {
  const stack = recognitionPending.get(midi);
  const open = stack?.shift();
  if (open) {
    // Clamp against the raw span, the live session elapsed, and an absolute
    // musical ceiling — any one of these going wrong (a lost note-off, a clock
    // mismatch) must not produce a multi-hundred-second "note" that keeps the
    // reference voice ringing and stops playback ever auto-ending (Bug 2).
    const rawDuration = time - open.startTime;
    const duration = Math.max(0.01, Math.min(rawDuration, recognitionTime(), MAX_RECOGNISED_NOTE_SECONDS));
    recognitionRawNotes.push({ midi, startTime: open.startTime, duration, velocity: open.velocity });
  }
  if (stack && stack.length === 0) recognitionPending.delete(midi);
  useAppStore.setState((s) => ({ recognitionActiveMidi: s.recognitionActiveMidi.filter((m) => m !== midi) }));
}

function pushDebugMidiEvent(label: string): void {
  useAppStore.setState((s) => ({ debug: { ...s.debug, lastMidiEvent: label } }));
}

function handleLearnerNoteOn(midi: number, velocity: number | undefined, label: string, source: 'midi-device' | 'virtual-keyboard'): void {
  pushDebugMidiEvent(label);
  const state = useAppStore.getState();
  const recognitionMidi = isRecognitionActive(state) && state.recognitionSource === 'midi';
  const recognitionMicrophone = isRecognitionActive(state) && state.recognitionSource === 'microphone';
  if (recognitionMidi) {
    // Recognition timestamps must come from the recognition session clock
    // (`recognitionTime()`, the `noteStartedForRecognition` default), NOT the
    // shared learner clock these adapters carry — playback is stopped during
    // recognition, so `learnerClock()` sits at ~0 and would collapse every
    // recognised note onto startTime 0.
    noteStartedForRecognition(midi, velocity, source);
  }
  if (!recognitionMicrophone) audibleAttack(midi, velocity);
  useAppStore.setState((s) => ({ learnerActiveMidi: [...new Set([...s.learnerActiveMidi, midi])] }));

  if (state.mode === 'wait' && state.waitingForMidi?.includes(midi)) {
    const remaining = state.waitingForMidi.filter((m) => m !== midi);
    useAppStore.setState({ waitingForMidi: remaining.length > 0 ? remaining : null });
    if (remaining.length === 0 && canStartPlayback()) void engine.play();
  }

  if (state.isAttemptRunning && liveMatcher) {
    const item = liveMatcher.accept({
      id: `live-${midi}-${Date.now()}`,
      midi,
      noteName: '',
      startTime: engine.getCurrentTime(),
      duration: 0.01,
      velocity,
      source: 'virtual-keyboard',
    });
    useAppStore.setState((s) => ({
      liveFeedback: [item, ...s.liveFeedback].slice(0, 8),
      lastInputFeedback: item,
      debug: { ...s.debug, lastMatchingDecisions: [item, ...s.debug.lastMatchingDecisions].slice(0, 8) },
    }));
  }
}

function handleLearnerNoteOff(midi: number): void {
  const state = useAppStore.getState();
  // As in `handleLearnerNoteOn`: let recognition use its own session clock.
  if (isRecognitionActive(state) && state.recognitionSource === 'midi') noteEndedForRecognition(midi);
  audibleRelease(midi);
  useAppStore.setState((s) => ({ learnerActiveMidi: s.learnerActiveMidi.filter((m) => m !== midi) }));
}

function handleReferenceNoteStart(note: NoteEvent): void {
  const state = useAppStore.getState();
  if (state.mode === 'wait' && state.isAttemptRunning) {
    engine.pause();
    // A chord fires this callback once per simultaneous note, so merge into
    // the existing wait set rather than replacing it — otherwise only the
    // last-processed note of the chord ends up required, and playing just
    // that one silently resumes playback without the rest of the chord.
    useAppStore.setState((s) => ({ waitingForMidi: [...new Set([...(s.waitingForMidi ?? []), note.midi])] }));
  }
}

keyboardAdapter.onNoteStart((n) => handleLearnerNoteOn(n.midi, n.velocity, `keyboard note-on ${n.midi} v${n.velocity ?? '-'}`, 'virtual-keyboard'));
keyboardAdapter.onNoteEnd((n) => handleLearnerNoteOff(n.midi));
midiAdapter.onNoteStart((n) => handleLearnerNoteOn(n.midi, n.velocity, `midi note-on ${n.midi} v${n.velocity ?? '-'}`, 'midi-device'));
midiAdapter.onNoteEnd((n) => handleLearnerNoteOff(n.midi));
midiAdapter.onStatusChange((status) => useAppStore.setState({ midiStatus: status }));

/** Load a song into the playback engine, honouring the current practice voice. */
function loadSongIntoEngine(song: Performance): void {
  engine.load(voiceFilteredPerformance(song, useAppStore.getState().practiceVoice));
}

// --- store ---

export const useAppStore = create<AppState>((set, get) => ({
  song: null,
  songRecord: null,
  savedSongs: [],
  importError: null,
  isLoadingSong: false,
  // No reference is loaded at startup, so open on the library face — never an
  // empty score surface (UI_OPTIMIZATION_PLAN.md §5.1).
  practiceSurface: 'library',

  mode: 'listen',
  transportState: 'idle',
  currentTime: 0,
  duration: 0,
  tempoScale: 1,
  metronomeEnabled: false,
  countInEnabled: true,
  isAttemptRunning: false,
  waitingForMidi: null,
  learnerActiveMidi: [],
  liveFeedback: [],
  lastInputFeedback: null,
  fallingNotesMode: 'guidance',

  lastResult: null,
  lastLearnerPerformance: null,
  attemptHistory: [],

  midiSupported: WebMidiAdapter.isSupported(),
  midiStatus: midiAdapter.status,
  midiInputs: [],
  selectedMidiInputId: null,
  midiError: null,

  settings: persistence.DEFAULT_SETTINGS,
  inputLatencyMs: persistence.DEFAULT_SETTINGS.inputLatencyMs,
  showDebugPanel: false,
  debug: { playheadTime: 0, lastMidiEvent: null, lastMatchingDecisions: [] },
  soundEnabled: true,
  practiceVoice: 'both',

  recognitionState: 'idle',
  recognitionSource: null,
  recognitionNotes: [],
  recognitionActiveMidi: [],
  recognitionElapsed: 0,
  recognitionLevel: 0,
  recognitionError: null,

  async init() {
    const [settings, savedSongs] = await Promise.all([persistence.loadSettings(), persistence.listSongs()]);
    set({
      settings,
      savedSongs,
      tempoScale: settings.tempoScale,
      metronomeEnabled: settings.metronomeEnabled,
      countInEnabled: settings.countInEnabled,
      selectedMidiInputId: settings.lastMidiInputId,
      showDebugPanel: settings.showDebugPanel,
      inputLatencyMs: settings.inputLatencyMs,
    });
    inputLatencyMs = settings.inputLatencyMs; // feed the shared learnerClock offset
    engine.setTempoScale(settings.tempoScale);
    engine.setMetronomeEnabled(settings.metronomeEnabled);
    engine.setCountInEnabled(settings.countInEnabled);
  },

  async importMidiFile(bytes, name) {
    set({ isLoadingSong: true, importError: null });
    try {
      const performance = parseMidiFile(bytes, name ? { name } : undefined);
      const record = await persistence.saveSong(performance, false);
      loadSongIntoEngine(performance);
      set({
        song: performance,
        songRecord: record,
        duration: performance.duration,
        currentTime: 0,
        lastResult: null,
        waitingForMidi: null,
        liveFeedback: [],
        lastInputFeedback: null,
        isLoadingSong: false,
        // Stay on the library face so the user sees the new song join the list
        // and can choose when to practise it (UI_OPTIMIZATION_PLAN.md §5.1).
        practiceSurface: 'library',
      });
      await get().refreshSavedSongs();
      await get().loadAttemptHistory(performance.id);
    } catch (err) {
      const message = err instanceof MidiImportError ? err.message : 'This file could not be imported.';
      // Import failure never disturbs the surface in view (UI_OPTIMIZATION_PLAN.md §5.1).
      set({ importError: message, isLoadingSong: false });
    }
  },

  async loadDemo(id) {
    set({ isLoadingSong: true, importError: null });
    try {
      const performance = loadDemoPerformance(id);
      const record = await persistence.saveSong(performance, true);
      loadSongIntoEngine(performance);
      set({
        song: performance,
        songRecord: record,
        duration: performance.duration,
        currentTime: 0,
        lastResult: null,
        waitingForMidi: null,
        liveFeedback: [],
        lastInputFeedback: null,
        isLoadingSong: false,
        // Loading a demo is "practise this now" — flip to the score face.
        practiceSurface: 'score',
      });
      await get().refreshSavedSongs();
      await get().loadAttemptHistory(performance.id);
    } catch {
      set({ importError: 'This demo could not be loaded.', isLoadingSong: false });
    }
  },

  async loadSavedSong(id) {
    const record = await persistence.getSong(id);
    if (!record) return;
    loadSongIntoEngine(record.performance);
    // Choosing a song from the library flips to the score face (UI_OPTIMIZATION_PLAN.md §5.1).
    set({ song: record.performance, songRecord: record, duration: record.performance.duration, currentTime: 0, lastResult: null, waitingForMidi: null, liveFeedback: [], lastInputFeedback: null, practiceSurface: 'score' });
    await get().loadAttemptHistory(record.performance.id);
  },

  async refreshSavedSongs() {
    set({ savedSongs: await persistence.listSongs() });
  },

  async loadAttemptHistory(songId) {
    set({ attemptHistory: await persistence.listAttempts(songId) });
  },

  setMode(mode) {
    if (get().isAttemptRunning || isRecognitionActive(get())) return;
    set({ mode, waitingForMidi: null, liveFeedback: [], lastInputFeedback: null });
  },

  setPracticeSurface(surface) {
    if (get().practiceSurface === surface) return;
    set({ practiceSurface: surface });
  },

  async play() {
    if (!canStartPlayback()) return;
    await engine.play();
  },
  pause() {
    engine.pause();
  },
  stop() {
    engine.stop();
    set({ waitingForMidi: null, liveFeedback: [], lastInputFeedback: null });
  },
  restart() {
    if (!canStartPlayback()) return;
    engine.restart();
    set({ waitingForMidi: null, liveFeedback: [], lastInputFeedback: null });
  },
  seek(seconds) {
    engine.seek(seconds);
    set({ currentTime: engine.getCurrentTime(), waitingForMidi: null, liveFeedback: [], lastInputFeedback: null });
  },

  setTempoScale(scale) {
    engine.setTempoScale(scale);
    const resolved = engine.getTempoScale();
    set({ tempoScale: resolved });
    void persistence.saveSettings({ tempoScale: resolved }).then((s) => set({ settings: s }));
  },
  setMetronomeEnabled(on) {
    engine.setMetronomeEnabled(on);
    set({ metronomeEnabled: on });
    void persistence.saveSettings({ metronomeEnabled: on }).then((s) => set({ settings: s }));
  },
  setCountInEnabled(on) {
    engine.setCountInEnabled(on);
    set({ countInEnabled: on });
    void persistence.saveSettings({ countInEnabled: on }).then((s) => set({ settings: s }));
  },
  setShowDebugPanel(on) {
    set({ showDebugPanel: on });
    void persistence.saveSettings({ showDebugPanel: on }).then((s) => set({ settings: s }));
  },
  setSoundEnabled(on) {
    set({ soundEnabled: on });
    // Silence anything currently ringing so muting takes effect immediately even
    // for a key/note held down across the toggle. In-memory only — not persisted.
    if (!on) instrument.releaseAll();
  },
  setPracticeVoice(voice) {
    if (get().isAttemptRunning) return;
    set({ practiceVoice: voice });
    const { song } = get();
    if (!song) return;
    // Re-load the filtered reference and rewind — the engine now holds only the
    // chosen hand's notes. In-memory only; not persisted.
    loadSongIntoEngine(song);
    set({ currentTime: 0, waitingForMidi: null, liveFeedback: [], lastInputFeedback: null });
  },
  setFallingNotesMode(mode) {
    set({ fallingNotesMode: mode });
  },
  setInputLatencyMs(ms) {
    const safe = Number.isFinite(ms) ? ms : 0;
    const clamped = Math.round(Math.max(INPUT_LATENCY_MIN_MS, Math.min(INPUT_LATENCY_MAX_MS, safe)));
    inputLatencyMs = clamped; // the shared learnerClock reads this synchronously
    set({ inputLatencyMs: clamped });
    void persistence.saveSettings({ inputLatencyMs: clamped }).then((s) => set({ settings: s }));
  },

  async connectMidi() {
    try {
      await midiAdapter.connect();
      set({ midiInputs: midiAdapter.listInputs(), midiStatus: midiAdapter.status, midiError: null });
      const preferred = get().selectedMidiInputId;
      if (preferred && midiAdapter.listInputs().some((i) => i.id === preferred)) {
        get().selectMidiInput(preferred);
      }
    } catch (err) {
      set({ midiError: err instanceof Error ? err.message : 'Could not access MIDI devices.' });
    }
  },
  selectMidiInput(id) {
    midiAdapter.selectInput(id);
    set({ selectedMidiInputId: id, midiStatus: midiAdapter.status });
    void persistence.saveSettings({ lastMidiInputId: id }).then((s) => set({ settings: s }));
  },

  pressVirtualKey(midi, velocity) {
    // The adapter event is the single input-to-audio/recording dispatch path.
    keyboardAdapter.press(midi, velocity);
  },
  releaseVirtualKey(midi) {
    keyboardAdapter.release(midi);
  },

  startAttempt() {
    const { song, mode, selectedMidiInputId, practiceVoice } = get();
    if (!song || mode === 'listen' || isRecognitionActive(get())) return;
    const source = selectedMidiInputId && midiAdapter.status === 'connected' ? 'midi-device' : 'virtual-keyboard';
    recorder = new PerformanceRecorder(source);
    recorder.attach(keyboardAdapter);
    recorder.attach(midiAdapter);
    recorder.start();
    liveMatcher = new LiveMatcher(voiceFilteredNotes(song, practiceVoice));
    set({ isAttemptRunning: true, liveFeedback: [], lastInputFeedback: null, lastResult: null, waitingForMidi: null });
  },

  async finishAttempt(atTime) {
    const { song, mode, practiceVoice } = get();
    if (!song || !recorder) return;
    const learnerPerformance = recorder.stop(atTime ?? engine.getCurrentTime(), `${song.name} attempt`);
    recorder.dispose();
    recorder = null;
    liveMatcher = null;
    engine.pause();

    // Score the learner against only the hand(s) they chose to practise. The
    // filter is applied here, before the pure `evaluatePerformance` call.
    const result = evaluatePerformance(voiceFilteredNotes(song, practiceVoice), learnerPerformance.notes);
    set({ isAttemptRunning: false, waitingForMidi: null, liveFeedback: [], lastInputFeedback: null, lastResult: result, lastLearnerPerformance: learnerPerformance });

    await persistence.saveAttempt({
      songId: song.id,
      songName: song.name,
      mode,
      learnerPerformance,
      result,
    });
    await get().loadAttemptHistory(song.id);
  },

  async startRecognition(source = 'microphone') {
    if (get().recognitionState === 'initializing' || get().recognitionState === 'listening') return;
    const sessionId = ++recognitionSessionId;
    clearRecognitionListeners();
    recognitionRawNotes = [];
    recognitionClockStart = performance.now();
    set({ recognitionState: 'initializing', recognitionSource: source, recognitionNotes: [], recognitionActiveMidi: [], recognitionElapsed: 0, recognitionError: null, importError: null, waitingForMidi: null });

    // Stop reference playback immediately. If an attempt is active, preserve
    // its current timestamp while sending it through the normal finish/persist
    // path below rather than leaving a reference voice playing during setup.
    const attemptTime = engine.getCurrentTime();
    engine.stop();
    instrument.releaseAll();
    keyboardAdapter.releaseAll();
    if (get().isAttemptRunning) await get().finishAttempt(attemptTime);
    if (sessionId !== recognitionSessionId) return;

    const connect = async () => {
      if (source === 'microphone') {
        // Inject the same session clock the rest of the recognition path uses, so
        // the adapter timestamps note-ons and note-offs on one monotonic clock
        // (Bug 2: onsets were buffer-relative, offsets were performance.now()).
        microphoneAdapter = new MicrophoneAdapter({ onLevel: (rms) => set({ recognitionLevel: rms }), clock: () => recognitionTime() });
        recognitionUnsubscribers.push(microphoneAdapter.onStatusChange((status) => {
          if (sessionId !== recognitionSessionId) return;
          if (status === 'error') set({ recognitionError: 'The microphone was disconnected or lost during capture.' });
        }));
        recognitionUnsubscribers.push(microphoneAdapter.onNoteStart((n) => {
          if (sessionId === recognitionSessionId) noteStartedForRecognition(n.midi, n.velocity, 'microphone', n.time);
        }));
        recognitionUnsubscribers.push(microphoneAdapter.onNoteEnd((n) => {
          if (sessionId === recognitionSessionId) noteEndedForRecognition(n.midi, n.time);
        }));
        await microphoneAdapter.connect();
      } else {
        await midiAdapter.connect();
        if (sessionId !== recognitionSessionId) return;
        const inputs = midiAdapter.listInputs();
        const preferred = get().selectedMidiInputId;
        if (preferred && inputs.some((input) => input.id === preferred)) midiAdapter.selectInput(preferred);
        else if (inputs[0]) midiAdapter.selectInput(inputs[0].id);
      }
    };

    try {
      await connect();
      if (sessionId !== recognitionSessionId) {
        await microphoneAdapter?.disconnect().catch(() => undefined);
        microphoneAdapter = null;
        return;
      }
      set({ recognitionState: 'listening' });
      recognitionTimer = window.setInterval(() => set({ recognitionElapsed: recognitionTime() }), 100);
    } catch (err) {
      if (sessionId !== recognitionSessionId) return;
      clearRecognitionListeners();
      await microphoneAdapter?.disconnect().catch(() => undefined);
      microphoneAdapter = null;
      set({ recognitionState: 'error', recognitionError: err instanceof Error ? err.message : 'Could not start recognition.' });
    }
  },

  async stopRecognition() {
    const currentState = get().recognitionState;
    if (currentState !== 'initializing' && currentState !== 'listening') return;
    if (currentState === 'initializing') {
      // Invalidate first so a late permission/model result cannot revive this
      // session after Stop has completed.
      recognitionSessionId += 1;
      const adapter = microphoneAdapter;
      microphoneAdapter = null;
      clearRecognitionListeners();
      await adapter?.disconnect().catch(() => undefined);
      instrument.releaseAll();
      keyboardAdapter.releaseAll();
      set({ recognitionState: 'stopped', recognitionActiveMidi: [], recognitionLevel: 0 });
      return;
    }
    const stopTime = recognitionTime();
    if (microphoneAdapter) await microphoneAdapter.disconnect();
    for (const midi of [...recognitionPending.keys()]) noteEndedForRecognition(midi, stopTime);
    const rawNotes = [...recognitionRawNotes];
    recognitionSessionId += 1;
    clearRecognitionListeners();
    microphoneAdapter = null;
    instrument.releaseAll();
    keyboardAdapter.releaseAll();
    const source = get().recognitionSource === 'midi' ? 'midi-device' : 'microphone';
    if (rawNotes.length === 0) {
      set({ recognitionState: 'error', recognitionError: 'No notes were detected. Play a clear single-note melody and try again.', recognitionActiveMidi: [], recognitionElapsed: stopTime });
      return;
    }
    const name = `Unnamed performance · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const performance = buildPerformance(rawNotes, { name, source, idPrefix: 'recognised' });
    const record = await persistence.saveSong(performance, false);
    loadSongIntoEngine(performance);
    set({ song: performance, songRecord: record, duration: performance.duration, currentTime: 0, lastResult: null, recognitionState: 'stopped', recognitionActiveMidi: [], recognitionElapsed: stopTime, recognitionLevel: 0 });
    await get().refreshSavedSongs();
    await get().loadAttemptHistory(performance.id);
  },

  async retryRecognition() {
    await get().startRecognition(get().recognitionSource ?? 'microphone');
  },

  async deleteSong(id) {
    await persistence.deleteSong(id);
    if (get().song?.id === id) get().clearSong();
    await get().refreshSavedSongs();
  },

  clearSong() {
    engine.stop();
    // No song left to notate — fall back to the library face (UI_OPTIMIZATION_PLAN.md §5.1).
    set({ song: null, songRecord: null, duration: 0, currentTime: 0, lastResult: null, lastLearnerPerformance: null, attemptHistory: [], mode: 'listen', practiceSurface: 'library', waitingForMidi: null, liveFeedback: [], lastInputFeedback: null });
  },
}));

export function _getEnginesForTests() {
  return { engine, keyboardAdapter, midiAdapter };
}

export function _getRecognitionForTests() {
  return { noteStartedForRecognition, noteEndedForRecognition };
}
