import { useMemo } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { midiToNoteName } from '@/music-model';
import { TransportControls } from '@/components/transport/TransportControls';
import { PianoKeyboard } from '@/components/piano/PianoKeyboard';
import { PracticeEmptyState } from '@/components/practice/PracticeEmptyState';
import { RecognitionControls } from '@/components/practice/RecognitionControls';
import { SongLibrary } from '@/components/practice/SongLibrary';
import { ImportMidiButton } from '@/components/practice/ImportMidiButton';
import { ScoreCard } from '@/components/feedback/ScoreCard';
import { ErrorBanner } from '@/components/common/ErrorBanner';

const KEYBOARD_LOW_MIDI = 21;
const KEYBOARD_HIGH_MIDI = 108;

function InlinePracticeResult() {
  const song = useAppStore((s) => s.song);
  const result = useAppStore((s) => s.lastResult);
  const learner = useAppStore((s) => s.lastLearnerPerformance);
  const clearResult = useAppStore((s) => s.startAttempt);
  if (!song || !result || !learner) return null;
  return (
    <section className="practice-result" aria-labelledby="practice-result-title">
      <div className="section-heading">
        <div><span className="section-heading__eyebrow">Latest practice</span><h2 id="practice-result-title">Score {result.scores.overall}</h2></div>
        <button type="button" className="btn btn--primary btn--sm" onClick={clearResult}>Practice again</button>
      </div>
      <ScoreCard scores={result.scores} counts={result.counts} />
      <p className="practice-result__note">Your result is saved with <strong>{song.name}</strong>. Detailed note feedback is available from the song’s practice history.</p>
    </section>
  );
}

export function PracticePage() {
  const song = useAppStore((s) => s.song);
  const currentTime = useAppStore((s) => s.currentTime);
  const transportState = useAppStore((s) => s.transportState);
  const learnerActiveMidi = useAppStore((s) => s.learnerActiveMidi);
  const recognitionActiveMidi = useAppStore((s) => s.recognitionActiveMidi);
  const pressVirtualKey = useAppStore((s) => s.pressVirtualKey);
  const releaseVirtualKey = useAppStore((s) => s.releaseVirtualKey);
  const isPlaying = transportState === 'playing' || transportState === 'counting-in';
  const importError = useAppStore((s) => s.importError);

  const activeReferenceMidi = useMemo(() => {
    if (!song || !isPlaying) return [];
    return song.notes.filter((n) => currentTime >= n.startTime && currentTime < n.startTime + n.duration).map((n) => n.midi);
  }, [song, currentTime, isPlaying]);
  const focusMidi = recognitionActiveMidi[0] ?? activeReferenceMidi[0] ?? learnerActiveMidi[0] ?? 60;

  return (
    <div className="practice-page">
      <RecognitionControls />
      {song ? (
        <>
          <TransportControls />
          <div className="practice-note-focus" aria-live="polite">
            <span className="section-heading__eyebrow">Current reference note</span>
            <strong>{activeReferenceMidi.length > 0 ? activeReferenceMidi.map(midiToNoteName).join(' · ') : 'Ready'}</strong>
            <span>Keyboard feedback is the primary visual during practice.</span>
          </div>
          <InlinePracticeResult />
        </>
      ) : (
        <PracticeEmptyState />
      )}

      <div className="keyboard-dock">
        <div className="keyboard-dock__meta">
          <span>88-key feedback · showing {midiToNoteName(focusMidi)}</span>
          <span className="keyboard-dock__hint">Mouse / touch, or A S D F… on your computer keyboard</span>
        </div>
        <PianoKeyboard
          lowMidi={KEYBOARD_LOW_MIDI}
          highMidi={KEYBOARD_HIGH_MIDI}
          focusMidi={focusMidi}
          heldMidi={learnerActiveMidi}
          activeReferenceMidi={song && isPlaying ? activeReferenceMidi : recognitionActiveMidi}
          onPress={pressVirtualKey}
          onRelease={releaseVirtualKey}
        />
      </div>

      {song && (
        <>
          {importError && <ErrorBanner message={importError} />}
          <div className="library-toolbar"><h2>My MIDI songs</h2><ImportMidiButton /></div>
          <SongLibrary compact />
        </>
      )}
    </div>
  );
}
