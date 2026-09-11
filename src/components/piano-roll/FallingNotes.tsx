import { useEffect, useMemo, useRef, useState } from 'react';
import { isBlackKey, midiToNoteName, type NoteEvent } from '@/music-model';
import { groupNotesByOnset, LOOK_AHEAD_SECONDS, notesInLookAheadWindow, voiceFilteredNotes } from '@/practice-engine';
import { useAppStore, type FallingNotesMode } from '@/stores/useAppStore';
import { buildKeyLayout, centreXForMidi, WHITE_WIDTH, BLACK_WIDTH } from '@/components/piano/keyLayout';

const FULL_LOW_MIDI = 21;
const FULL_HIGH_MIDI = 108;
const FALLBACK_CANVAS_WIDTH = 1000;
const FALLBACK_CANVAS_HEIGHT = 96;
const COLUMN_FILL = 0.72;
const MIN_COLUMN_PX = 3;
const REDUCED_MOTION_SLOT_PX = 16;
const REDUCED_MOTION_MAX_MARKERS = 10;
const ONSET_TOLERANCE_SECONDS = 0.001;

interface Tokens {
  accent: string;
  text: string;
  border: string;
  correct: string;
  wrong: string;
  extra: string;
}

interface CanvasMetrics {
  width: number;
  height: number;
  dpr: number;
}

function readTokens(): Tokens {
  const style = getComputedStyle(document.documentElement);
  const value = (name: string) => style.getPropertyValue(name).trim();
  return {
    accent: value('--accent'),
    text: value('--text'),
    border: value('--border'),
    correct: value('--correct'),
    wrong: value('--wrong'),
    extra: value('--extra'),
  };
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function currentOnsetNotes(notes: readonly NoteEvent[], currentTime: number): NoteEvent[] {
  const groups = groupNotesByOnset(notes, ONSET_TOLERANCE_SECONDS);
  const current = groups.find((group) =>
    group.startTime <= currentTime + 0.05
    && group.notes.some((note) => note.startTime + note.duration > currentTime - 0.05),
  );
  return current?.notes ?? [];
}

function notesForMode(
  notes: readonly NoteEvent[],
  currentTime: number,
  mode: FallingNotesMode,
  waitingForMidi: readonly number[] | null,
): NoteEvent[] {
  if (waitingForMidi && waitingForMidi.length > 0) {
    const waiting = new Set(waitingForMidi);
    const currentTargets = currentOnsetNotes(notes, currentTime).filter((note) => waiting.has(note.midi));
    // The store is authoritative; the fallback keeps a target visible when a
    // draw callback and state tick land a few milliseconds apart.
    return currentTargets.length > 0
      ? currentTargets
      : notes.filter((note) => waiting.has(note.midi)).slice(0, waitingForMidi.length);
  }

  if (mode === 'subtle') {
    const groups = groupNotesByOnset(notes, ONSET_TOLERANCE_SECONDS);
    const current = groups.find((group) =>
      group.startTime <= currentTime
      && group.notes.some((note) => note.startTime + note.duration > currentTime),
    );
    const next = groups.find((group) => group.startTime > currentTime + ONSET_TOLERANCE_SECONDS);
    return [...(current?.notes ?? []), ...(next?.notes ?? [])];
  }
  return notesInLookAheadWindow(notes, currentTime);
}

function formatNotes(notes: readonly NoteEvent[]): string {
  const names = [...new Set(notes.map((note) => note.noteName || midiToNoteName(note.midi)))];
  return names.length > 0 ? names.join(' · ') : '—';
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const rounded = ctx as CanvasRenderingContext2D & {
    roundRect?: (x: number, y: number, width: number, height: number, radius: number) => void;
  };
  if (rounded.roundRect) {
    ctx.beginPath();
    rounded.roundRect(x, y, width, height, radius);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, width, height);
  }
}

