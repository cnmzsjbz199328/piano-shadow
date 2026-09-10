import { useCallback, useMemo, useState } from 'react';
import { useAppStore, type PracticeSurface } from '@/stores/useAppStore';
import { midiToNoteName } from '@/music-model';
import { TransportControls } from '@/components/transport/TransportControls';
import { PianoKeyboard } from '@/components/piano/PianoKeyboard';
import { FallingNotes } from '@/components/piano-roll/FallingNotes';
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
  const isAttemptRunning = useAppStore((s) => s.isAttemptRunning);
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

  const activeReferenceMidi = useMemo(() => {
    if (!song || !isPlaying) return [];
    return song.notes.filter((n) => currentTime >= n.startTime && currentTime < n.startTime + n.duration).map((n) => n.midi);
  }, [song, currentTime, isPlaying]);
  const focusMidi = recognitionActiveMidi[0] ?? activeReferenceMidi[0] ?? learnerActiveMidi[0] ?? 60;
  const referenceLabel = activeReferenceMidi.length > 0 ? activeReferenceMidi.map(midiToNoteName).join(' · ') : 'Ready';

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

      {(isPlaying || isAttemptRunning) && <FallingNotes />}

      <div className="keyboard-dock">
        <div className="keyboard-dock__meta">
          <span>88-key feedback · reference {referenceLabel} · focus {midiToNoteName(focusMidi)}</span>
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
    </div>
  );
}
