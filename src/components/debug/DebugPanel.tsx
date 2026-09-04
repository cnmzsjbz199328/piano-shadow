import { useMemo } from 'react';
import { midiToNoteName } from '@/music-model';
import { useAppStore } from '@/stores/useAppStore';

/**
 * Developer diagnostic panel (spec §26). Hidden by default; toggled from
 * Settings or the Experiments page. Exists to debug timing problems, so it
 * intentionally shows raw numbers rather than user-facing language.
 */
export function DebugPanel() {
  const song = useAppStore((s) => s.song);
  const currentTime = useAppStore((s) => s.currentTime);
  const transportState = useAppStore((s) => s.transportState);
  const learnerActiveMidi = useAppStore((s) => s.learnerActiveMidi);
  const selectedMidiInputId = useAppStore((s) => s.selectedMidiInputId);
  const midiStatus = useAppStore((s) => s.midiStatus);
  const debug = useAppStore((s) => s.debug);
  const lastResult = useAppStore((s) => s.lastResult);

  const activeReferenceNotes = useMemo(() => {
    if (!song) return [];
    return song.notes.filter((n) => currentTime >= n.startTime && currentTime < n.startTime + n.duration);
  }, [song, currentTime]);

  return (
    <div className="debug-panel" role="complementary" aria-label="Debug panel">
      <strong>Diagnostics</strong>
      <dl>
        <dt>Transport state</dt>
        <dd>{transportState}</dd>
        <dt>Playhead time</dt>
        <dd>{debug.playheadTime.toFixed(3)}s</dd>
        <dt>Active reference notes</dt>
        <dd>{activeReferenceNotes.length ? activeReferenceNotes.map((n) => midiToNoteName(n.midi)).join(', ') : '—'}</dd>
        <dt>Learner active notes</dt>
        <dd>{learnerActiveMidi.length ? learnerActiveMidi.map(midiToNoteName).join(', ') : '—'}</dd>
        <dt>Last MIDI event</dt>
        <dd>{debug.lastMidiEvent ?? '—'}</dd>
        <dt>Selected input device</dt>
        <dd>
          {selectedMidiInputId ?? '(virtual keyboard)'} · {midiStatus}
        </dd>
        <dt>Last matching decisions</dt>
        <dd>
          {debug.lastMatchingDecisions.length === 0
            ? '—'
            : debug.lastMatchingDecisions
                .map((d) => `${midiToNoteName(d.actual.midi)}:${d.result}${d.onsetErrorMs !== undefined ? `(${Math.round(d.onsetErrorMs)}ms)` : ''}`)
                .join(', ')}
        </dd>
        <dt>Last score</dt>
        <dd>{lastResult ? JSON.stringify(lastResult.scores) : '—'}</dd>
      </dl>
    </div>
  );
}
