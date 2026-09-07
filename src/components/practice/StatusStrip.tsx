import { useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { MidiDevicePanel } from '@/components/transport/MidiDevicePanel';
import { LiveFeedback } from '@/components/feedback/LiveFeedback';

/**
 * The single collapsible status bar between the Piano Roll and the keyboard
 * (ROUND_3_REQUIREMENTS §C.2.3). Collapsed by default: a one-line summary of
 * MIDI connection + recent live-feedback. Expanded: the full MIDI device
 * picker and the rolling live-feedback list — the detail that used to sit in
 * the right-hand column.
 */
export function StatusStrip() {
  const [open, setOpen] = useState(false);
  const mode = useAppStore((s) => s.mode);
  const midiStatus = useAppStore((s) => s.midiStatus);
  const midiSupported = useAppStore((s) => s.midiSupported);
  const liveFeedback = useAppStore((s) => s.liveFeedback);

  const midiLabel = midiSupported ? `MIDI ${midiStatus}` : 'MIDI unavailable';
  const midiDotClass =
    midiStatus === 'connected'
      ? 'status-strip__dot--ok'
      : midiStatus === 'error'
        ? 'status-strip__dot--error'
        : '';

  const recent = liveFeedback.slice(0, 5);
  const dots = Array.from({ length: 5 }, (_, i) => recent[i]);

  return (
    <div className="status-strip">
      <button
        type="button"
        className="status-strip__bar"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="status-strip__group">
          <span className={`status-strip__dot ${midiDotClass}`} />
          {midiLabel}
        </span>

        {mode !== 'listen' && (
          <span className="status-strip__group">
            Live feedback
            <span className="fb-dots" aria-hidden>
              {dots.map((item, i) => (
                <span key={i} className={`fb-dot${item ? ` fb-dot--${item.result}` : ''}`} />
              ))}
            </span>
          </span>
        )}

        <span className="status-strip__group status-strip__group--push">
          {open ? 'Hide details' : 'Details'}
          <span className={`status-strip__chevron${open ? ' status-strip__chevron--open' : ''}`} aria-hidden>
            ⌄
          </span>
        </span>
      </button>

      {open && (
        <div className="status-strip__body">
          <MidiDevicePanel />
          {mode !== 'listen' && (
            <div className="panel">
              <h3>Live feedback</h3>
              <LiveFeedback items={liveFeedback} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
