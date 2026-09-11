import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import type { NoteEvent, Performance } from '@/music-model';

/**
 * The store is replaced wholesale so the component is exercised in isolation
 * (mounting the real `useAppStore` module would spin up PlaybackEngine / Tone).
 */
const { state } = vi.hoisted(() => ({
  state: {
    song: null as Performance | null,
    currentTime: 0,
    transportState: 'playing' as string,
    isAttemptRunning: true,
    practiceVoice: 'both' as const,
    waitingForMidi: null as number[] | null,
    fallingNotesMode: 'guidance' as const,
    lastInputFeedback: null,
  },
}));

vi.mock('@/stores/useAppStore', () => ({
  useAppStore: <T,>(selector: (s: typeof state) => T): T => selector(state),
}));

import { FallingNotes } from './FallingNotes';

function note(midi: number, startTime: number, duration = 0.4): NoteEvent {
  return {
    id: `n-${midi}-${startTime}`,
    midi,
    noteName: '',
    startTime,
    duration,
    source: 'midi-file',
  };
}

function song(notes: NoteEvent[]): Performance {
  return {
    id: 'song-1',
    name: 'Fixture',
    notes,
    duration: 10,
    sourceType: 'midi-file',
    createdAt: new Date(0).toISOString(),
  };
}

function fakeCtx() {
  return {
    canvas: document.createElement('canvas'),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
  };
}

let ctx: ReturnType<typeof fakeCtx>;
const realGetContext = HTMLCanvasElement.prototype.getContext;
const realMatchMedia = window.matchMedia;

/** jsdom has no real 2D context; hand the component a recording stub (or `null`). */
function stubCanvasContext(value: ReturnType<typeof fakeCtx> | null): void {
  HTMLCanvasElement.prototype.getContext = (() => value) as never;
}

function stubReducedMotion(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as never;
}

beforeEach(() => {
  state.song = null;
  state.currentTime = 0;
  state.transportState = 'playing';
  state.isAttemptRunning = true;
  state.practiceVoice = 'both';
  state.waitingForMidi = null;
  state.fallingNotesMode = 'guidance';
  state.lastInputFeedback = null;

  ctx = fakeCtx();
  stubCanvasContext(ctx);
  // Run the paint synchronously so the draw path is covered inside render().
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
  window.matchMedia = realMatchMedia;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FallingNotes', () => {
  it('renders a <canvas> guidance layer', () => {
    const { container } = render(<FallingNotes />);
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(container.querySelector('.falling-notes')).not.toBeNull();
  });

  it('does not throw with song = null', () => {
    state.song = null;
    expect(() => render(<FallingNotes />)).not.toThrow();
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('does not throw with a song of 0 notes', () => {
    state.song = song([]);
    expect(() => render(<FallingNotes />)).not.toThrow();
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('draws a column for each upcoming note in range without throwing', () => {
    state.song = song([note(60, 0.5), note(64, 1.0), note(25, 1.5), note(103, 2.0)]);
    state.currentTime = 0.2;
    expect(() => render(<FallingNotes />)).not.toThrow();
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('skips notes that are already finished or beyond the look-ahead window', () => {
    // one already-past note, one far-future note -> nothing to draw
    state.song = song([note(60, 0, 0.2), note(72, 30)]);
    state.currentTime = 5;
    render(<FallingNotes />);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('keeps the first target visible while the transport is idle for preview', () => {
    state.song = song([note(60, 0.5)]);
    state.currentTime = 0;
    state.transportState = 'stopped';
    state.isAttemptRunning = false;
    render(<FallingNotes />);
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('renders static markers (no throw) when prefers-reduced-motion is set', () => {
    stubReducedMotion(true);
    state.song = song([note(60, 0.4), note(62, 0.9), note(64, 1.4)]);
    state.currentTime = 0.1;
    expect(() => render(<FallingNotes />)).not.toThrow();
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('keeps a waiting chord on one static layer and only uses remaining targets', () => {
    stubReducedMotion(true);
    state.song = song([note(60, 0), note(64, 0), note(67, 0), note(72, 1)]);
    state.currentTime = 0;
    state.waitingForMidi = [60, 67];
    render(<FallingNotes />);
    const yPositions = ctx.fillRect.mock.calls.map((call) => call[1]).filter((y) => y === 78);
    expect(yPositions).toHaveLength(2);
  });

  it('no-ops (does not throw) when the canvas has no 2D context', () => {
    stubCanvasContext(null);
    state.song = song([note(60, 0.5), note(64, 1.0)]);
    state.currentTime = 0.2;
    expect(() => render(<FallingNotes />)).not.toThrow();
  });
});
