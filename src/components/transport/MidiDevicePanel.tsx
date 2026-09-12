import { useAppStore } from '@/stores/useAppStore';

/** Web MIDI connection UI (spec §2.2.B): list devices, select one, show status, fail gracefully. */
export function MidiDevicePanel({ compact = false }: { compact?: boolean }) {
  const midiSupported = useAppStore((s) => s.midiSupported);
  const midiStatus = useAppStore((s) => s.midiStatus);
  const midiInputs = useAppStore((s) => s.midiInputs);
  const selectedMidiInputId = useAppStore((s) => s.selectedMidiInputId);
  const midiError = useAppStore((s) => s.midiError);
  const connectMidi = useAppStore((s) => s.connectMidi);
  const selectMidiInput = useAppStore((s) => s.selectMidiInput);

  if (!midiSupported) {
    return (
      <div className={compact ? 'midi-device midi-device--compact' : 'panel'}>
        <span className={compact ? 'header-settings__status' : 'badge badge--neutral'} title="Web MIDI not supported in this browser" aria-label={compact ? 'Web MIDI not supported in this browser' : undefined}>{compact ? 'Web MIDI unavailable' : 'Web MIDI not supported in this browser'}</span>
        {!compact && <p>You can still practice with the virtual keyboard below.</p>}
      </div>
    );
  }

  return (
    <div className={compact ? 'midi-device midi-device--compact' : 'panel'}>
      {!compact && <h3>MIDI device</h3>}
      <div className="btn-row" style={{ marginBottom: '0.6rem' }}>
        <span className={compact ? 'header-settings__status' : `badge badge--dot ${midiStatus === 'connected' ? 'badge--ok' : midiStatus === 'error' ? 'badge--error' : 'badge--neutral'}`} title={midiError ?? undefined} aria-label={compact && midiError ? `MIDI error: ${midiError}` : undefined}>
          {compact && midiError ? midiError : midiStatus}
        </span>
        {midiStatus === 'unsupported' || midiStatus === 'disconnected' || midiStatus === 'error' ? (
          <button type="button" className="btn" onClick={() => void connectMidi()}>
            Connect MIDI
          </button>
        ) : null}
      </div>
      {midiError && <p style={{ color: 'var(--wrong)' }}>{midiError}</p>}
      {midiInputs.length > 0 && (
        <select
          className={compact ? 'select midi-device__select' : 'select'}
          value={selectedMidiInputId ?? ''}
          onChange={(e) => selectMidiInput(e.target.value || null)}
          aria-label="MIDI input device"
        >
          <option value="">None</option>
          {midiInputs.map((input) => (
            <option key={input.id} value={input.id}>
              {input.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
