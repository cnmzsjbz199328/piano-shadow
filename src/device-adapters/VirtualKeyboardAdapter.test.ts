import { describe, it, expect, vi } from 'vitest';
import { VirtualKeyboardAdapter } from './VirtualKeyboardAdapter';

describe('VirtualKeyboardAdapter', () => {
  it('emits note-on/off with velocity and the injected clock time', () => {
    let t = 0;
    const adapter = new VirtualKeyboardAdapter(() => t);
    const starts: unknown[] = [];
    const ends: unknown[] = [];
    adapter.onNoteStart((n) => starts.push(n));
    adapter.onNoteEnd((n) => ends.push(n));

    t = 1.5;
    adapter.press(60, 90);
    t = 2.1;
    adapter.release(60);

    expect(starts).toEqual([{ midi: 60, time: 1.5, velocity: 90 }]);
    expect(ends).toEqual([{ midi: 60, time: 2.1 }]);
  });

  it('ignores a repeated press while the key is already held', () => {
    const adapter = new VirtualKeyboardAdapter(() => 0);
    const cb = vi.fn();
    adapter.onNoteStart(cb);
    adapter.press(60);
    adapter.press(60);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(adapter.isHeld(60)).toBe(true);
  });

  it('ignores a release with no matching press', () => {
    const adapter = new VirtualKeyboardAdapter(() => 0);
    const cb = vi.fn();
    adapter.onNoteEnd(cb);
    adapter.release(60);
    expect(cb).not.toHaveBeenCalled();
  });

  it('releaseAll clears every held key', () => {
    const adapter = new VirtualKeyboardAdapter(() => 0);
    adapter.press(60);
    adapter.press(64);
    adapter.releaseAll();
    expect(adapter.heldNotes).toEqual([]);
  });

  it('reports connected/disconnected status transitions', async () => {
    const adapter = new VirtualKeyboardAdapter(() => 0);
    const statuses: string[] = [];
    adapter.onStatusChange((s) => statuses.push(s));
    await adapter.connect();
    adapter.press(60);
    await adapter.disconnect();
    expect(statuses).toEqual(['connected', 'disconnected']);
    expect(adapter.heldNotes).toEqual([]); // disconnect releases held notes
  });
});
