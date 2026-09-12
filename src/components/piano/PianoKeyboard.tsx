import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { midiToNoteName } from '@/music-model';
import {
  buildKeyLayout,
  centreXForMidi,
  WHITE_WIDTH,
  BLACK_WIDTH,
  WHITE_HEIGHT,
  BLACK_HEIGHT,
  LABEL_ROW_HEIGHT,
} from './keyLayout';

/**
 * The virtual piano keyboard (spec §2.2.A) — mouse/touch and computer-keyboard
 * input, with visible pressed-key state. This is what makes the app fully
 * testable with no hardware attached.
 *
 * Phase C (ROUND_3_REQUIREMENTS §C.2.4): the default range is the full 88-key
 * piano (A0–C8). The SVG is drawn fluidly (`width="100%"`,
 * `preserveAspectRatio="none"`) and its CSS height is clamped, so the whole
 * keyboard scales to fit the viewport with no horizontal page scroll — the key
 * geometry (in `./keyLayout`) is unchanged, only how the SVG paints it.
 * `focusMidi` still scrolls the relevant octave into view *if* a caller passes
 * a range too wide to fit (`scrollWidth > clientWidth`); at fit scale it is a
 * no-op. The QWERTY input mapping is unchanged and out of scope here.
 */

interface PianoKeyboardProps {
  lowMidi?: number;
  highMidi?: number;
  /** Learner-held notes (from the input adapter), for visible pressed state. */
  heldMidi: readonly number[];
  /** Reference notes currently sounding, e.g. during Listen/Play Along playback. */
  activeReferenceMidi?: readonly number[];
  /** Notes the learner should play right now; labelled above the key in
   *  addition to any fill from `activeReferenceMidi` (the two overlap during
   *  guided playback, but stay separate props since recognition mode fills
   *  keys without this "you should play this" framing). */
  currentTargetMidi?: readonly number[];
  /** The following onset group; labelled only, never filled — a filled key
   *  would read as "play this now" and be confused with the current target. */
  nextTargetMidi?: readonly number[];
  /** Most recent learner-input result; reference playback never sets this. */
  inputFeedback?: { midi: number; result: 'correct' | 'wrong-note' | 'extra' } | null;
  /** Scroll this pitch's octave into view (reference/learner note, or middle C). */
  focusMidi?: number;
  onPress: (midi: number, velocity?: number) => void;
  onRelease: (midi: number) => void;
  disabled?: boolean;
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
  lowMidi = 21,
  highMidi = 108,
  heldMidi,
  activeReferenceMidi = [],
  currentTargetMidi = [],
  nextTargetMidi = [],
  inputFeedback = null,
  focusMidi,
  onPress,
  onRelease,
  disabled = false,
}: PianoKeyboardProps) {
  const layout = useMemo(() => buildKeyLayout(lowMidi, highMidi), [lowMidi, highMidi]);
  const held = useMemo(() => new Set(heldMidi), [heldMidi]);
  const active = useMemo(() => new Set(activeReferenceMidi), [activeReferenceMidi]);
  // True visual centre of each key (unlike `centreXForMidi`, which is only a
  // scroll-into-view approximation), so a target label sits over the actual
  // key it names, black keys included.
  const centreByMidi = useMemo(() => {
    const map = new Map<number, number>();
    for (const w of layout.whites) map.set(w.midi, w.x + WHITE_WIDTH / 2);
    for (const b of layout.blacks) map.set(b.midi, b.x + BLACK_WIDTH / 2);
    return map;
  }, [layout]);
  // 'current' wins where a note is (harmlessly) listed in both — it is the
  // more urgent of the two labels.
  const targetLabelKind = useMemo(() => {
    const labels = new Map<number, 'current' | 'next'>();
    for (const midi of nextTargetMidi) labels.set(midi, 'next');
    for (const midi of currentTargetMidi) labels.set(midi, 'current');
    return labels;
  }, [currentTargetMidi, nextTargetMidi]);
  // The target labels are visual (`aria-hidden`, drawn on the keys); this is
  // the equivalent announcement for screen-reader users.
  const targetAnnouncement = useMemo(() => {
    const parts: string[] = [];
    if (currentTargetMidi.length > 0) parts.push(`Current target ${currentTargetMidi.map(midiToNoteName).join(', ')}`);
    if (nextTargetMidi.length > 0) parts.push(`next ${nextTargetMidi.map(midiToNoteName).join(', ')}`);
    return parts.join('. ');
  }, [currentTargetMidi, nextTargetMidi]);
  const [octaveShift, setOctaveShift] = useState(0);
  const [overflowing, setOverflowing] = useState(false);
  const keyToMidi = useRef(new Map<string, number>());
  const scrollRef = useRef<HTMLDivElement>(null);
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

  // Scroll the focused octave into view (initial: middle C). No-op when the
  // whole keyboard already fits, or in a zero-width test container.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || focusMidi === undefined) return;
    const centre = centreXForMidi(layout, focusMidi);
    if (centre === null || el.clientWidth === 0 || layout.totalWidth <= el.clientWidth) return;
    const target = Math.max(0, Math.min(centre - el.clientWidth / 2, layout.totalWidth - el.clientWidth));
    el.scrollTo({ left: target, behavior: 'smooth' });
  }, [focusMidi, layout]);

  // Show the scroll arrows only when the keyboard is wider than its container.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout]);

  function scrollByKeys(direction: -1 | 1) {
    scrollRef.current?.scrollBy({ left: direction * WHITE_WIDTH * 7, behavior: 'smooth' });
  }

  function press(midi: number, e: ReactPointerEvent) {
    if (disabled) return;
    const velocity = e.pressure > 0 ? Math.round(e.pressure * 127) : 100;
    onPress(midi, velocity);
  }

  const keyHandlers = (midi: number) => ({
    onPointerDown: (e: ReactPointerEvent) => press(midi, e),
    onPointerUp: () => onRelease(midi),
    onPointerLeave: () => held.has(midi) && onRelease(midi),
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') onPress(midi, 100);
    },
    onKeyUp: (e: ReactKeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') onRelease(midi);
    },
  });

  function keyClass(base: string, midi: number): string {
    if (held.has(midi)) return `${base} piano-key--held`;
    if (inputFeedback?.midi === midi) return `${base} piano-key--feedback-${inputFeedback.result}`;
    if (active.has(midi)) return `${base} piano-key--reference-active`;
    return base;
  }

  return (
    <div className="piano-keyboard-wrap">
      <span className="sr-only" role="status" aria-live="polite">{targetAnnouncement}</span>
      {overflowing && (
        <button
          type="button"
          className="piano-keyboard__scroll piano-keyboard__scroll--prev"
          aria-label="Scroll keyboard left"
          tabIndex={-1}
          onClick={() => scrollByKeys(-1)}
        >
          ‹
        </button>
      )}
      <div className="piano-keyboard" ref={scrollRef}>
        <svg
          width="100%"
          height={LABEL_ROW_HEIGHT + WHITE_HEIGHT}
          viewBox={`0 0 ${layout.totalWidth} ${LABEL_ROW_HEIGHT + WHITE_HEIGHT}`}
          preserveAspectRatio="none"
          role="group"
          aria-label="Virtual piano keyboard"
        >
        {layout.whites.map(({ midi, x }) => {
          const name = midiToNoteName(midi);
          const showLabel = midi % 12 === 0 || midi === lowMidi || midi === highMidi;
          return (
            <g key={midi}>
              <rect
                className={keyClass('piano-key piano-key--white', midi)}
                x={x}
                y={LABEL_ROW_HEIGHT}
                width={WHITE_WIDTH}
                height={WHITE_HEIGHT}
                role="button"
                aria-label={`Key ${midi}`}
                aria-pressed={held.has(midi)}
                tabIndex={disabled ? -1 : 0}
                {...keyHandlers(midi)}
              />
              {showLabel && (
                <text className="piano-key__label" x={x + WHITE_WIDTH / 2} y={LABEL_ROW_HEIGHT + WHITE_HEIGHT - 8} textAnchor="middle">
                  {name}
                </text>
              )}
            </g>
          );
        })}
        {layout.blacks.map(({ midi, x }) => (
          <rect
            key={midi}
            className={keyClass('piano-key piano-key--black', midi)}
            x={x}
            y={LABEL_ROW_HEIGHT}
            width={BLACK_WIDTH}
            height={BLACK_HEIGHT}
            role="button"
            aria-label={`Key ${midi}`}
            aria-pressed={held.has(midi)}
            tabIndex={disabled ? -1 : 0}
            {...keyHandlers(midi)}
          />
        ))}
        {[...targetLabelKind.entries()].map(([midi, kind]) => {
          const centreX = centreByMidi.get(midi);
          if (centreX === undefined) return null;
          return (
            <text
              key={`target-${midi}`}
              className={`piano-key__target-label piano-key__target-label--${kind}`}
              x={centreX}
              y={LABEL_ROW_HEIGHT - 3}
              textAnchor="middle"
              aria-hidden="true"
            >
              {midiToNoteName(midi)}
            </text>
          );
        })}
        </svg>
      </div>
      {overflowing && (
        <button
          type="button"
          className="piano-keyboard__scroll piano-keyboard__scroll--next"
          aria-label="Scroll keyboard right"
          tabIndex={-1}
          onClick={() => scrollByKeys(1)}
        >
          ›
        </button>
      )}
    </div>
  );
}
