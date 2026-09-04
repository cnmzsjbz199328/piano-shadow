import { describe, it, expect } from 'vitest';
import { PerformanceRecorder } from './PerformanceRecorder';
import { VirtualKeyboardAdapter } from './VirtualKeyboardAdapter';
import { Emitter } from './emitter';
import type { AdapterNoteOff, AdapterNoteOn, AdapterStatus, NoteInputAdapter } from './types';

/** A bare adapter whose note-on/off events can be fired directly, for edge cases
 * (like a stray note-off) that VirtualKeyboardAdapter deliberately guards against. */
class RawAdapter implements NoteInputAdapter {
  readonly source = 'virtual-keyboard' as const;
  status: AdapterStatus = 'connected';
  private readonly starts = new Emitter<AdapterNoteOn>();
  private readonly ends = new Emitter<AdapterNoteOff>();
  async connect() {}
  async disconnect() {}
  fireStart(n: AdapterNoteOn) {
    this.starts.emit(n);
  }
  fireEnd(n: AdapterNoteOff) {
    this.ends.emit(n);
  }
  onNoteStart(cb: (n: AdapterNoteOn) => void) {
    return this.starts.on(cb);
  }
  onNoteEnd(cb: (n: AdapterNoteOff) => void) {
    return this.ends.on(cb);
  }
  onStatusChange() {
    return () => {};
  }
}

describe('PerformanceRecorder', () => {
  it('pairs note-on/off into completed NoteEvents', () => {
    let t = 0;
    const adapter = new VirtualKeyboardAdapter(() => t);
    const recorder = new PerformanceRecorder('virtual-keyboard');
    recorder.attach(adapter);
    recorder.start();

    t = 0;
    adapter.press(60);
    t = 0.5;
    adapter.release(60);
    t = 0.5;
    adapter.press(64);
    t = 1.2;
    adapter.release(64);

    const perf = recorder.stop(1.2, 'Attempt');
    expect(perf.notes).toHaveLength(2);
    expect(perf.notes[0]).toMatchObject({ midi: 60, startTime: 0, source: 'virtual-keyboard' });
    expect(perf.notes[0]!.duration).toBeCloseTo(0.5, 5);
    expect(perf.notes[1]).toMatchObject({ midi: 64, startTime: 0.5 });
  });

  it('closes a note still held at stop time and warns (never drops it)', () => {
    let t = 0;
    const adapter = new VirtualKeyboardAdapter(() => t);
    const recorder = new PerformanceRecorder('virtual-keyboard');
    recorder.attach(adapter);
    recorder.start();

    adapter.press(60);
    t = 3;
    const perf = recorder.stop(3);

    expect(perf.notes).toHaveLength(1);
    expect(perf.notes[0]!.duration).toBeCloseTo(3, 5);
    expect(recorder.getWarnings()).toEqual([{ type: 'held-at-stop', midi: 60, startTime: 0, stopTime: 3 }]);
  });

  it('does not drop or crash on an unmatched note-off, and records a warning', () => {
    const adapter = new RawAdapter();
    const recorder = new PerformanceRecorder('virtual-keyboard');
    recorder.attach(adapter);
    recorder.start();

    adapter.fireStart({ midi: 60, time: 0 });
    adapter.fireEnd({ midi: 60, time: 0.4 });
    adapter.fireStart({ midi: 62, time: 0.4 });
    adapter.fireEnd({ midi: 62, time: 0.8 });
    adapter.fireEnd({ midi: 64, time: 1 }); // stray — never started

    const perf = recorder.stop(2);

    expect(perf.notes.map((n) => n.midi)).toEqual([60, 62]);
    expect(recorder.getWarnings()).toEqual([{ type: 'unmatched-note-off', midi: 64, time: 1 }]);
  });

  it('ignores events received before start() / after stop()', () => {
    let t = 0;
    const adapter = new VirtualKeyboardAdapter(() => t);
    const recorder = new PerformanceRecorder('virtual-keyboard');
    recorder.attach(adapter);

    adapter.press(60); // before start — must not be recorded
    recorder.start();
    t = 0.2;
    adapter.press(64);
    t = 0.6;
    adapter.release(64);
    const perf = recorder.stop(0.6);

    expect(perf.notes).toHaveLength(1);
    expect(perf.notes[0]!.midi).toBe(64);
  });
});
