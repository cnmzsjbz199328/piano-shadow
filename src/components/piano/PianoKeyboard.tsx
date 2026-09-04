import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { isBlackKey } from '@/music-model';

/**
 * The virtual piano keyboard (spec §2.2.A) — mouse/touch and computer-keyboard
 * input, with visible pressed-key state. This is what makes the app fully
 * testable with no hardware attached.
 */

interface PianoKeyboardProps {
  lowMidi?: number;
  highMidi?: number;
  /** Learner-held notes (from the input adapter), for visible pressed state. */
  heldMidi: readonly number[];
  /** Reference notes currently sounding, e.g. during Listen/Play Along playback. */
  activeReferenceMidi?: readonly number[];
  onPress: (midi: number, velocity?: number) => void;
  onRelease: (midi: number) => void;
  disabled?: boolean;
}

const WHITE_WIDTH = 26;
const BLACK_WIDTH = 16;
const WHITE_HEIGHT = 130;
const BLACK_HEIGHT = 82;

interface KeyLayout {
  whites: Array<{ midi: number; x: number }>;
  blacks: Array<{ midi: number; x: number }>;
  totalWidth: number;
}

function buildKeyLayout(low: number, high: number): KeyLayout {
  const whites: KeyLayout['whites'] = [];
  for (let m = low, i = 0; m <= high; m++) {
    if (!isBlackKey(m)) {
      whites.push({ midi: m, x: i * WHITE_WIDTH });
      i++;
    }
  }
  const blacks: KeyLayout['blacks'] = [];
  for (let m = low; m <= high; m++) {
    if (!isBlackKey(m)) continue;
    const prevWhite = whites.find((w) => w.midi === m - 1);
    if (prevWhite) blacks.push({ midi: m, x: prevWhite.x + WHITE_WIDTH - BLACK_WIDTH / 2 });
  }
  return { whites, blacks, totalWidth: whites.length * WHITE_WIDTH };
}

// QWERTY row -> semitone offset from the current base octave (z/x shift octaves).
const KEYMAP: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ';': 16,
};

function isTypingTarget(el: EventTarget | null): boolean {
  const tag = (el as HTMLElement | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function PianoKeyboard({
  lowMidi = 48,
  highMidi = 84,
  heldMidi,
  activeReferenceMidi = [],
  onPress,
  onRelease,
  disabled = false,
}: PianoKeyboardProps) {
  const layout = useMemo(() => buildKeyLayout(lowMidi, highMidi), [lowMidi, highMidi]);
  const held = useMemo(() => new Set(heldMidi), [heldMidi]);
  const active = useMemo(() => new Set(activeReferenceMidi), [activeReferenceMidi]);
  const [octaveShift, setOctaveShift] = useState(0);
  const keyToMidi = useRef(new Map<string, number>());
  const onPressRef = useRef(onPress);
  const onReleaseRef = useRef(onRelease);
  onPressRef.current = onPress;
  onReleaseRef.current = onRelease;

  useEffect(() => {
    if (disabled) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.repeat || isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z') {
        setOctaveShift((s) => Math.max(-3, s - 1));
        return;
      }
      if (key === 'x') {
        setOctaveShift((s) => Math.min(3, s + 1));
        return;
      }
      const offset = KEYMAP[key];
      if (offset === undefined || keyToMidi.current.has(key)) return;
      const midi = 60 + octaveShift * 12 + offset;
      keyToMidi.current.set(key, midi);
      onPressRef.current(midi, 100);
    }
    function handleKeyUp(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      const midi = keyToMidi.current.get(key);
      if (midi === undefined) return;
      keyToMidi.current.delete(key);
      onReleaseRef.current(midi);
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [octaveShift, disabled]);

  function press(midi: number, e: ReactPointerEvent) {
    if (disabled) return;
    const velocity = e.pressure > 0 ? Math.round(e.pressure * 127) : 100;
    onPress(midi, velocity);
  }

  return (
    <div className="piano-keyboard">
      <svg
        width={layout.totalWidth}
        height={WHITE_HEIGHT}
        viewBox={`0 0 ${layout.totalWidth} ${WHITE_HEIGHT}`}
        role="group"
        aria-label="Virtual piano keyboard"
      >
        {layout.whites.map(({ midi, x }) => (
          <rect
            key={midi}
            className={
              'piano-key piano-key--white' +
              (held.has(midi) ? ' piano-key--held' : active.has(midi) ? ' piano-key--reference-active' : '')
            }
            x={x}
            y={0}
            width={WHITE_WIDTH}
            height={WHITE_HEIGHT}
            role="button"
            aria-label={`Key ${midi}`}
            aria-pressed={held.has(midi)}
            tabIndex={disabled ? -1 : 0}
            onPointerDown={(e) => press(midi, e)}
            onPointerUp={() => onRelease(midi)}
            onPointerLeave={() => held.has(midi) && onRelease(midi)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onPress(midi, 100);
            }}
            onKeyUp={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onRelease(midi);
            }}
          />
        ))}
        {layout.blacks.map(({ midi, x }) => (
          <rect
            key={midi}
            className={
              'piano-key piano-key--black' +
              (held.has(midi) ? ' piano-key--held' : active.has(midi) ? ' piano-key--reference-active' : '')
            }
            x={x}
            y={0}
            width={BLACK_WIDTH}
            height={BLACK_HEIGHT}
            role="button"
            aria-label={`Key ${midi}`}
            aria-pressed={held.has(midi)}
            tabIndex={disabled ? -1 : 0}
            onPointerDown={(e) => press(midi, e)}
            onPointerUp={() => onRelease(midi)}
            onPointerLeave={() => held.has(midi) && onRelease(midi)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onPress(midi, 100);
            }}
            onKeyUp={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onRelease(midi);
            }}
          />
        ))}
      </svg>
    </div>
  );
}
