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
import { evaluatePerformance, LiveMatcher, type EvaluationResult, type LiveFeedbackItem } from '@/practice-engine';
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
  showDebugPanel: boolean;
  debug: DebugSnapshot;

  // actions
  init(): Promise<void>;
  importMidiFile(bytes: ArrayBuffer, name?: string): Promise<void>;
  loadDemo(id: string): Promise<void>;
  loadSavedSong(id: string): Promise<void>;
  refreshSavedSongs(): Promise<void>;
  loadAttemptHistory(songId: string): Promise<void>;

  setMode(mode: PracticeMode): void;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  restart(): void;
  seek(seconds: number): void;
  setTempoScale(scale: number): void;
  setMetronomeEnabled(on: boolean): void;
  setCountInEnabled(on: boolean): void;
  setShowDebugPanel(on: boolean): void;

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
  },
});

const keyboardAdapter = new VirtualKeyboardAdapter(() => engine.getCurrentTime());
const midiAdapter = new WebMidiAdapter(() => engine.getCurrentTime());
let recorder: PerformanceRecorder | null = null;
let liveMatcher: LiveMatcher | null = null;
let microphoneAdapter: MicrophoneAdapter | null = null;
let recognitionClockStart = 0;
let recognitionTimer: number | null = null;
let recognitionUnsubscribers: Array<() => void> = [];
const recognitionPending = new Map<number, Array<{ startTime: number; velocity?: number }>>();
let recognitionRawNotes: Array<{ midi: number; startTime: number; duration: number; velocity?: number }> = [];

function recognitionTime(): number {
  return Math.max(0, (performance.now() - recognitionClockStart) / 1000);
}

function clearRecognitionListeners(): void {
  for (const unsubscribe of recognitionUnsubscribers) unsubscribe();
  recognitionUnsubscribers = [];
  recognitionPending.clear();
  if (recognitionTimer !== null) window.clearInterval(recognitionTimer);
  recognitionTimer = null;
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
  if (open) recognitionRawNotes.push({ midi, startTime: open.startTime, duration: Math.max(0.01, time - open.startTime), velocity: open.velocity });
  if (stack && stack.length === 0) recognitionPending.delete(midi);
  useAppStore.setState((s) => ({ recognitionActiveMidi: s.recognitionActiveMidi.filter((m) => m !== midi) }));
}

function pushDebugMidiEvent(label: string): void {
  useAppStore.setState((s) => ({ debug: { ...s.debug, lastMidiEvent: label } }));
}

function handleLearnerNoteOn(midi: number, velocity: number | undefined, label: string): void {
  pushDebugMidiEvent(label);
  useAppStore.setState((s) => ({ learnerActiveMidi: [...new Set([...s.learnerActiveMidi, midi])] }));

  const state = useAppStore.getState();
  if (state.mode === 'wait' && state.waitingForMidi?.includes(midi)) {
    const remaining = state.waitingForMidi.filter((m) => m !== midi);
    useAppStore.setState({ waitingForMidi: remaining.length > 0 ? remaining : null });
    if (remaining.length === 0) void engine.play();
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
      debug: { ...s.debug, lastMatchingDecisions: [item, ...s.debug.lastMatchingDecisions].slice(0, 8) },
    }));
  }
}

