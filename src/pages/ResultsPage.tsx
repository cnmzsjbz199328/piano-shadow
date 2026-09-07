import { Link, useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/useAppStore';
import { ScoreCard } from '@/components/feedback/ScoreCard';
import { NoteResultList } from '@/components/feedback/NoteResultList';
import { PianoRoll } from '@/components/piano-roll/PianoRoll';
import { EmptyState } from '@/components/common/EmptyState';

export function ResultsPage() {
  const navigate = useNavigate();
  const song = useAppStore((s) => s.song);
  const result = useAppStore((s) => s.lastResult);
  const learnerPerformance = useAppStore((s) => s.lastLearnerPerformance);
  const attemptHistory = useAppStore((s) => s.attemptHistory);
  const mode = useAppStore((s) => s.mode);

  if (!song || !result || !learnerPerformance) {
    return (
      <div className="page">
        <EmptyState
          title="No results yet"
          description="Finish a Play Along or Wait Mode attempt to see your score breakdown."
          action={
            <Link to="/practice" className="btn btn--primary">
              Go to practice
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="results-page">
      <div className="results-head">
        <span className="results-head__icon" aria-hidden>
          <NoteIcon />
        </span>
        <div>
          <h1 className="results-head__title">{song.name}</h1>
          <h2 className="results-head__score">
            Score <b>{result.scores.overall}</b>
          </h2>
        </div>
      </div>

      <ScoreCard scores={result.scores} counts={result.counts} />

      <h2>Reference vs. your performance</h2>
      <PianoRoll
        reference={song.notes}
        learner={learnerPerformance.notes}
        matches={result.matches}
        currentTime={-1}
        duration={Math.max(song.duration, learnerPerformance.duration)}
      />

      <NoteResultList matches={result.matches} />

      {attemptHistory.length > 1 && (
        <div className="panel">
          <h2>Attempt history — {song.name}</h2>
          <table className="result-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Mode</th>
                <th>Overall</th>
              </tr>
            </thead>
            <tbody>
              {attemptHistory.map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.createdAt).toLocaleString()}</td>
                  <td>{a.mode}</td>
                  <td>{a.result.scores.overall}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="results-actions">
        <Link to="/practice" className="btn">
          Back home
        </Link>
        <button type="button" className="btn btn--primary" onClick={() => navigate('/practice')}>
          Practice again{mode !== 'listen' ? ` (${mode})` : ''}
        </button>
      </div>
    </div>
  );
}

function NoteIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="7" cy="18" r="2.5" />
      <circle cx="18" cy="16" r="2.5" />
      <path d="M9.5 18V6l11-2v12" />
    </svg>
  );
}
