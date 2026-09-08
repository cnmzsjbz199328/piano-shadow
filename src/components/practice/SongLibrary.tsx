import { useAppStore } from '@/stores/useAppStore';
import { writeMidiFile } from '@/midi';
import type { Performance } from '@/music-model';

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

export function SongLibrary({ compact = false }: { compact?: boolean }) {
  const savedSongs = useAppStore((s) => s.savedSongs);
  const currentSongId = useAppStore((s) => s.song?.id);
  const loadSavedSong = useAppStore((s) => s.loadSavedSong);
  const setMode = useAppStore((s) => s.setMode);
  const deleteSong = useAppStore((s) => s.deleteSong);

  async function practice(id: string): Promise<void> {
    await loadSavedSong(id);
    setMode('play-along');
  }

  async function remove(id: string, name: string): Promise<void> {
    if (!window.confirm(`Delete “${name}”? This cannot be undone.`)) return;
    await deleteSong(id);
  }

  return (
    <section className={`song-library${compact ? ' song-library--compact' : ''}`} aria-labelledby="song-library-title">
      <div className="section-heading">
        <div>
          <span className="section-heading__eyebrow">Library</span>
          <h2 id="song-library-title">My MIDI songs</h2>
        </div>
        <span className="section-heading__count">{savedSongs.length} {savedSongs.length === 1 ? 'song' : 'songs'}</span>
      </div>
      {savedSongs.length === 0 ? (
        <div className="library-empty">Your recorded and imported MIDI songs will appear here.</div>
      ) : (
        <div className="song-list">
          {savedSongs.map(({ id, performance }) => (
            <div className={`song-row${currentSongId === id ? ' song-row--current' : ''}`} key={id}>
              <div className="song-row__main">
                <strong title={performance.name}>{performance.name}</strong>
                <span>{formatDuration(performance.duration)} · {performance.notes.length} notes</span>
              </div>
              <div className="song-row__actions">
                <button type="button" className="btn btn--primary btn--sm" onClick={() => void practice(id)}>Practice</button>
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => downloadMidi(performance)}>Export</button>
                <button type="button" className="btn btn--danger-quiet btn--sm" onClick={() => void remove(id, performance.name)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
