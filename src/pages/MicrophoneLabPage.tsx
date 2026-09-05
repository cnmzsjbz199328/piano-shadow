import { useEffect, useRef, useState } from 'react';
import { getDemoAssets } from '@/midi';
import { midiToNoteName, type Performance } from '@/music-model';
import { evaluatePerformance, type EvaluationResult } from '@/practice-engine';
import { WebMidiAdapter, PerformanceRecorder, type MidiInputInfo } from '@/device-adapters';
import {
  MicrophoneCapture,
  MicrophoneCaptureError,
  PitchyRecognizer,
  BasicPitchRecognizer,
  detectedNotesToNoteEvents,
  detectOnsetTime,
  benchmarkRecognizer,
  type CaptureStatus,
  type DetectedNote,
  type NoteRecognizer,
  type RecognizerBenchmarkResult,
} from '@/recognition';
import { ScoreCard } from '@/components/feedback/ScoreCard';

/**
 * Microphone Lab (spec §15/§36, doc/NEXT_ROUND_REQUIREMENTS.md Phase B). An
 * isolated, experimental page: benchmarks candidate pitch recognizers against
 * MIDI ground truth. Nothing here is wired into `NoteInputAdapter`/`PracticePage`
 * — a real `MicrophoneAdapter` is a decision for a future round, made only after
 * the numbers on this page (and in doc/MICROPHONE_LAB_FINDINGS.md) are in.
 *
 * Every recognizer output shown here is labeled experimental with its actual
 * measured confidence/latency next to it — never a bare "it works" claim
 * (spec §25).
 */

interface RunResult {
  notes: DetectedNote[];
  processingMs: number;
  onsetLatencyMs: number | null;
}

function useAnimatedLevel(capturing: boolean, levelRef: React.MutableRefObject<number>): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!capturing) {
      setLevel(0);
      return;
    }
    let raf = 0;
    const tick = () => {
      setLevel(levelRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [capturing, levelRef]);
  return level;
}

function LevelMeter({ level }: { level: number }) {
  // RMS of a full-scale sine is ~0.7; scale so normal speech/piano levels read mid-bar.
  const pct = Math.min(100, Math.round(level * 260));
  return (
    <div className="level-meter" role="meter" aria-label="Microphone level" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="level-meter__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="confidence-bar" aria-label={`Confidence ${pct}%`}>
      <div className="confidence-bar__fill" style={{ width: `${pct}%` }} />
      <span className="confidence-bar__label">{pct}%</span>
    </div>
  );
}

