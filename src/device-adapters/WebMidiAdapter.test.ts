import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebMidiAdapter } from './WebMidiAdapter';
import type { MIDIAccessLike, MIDIInputLike } from './webMidiTypes';

class FakeInput implements MIDIInputLike {
  id: string;
  name = 'Fake Piano';
  manufacturer = 'Test Co';
  state: 'connected' | 'disconnected' = 'connected';
  connection: 'open' | 'closed' | 'pending' = 'closed';
  onmidimessage: ((event: { data: Uint8Array | null }) => void) | null = null;
  constructor(id: string) {
    this.id = id;
  }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent(): boolean {
    return true;
  }
  send(data: number[]) {
    this.onmidimessage?.({ data: Uint8Array.from(data) });
  }
}

function makeFakeAccess(inputs: FakeInput[]): MIDIAccessLike {
  const map = new Map(inputs.map((i) => [i.id, i]));
  return {
    inputs: map,
    onstatechange: null,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  };
}

const originalNavigator = globalThis.navigator;

describe('WebMidiAdapter', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
  });

  it('reports "unsupported" when the browser has no Web MIDI API', () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    expect(WebMidiAdapter.isSupported()).toBe(false);
    const adapter = new WebMidiAdapter(() => 0);
    expect(adapter.status).toBe('unsupported');
  });

  describe('with a fake Web MIDI API', () => {
    let input: FakeInput;
    let requestMIDIAccess: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      input = new FakeInput('dev-1');
      requestMIDIAccess = vi.fn().mockResolvedValue(makeFakeAccess([input]));
      Object.defineProperty(globalThis, 'navigator', {
        value: { requestMIDIAccess },
        configurable: true,
      });
    });

    it('connects, lists inputs, and selects one', async () => {
      const adapter = new WebMidiAdapter(() => 0);
      await adapter.connect();
      expect(adapter.listInputs()).toEqual([{ id: 'dev-1', name: 'Fake Piano', manufacturer: 'Test Co' }]);
      adapter.selectInput('dev-1');
      expect(adapter.status).toBe('connected');
      expect(adapter.selectedInputId).toBe('dev-1');
    });

    it('parses note-on / note-off, including running-status note-on velocity 0', () => {
      let t = 0;
      const adapter = new WebMidiAdapter(() => t);
      const starts: unknown[] = [];
      const ends: unknown[] = [];
      adapter.onNoteStart((n) => starts.push(n));
      adapter.onNoteEnd((n) => ends.push(n));

      return adapter.connect().then(() => {
        adapter.selectInput('dev-1');
        t = 0.1;
        input.send([0x90, 60, 100]); // note on
        t = 0.4;
        input.send([0x80, 60, 0]); // real note off
        t = 0.6;
        input.send([0x90, 64, 100]);
        t = 0.9;
        input.send([0x90, 64, 0]); // note-on velocity 0 == note off

        expect(starts).toEqual([
          { midi: 60, time: 0.1, velocity: 100 },
          { midi: 64, time: 0.6, velocity: 100 },
        ]);
        expect(ends).toEqual([
          { midi: 60, time: 0.4 },
          { midi: 64, time: 0.9 },
        ]);
      });
    });

    it('surfaces a WebMidiError instead of throwing an unhandled rejection on denial', async () => {
      requestMIDIAccess.mockRejectedValueOnce(new Error('denied'));
      const adapter = new WebMidiAdapter(() => 0);
      await expect(adapter.connect()).rejects.toThrow(/denied|unavailable/i);
      expect(adapter.status).toBe('error');
    });
  });
});