export function FallingNotes() {
  const song = useAppStore((state) => state.song);
  const currentTime = useAppStore((state) => state.currentTime);
  const practiceVoice = useAppStore((state) => state.practiceVoice) ?? 'both';
  const transportState = useAppStore((state) => state.transportState);
  const waitingForMidi = useAppStore((state) => state.waitingForMidi) ?? null;
  const fallingNotesMode = useAppStore((state) => state.fallingNotesMode) ?? 'guidance';
  const lastInputFeedback = useAppStore((state) => state.lastInputFeedback) ?? null;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const metricsRef = useRef<CanvasMetrics | null>(null);
  const tokensRef = useRef<Tokens | null>(null);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [resizeTick, setResizeTick] = useState(0);
  const layout = useMemo(() => buildKeyLayout(FULL_LOW_MIDI, FULL_HIGH_MIDI), []);
  const notes = useMemo(() => (song ? voiceFilteredNotes(song, practiceVoice) : []), [song, practiceVoice]);
  const visibleNotes = useMemo(
    () => notesForMode(notes, currentTime, fallingNotesMode, waitingForMidi),
    [notes, currentTime, fallingNotesMode, waitingForMidi],
  );
  const currentNotes = useMemo(() => currentOnsetNotes(notes, currentTime), [notes, currentTime]);
  const nextNotes = useMemo(() => {
    const next = groupNotesByOnset(notes, ONSET_TOLERANCE_SECONDS)
      .find((group) => group.startTime > currentTime + ONSET_TOLERANCE_SECONDS);
    return next?.notes ?? [];
  }, [notes, currentTime]);
  const waiting = (waitingForMidi?.length ?? 0) > 0;
  const activelyPlaying = transportState === 'playing' || transportState === 'counting-in';

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setResizeTick((tick) => tick + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const paint = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth || FALLBACK_CANVAS_WIDTH;
      const height = canvas.clientHeight || FALLBACK_CANVAS_HEIGHT;
      const previous = metricsRef.current;
      if (!previous || previous.width !== width || previous.height !== height || previous.dpr !== dpr) {
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        metricsRef.current = { width, height, dpr };
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (!song || notes.length === 0 || visibleNotes.length === 0) return;

      const tokens = tokensRef.current ?? (tokensRef.current = readTokens());
      const scaleX = width / layout.totalWidth;
      const columnFor = (note: NoteEvent) => {
        const centre = centreXForMidi(layout, note.midi);
        if (centre === null) return null;
        const keyWidth = isBlackKey(note.midi) ? BLACK_WIDTH : WHITE_WIDTH;
        const barWidth = Math.max(MIN_COLUMN_PX, keyWidth * COLUMN_FILL * scaleX);
        return { x: centre * scaleX - barWidth / 2, width: barWidth };
      };

      // This line is in the canvas content box, the same box used by the SVG
      // keyboard below it, so it is the actual timing target rather than meta UI.
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = tokens.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height - 0.5);
      ctx.lineTo(width, height - 0.5);
      ctx.stroke();

      if (reducedMotion) {
        const groups = groupNotesByOnset(visibleNotes, ONSET_TOLERANCE_SECONDS).slice(0, REDUCED_MOTION_MAX_MARKERS);
        groups.forEach((group, index) => {
          for (const note of group.notes) {
            const column = columnFor(note);
            if (!column) continue;
            ctx.globalAlpha = index === 0 ? 0.95 : 0.52;
            ctx.fillStyle = tokens.accent;
            const markerY = waiting ? height - 18 : 6 + index * REDUCED_MOTION_SLOT_PX;
            drawRoundedRect(ctx, column.x, markerY, column.width, 10, 3);
          }
        });
        ctx.globalAlpha = 1;
        return;
      }

      for (const note of visibleNotes) {
        const column = columnFor(note);
        if (!column) continue;
        const untilStart = note.startTime - currentTime;
        const untilEnd = note.startTime + note.duration - currentTime;
        const leadingY = height - (untilStart / LOOK_AHEAD_SECONDS) * height;
        const bodyHeight = Math.max(6, (note.duration / LOOK_AHEAD_SECONDS) * height);
        const top = Math.max(0, leadingY - bodyHeight);
        const bottom = Math.min(height, leadingY);
        if (bottom <= top) continue;
        const sounding = untilStart <= 0 && untilEnd > 0;
        const inputResult = lastInputFeedback?.actual.midi === note.midi ? lastInputFeedback.result : null;
        ctx.globalAlpha = sounding || inputResult ? 0.92 : 0.44;
        const barColor = inputResult === 'correct' ? tokens.correct
          : inputResult === 'wrong-note' ? tokens.wrong
            : inputResult === 'extra' ? tokens.extra
              : tokens.accent;
        const gradientFactory = ctx as CanvasRenderingContext2D & {
          createLinearGradient?: (x0: number, y0: number, x1: number, y1: number) => CanvasGradient;
        };
        if (gradientFactory.createLinearGradient) {
          const gradient = gradientFactory.createLinearGradient(0, top, 0, bottom);
          gradient.addColorStop(0, `${barColor}00`);
          gradient.addColorStop(0.28, barColor);
          gradient.addColorStop(1, barColor);
          ctx.fillStyle = gradient;
        } else {
          ctx.fillStyle = barColor;
        }
        ctx.shadowColor = barColor;
        ctx.shadowBlur = sounding ? 8 : 0;
        drawRoundedRect(ctx, column.x, top, column.width, bottom - top, Math.min(4, column.width / 2));
        ctx.shadowBlur = 0;
        // Crisp onset marker improves short-note recognition without changing
        // the actual timing or duration represented by the bar.
        ctx.globalAlpha = sounding ? 1 : 0.8;
        ctx.fillStyle = tokens.text;
        ctx.fillRect(column.x, Math.max(0, Math.min(height - 2, leadingY - 2)), column.width, 2);
      }
      ctx.globalAlpha = 1;
    };
    const frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [song, notes, visibleNotes, currentTime, reducedMotion, waiting, lastInputFeedback, resizeTick, layout]);

  const status = waiting
    ? `Waiting for ${formatNotes(visibleNotes)}`
    : currentNotes.length > 0
      ? `${activelyPlaying ? 'Playing' : 'Current target'} ${formatNotes(currentNotes)} · next ${formatNotes(nextNotes)}`
      : nextNotes.length > 0
        ? `Next ${formatNotes(nextNotes)}`
        : 'No upcoming notes';
  const feedbackStatus = lastInputFeedback
    ? `${lastInputFeedback.result === 'correct' ? 'Matched' : lastInputFeedback.result === 'wrong-note' ? 'Check pitch' : 'Extra input'} ${midiToNoteName(lastInputFeedback.actual.midi)}`
    : null;

  return (
    <section className="falling-notes" data-mode={fallingNotesMode} aria-label="Upcoming notes. Falling bars reach the line when it is time to play the matching key.">
      <div className="falling-notes__header">
        <span className="falling-notes__title">Upcoming notes</span>
        <span className="falling-notes__status" role="status" aria-live="polite">{status}</span>
        <span className="falling-notes__target" aria-hidden="true">NOW ↓</span>
      </div>
      <p className="falling-notes__hint">
        {feedbackStatus ?? (waiting ? 'Unfinished target keys stay at the timing line.' : 'Bars reach the line at the reference onset.')}
      </p>
      <canvas ref={canvasRef} className="falling-notes__canvas" aria-hidden="true" />
    </section>
  );
}
