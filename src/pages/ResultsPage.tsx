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
      <EmptyState
        title="No results yet"
        description="Finish a Play Along or Wait Mode attempt to see your score breakdown."
        action={
          <Link to="/practice" className="btn btn--primary">
            Go to practice
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <header className="page-header">
        <div className="page-header__eyebrow">Results — {song.name}</div>
        <h1>Score {result.scores.overall}</h1>
      </header>

      <ScoreCard scores={result.scores} counts={result.counts} />

      <div className="panel">
        <h2>Reference vs. your performance</h2>
        <PianoRoll
          reference={song.notes}
          learner={learnerPerformance.notes}
          matches={result.matches}
          currentTime={-1}
          duration={Math.max(song.duration, learnerPerformance.duration)}
        />
      </div>

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

      <div className="btn-row" style={{ marginTop: '1rem' }}>
        <button type="button" className="btn btn--primary" onClick={() => navigate('/practice')}>
          Practice again{mode !== 'listen' ? ` (${mode})` : ''}
        </button>
        <Link to="/" className="btn">
          Back home
        </Link>
      </div>
    </div>
  );
}
