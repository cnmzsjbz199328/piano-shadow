import { useMemo } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { getDemoAssets, writeMidiFile } from '@/midi';
import type { Performance } from '@/music-model';
import { ErrorBanner } from '@/components/common/ErrorBanner';
import { FileDropZone } from '@/components/common/FileDropZone';
import { ImportMidiButton } from './ImportMidiButton';

/**
 * The library face of the shared Practice workspace (doc/UI_OPTIMIZATION_PLAN.md
 * §5.4). Same data and business rules as before — select / Practice / Export /
 * Delete — re-housed so it shares the workspace frame with the score face
 * instead of stacking below it. The list scrolls inside its own region; the
 * Practice-page frame and the keyboard dock never grow with it.
 */

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function downloadMidi(performance: Performance): void {
  const bytes = writeMidiFile(performance);
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${performance.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'piano-shadow'}.mid`;
  anchor.click();
  URL.revokeObjectURL(url);
}

interface SongLibraryProps {
  /** Flip back to the score face. Shown only when a reference is loaded. */
  onReturnToScore?: () => void;
  /** Whether returning to the score face is currently possible. */
  canReturnToScore?: boolean;
  /** True while the workspace flip is in flight — locks the header controls. */
  busy?: boolean;
}

export function SongLibrary({ onReturnToScore, canReturnToScore = false, busy = false }: SongLibraryProps) {
  const savedSongs = useAppStore((s) => s.savedSongs);
  const currentSongId = useAppStore((s) => s.song?.id);
  const loadSavedSong = useAppStore((s) => s.loadSavedSong);
  const loadDemo = useAppStore((s) => s.loadDemo);
  const setMode = useAppStore((s) => s.setMode);
  const deleteSong = useAppStore((s) => s.deleteSong);
  const importMidiFile = useAppStore((s) => s.importMidiFile);
  const isLoadingSong = useAppStore((s) => s.isLoadingSong);
  const importError = useAppStore((s) => s.importError);

  const demos = useMemo(() => getDemoAssets().map(({ id, name }) => ({ id, name })), []);
  const empty = savedSongs.length === 0;

  async function practice(id: string): Promise<void> {
    await loadSavedSong(id);
    setMode('play-along');
  }

  async function importFile(file: File): Promise<void> {
    await importMidiFile(await file.arrayBuffer(), file.name.replace(/\.(mid|midi)$/i, ''));
  }

  async function remove(id: string, name: string): Promise<void> {
    if (!window.confirm(`Delete “${name}”? This cannot be undone.`)) return;
    await deleteSong(id);
  }

  return (
    <section className="song-library" aria-labelledby="song-library-title">
      <div className="workspace-surface__header">
        <div>
          <span className="section-heading__eyebrow">Library</span>
          <h2 id="song-library-title" data-workspace-heading tabIndex={-1}>My MIDI songs</h2>
        </div>
        <div className="song-library__actions">
          <span className="section-heading__count">
            {savedSongs.length} {savedSongs.length === 1 ? 'song' : 'songs'}
          </span>
          {/* Empty state carries its own prominent drop zone below, so only the
              non-empty list needs the compact header import (keeps exactly one
              file input on the page for tests / assistive tech). */}
          {!empty && <ImportMidiButton />}
          {onReturnToScore && canReturnToScore && (
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              aria-label="Back to the score"
              disabled={busy}
              onClick={onReturnToScore}
            >
              ← Back to score
            </button>
          )}
        </div>
      </div>

      {/* Import failure keeps the surface in view and reports here, next to the
          Import control that started it (UI_OPTIMIZATION_PLAN.md §5.1). */}
      {importError && <ErrorBanner message={importError} />}

      {empty ? (
        <div className="library-empty">
          <p>Your recorded and imported MIDI songs will appear here.</p>
          <FileDropZone
            className="import-zone import-zone--compact"
            onFile={(file) => void importFile(file)}
            label="Import MIDI"
            hint="Drop a .mid / .midi file, or click to browse"
          />
          <div className="library-empty__demos">
            <span>Or start with a built-in demo:</span>
            <div className="btn-row">
              {demos.map((demo) => (
                <button
                  key={demo.id}
                  type="button"
                  className="btn btn--sm"
                  disabled={isLoadingSong}
                  onClick={() => void loadDemo(demo.id)}
                >
                  {demo.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="song-list" role="list">
          {savedSongs.map(({ id, performance }) => {
            const current = currentSongId === id;
            return (
              <div className={`song-row${current ? ' song-row--current' : ''}`} key={id} role="listitem">
                <div className="song-row__main">
                  <strong title={performance.name}>{performance.name}</strong>
                  <span>
                    {current && <span className="song-row__badge">Current</span>}
                    {formatDuration(performance.duration)} · {performance.notes.length} notes
                  </span>
                </div>
                <div className="song-row__actions">
                  <button type="button" className="btn btn--primary btn--sm" onClick={() => void practice(id)}>Practice</button>
                  <button type="button" className="btn btn--quiet btn--sm" onClick={() => downloadMidi(performance)}>Export</button>
                  <button type="button" className="btn btn--danger-quiet btn--sm" onClick={() => void remove(id, performance.name)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
