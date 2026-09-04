import { midiToNoteName } from '@/music-model';
import type { NoteMatchResult } from '@/practice-engine';

/**
 * Full per-note result table (spec §11). All language ("early", "late", "wrong
 * note", …) is decided here in the UI from typed engine data — the practice
 * engine itself never emits display strings (spec §7, §25).
 */
export function NoteResultList({ matches }: { matches: readonly NoteMatchResult[] }) {
  return (
    <div className="panel" style={{ overflowX: 'auto' }}>
      <table className="result-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Expected</th>
            <th>Played</th>
            <th>Timing</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{m.expected ? midiToNoteName(m.expected.midi) : '—'}</td>
              <td>{m.actual ? midiToNoteName(m.actual.midi) : '—'}</td>
              <td>{describeTiming(m)}</td>
              <td>
                <span className={`result-dot result-dot--${m.result}`} />
                {describeResult(m)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function describeTiming(m: NoteMatchResult): string {
  if (m.onsetErrorMs === undefined) return '—';
  const ms = Math.round(m.onsetErrorMs);
  if (m.timingBand === 'perfect') return 'on time';
  const direction = ms > 0 ? 'late' : 'early';
  return `${Math.abs(ms)}ms ${direction}`;
}

function describeResult(m: NoteMatchResult): string {
  switch (m.result) {
    case 'correct':
      return 'Correct';
    case 'wrong-note': {
      const err = m.pitchErrorSemitones ?? 0;
      const sign = err > 0 ? '+' : '';
      return `Wrong note (${sign}${err} semitone${Math.abs(err) === 1 ? '' : 's'})`;
    }
    case 'missed':
      return 'Missed';
    case 'extra':
      return 'Extra note';
  }
}
