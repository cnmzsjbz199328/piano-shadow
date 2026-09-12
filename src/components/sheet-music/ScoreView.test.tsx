import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { NoteEvent, NoteSource, Performance } from '@/music-model';

/**
 * The store is replaced wholesale so `ScoreView` is exercised in isolation
 * (mounting the real `useAppStore` would spin up PlaybackEngine / Tone).
 */
const { state } = vi.hoisted(() => ({
  state: {
    song: null as Performance | null,
    currentTime: 0,
    transportState: 'idle',
  },
}));

vi.mock('@/stores/useAppStore', () => ({
  useAppStore: <T,>(selector: (s: typeof state) => T): T => selector(state),
}));

import { ScoreView } from './ScoreView';

function note(midi: number, startTime: number, duration = 0.5): NoteEvent {
  return { id: `n-${midi}-${startTime}`, midi, noteName: '', startTime, duration, source: 'midi-file' };
}

function midiSong(notes: NoteEvent[] = defaultNotes()): Performance {
  return {
    id: 'song-midi',
    name: 'Fixture Sonatina',
    notes,
    duration: notes.length ? Math.max(...notes.map((n) => n.startTime + n.duration)) : 0,
    tempoMap: [{ time: 0, bpm: 120 }],
    timeSignatureMap: [{ time: 0, numerator: 4, denominator: 4 }],
    sourceType: 'midi-file',
    createdAt: new Date(0).toISOString(),
  };
}

function recordedSong(sourceType: NoteSource): Performance {
  return {
    id: 'song-rec',
    name: 'Recorded take',
    notes: [note(60, 0, 0.9), note(62, 1, 0.4)],
    duration: 1.4,
    sourceType,
    createdAt: new Date(0).toISOString(),
  };
}

/** ~2 bars of 4/4 at 120 bpm: quarters in both hands, a chord, a couple of eighths. */
function defaultNotes(): NoteEvent[] {
  return [
    note(60, 0, 0.5),
    note(64, 0.5, 0.5),
    note(67, 1.0, 0.25),
    note(72, 1.25, 0.25),
    note(65, 1.5, 0.5),
    note(48, 0, 1.0),
    note(43, 1.0, 1.0),
    note(60, 2.0, 0.5),
    note(62, 2.5, 0.5),
    note(64, 3.0, 1.0),
    note(45, 2.0, 2.0),
  ];
}

const realGetContext = HTMLCanvasElement.prototype.getContext;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  state.song = null;
  state.currentTime = 0;
  state.transportState = 'idle';
  // jsdom has no real 2D context; VexFlow only uses it for text measurement and
  // degrades gracefully to empty metrics when it is null.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
  warnSpy.mockRestore();
  vi.restoreAllMocks();
});

describe('ScoreView — scope gate', () => {
  it('refuses when there is no song', () => {
    state.song = null;
    render(<ScoreView />);
    expect(
      screen.getByText('Notation needs a quantised rhythm — not available for recorded takes yet.'),
    ).toBeInTheDocument();
    expect(document.querySelector('svg')).toBeNull();
  });

  it('refuses a microphone-recorded take', () => {
    state.song = recordedSong('microphone');
    render(<ScoreView />);
    expect(
      screen.getByText('Notation needs a quantised rhythm — not available for recorded takes yet.'),
    ).toBeInTheDocument();
    expect(document.querySelector('svg')).toBeNull();
  });

  it('refuses a device-recorded take', () => {
    state.song = recordedSong('midi-device');
    render(<ScoreView />);
    expect(
      screen.getByText('Notation needs a quantised rhythm — not available for recorded takes yet.'),
    ).toBeInTheDocument();
  });
});

describe('ScoreView — imported MIDI', () => {
  it('renders a stave for an imported-MIDI performance without throwing', async () => {
    state.song = midiSong();
    expect(() => render(<ScoreView />)).not.toThrow();

    const host = await screen.findByRole('region', { name: /staff notation for fixture sonatina/i });
    await waitFor(() => expect(host.querySelector('svg')).not.toBeNull());

    // The scope-gate refusal must NOT be shown for eligible input.
    expect(
      screen.queryByText(/not available for recorded takes yet/i),
    ).not.toBeInTheDocument();
    // The approximation is disclosed, not hidden (spec §25 — no overclaiming).
    expect(screen.getByText(/approximate rhythm/i)).toBeInTheDocument();
  });

  it('does not throw for an imported-MIDI performance with no notes', () => {
    state.song = midiSong([]);
    expect(() => render(<ScoreView />)).not.toThrow();
    expect(screen.getByText(/no notes to display/i)).toBeInTheDocument();
  });

  it('renders only an initial batch of rows on mount, not the whole long song', async () => {
    const many: NoteEvent[] = [];
    for (let bar = 0; bar < 100; bar += 1) many.push(note(60 + (bar % 5), bar * 2, 0.5));
    state.song = midiSong(many);
    render(<ScoreView />);

    const host = await screen.findByRole('region', { name: /staff notation for fixture sonatina/i });
    await waitFor(() => expect(host.querySelector('svg')).not.toBeNull());
    const initialNotes = host.querySelectorAll('.score-note').length;

    expect(initialNotes).toBeGreaterThan(0);
    expect(initialNotes).toBeLessThan(many.length);
  });

  it('renders more rows as the score viewport scrolls down', async () => {
    const many: NoteEvent[] = [];
    for (let bar = 0; bar < 100; bar += 1) many.push(note(60 + (bar % 5), bar * 2, 0.5));
    state.song = midiSong(many);
    render(
      <div className="score-surface__viewport">
        <ScoreView />
      </div>,
    );

    const host = await screen.findByRole('region', { name: /staff notation for fixture sonatina/i });
    const viewport = host.closest('.score-surface__viewport');
    expect(viewport).not.toBeNull();
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 420 });
    await waitFor(() => expect(host.querySelectorAll('.score-note').length).toBeGreaterThan(0));
    const initialNotes = host.querySelectorAll('.score-note').length;

    for (let scrollTop = 600; scrollTop <= 12000; scrollTop += 600) {
      fireEvent.scroll(viewport as HTMLElement, { target: { scrollTop } });
    }

    await waitFor(() => expect(host.querySelectorAll('.score-note')).toHaveLength(many.length));
    expect(host.querySelectorAll('.score-note').length).toBeGreaterThan(initialNotes);
  });

  it('keeps drawing ahead of playback without manual scrolling', async () => {
    const many: NoteEvent[] = [];
    for (let bar = 0; bar < 100; bar += 1) many.push(note(60 + (bar % 5), bar * 2, 0.5));
    state.song = midiSong(many);
    const view = render(<ScoreView />);

    const host = await screen.findByRole('region', { name: /staff notation for fixture sonatina/i });
    await waitFor(() => expect(host.querySelectorAll('.score-note').length).toBeGreaterThan(0));
    const initialNotes = host.querySelectorAll('.score-note').length;

    state.currentTime = 80 * 2;
    state.transportState = 'playing';
    view.rerender(<ScoreView />);

    await waitFor(() => expect(host.querySelectorAll('.score-note').length).toBeGreaterThan(initialNotes));
    expect(host.querySelectorAll('.score-note').length).toBeGreaterThanOrEqual(81);
  });
});
