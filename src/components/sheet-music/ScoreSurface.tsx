import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { ScoreView } from './ScoreView';

/**
 * The score face of the shared Practice workspace (doc/UI_OPTIMIZATION_PLAN.md
 * §5.3). It gives `ScoreView` a stable frame:
 *
 *   - a light toolbar (song name + notation status), and
 *   - an independent `overflow-y: auto` viewport, so a long piece scrolls its
 *     own staves — never the Practice page frame, never the keyboard dock.
 *
 * The viewport element is never unmounted while the app runs, so its scroll
 * position survives a flip to the Library face and back for free (§5.3). A new
 * song resets it to the top (§5.1).
 */
interface ScoreSurfaceProps {
  /** Flip to the Library face — used by the empty state's call to action. */
  onOpenLibrary: () => void;
}

export function ScoreSurface({ onOpenLibrary }: ScoreSurfaceProps) {
  const song = useAppStore((s) => s.song);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
  }, [song?.id]);

  const status = !song
    ? 'Nothing loaded'
    : song.sourceType === 'midi-file'
      ? 'Imported MIDI'
      : 'Recorded take — notation unavailable';

  return (
    <section className="score-surface" aria-labelledby="score-surface-title">
      <div className="workspace-surface__header score-surface__toolbar">
        <div>
          <span className="section-heading__eyebrow">Score</span>
          <h2
            className="workspace-surface__title"
            id="score-surface-title"
            data-workspace-heading
            tabIndex={-1}
          >
            {song ? song.name : 'Score'}
          </h2>
        </div>
        <span className="workspace-surface__status">{status}</span>
      </div>

      <div
        className="score-surface__viewport"
        ref={viewportRef}
        tabIndex={0}
        role="region"
        aria-label="五线谱 · Sheet music"
      >
        {song ? (
          <ScoreView />
        ) : (
          <div className="score-surface__empty">
            <p>No reference is loaded yet.</p>
            <button type="button" className="btn btn--primary btn--sm" onClick={onOpenLibrary}>
              Open the song library
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
