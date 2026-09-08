import { useNavigate } from 'react-router-dom';
import { getDemoAssets } from '@/midi';
import { useAppStore } from '@/stores/useAppStore';
import { FileDropZone } from '@/components/common/FileDropZone';
import { ErrorBanner } from '@/components/common/ErrorBanner';

/**
 * The Practice page's empty state (ROUND_3_REQUIREMENTS §C.2.2 / §C.2.6): the
 * former standalone Home, folded in. One prominent import action; demos and
 * recent practice are secondary. `/` and `/practice` both render this until a
 * song is loaded.
 */
export function PracticeEmptyState() {
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
    if (useAppStore.getState().song) navigate('/practice');
  }

  return (
    <div className="page">
      <div className="hero">
        <div className="hero__eyebrow">Piano Shadow</div>
        <h1 className="hero__title">Practice with precision.</h1>
        <p className="hero__sub">Import your MIDI, practice deliberately, and see exactly what improves.</p>
      </div>

      {importError && <ErrorBanner message={importError} />}

      <FileDropZone
        className="import-zone"
        onFile={(f) => void handleFile(f)}
        icon={<FileMusicIcon />}
        label="Import a MIDI file"
        hint="Drop it here, or click to choose a file"
      />
      {isLoadingSong && <p className="u-center">Loading…</p>}

      <div className="secondary-block">
        <div className="secondary-block__label">Try a demo</div>
        <div className="chip-row">
          {getDemoAssets().map((asset) => (
            <button key={asset.id} type="button" className="chip" onClick={() => void handleDemo(asset.id)}>
              <NoteIcon />
              <span className="chip__grow">{asset.name}</span>
              <span className="chip__chevron" aria-hidden>
                ›
              </span>
            </button>
          ))}
        </div>
      </div>

      {savedSongs.length > 0 && (
        <div className="secondary-block">
          <div className="secondary-block__label">Recent practice</div>
          <div className="recent-list">
            {savedSongs.map((s) => (
              <button key={s.id} type="button" className="recent-row" onClick={() => void handleSaved(s.id)}>
                <NoteIcon />
                <span className="chip__grow">{s.performance.name}</span>
                <span className="recent-row__meta">
                  {s.isDemo ? 'demo · ' : ''}
                  {s.performance.notes.length} notes
                </span>
                <span className="chip__chevron" aria-hidden>
                  ›
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FileMusicIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <circle cx="10" cy="16" r="1.6" />
      <path d="M11.6 16V11l3 .9V15" />
      <circle cx="13.4" cy="15" r="1.6" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg className="chip__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="7" cy="18" r="2.5" />
      <circle cx="18" cy="16" r="2.5" />
      <path d="M9.5 18V6l11-2v12" />
    </svg>
  );
}
