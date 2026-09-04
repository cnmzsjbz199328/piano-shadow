import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { isBlackKey, midiToNoteName, type NoteEvent } from '@/music-model';
import type { MatchType, NoteMatchResult } from '@/practice-engine';

/**
 * The Piano Roll (spec §2.3 / §11): time on the x-axis, pitch on the y-axis, a
 * pitch-aligned keyboard gutter, the current playhead, zoom, and — when a
 * completed attempt's `matches` are supplied — reference vs. learner note-level
 * result coloring. Canvas 2D (spec allows any performant canvas/WebGL renderer;
 * typical MVP song sizes render comfortably at 60fps without a heavier engine).
 */

interface PianoRollProps {
  reference: readonly NoteEvent[];
  learner?: readonly NoteEvent[];
  matches?: readonly NoteMatchResult[];
  currentTime: number;
  duration: number;
  height?: number;
}

const ROW_HEIGHT = 9;
const GUTTER_WIDTH = 34;
const MIN_PX_PER_SEC = 20;
const MAX_PX_PER_SEC = 300;
const DEFAULT_PX_PER_SEC = 90;

const RESULT_COLOR: Record<MatchType, string> = {
  correct: '#3ecf8e',
  'wrong-note': '#f2637a',
  missed: '#f2b84b',
  extra: '#b98cf0',
};

interface Block {
  x: number;
  y: number;
  w: number;
  h: number;
  note: NoteEvent;
  result?: MatchType;
  detail?: string;
}

function pitchRange(notes: readonly NoteEvent[]): [number, number] {
  if (notes.length === 0) return [60 - 12, 60 + 12];
  let min = Infinity;
  let max = -Infinity;
  for (const n of notes) {
    if (n.midi < min) min = n.midi;
    if (n.midi > max) max = n.midi;
  }
  const pad = 2;
  min -= pad;
  max += pad;
  if (max - min < 12) {
    const mid = (max + min) / 2;
    min = Math.floor(mid - 6);
    max = Math.ceil(mid + 6);
  }
  return [min, max];
}

function yForMidi(midi: number, maxMidi: number): number {
  return (maxMidi - midi) * ROW_HEIGHT;
}