function DetectedNotesTable({ result }: { result: RunResult | null }) {
  if (!result) return <p>No run yet.</p>;
  if (result.notes.length === 0) return <p>No notes detected in the captured audio.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="result-table">
        <thead>
          <tr>
            <th>Note</th>
            <th>Onset</th>
            <th>Duration</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {result.notes.map((n, i) => (
            <tr key={i}>
              <td>{midiToNoteName(n.midi)}</td>
              <td>{n.startTime.toFixed(2)}s</td>
              <td>{n.duration.toFixed(2)}s</td>
              <td>
                <ConfidenceBar value={n.confidence} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LatencyReadout({ result }: { result: RunResult | null }) {
  if (!result) return null;
  return (
    <p className="lab-latency">
      Processing: <strong>{result.processingMs.toFixed(1)}ms</strong>
      {result.onsetLatencyMs !== null && (
        <>
          {' '}· Onset latency: <strong>{result.onsetLatencyMs.toFixed(1)}ms</strong>
        </>
      )}
    </p>
  );
}

export function MicrophoneLabPage() {
  // --- free capture (section 2/3: run a recognizer on whatever was captured) ---
  const freeMicRef = useRef<MicrophoneCapture | null>(null);
  const freeLevelRef = useRef(0);
  const [freeCaptureStatus, setFreeCaptureStatus] = useState<CaptureStatus>('idle');
  const [freeCaptureError, setFreeCaptureError] = useState<string | null>(null);
  const freeLevel = useAnimatedLevel(freeCaptureStatus === 'capturing', freeLevelRef);

  const pitchyRef = useRef<PitchyRecognizer | null>(null);
  const basicPitchRef = useRef<BasicPitchRecognizer | null>(null);
  const [pitchyResult, setPitchyResult] = useState<RunResult | null>(null);
  const [basicPitchResult, setBasicPitchResult] = useState<RunResult | null>(null);
  const [basicPitchLoading, setBasicPitchLoading] = useState(false);
  const [basicPitchError, setBasicPitchError] = useState<string | null>(null);

  async function ensurePitchy(): Promise<PitchyRecognizer> {
    if (!pitchyRef.current) {
      const r = new PitchyRecognizer();
      await r.initialize();
      pitchyRef.current = r;
    }
    return pitchyRef.current;
  }

  async function ensureBasicPitch(): Promise<BasicPitchRecognizer> {
    if (!basicPitchRef.current) {
      setBasicPitchLoading(true);
      setBasicPitchError(null);
      try {
        const r = new BasicPitchRecognizer();
        await r.initialize();
        basicPitchRef.current = r;
      } catch (err) {
        setBasicPitchError(err instanceof Error ? err.message : 'Could not load the Basic Pitch model.');
        throw err;
      } finally {
        setBasicPitchLoading(false);
      }
    }
    return basicPitchRef.current;
  }

  async function runRecognizer(
    recognizer: NoteRecognizer,
    audio: Float32Array,
    sampleRate: number,
  ): Promise<RunResult> {
    const trueOnset = detectOnsetTime(audio, sampleRate);
    const start = performance.now();
    const notes = await recognizer.process(audio, sampleRate);
    const processingMs = performance.now() - start;
    const onsetLatencyMs = trueOnset !== null && notes[0] ? (notes[0].startTime - trueOnset) * 1000 : null;
    return { notes, processingMs, onsetLatencyMs };
  }

  async function startFreeCapture() {
    setFreeCaptureError(null);
    setPitchyResult(null);
    setBasicPitchResult(null);
    const mic = new MicrophoneCapture({
      onLevel: (rms) => (freeLevelRef.current = rms),
      onStatusChange: (status, error) => {
        setFreeCaptureStatus(status);
        if (error) setFreeCaptureError(error.message);
      },
    });
    freeMicRef.current = mic;
    try {
      await mic.start();
    } catch (err) {
      setFreeCaptureError(err instanceof MicrophoneCaptureError ? err.message : 'Could not start microphone capture.');
    }
  }

  async function stopFreeCapture() {
    await freeMicRef.current?.stop();
  }

  async function runPitchyOnFreeCapture() {
    const mic = freeMicRef.current;
    if (!mic) return;
    const { audio, sampleRate } = mic.getBuffer();
    const recognizer = await ensurePitchy();
    setPitchyResult(await runRecognizer(recognizer, audio, sampleRate));
  }

  async function runBasicPitchOnFreeCapture() {
    const mic = freeMicRef.current;
    if (!mic) return;
    const { audio, sampleRate } = mic.getBuffer();
    try {
      const recognizer = await ensureBasicPitch();
      setBasicPitchResult(await runRecognizer(recognizer, audio, sampleRate));
    } catch {
      // ensureBasicPitch already recorded basicPitchError
    }
  }

  // --- synthetic benchmark (section: no microphone needed) ---
  const [benchmarkResults, setBenchmarkResults] = useState<RecognizerBenchmarkResult[] | null>(null);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);

  async function runSyntheticBenchmark() {
    setBenchmarkRunning(true);
    setBenchmarkError(null);
    try {
      const results: RecognizerBenchmarkResult[] = [];
      results.push(await benchmarkRecognizer('Pitchy (baseline)', new PitchyRecognizer()));
      try {
        results.push(await benchmarkRecognizer('Basic Pitch', new BasicPitchRecognizer()));
      } catch (err) {
        setBenchmarkError(err instanceof Error ? `Basic Pitch benchmark failed: ${err.message}` : 'Basic Pitch benchmark failed.');
      }
      setBenchmarkResults(results);
    } finally {
      setBenchmarkRunning(false);
    }
  }

  // --- MIDI ground-truth comparison (section 4) ---
  const demos = getDemoAssets();
  const [demoId, setDemoId] = useState(demos[0]?.id ?? '');
  const midiAdapterRef = useRef<WebMidiAdapter | null>(null);
  const captureStartMsRef = useRef(0);
  if (!midiAdapterRef.current) {
    midiAdapterRef.current = new WebMidiAdapter(() => (performance.now() - captureStartMsRef.current) / 1000);
  }
  const [midiStatus, setMidiStatus] = useState(midiAdapterRef.current.status);
  const [midiInputs, setMidiInputs] = useState<MidiInputInfo[]>([]);
  const [selectedMidiInputId, setSelectedMidiInputId] = useState<string | null>(null);
  const [midiError, setMidiError] = useState<string | null>(null);

  useEffect(() => {
    const adapter = midiAdapterRef.current!;
    return adapter.onStatusChange(setMidiStatus);
  }, []);

  async function connectMidi() {
    setMidiError(null);
    try {
      await midiAdapterRef.current!.connect();
      setMidiInputs(midiAdapterRef.current!.listInputs());
    } catch (err) {
      setMidiError(err instanceof Error ? err.message : 'Could not access MIDI devices.');
    }
  }

  function selectMidiInput(id: string) {
    midiAdapterRef.current!.selectInput(id || null);
    setSelectedMidiInputId(id || null);
  }

  const gtMicRef = useRef<MicrophoneCapture | null>(null);
  const gtLevelRef = useRef(0);
  const gtRecorderRef = useRef<PerformanceRecorder | null>(null);
  const [gtCapturing, setGtCapturing] = useState(false);
  const [gtError, setGtError] = useState<string | null>(null);
  const gtLevel = useAnimatedLevel(gtCapturing, gtLevelRef);

  const [gtGroundTruth, setGtGroundTruth] = useState<Performance | null>(null);
  const [gtAudio, setGtAudio] = useState<{ audio: Float32Array; sampleRate: number } | null>(null);
  const [gtResultPitchy, setGtResultPitchy] = useState<EvaluationResult | null>(null);
  const [gtResultBasicPitch, setGtResultBasicPitch] = useState<EvaluationResult | null>(null);
  const [gtComparingBasicPitch, setGtComparingBasicPitch] = useState(false);

  async function startGroundTruthCapture() {
    setGtError(null);
    setGtGroundTruth(null);
    setGtAudio(null);
    setGtResultPitchy(null);
    setGtResultBasicPitch(null);

    const mic = new MicrophoneCapture({
      onLevel: (rms) => (gtLevelRef.current = rms),
      onStatusChange: (status, error) => {
        if (status === 'error' && error) setGtError(error.message);
      },
    });
    gtMicRef.current = mic;
    try {
      await mic.start();
    } catch (err) {
      setGtError(err instanceof MicrophoneCaptureError ? err.message : 'Could not start microphone capture.');
      return;
    }

    // Zero the MIDI recorder's clock right as mic capture becomes active, so the
    // two note sets share an approximately common t=0. A few hundred ms of
    // residual setup-latency offset can still show up as Timing-dimension error --
    // Pitch/Completeness are the reliable dimensions from this comparison.
    captureStartMsRef.current = performance.now();
    const recorder = new PerformanceRecorder('midi-device');
    recorder.attach(midiAdapterRef.current!);
    recorder.start();
    gtRecorderRef.current = recorder;
    setGtCapturing(true);
  }

  async function stopGroundTruthCaptureAndCompare() {
    const recorder = gtRecorderRef.current;
    const mic = gtMicRef.current;
    if (!recorder || !mic) return;

    const stopTime = (performance.now() - captureStartMsRef.current) / 1000;
    const demoName = demos.find((d) => d.id === demoId)?.name ?? 'Ground truth';
    const groundTruth = recorder.stop(stopTime, `${demoName} (Microphone Lab ground truth)`);
    recorder.dispose();
    gtRecorderRef.current = null;

    const buffer = mic.getBuffer();
    await mic.stop();
    setGtCapturing(false);

    setGtGroundTruth(groundTruth);
    setGtAudio(buffer);

    const pitchy = await ensurePitchy();
    const detected = await pitchy.process(buffer.audio, buffer.sampleRate);
    const learnerNotes = detectedNotesToNoteEvents(detected, 'microphone');
    setGtResultPitchy(evaluatePerformance(groundTruth.notes, learnerNotes));
  }

  async function compareGroundTruthWithBasicPitch() {
    if (!gtGroundTruth || !gtAudio) return;
    setGtComparingBasicPitch(true);
    try {
      const recognizer = await ensureBasicPitch();
      const detected = await recognizer.process(gtAudio.audio, gtAudio.sampleRate);
      const learnerNotes = detectedNotesToNoteEvents(detected, 'microphone');
      setGtResultBasicPitch(evaluatePerformance(gtGroundTruth.notes, learnerNotes));
    } catch {
      // ensureBasicPitch already recorded basicPitchError, surfaced below
    } finally {
      setGtComparingBasicPitch(false);
    }
  }

  return (
    <div>
      <header className="page-header">
        <div className="page-header__eyebrow">Experimental — not part of Practice</div>
        <h1>Microphone Lab</h1>
        <p>
          Benchmarks candidate pitch recognizers against MIDI ground truth (spec §15/§36). Nothing on this page
          feeds into Practice — see <a href="/experiments">Experiments</a> for the reserved <code>NoteRecognizer</code>{' '}
          interface, and <code>doc/MICROPHONE_LAB_FINDINGS.md</code> for written accuracy/latency findings.
        </p>
      </header>

      <div className="panel">
        <h2>1. Free capture</h2>
        <p>Grant microphone access, play a single note or short phrase, then run a recognizer on what was captured.</p>
        <div className="btn-row" style={{ marginBottom: '0.6rem' }}>
          <span
            className={`badge badge--dot ${freeCaptureStatus === 'capturing' ? 'badge--ok' : freeCaptureStatus === 'error' ? 'badge--error' : 'badge--neutral'}`}
          >
            {freeCaptureStatus}
          </span>
          {freeCaptureStatus !== 'capturing' ? (
            <button type="button" className="btn btn--primary" onClick={() => void startFreeCapture()}>
              Start capture
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => void stopFreeCapture()}>
              Stop capture
            </button>
          )}
        </div>
        {freeCaptureError && <p className="error-banner">{freeCaptureError}</p>}
        <LevelMeter level={freeLevel} />

        <div className="lab-recognizer-row">
          <div className="lab-recognizer">
            <h3>Baseline (Pitchy)</h3>
            <button type="button" className="btn" disabled={freeCaptureStatus === 'idle'} onClick={() => void runPitchyOnFreeCapture()}>
              Run
            </button>
            <LatencyReadout result={pitchyResult} />
            <DetectedNotesTable result={pitchyResult} />
          </div>
          <div className="lab-recognizer">
            <h3>Basic Pitch</h3>
            <button
              type="button"
              className="btn"
              disabled={freeCaptureStatus === 'idle' || basicPitchLoading}
              onClick={() => void runBasicPitchOnFreeCapture()}
            >
              {basicPitchLoading ? 'Loading model…' : 'Run'}
            </button>
            {basicPitchError && <p className="error-banner">{basicPitchError}</p>}
            <LatencyReadout result={basicPitchResult} />
            <DetectedNotesTable result={basicPitchResult} />
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>2. Synthetic benchmark (no microphone needed)</h2>
        <p>
          Runs both recognizers against known sine-wave tones instead of a live mic — deterministic and repeatable.
          This is what produced the numbers in <code>doc/MICROPHONE_LAB_FINDINGS.md</code>.
        </p>
        <button type="button" className="btn btn--primary" disabled={benchmarkRunning} onClick={() => void runSyntheticBenchmark()}>
          {benchmarkRunning ? 'Running…' : 'Run synthetic benchmark'}
        </button>
        {benchmarkError && <p className="error-banner">{benchmarkError}</p>}
        {benchmarkResults && (
          <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
            <table className="result-table">
              <thead>
                <tr>
                  <th>Recognizer</th>
                  <th>Accuracy</th>
                  <th>Mean latency</th>
                </tr>
              </thead>
              <tbody>
                {benchmarkResults.map((r) => (
                  <tr key={r.recognizerName}>
                    <td>{r.recognizerName}</td>
                    <td>
                      {r.accuracyPercent.toFixed(0)}% ({r.cases.filter((c) => c.correct).length}/{r.cases.length})
                    </td>
                    <td>{r.meanProcessingMs.toFixed(1)}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>3. MIDI ground-truth comparison</h2>
        <p>
          Play one of the built-in demo melodies on a MIDI keyboard while the mic listens to the same performance,
          then diff the mic-detected notes against what was actually played — reusing <code>practice-engine</code>
          &apos;s existing scoring, exactly as Results does.
        </p>

        <div className="btn-row" style={{ marginBottom: '0.6rem' }}>
          <select className="select" value={demoId} onChange={(e) => setDemoId(e.target.value)} aria-label="Demo melody">
            {demos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <span
            className={`badge badge--dot ${midiStatus === 'connected' ? 'badge--ok' : midiStatus === 'error' ? 'badge--error' : 'badge--neutral'}`}
          >
            MIDI {midiStatus}
          </span>
          {midiStatus !== 'connected' && (
            <button type="button" className="btn" onClick={() => void connectMidi()}>
              Connect MIDI
            </button>
          )}
          {midiInputs.length > 0 && (
            <select className="select" value={selectedMidiInputId ?? ''} onChange={(e) => selectMidiInput(e.target.value)} aria-label="MIDI input device">
              <option value="">None</option>
              {midiInputs.map((input) => (
                <option key={input.id} value={input.id}>
                  {input.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {midiError && <p className="error-banner">{midiError}</p>}

        <div className="btn-row" style={{ marginBottom: '0.6rem' }}>
          {!gtCapturing ? (
            <button type="button" className="btn btn--primary" onClick={() => void startGroundTruthCapture()}>
              Start capture
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => void stopGroundTruthCaptureAndCompare()}>
              Stop &amp; compare
            </button>
          )}
        </div>
        {gtError && <p className="error-banner">{gtError}</p>}
        {gtCapturing && <LevelMeter level={gtLevel} />}

        {gtResultPitchy && (
          <>
            <h3>Baseline (Pitchy) vs. MIDI ground truth</h3>
            <ScoreCard scores={gtResultPitchy.scores} counts={gtResultPitchy.counts} />
            <div className="btn-row" style={{ margin: '0.6rem 0' }}>
              <button type="button" className="btn" disabled={gtComparingBasicPitch} onClick={() => void compareGroundTruthWithBasicPitch()}>
                {gtComparingBasicPitch ? 'Loading model…' : 'Also compare with Basic Pitch'}
              </button>
            </div>
            {basicPitchError && <p className="error-banner">{basicPitchError}</p>}
            {gtResultBasicPitch && (
              <>
                <h3>Basic Pitch vs. MIDI ground truth</h3>
                <ScoreCard scores={gtResultBasicPitch.scores} counts={gtResultBasicPitch.counts} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