function handleLearnerNoteOff(midi: number): void {
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

keyboardAdapter.onNoteStart((n) => handleLearnerNoteOn(n.midi, n.velocity, `keyboard note-on ${n.midi} v${n.velocity ?? '-'}`));
keyboardAdapter.onNoteEnd((n) => handleLearnerNoteOff(n.midi));
midiAdapter.onNoteStart((n) => handleLearnerNoteOn(n.midi, n.velocity, `midi note-on ${n.midi} v${n.velocity ?? '-'}`));
midiAdapter.onNoteEnd((n) => handleLearnerNoteOff(n.midi));
midiAdapter.onStatusChange((status) => useAppStore.setState({ midiStatus: status }));

// --- store ---

export const useAppStore = create<AppState>((set, get) => ({
  song: null,
  songRecord: null,
  savedSongs: [],
  importError: null,
  isLoadingSong: false,

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

  lastResult: null,
  lastLearnerPerformance: null,
  attemptHistory: [],

  midiSupported: WebMidiAdapter.isSupported(),
  midiStatus: midiAdapter.status,
  midiInputs: [],
  selectedMidiInputId: null,
  midiError: null,

  settings: persistence.DEFAULT_SETTINGS,
  showDebugPanel: false,
  debug: { playheadTime: 0, lastMidiEvent: null, lastMatchingDecisions: [] },

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
    });
    engine.setTempoScale(settings.tempoScale);
    engine.setMetronomeEnabled(settings.metronomeEnabled);
    engine.setCountInEnabled(settings.countInEnabled);
  },

  async importMidiFile(bytes, name) {
    set({ isLoadingSong: true, importError: null });
    try {
      const performance = parseMidiFile(bytes, name ? { name } : undefined);
      const record = await persistence.saveSong(performance, false);
      engine.load(performance);
      set({
        song: performance,
        songRecord: record,
        duration: performance.duration,
        currentTime: 0,
        lastResult: null,
        isLoadingSong: false,
      });
      await get().refreshSavedSongs();
      await get().loadAttemptHistory(performance.id);
    } catch (err) {
      const message = err instanceof MidiImportError ? err.message : 'This file could not be imported.';
      set({ importError: message, isLoadingSong: false });
    }
  },

  async loadDemo(id) {
    set({ isLoadingSong: true, importError: null });
    try {
      const performance = loadDemoPerformance(id);
      const record = await persistence.saveSong(performance, true);
      engine.load(performance);
      set({
        song: performance,
        songRecord: record,
        duration: performance.duration,
        currentTime: 0,
        lastResult: null,
        isLoadingSong: false,
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
    engine.load(record.performance);
    set({ song: record.performance, songRecord: record, duration: record.performance.duration, currentTime: 0, lastResult: null });
    await get().loadAttemptHistory(record.performance.id);
  },

  async refreshSavedSongs() {
    set({ savedSongs: await persistence.listSongs() });
  },

  async loadAttemptHistory(songId) {
    set({ attemptHistory: await persistence.listAttempts(songId) });
  },

  setMode(mode) {
    if (get().isAttemptRunning) return;
    set({ mode, waitingForMidi: null });
  },

  async play() {
    await engine.play();
  },
  pause() {
    engine.pause();
  },
  stop() {
    engine.stop();
    set({ waitingForMidi: null });
  },
  restart() {
    engine.restart();
    set({ waitingForMidi: null });
  },
  seek(seconds) {
    engine.seek(seconds);
    set({ currentTime: engine.getCurrentTime() });
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
    keyboardAdapter.press(midi, velocity);
  },
  releaseVirtualKey(midi) {
    keyboardAdapter.release(midi);
  },

  startAttempt() {
    const { song, mode, selectedMidiInputId } = get();
    if (!song || mode === 'listen') return;
    const source = selectedMidiInputId && midiAdapter.status === 'connected' ? 'midi-device' : 'virtual-keyboard';
    recorder = new PerformanceRecorder(source);
    recorder.attach(keyboardAdapter);
    recorder.attach(midiAdapter);
    recorder.start();
    liveMatcher = new LiveMatcher(song.notes);
    set({ isAttemptRunning: true, liveFeedback: [], lastResult: null, waitingForMidi: null });
  },

  async finishAttempt(atTime) {
    const { song, mode } = get();
    if (!song || !recorder) return;
    const learnerPerformance = recorder.stop(atTime ?? engine.getCurrentTime(), `${song.name} attempt`);
    recorder.dispose();
    recorder = null;
    liveMatcher = null;
    engine.pause();

    const result = evaluatePerformance(song.notes, learnerPerformance.notes);
    set({ isAttemptRunning: false, waitingForMidi: null, lastResult: result, lastLearnerPerformance: learnerPerformance });

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
    clearRecognitionListeners();
    recognitionRawNotes = [];
    recognitionClockStart = performance.now();
    set({ recognitionState: 'initializing', recognitionSource: source, recognitionNotes: [], recognitionActiveMidi: [], recognitionElapsed: 0, recognitionError: null, importError: null });

    const connect = async () => {
      if (source === 'microphone') {
        microphoneAdapter = new MicrophoneAdapter({ onLevel: (rms) => set({ recognitionLevel: rms }) });
        recognitionUnsubscribers.push(microphoneAdapter.onStatusChange((status) => {
          if (status === 'error') set({ recognitionError: 'The microphone was disconnected or lost during capture.' });
        }));
        recognitionUnsubscribers.push(microphoneAdapter.onNoteStart((n) => noteStartedForRecognition(n.midi, n.velocity, 'microphone', n.time)));
        recognitionUnsubscribers.push(microphoneAdapter.onNoteEnd((n) => noteEndedForRecognition(n.midi, n.time)));
        await microphoneAdapter.connect();
      } else {
        await midiAdapter.connect();
        const inputs = midiAdapter.listInputs();
        const preferred = get().selectedMidiInputId;
        if (preferred && inputs.some((input) => input.id === preferred)) midiAdapter.selectInput(preferred);
        else if (inputs[0]) midiAdapter.selectInput(inputs[0].id);
        recognitionUnsubscribers.push(keyboardAdapter.onNoteStart((n) => noteStartedForRecognition(n.midi, n.velocity, 'virtual-keyboard')));
        recognitionUnsubscribers.push(keyboardAdapter.onNoteEnd((n) => noteEndedForRecognition(n.midi)));
        recognitionUnsubscribers.push(midiAdapter.onNoteStart((n) => noteStartedForRecognition(n.midi, n.velocity, 'midi-device')));
        recognitionUnsubscribers.push(midiAdapter.onNoteEnd((n) => noteEndedForRecognition(n.midi)));
      }
    };

    try {
      await connect();
      set({ recognitionState: 'listening' });
      recognitionTimer = window.setInterval(() => set({ recognitionElapsed: recognitionTime() }), 100);
    } catch (err) {
      clearRecognitionListeners();
      await microphoneAdapter?.disconnect().catch(() => undefined);
      microphoneAdapter = null;
      set({ recognitionState: 'error', recognitionError: err instanceof Error ? err.message : 'Could not start recognition.' });
    }
  },

  async stopRecognition() {
    if (get().recognitionState !== 'listening') return;
    const stopTime = recognitionTime();
    if (microphoneAdapter) await microphoneAdapter.disconnect();
    for (const midi of [...recognitionPending.keys()]) noteEndedForRecognition(midi, stopTime);
    clearRecognitionListeners();
    microphoneAdapter = null;
    const source = get().recognitionSource === 'midi' ? 'midi-device' : 'microphone';
    if (recognitionRawNotes.length === 0) {
      set({ recognitionState: 'error', recognitionError: 'No notes were detected. Play a clear single-note melody and try again.', recognitionActiveMidi: [], recognitionElapsed: stopTime });
      return;
    }
    const name = `Unnamed performance · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const performance = buildPerformance(recognitionRawNotes, { name, source, idPrefix: 'recognised' });
    const record = await persistence.saveSong(performance, false);
    engine.load(performance);
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
    set({ song: null, songRecord: null, duration: 0, currentTime: 0, lastResult: null, lastLearnerPerformance: null, attemptHistory: [], mode: 'listen' });
  },
}));

export function _getEnginesForTests() {
  return { engine, keyboardAdapter, midiAdapter };
}
