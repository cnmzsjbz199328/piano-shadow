import { describe, it, expect } from 'vitest';
import { parseMidiFile, loadDemoPerformance, getDemoAssets } from '@/midi';
import { VirtualKeyboardAdapter, PerformanceRecorder } from '@/device-adapters';
import { evaluatePerformance } from '@/practice-engine';
import { Midi } from '@tonejs/midi';

/**
 * End-to-end module pipeline (spec §21.2):
 *   MIDI import -> canonical NoteEvent[] -> simulated learner input capture
 *   -> sequence alignment / matching -> score.
 *
 * This does not require a real AudioContext (unlike `PlaybackEngine`, which is
 * exercised at the browser level by the Playwright E2E suite) — it drives the
 * actual input-capture classes (`VirtualKeyboardAdapter` + `PerformanceRecorder`)
 * so the recorded learner `Performance` comes from the same code path a real
 * practice session uses.
 */

function buildReferenceMidi(): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(120); // 0.5s per beat
  const track = midi.addTrack();
  const notes: Array<[number, number, number]> = [
    [60, 0, 0.45], // C4
    [62, 0.5, 0.45], // D4
    [64, 1.0, 0.45], // E4
    [65, 1.5, 0.45], // F4
    [67, 2.0, 0.9], // G4
  ];
  for (const [midiNote, time, duration] of notes) {
    track.addNote({ midi: midiNote, time, duration, velocity: 0.8 });
  }
  return midi.toArray();
}

/** Drive the real keyboard adapter + recorder on a fake clock, like a live attempt. */
function recordLearnerPerformance(
  script: Array<{ midi: number; on: number; off: number }>,
): ReturnType<PerformanceRecorder['stop']> {
  let clock = 0;
  const adapter = new VirtualKeyboardAdapter(() => clock);
  const recorder = new PerformanceRecorder('virtual-keyboard');
  recorder.attach(adapter);
  recorder.start();

  const events = script
    .flatMap((n) => [
      { midi: n.midi, time: n.on, type: 'on' as const },
      { midi: n.midi, time: n.off, type: 'off' as const },
    ])
    .sort((a, b) => a.time - b.time);

  let stopTime = 0;
  for (const e of events) {
    clock = e.time;
    stopTime = Math.max(stopTime, e.time);
    if (e.type === 'on') adapter.press(e.midi, 100);
    else adapter.release(e.midi);
  }
  return recorder.stop(stopTime, 'Integration attempt');
}

describe('pipeline: MIDI import -> capture -> alignment -> score', () => {
  it('a note-perfect echo of the reference scores at/near 100 with no errors', () => {
    const reference = parseMidiFile(buildReferenceMidi(), { name: 'Reference' });
    expect(reference.notes.map((n) => n.noteName)).toEqual(['C4', 'D4', 'E4', 'F4', 'G4']);

    const learner = recordLearnerPerformance(
      reference.notes.map((n) => ({ midi: n.midi, on: n.startTime, off: n.startTime + n.duration })),
    );

    const { scores, counts } = evaluatePerformance(reference.notes, learner.notes);
    expect(counts).toMatchObject({ correct: 5, missed: 0, wrongNote: 0, extra: 0 });
    expect(scores.overall).toBeGreaterThanOrEqual(98);
  });

  it('a missed note and a wrong note surface distinctly and do not shift later notes', () => {
    const reference = parseMidiFile(buildReferenceMidi(), { name: 'Reference' });
    const [c4, d4, e4, f4, g4] = reference.notes;

    // Learner: skips D4, plays E4 correctly, plays a wrong note instead of F4, gets G4 right.
    const learner = recordLearnerPerformance([
      { midi: c4!.midi, on: c4!.startTime, off: c4!.startTime + c4!.duration },
      { midi: e4!.midi, on: e4!.startTime, off: e4!.startTime + e4!.duration },
      { midi: f4!.midi + 2, on: f4!.startTime, off: f4!.startTime + f4!.duration }, // wrong note
      { midi: g4!.midi, on: g4!.startTime, off: g4!.startTime + g4!.duration },
    ]);

    const { matches, counts } = evaluatePerformance(reference.notes, learner.notes);
    expect(counts).toMatchObject({ correct: 3, missed: 1, wrongNote: 1, extra: 0 });

    const missed = matches.find((m) => m.result === 'missed');
    expect(missed?.expected?.midi).toBe(d4!.midi);
    const wrong = matches.find((m) => m.result === 'wrong-note');
    expect(wrong?.expected?.midi).toBe(f4!.midi);
    // G4 still matched G4, proving the earlier miss/wrong-note did not shift the tail.
    const last = matches.filter((m) => m.result === 'correct').at(-1);
    expect(last?.expected?.midi).toBe(g4!.midi);
    expect(last?.actual?.midi).toBe(g4!.midi);
  });

  it('every built-in demo survives the full pipeline with a clean echo', () => {
    for (const asset of getDemoAssets()) {
      const reference = loadDemoPerformance(asset.id);
      const learner = recordLearnerPerformance(
        reference.notes.map((n) => ({ midi: n.midi, on: n.startTime, off: n.startTime + n.duration })),
      );
      const { counts, scores } = evaluatePerformance(reference.notes, learner.notes);
      expect(counts.missed).toBe(0);
      expect(counts.extra).toBe(0);
      expect(scores.overall).toBeGreaterThanOrEqual(98);
    }
  });
});
