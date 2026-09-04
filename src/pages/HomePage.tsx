import { useNavigate } from 'react-router-dom';
import { getDemoAssets } from '@/midi';
import { useAppStore } from '@/stores/useAppStore';
import { FileDropZone } from '@/components/common/FileDropZone';
import { ErrorBanner } from '@/components/common/ErrorBanner';

export function HomePage() {
  const navigate = useNavigate();
  const importMidiFile = useAppStore((s) => s.importMidiFile);
  const loadDemo = useAppStore((s) => s.loadDemo);
  const loadSavedSong = useAppStore((s) => s.loadSavedSong);
  const savedSongs = useAppStore((s) => s.savedSongs);
  const importError = useAppStore((s) => s.importError);
  const isLoadingSong = useAppStore((s) => s.isLoadingSong);

  async function handleFile(file: File) {
    const bytes = await file.arrayBuffer();
    await importMidiFile(bytes, file.name.replace(/\.(mid|midi)$/i, ''));
    if (useAppStore.getState().song) navigate('/practice');
  }

  async function handleDemo(id: string) {
    await loadDemo(id);
    if (useAppStore.getState().song) navigate('/practice');
  }

  async function handleSaved(id: string) {
    await loadSavedSong(id);
    navigate('/practice');
  }

  return (
    <div>
      <header className="page-header">
        <div className="page-header__eyebrow">Piano Shadow</div>
        <h1>Turn a performance into a practice template</h1>
        <p>Import a reference MIDI file, follow it on the keyboard, and get precise feedback on every note.</p>
      </header>

      {importError && <ErrorBanner message={importError} />}

      <div className="panel">
        <h2>Import a reference</h2>
        <FileDropZone onFile={(f) => void handleFile(f)} />
        {isLoadingSong && <p>Loading…</p>}
      </div>

      <div className="panel">
        <h2>Built-in demos</h2>
        <p>No MIDI file handy? Start with one of these.</p>
        <div className="song-grid">
          {getDemoAssets().map((asset) => (
            <button key={asset.id} type="button" className="song-card" onClick={() => void handleDemo(asset.id)}>
              <div className="song-card__name">{asset.name}</div>
              <div className="song-card__meta">{asset.description}</div>
            </button>
          ))}
        </div>
      </div>

      {savedSongs.length > 0 && (
        <div className="panel">
          <h2>Recently imported</h2>
          <div className="song-grid">
            {savedSongs.map((s) => (
              <button key={s.id} type="button" className="song-card" onClick={() => void handleSaved(s.id)}>
                <div className="song-card__name">{s.performance.name}</div>
                <div className="song-card__meta">
                  {s.performance.notes.length} notes · {s.performance.duration.toFixed(1)}s
                  {s.isDemo ? ' · demo' : ''}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
