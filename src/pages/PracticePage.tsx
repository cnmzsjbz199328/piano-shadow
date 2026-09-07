import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/useAppStore';
import { midiToNoteName } from '@/music-model';
import { TransportControls } from '@/components/transport/TransportControls';
import { PianoRoll } from '@/components/piano-roll/PianoRoll';
import { PianoKeyboard } from '@/components/piano/PianoKeyboard';
import { StatusStrip } from '@/components/practice/StatusStrip';
import { PracticeEmptyState } from '@/components/practice/PracticeEmptyState';

const KEYBOARD_LOW_MIDI = 21;
const KEYBOARD_HIGH_MIDI = 108;

export function PracticePage() {
  const navigate = useNavigate();
  const song = useAppStore((s) => s.song);
  const currentTime = useAppStore((s) => s.currentTime);
  const duration = useAppStore((s) => s.duration);
  const mode = useAppStore((s) => s.mode);
  const transportState = useAppStore((s) => s.transportState);
  const learnerActiveMidi = useAppStore((s) => s.learnerActiveMidi);
  const lastResult = useAppStore((s) => s.lastResult);
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

  // The octave the keyboard should scroll into view: the sounding reference
  // note, else a held learner note, else middle C.
  const focusMidi = activeReferenceMidi[0] ?? learnerActiveMidi[0] ?? 60;

  if (!song) {
    return <PracticeEmptyState />;
  }

  return (
    <div className="practice-page">
      <TransportControls />

      <div className="practice-body">
        <PianoRoll reference={song.notes} currentTime={currentTime} duration={duration} />
      </div>

      <StatusStrip />

      <div className="keyboard-dock">
        <div className="keyboard-dock__meta">
          <span>Keys A0–C8 · showing {midiToNoteName(focusMidi)}</span>
          <span className="keyboard-dock__hint">
            Mouse / touch, or your computer keyboard (A S D F… = white keys, Z / X shift octave)
          </span>
        </div>
        <PianoKeyboard
          lowMidi={KEYBOARD_LOW_MIDI}
          highMidi={KEYBOARD_HIGH_MIDI}
          focusMidi={focusMidi}
          heldMidi={learnerActiveMidi}
          activeReferenceMidi={mode === 'listen' ? activeReferenceMidi : []}
          onPress={pressVirtualKey}
          onRelease={releaseVirtualKey}
        />
      </div>
    </div>
  );
}
