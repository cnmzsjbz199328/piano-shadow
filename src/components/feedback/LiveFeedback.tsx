import { midiToNoteName } from '@/music-model';
import type { LiveFeedbackItem } from '@/practice-engine';

/** Rolling "what just happened" list during Play Along / Wait Mode (spec §9.2, §10). */
export function LiveFeedback({ items }: { items: readonly LiveFeedbackItem[] }) {
  if (items.length === 0) {
    return <p style={{ margin: 0 }}>Play along — recent notes will appear here.</p>;
  }
  return (
    <ul className="live-feedback" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {items.map((item, i) => (
        <li key={i} className="live-feedback__item">
          <span>
            <span className={`result-dot result-dot--${item.result}`} />
            {midiToNoteName(item.actual.midi)}
            {item.expected && item.expected.midi !== item.actual.midi ? ` (expected ${midiToNoteName(item.expected.midi)})` : ''}
          </span>
          <span style={{ color: 'var(--text-faint)' }}>
            {item.onsetErrorMs !== undefined
              ? `${item.onsetErrorMs > 0 ? '+' : ''}${Math.round(item.onsetErrorMs)}ms`
              : item.result}
          </span>
        </li>
      ))}
    </ul>
  );
}
