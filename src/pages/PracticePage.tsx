import { useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/useAppStore';
import { TransportControls } from '@/components/transport/TransportControls';
import { MidiDevicePanel } from '@/components/transport/MidiDevicePanel';
import { PianoRoll } from '@/components/piano-roll/PianoRoll';
import { PianoKeyboard } from '@/components/piano/PianoKeyboard';
import { LiveFeedback } from '@/components/feedback/LiveFeedback';
import { EmptyState } from '@/components/common/EmptyState';

export function PracticePage() {
  const navigate = useNavigate();
  const song = useAppStore((s) => s.song);
  const currentTime = useAppStore((s) => s.currentTime);
  const duration = useAppStore((s) => s.duration);
  const mode = useAppStore((s) => s.mode);
  const transportState = useAppStore((s) => s.transportState);
  const learnerActiveMidi = useAppStore((s) => s.learnerActiveMidi);
  const liveFeedback = useAppStore((s) => s.liveFeedback);
  const lastResult = useAppStore((s) => s.lastResult);
  const showDebugPanel = useAppStore((s) => s.showDebugPanel);
  const setShowDebugPanel = useAppStore((s) => s.setShowDebugPanel);
  const pressVirtualKey = useAppStore((s) => s.pressVirtualKey);
  const releaseVirtualKey = useAppStore((s) => s.releaseVirtualKey);

  const prevResult = useRef(lastResult);
  useEffect(() => {
    if (lastResult && lastResult !== prevResult.current) navigate('/results');
    prevResult.current = lastResult;
  }, [lastResult, navigate]);

  const isPlaying = transportState === 'playing' || transportState === 'counting-in';
  const activeReferenceMidi = useMemo(() => {
    if (!song || !isPlaying) return [];
    return song.notes
      .filter((n) => currentTime >= n.startTime && currentTime < n.startTime + n.duration)
      .map((n) => n.midi);
  }, [song, currentTime, isPlaying]);

  if (!song) {
    return (
      <EmptyState
        title="No song loaded"
        description="Import a MIDI file or pick a demo to start practicing."
        action={
          <Link to="/" className="btn btn--primary">
            Choose a song
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <header className="page-header">
        <div className="page-header__eyebrow">Practice</div>
        <h1>{song.name}</h1>
      </header>

      <div className="practice-layout">
        <div className="practice-main">
          <TransportControls />
          <PianoRoll reference={song.notes} currentTime={currentTime} duration={duration} />
          <div className="panel">
            <PianoKeyboard
              heldMidi={learnerActiveMidi}
              activeReferenceMidi={mode === 'listen' ? activeReferenceMidi : []}
              onPress={pressVirtualKey}
              onRelease={releaseVirtualKey}
            />
            <p style={{ marginTop: '0.6rem', fontSize: '0.8rem' }}>
              Play with your mouse/touch, or your computer keyboard (A S D F… row = white keys, Z/X shift octave).
            </p>
          </div>
        </div>
        <div className="practice-side">
          {mode !== 'listen' && (
            <div className="panel">
              <h3>Live feedback</h3>
              <LiveFeedback items={liveFeedback} />
            </div>
          )}
          <MidiDevicePanel />
          <div className="panel">
            <label className="toggle">
              <input type="checkbox" checked={showDebugPanel} onChange={(e) => setShowDebugPanel(e.target.checked)} />
              Show debug panel
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
