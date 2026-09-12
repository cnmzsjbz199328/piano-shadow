import { useCallback, useMemo, useState } from 'react';
import { useAppStore, type PracticeSurface } from '@/stores/useAppStore';
import { currentOnsetGroup, nextOnsetGroup, voiceFilteredNotes } from '@/practice-engine';
import { TransportControls } from '@/components/transport/TransportControls';
import { PianoKeyboard } from '@/components/piano/PianoKeyboard';
import { ScoreSurface } from '@/components/sheet-music/ScoreSurface';
import { PracticeWorkspace } from '@/components/practice/PracticeWorkspace';
import { SongLibrary } from '@/components/practice/SongLibrary';
import { ScoreCard } from '@/components/feedback/ScoreCard';

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
  const practiceVoice = useAppStore((s) => s.practiceVoice);
  const waitingForMidi = useAppStore((s) => s.waitingForMidi);
  const lastInputFeedback = useAppStore((s) => s.lastInputFeedback);
  const pressVirtualKey = useAppStore((s) => s.pressVirtualKey);
  const releaseVirtualKey = useAppStore((s) => s.releaseVirtualKey);
  const practiceSurface = useAppStore((s) => s.practiceSurface);
  const setPracticeSurface = useAppStore((s) => s.setPracticeSurface);
  const isPlaying = transportState === 'playing' || transportState === 'counting-in';

  // The flip is transient; while it runs, the switch controls are locked so a
  // second click can't reverse a turn mid-way (UI_OPTIMIZATION_PLAN.md §5.2).
  const [isFlipping, setIsFlipping] = useState(false);
  const requestSurface = useCallback(
    (next: PracticeSurface) => {
      if (isFlipping) return;
      setPracticeSurface(next);
    },
    [isFlipping, setPracticeSurface],
  );

  const referenceNotes = useMemo(() => (song ? voiceFilteredNotes(song, practiceVoice) : []), [song, practiceVoice]);
  const activeReferenceMidi = useMemo(() => {
    if (!isPlaying) return [];
    return referenceNotes.filter((n) => currentTime >= n.startTime && currentTime < n.startTime + n.duration).map((n) => n.midi);
  }, [referenceNotes, currentTime, isPlaying]);
  const targetMidi = waitingForMidi ?? activeReferenceMidi;
  const focusMidi = recognitionActiveMidi[0] ?? targetMidi[0] ?? learnerActiveMidi[0] ?? 60;

  // Guidance labels (current/next note names on the keys themselves): only on
  // the score face, so flipping to the library face doesn't distract with
  // targets for a song the learner isn't looking at. `PianoKeyboard` reserves
  // the label row's height unconditionally, so this never moves the keyboard.
  const showGuidance = song != null && practiceSurface === 'score';
  const currentTargetMidi = useMemo(() => {
    if (!showGuidance) return [];
    if (waitingForMidi && waitingForMidi.length > 0) return waitingForMidi;
    return currentOnsetGroup(referenceNotes, currentTime).map((n) => n.midi);
  }, [showGuidance, waitingForMidi, referenceNotes, currentTime]);
  const nextTargetMidi = useMemo(() => {
    if (!showGuidance) return [];
    const next = nextOnsetGroup(referenceNotes, currentTime).map((n) => n.midi);
    return next.filter((midi) => !currentTargetMidi.includes(midi));
  }, [showGuidance, referenceNotes, currentTime, currentTargetMidi]);

  return (
    <div className="practice-page">
      <TransportControls
        surface={practiceSurface}
        onSurfaceChange={requestSurface}
        surfaceSwitchDisabled={isFlipping}
      />

      <InlinePracticeResult />

      <PracticeWorkspace
        surface={practiceSurface}
        onFlipStateChange={setIsFlipping}
        score={<ScoreSurface onOpenLibrary={() => requestSurface('library')} />}
        library={
          <SongLibrary
            onReturnToScore={() => requestSurface('score')}
            canReturnToScore={song != null}
            busy={isFlipping}
          />
        }
      />

      <div className="keyboard-dock">
        <PianoKeyboard
          lowMidi={KEYBOARD_LOW_MIDI}
          highMidi={KEYBOARD_HIGH_MIDI}
          focusMidi={focusMidi}
          heldMidi={learnerActiveMidi}
          activeReferenceMidi={song && (isPlaying || waitingForMidi) ? targetMidi : recognitionActiveMidi}
          currentTargetMidi={currentTargetMidi}
          nextTargetMidi={nextTargetMidi}
          inputFeedback={lastInputFeedback ? { midi: lastInputFeedback.actual.midi, result: lastInputFeedback.result } : null}
          onPress={pressVirtualKey}
          onRelease={releaseVirtualKey}
        />
      </div>
    </div>
  );
}
