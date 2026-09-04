import type { MatchCounts, ScoreBreakdown } from '@/practice-engine';

/** Category scores + counts (spec §11). The UI's only job is to lay these numbers out. */
export function ScoreCard({ scores, counts }: { scores: ScoreBreakdown; counts: MatchCounts }) {
  return (
    <div className="panel">
      <div className="score-grid">
        <div className="score-tile score-tile--overall">
          <div className="score-tile__value">{scores.overall}</div>
          <div className="score-tile__label">Overall</div>
        </div>
        <ScoreTile label="Pitch" value={scores.pitch} />
        <ScoreTile label="Timing" value={scores.timing} />
        <ScoreTile label="Rhythm" value={scores.rhythm} />
        <ScoreTile label="Duration" value={scores.duration} />
        <ScoreTile label="Completeness" value={scores.completeness} />
      </div>
      <div className="count-row">
        <span>✓ {counts.correct} correct</span>
        <span>✗ {counts.wrongNote} wrong note</span>
        <span>… {counts.missed} missed</span>
        <span>+ {counts.extra} extra</span>
      </div>
    </div>
  );
}

function ScoreTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="score-tile">
      <div className="score-tile__value">{value}</div>
      <div className="score-tile__label">{label}</div>
    </div>
  );
}
