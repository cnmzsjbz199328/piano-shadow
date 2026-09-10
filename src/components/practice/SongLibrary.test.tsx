import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Performance } from '@/music-model';
import type { SongRecord } from '@/services/persistence';

/**
 * The store is replaced wholesale so `SongLibrary` is exercised in isolation
 * (the real `useAppStore` module spins up PlaybackEngine / Tone).
 */
const { state, actions } = vi.hoisted(() => ({
  state: {
    savedSongs: [] as SongRecord[],
    song: null as Performance | null,
    isLoadingSong: false,
    importError: null as string | null,
  },
  actions: {
    loadSavedSong: vi.fn(),
    loadDemo: vi.fn(),
    setMode: vi.fn(),
    deleteSong: vi.fn(),
  },
}));

vi.mock('@/stores/useAppStore', () => ({
  useAppStore: <T,>(selector: (s: Record<string, unknown>) => T): T =>
    selector({
      savedSongs: state.savedSongs,
      song: state.song,
      isLoadingSong: state.isLoadingSong,
      importError: state.importError,
      ...actions,
    }),
}));

import { SongLibrary } from './SongLibrary';

function perf(id: string, name: string): Performance {
  return {
    id,
    name,
    notes: [{ id: `${id}-n`, midi: 60, noteName: 'C4', startTime: 0, duration: 0.5, source: 'midi-file' }],
    duration: 12,
    sourceType: 'midi-file',
    createdAt: new Date(0).toISOString(),
  };
}

function record(p: Performance): SongRecord {
  return { id: p.id, performance: p, isDemo: false, savedAt: p.createdAt };
}

beforeEach(() => {
  state.savedSongs = [];
  state.song = null;
  state.isLoadingSong = false;
  state.importError = null;
  actions.loadSavedSong.mockReset().mockResolvedValue(undefined);
  actions.loadDemo.mockReset().mockResolvedValue(undefined);
  actions.setMode.mockReset();
  actions.deleteSong.mockReset().mockResolvedValue(undefined);
});

describe('SongLibrary — library face', () => {
  it('shows one header with the count and an Import control', () => {
    state.savedSongs = [record(perf('a', 'Song A')), record(perf('b', 'Song B'))];
    render(<SongLibrary />);
    expect(screen.getByRole('heading', { name: 'My MIDI songs' })).toBeInTheDocument();
    expect(screen.getByText('2 songs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import midi/i })).toBeInTheDocument();
  });

  it('empty library keeps the discoverable copy and offers built-in demos', () => {
    render(<SongLibrary />);
    expect(screen.getByText(/will appear here/i)).toBeInTheDocument();
    const demos = screen.getByText(/built-in demo/i).parentElement as HTMLElement;
    expect(within(demos).getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('loading a demo goes through the store action', async () => {
    render(<SongLibrary />);
    const demos = screen.getByText(/built-in demo/i).parentElement as HTMLElement;
    const [firstDemo] = within(demos).getAllByRole('button');
    await userEvent.click(firstDemo as HTMLElement);
    expect(actions.loadDemo).toHaveBeenCalledTimes(1);
  });

  it('marks the current song with an accent row and a "Current" badge', () => {
    const a = perf('a', 'Song A');
    state.savedSongs = [record(a), record(perf('b', 'Song B'))];
    state.song = a;
    render(<SongLibrary />);
    const rowA = screen.getByText('Song A').closest('.song-row');
    expect(rowA).toHaveClass('song-row--current');
    expect(within(rowA as HTMLElement).getByText('Current')).toBeInTheDocument();
    // The other row is not marked.
    const rowB = screen.getByText('Song B').closest('.song-row');
    expect(rowB).not.toHaveClass('song-row--current');
  });

  it('Practice loads the song then switches to play-along mode', async () => {
    state.savedSongs = [record(perf('a', 'Song A'))];
    render(<SongLibrary />);
    await userEvent.click(screen.getByRole('button', { name: 'Practice' }));
    expect(actions.loadSavedSong).toHaveBeenCalledWith('a');
    expect(actions.setMode).toHaveBeenCalledWith('play-along');
  });

  it('shows "Back to score" only when a reference is loaded, and disables it while flipping', () => {
    const a = perf('a', 'Song A');
    state.savedSongs = [record(a)];
    state.song = a;
    const onReturnToScore = vi.fn();
    const { rerender } = render(
      <SongLibrary onReturnToScore={onReturnToScore} canReturnToScore busy={false} />,
    );
    expect(screen.getByRole('button', { name: /back to the score/i })).toBeEnabled();

    rerender(<SongLibrary onReturnToScore={onReturnToScore} canReturnToScore busy />);
    expect(screen.getByRole('button', { name: /back to the score/i })).toBeDisabled();

    rerender(<SongLibrary onReturnToScore={onReturnToScore} canReturnToScore={false} busy={false} />);
    expect(screen.queryByRole('button', { name: /back to the score/i })).not.toBeInTheDocument();
  });

  it('surfaces an import failure on the library face without clearing the list', () => {
    state.savedSongs = [record(perf('a', 'Song A'))];
    state.importError = 'This file could not be imported.';
    render(<SongLibrary />);
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be imported/i);
    expect(screen.getByText('Song A')).toBeInTheDocument();
  });
});
