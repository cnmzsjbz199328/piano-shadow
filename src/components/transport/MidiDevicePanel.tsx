import { useAppStore } from '@/stores/useAppStore';

/** Web MIDI connection UI (spec §2.2.B): list devices, select one, show status, fail gracefully. */
export function MidiDevicePanel() {
  const midiSupported = useAppStore((s) => s.midiSupported);
  const midiStatus = useAppStore((s) => s.midiStatus);
  const midiInputs = useAppStore((s) => s.midiInputs);
  const selectedMidiInputId = useAppStore((s) => s.selectedMidiInputId);
  const midiError = useAppStore((s) => s.midiError);
  const connectMidi = useAppStore((s) => s.connectMidi);
  const selectMidiInput = useAppStore((s) => s.selectMidiInput);

  if (!midiSupported) {
    return (
      <div className="panel">
        <h3>MIDI device</h3>
        <span className="badge badge--neutral">Web MIDI not supported in this browser</span>
        <p>You can still practice with the virtual keyboard below.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>MIDI device</h3>
      <div className="btn-row" style={{ marginBottom: '0.6rem' }}>
        <span className={`badge badge--dot ${midiStatus === 'connected' ? 'badge--ok' : midiStatus === 'error' ? 'badge--error' : 'badge--neutral'}`}>
          {midiStatus}
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
          className="select"
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