export function PianoRoll({ reference, learner, matches, currentTime, duration, height }: PianoRollProps) {
  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SEC);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef<Block[]>([]);
  const [hover, setHover] = useState<{ x: number; y: number; block: Block } | null>(null);

  const allNotes = useMemo(() => [...reference, ...(learner ?? [])], [reference, learner]);
  const [minMidi, maxMidi] = useMemo(() => pitchRange(allNotes), [allNotes]);
  const rollHeight = height ?? (maxMidi - minMidi + 1) * ROW_HEIGHT;
  const width = Math.max(200, Math.ceil((duration + 2) * pxPerSecond));

  // --- draw ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = rollHeight * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${rollHeight}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, width, rollHeight);

    // row backgrounds
    for (let m = minMidi; m <= maxMidi; m++) {
      ctx.fillStyle = isBlackKey(m) ? '#141720' : '#10121880';
      ctx.fillRect(0, yForMidi(m, maxMidi), width, ROW_HEIGHT);
    }

    // second gridlines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let t = 0; t * pxPerSecond < width; t++) {
      const x = Math.round(t * pxPerSecond) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rollHeight);
      ctx.stroke();
    }

    const blocks: Block[] = [];

    function drawBlock(
      context: CanvasRenderingContext2D,
      note: NoteEvent,
      color: string,
      opacity: number,
      style: 'solid' | 'dashed',
      result?: MatchType,
    ) {
      const x = note.startTime * pxPerSecond;
      const y = yForMidi(note.midi, maxMidi) + 1;
      const w = Math.max(3, note.duration * pxPerSecond - 1);
      const h = ROW_HEIGHT - 2;
      context.globalAlpha = opacity;
      if (style === 'dashed') {
        context.setLineDash([3, 2]);
        context.strokeStyle = color;
        context.lineWidth = 1.5;
        context.strokeRect(x, y, w, h);
        context.setLineDash([]);
      } else {
        context.fillStyle = color;
        context.fillRect(x, y, w, h);
      }
      context.globalAlpha = 1;
      blocks.push({ x, y, w, h, note, result });
    }

    if (matches) {
      for (const m of matches) {
        if (m.result === 'missed' && m.expected) {
          drawBlock(ctx, m.expected, RESULT_COLOR.missed, 1, 'dashed', 'missed');
        } else if (m.result === 'extra' && m.actual) {
          drawBlock(ctx, m.actual, RESULT_COLOR.extra, 0.95, 'solid', 'extra');
        } else if (m.actual) {
          drawBlock(ctx, m.actual, RESULT_COLOR[m.result], 0.95, 'solid', m.result);
        }
      }
    } else {
      for (const n of reference) drawBlock(ctx, n, '#6ea8fe', 0.85, 'solid');
      if (learner) for (const n of learner) drawBlock(ctx, n, '#f2b84b', 0.55, 'solid');
    }

    blocksRef.current = blocks;

    // playhead
    if (currentTime >= 0) {
      const x = currentTime * pxPerSecond;
      ctx.strokeStyle = '#eef0f4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rollHeight);
      ctx.stroke();
    }
  }, [reference, learner, matches, minMidi, maxMidi, width, rollHeight, pxPerSecond, currentTime]);

  // --- auto-scroll to keep the playhead in view ---
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = currentTime * pxPerSecond;
    const margin = el.clientWidth * 0.25;
    if (x < el.scrollLeft + margin || x > el.scrollLeft + el.clientWidth - margin) {
      el.scrollLeft = Math.max(0, x - margin);
    }
  }, [currentTime, pxPerSecond]);

  function handleMouseMove(e: ReactMouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const block = blocksRef.current.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    setHover(block ? { x: e.clientX, y: e.clientY, block } : null);
  }

  return (
    <div className="piano-roll">
      <div className="piano-roll__toolbar">
        {matches && (
          <div className="btn-row" style={{ marginRight: 'auto', fontSize: '0.78rem', color: 'var(--text-dim)' }}>
            <span><span className="result-dot result-dot--correct" />Correct</span>
            <span><span className="result-dot result-dot--wrong-note" />Wrong note</span>
            <span><span className="result-dot result-dot--missed" />Missed</span>
            <span><span className="result-dot result-dot--extra" />Extra</span>
          </div>
        )}
        <button
          type="button"
          className="btn btn--icon"
          aria-label="Zoom out"
          onClick={() => setPxPerSecond((v) => Math.max(MIN_PX_PER_SEC, v - 20))}
        >
          −
        </button>
        <button
          type="button"
          className="btn btn--icon"
          aria-label="Zoom in"
          onClick={() => setPxPerSecond((v) => Math.min(MAX_PX_PER_SEC, v + 20))}
        >
          +
        </button>
      </div>
      <div style={{ display: 'flex' }}>
        <svg width={GUTTER_WIDTH} height={rollHeight} style={{ flexShrink: 0 }} aria-hidden>
          {Array.from({ length: maxMidi - minMidi + 1 }, (_, i) => minMidi + i).map((m) => {
            const y = yForMidi(m, maxMidi);
            const black = isBlackKey(m);
            return (
              <g key={m}>
                <rect x={0} y={y} width={GUTTER_WIDTH} height={ROW_HEIGHT} fill={black ? '#17191f' : '#e7e9ee'} stroke="#0b0d12" strokeWidth={0.5} />
                {m % 12 === 0 && (
                  <text x={3} y={y + ROW_HEIGHT - 1} fontSize={7} fill="#333">
                    {midiToNoteName(m)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <div className="piano-roll__scroll" ref={scrollRef}>
          <canvas
            ref={canvasRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHover(null)}
          />
        </div>
      </div>
      {hover && (
        <div
          className="piano-roll__tooltip"
          style={{ left: hover.x + 12, top: hover.y - 40, position: 'fixed' }}
        >
          <div>
            <strong>{hover.block.note.noteName}</strong> {hover.block.result ? `— ${hover.block.result}` : ''}
          </div>
          <div>onset {hover.block.note.startTime.toFixed(2)}s · dur {hover.block.note.duration.toFixed(2)}s</div>
        </div>
      )}
    </div>
  );
}
