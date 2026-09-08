import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/useAppStore';
import { FileDropZone } from '@/components/common/FileDropZone';
import { ErrorBanner } from '@/components/common/ErrorBanner';
import { SongLibrary } from './SongLibrary';

/** The lower half of the single-page workspace when no reference is loaded. */
export function PracticeEmptyState() {
  const navigate = useNavigate();
  const importMidiFile = useAppStore((s) => s.importMidiFile);
  const importError = useAppStore((s) => s.importError);
  const isLoadingSong = useAppStore((s) => s.isLoadingSong);

  async function handleFile(file: File): Promise<void> {
    const bytes = await file.arrayBuffer();
    await importMidiFile(bytes, file.name.replace(/\.(mid|midi)$/i, ''));
    if (useAppStore.getState().song) navigate('/practice');
  }

  return (
    <div className="practice-empty">
      {importError && <ErrorBanner message={importError} />}
      <div className="import-row">
        <FileDropZone
          className="import-zone import-zone--compact"
          onFile={(file) => void handleFile(file)}
          icon={<FileMusicIcon />}
          label="Import MIDI"
          hint="Add a reference performance to your library"
        />
      </div>
      {isLoadingSong && <p className="u-center">Loading…</p>}
      <SongLibrary />
    </div>
  );
}

function FileMusicIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <circle cx="10" cy="16" r="1.6" /><path d="M11.6 16V11l3 .9V15" /><circle cx="13.4" cy="15" r="1.6" />
    </svg>
  );
}
