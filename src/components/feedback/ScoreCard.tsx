import type { MatchCounts, ScoreBreakdown } from '@/practice-engine';

/**
 * Category scores + a per-category legend (spec §11, ROUND_3_REQUIREMENTS
 * §C.2.6). The UI's only job is to lay these numbers out — six dimension tiles
 * in one row (Overall first) with a mini progress bar each, then the four
 * result categories with their counts.
 */
export function ScoreCard({ scores, counts }: { scores: ScoreBreakdown; counts: MatchCounts }) {
  return (
    <>
      <div className="score-row">
        <ScoreCell label="Overall" value={scores.overall} overall />
        <ScoreCell label="Pitch" value={scores.pitch} />
        <ScoreCell label="Timing" value={scores.timing} />
        <ScoreCell label="Rhythm" value={scores.rhythm} />
        <ScoreCell label="Duration" value={scores.duration} />
        <ScoreCell label="Completeness" value={scores.completeness} />
      </div>

      <div className="legend count-row">
        <LegendRow kind="correct" name="Correct" desc="Notes you played correctly." count={counts.correct} />
        <LegendRow kind="missed" name="Missed" desc="Notes from the reference that you missed." count={counts.missed} />
        <LegendRow
          kind="wrong-note"
          name="Wrong note"
          desc="Notes you played that were incorrect."
          count={counts.wrongNote}
        />
        <LegendRow kind="extra" name="Extra" desc="Notes you played that are not in the reference." count={counts.extra} />
      </div>
    </>
  );
}

function bandClass(value: number): string {
  if (value >= 85) return 'score-cell__bar-fill--good';
  if (value >= 60) return 'score-cell__bar-fill--mid';
  return 'score-cell__bar-fill--low';
}

function ScoreCell({ label, value, overall = false }: { label: string; value: number; overall?: boolean }) {
  return (
    <div className={`score-cell${overall ? ' score-cell--overall' : ''}`}>
      <div className="score-cell__label score-tile__label">{label}</div>
      <div className="score-cell__value">{value}</div>
      <div className="score-cell__bar">
        <span
          className={`score-cell__bar-fill${overall ? '' : ` ${bandClass(value)}`}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

function LegendRow({
  kind,
  name,
  desc,
  count,
}: {
  kind: 'correct' | 'wrong-note' | 'missed' | 'extra';
  name: string;
  desc: string;
  count: number;
}) {
  return (
    <div className="legend__row">
      <span className={`result-dot result-dot--${kind}`} />
      <span className="legend__name">{name}</span>
      <span className="legend__desc">{desc}</span>
      <span className="legend__count">{count}</span>
    </div>
  );
}
