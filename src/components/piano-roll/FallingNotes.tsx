import { useEffect, useMemo, useRef, useState } from 'react';
import { isBlackKey, type NoteEvent } from '@/music-model';
import { useAppStore } from '@/stores/useAppStore';
import {
  buildKeyLayout,
  centreXForMidi,
  WHITE_WIDTH,
  BLACK_WIDTH,
} from '@/components/piano/keyLayout';

/**
 * Falling-notes ("Synthesia") guidance layer (plan Track D / spec §2.3 —
 * "current note highlighting", a look-ahead of upcoming reference notes).
 *
 * A `<canvas>` drawn with the same approach as `PianoRoll.tsx`: it redraws on
 * every relevant store change and reads live design-token colours through
 * `getComputedStyle` instead of hard-coding hex, so it stays in lockstep with
 * the palette.
 *
 * One authoritative clock (spec §25): this component only *reads* `currentTime`
 * from the store — it never creates a playback timer, never seeks, never calls
 * the engine. `currentTime` is advanced by `PlaybackEngine`'s own transport
 * frame loop, so a store tick per animation frame already drives a smooth
 * repaint; the `requestAnimationFrame` here only defers the paint to the next
 * frame and coalesces bursts of ticks — its timestamp is never used as a time
 * source. Note positions are derived purely from the store's `currentTime`.
 *
 * Column geometry comes from the shared, React-free `keyLayout.ts` (built for
 * the full A0–C8 range) so a note's x-position and width line up exactly with
 * the key directly below it in `PianoKeyboard`.
 */

/** Seconds of upcoming reference notes shown at once; time maps linearly to y. */
const LOOK_AHEAD_SECONDS = 2.5;
/** Full 88-key piano range — matches PracticePage's keyboard. */
const FULL_LOW_MIDI = 21; // A0
const FULL_HIGH_MIDI = 108; // C8
/** Fallbacks for environments with no layout (jsdom: clientWidth/Height are 0). */
const FALLBACK_CANVAS_WIDTH = 1000;
const FALLBACK_CANVAS_HEIGHT = 96;
/** A note column is drawn a little narrower than its key so lanes read apart. */
const COLUMN_FILL = 0.72;
const MIN_COLUMN_PX = 3;
/** Reduced-motion: upcoming notes are stacked by queue order in fixed slots. */
const REDUCED_MOTION_SLOT_PX = 13;
const REDUCED_MOTION_MAX_MARKERS = 10;

interface Tokens {
  accent: string;
  text: string;
  border: string;
}

function readTokens(): Tokens {
  // Same technique as `readColorTokens` in PianoRoll.tsx: pull the live values of
  // `src/index.css`'s design tokens once per draw so the layer never duplicates
  // (and drifts from) the palette's hex values.
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    accent: v('--accent'),
    text: v('--text'),
    border: v('--border'),
  };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function FallingNotes() {
  const song = useAppStore((s) => s.song);
  const currentTime = useAppStore((s) => s.currentTime);
  const transportState = useAppStore((s) => s.transportState);
  const isAttemptRunning = useAppStore((s) => s.isAttemptRunning);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [resizeTick, setResizeTick] = useState(0);

  const layout = useMemo(() => buildKeyLayout(FULL_LOW_MIDI, FULL_HIGH_MIDI), []);
  const centreByMidi = useMemo(() => {
    const map = new Map<number, number>();
    for (const w of layout.whites) map.set(w.midi, w.x + WHITE_WIDTH / 2);
    for (const b of layout.blacks) map.set(b.midi, b.x + BLACK_WIDTH / 2);
    return map;
  }, [layout]);

  // The guidance layer is only mounted by PracticePage while the transport runs
  // or an attempt is recording; this mirrors that so a stray mount never paints.
  const activeSession =
    transportState === 'playing' || transportState === 'counting-in' || isAttemptRunning;

  // Track the reduced-motion preference live.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  // Keep the canvas backing store sized to its fluid CSS box.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setResizeTick((n) => n + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const paint = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = canvas.clientWidth || FALLBACK_CANVAS_WIDTH;
      const cssHeight = canvas.clientHeight || FALLBACK_CANVAS_HEIGHT;
      canvas.width = Math.max(1, Math.round(cssWidth * dpr));
      canvas.height = Math.max(1, Math.round(cssHeight * dpr));

      const ctx = canvas.getContext('2d');
      if (!ctx) return; // jsdom / no 2D context — no-op rather than throw (spec §25).
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const notes = song?.notes;
      if (!activeSession || !notes || notes.length === 0) return;

      const tokens = readTokens();
      const scaleX = cssWidth / layout.totalWidth;

      const columnFor = (note: NoteEvent) => {
        const centre = centreByMidi.get(note.midi) ?? centreXForMidi(layout, note.midi);
        if (centre == null) return null;
        const keyWidth = isBlackKey(note.midi) ? BLACK_WIDTH : WHITE_WIDTH;
        const w = Math.max(MIN_COLUMN_PX, keyWidth * COLUMN_FILL * scaleX);
        return { x: centre * scaleX - w / 2, w };
      };

      // Baseline: the keyboard's top edge sits directly below this line.
      ctx.strokeStyle = tokens.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, cssHeight - 0.5);
      ctx.lineTo(cssWidth, cssHeight - 0.5);
      ctx.stroke();

      if (reducedMotion) {
        // Static markers: upcoming notes are stacked by queue order in fixed
        // slots, so nothing moves as the clock advances — a note simply drops
        // out of the list once it has been reached.
        const upcoming = notes
          .filter((n) => n.startTime + n.duration > currentTime)
          .sort((a, b) => a.startTime - b.startTime)
          .slice(0, REDUCED_MOTION_MAX_MARKERS);
        upcoming.forEach((note, i) => {
          const col = columnFor(note);
          if (!col) return;
          ctx.globalAlpha = i === 0 ? 0.95 : 0.5;
          ctx.fillStyle = tokens.accent;
          ctx.fillRect(col.x, 6 + i * REDUCED_MOTION_SLOT_PX, col.w, REDUCED_MOTION_SLOT_PX - 5);
        });
        ctx.globalAlpha = 1;
        return;
      }

      // Animated: every note within the look-ahead window falls toward the
      // baseline; its leading (bottom) edge reaches y = cssHeight exactly when
      // currentTime === note.startTime.
      for (const note of notes) {
        const untilStart = note.startTime - currentTime;
        const untilEnd = note.startTime + note.duration - currentTime;
        if (untilEnd <= 0) continue; // already played
        if (untilStart > LOOK_AHEAD_SECONDS) continue; // not in the window yet

        const col = columnFor(note);
        if (!col) continue;

        const leadingY = cssHeight - (untilStart / LOOK_AHEAD_SECONDS) * cssHeight;
        const bodyH = Math.max(MIN_COLUMN_PX, (note.duration / LOOK_AHEAD_SECONDS) * cssHeight);
        const top = Math.max(0, leadingY - bodyH);
        const bottom = Math.min(cssHeight, leadingY);
        if (bottom <= top) continue;

        const sounding = untilStart <= 0 && untilEnd > 0;
        ctx.globalAlpha = sounding ? 0.9 : 0.42;
        ctx.fillStyle = tokens.accent;
        ctx.fillRect(col.x, top, col.w, bottom - top);

        // Crisp leading edge so the "hit now" moment is legible.
        const edgeY = Math.min(cssHeight - 1.5, Math.max(0, leadingY - 1.5));
        ctx.globalAlpha = sounding ? 1 : 0.75;
        ctx.fillStyle = tokens.text;
        ctx.fillRect(col.x, edgeY, col.w, 1.5);
      }
      ctx.globalAlpha = 1;
    };

    // rAF defers the paint to the next frame and coalesces a burst of store
    // ticks into one draw. It is a paint scheduler only — never a clock.
    const frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [song, currentTime, activeSession, reducedMotion, resizeTick, layout, centreByMidi]);

  return (
    <div className="falling-notes" aria-hidden="true">
      <canvas ref={canvasRef} className="falling-notes__canvas" />
    </div>
  );
}
