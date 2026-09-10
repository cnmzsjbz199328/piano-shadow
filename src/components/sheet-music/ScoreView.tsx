import { useEffect, useMemo, useRef, useState } from 'react';
import type { Accidental, RenderContext, Stave, StaveConnector, StaveNote } from 'vexflow';
import type { NoteEvent, Performance } from '@/music-model';
import { gridSecondsFor, quantizeNotes } from '@/quantization';
import { useAppStore } from '@/stores/useAppStore';
import {
  decomposeRest,
  noteValueSeconds,
  secondsPerQuarter,
  secondsToNoteValue,
  type NoteValueCode,
} from './secondsToNoteValue';

/**
 * Staff-notation view (Track F, v0.8.0). Renders standard notation for an
 * **imported-MIDI** `Performance` with `vexflow`, strictly within the
 * signed-off scope in `doc/ARCHITECTURE.md` ("Staff-notation view — scope"):
 *
 *   - Input is an imported-MIDI `Performance` only (`sourceType === 'midi-file'`);
 *     those carry authored durations + a `tempoMap` / `timeSignatureMap`.
 *   - Recorded / recognised takes are refused with a fixed message — no guessing.
 *   - Display-only: it only *reads* `song` from the store, never writes back,
 *     and offers no editing / drag / export.
 *   - Not the primary surface: mounted behind a collapsed toggle on PracticePage.
 *
 * APPROXIMATE RHYTHM (documented limitation): note onsets and durations are
 * snapped to a 1/16 grid by reusing `quantization/quantize.ts`, then each note
 * is shown as the single nearest plain value from {1/1, 1/2, 1/4, 1/8, 1/16}.
 * No dotted values, tuplets, ties, key-signature spelling (sharps only), or
 * voice separation — so a bar's symbols may not sum to its exact length. This
 * is a readable approximation, not a faithful transcription.
 */

/** Refusal copy is fixed by the scope note — do not localise here. */
const REFUSAL_MESSAGE =
  'Notation needs a quantised rhythm — not available for recorded takes yet.';

/**
 * Keep the render bounded — still no pagination/engraving. Raised from 16 now
 * that `ScoreSurface` gives the staves their own vertical scroll viewport
 * (UI_OPTIMIZATION_PLAN.md §5.3): a longer piece scrolls instead of being
 * squeezed, but the cap stays finite so one enormous import can't lock the tab.
 */
const MAX_MEASURES = 64;
/** Treble vs. bass split point (middle C). Imported MIDI has no `hand` yet. */
const MIDDLE_C = 60;
/** Sixteenth-note grid: quarter beat / 4. */
const GRID_SUBDIVISION = 4;
const FALLBACK_WIDTH = 900;

const SHARP_SPELLING = [
  'c',
  'c#',
  'd',
  'd#',
  'e',
  'f',
  'f#',
  'g',
  'g#',
  'a',
  'a#',
  'b',
] as const;

function midiToVexKey(midi: number): { key: string; accidental: string | null } {
  const clamped = Math.max(0, Math.min(127, Math.round(midi)));
  const pitchClass = ((clamped % 12) + 12) % 12;
  const name = SHARP_SPELLING[pitchClass] ?? 'c';
  const octave = Math.floor(clamped / 12) - 1;
  return { key: `${name}/${octave}`, accidental: name.length > 1 ? '#' : null };
}

interface Tick {
  isRest: boolean;
  keys: string[];
  duration: NoteValueCode;
  accidentals: Array<string | null>;
  /** Reference-timeline span represented by this rendered note/chord. */
  startTime?: number;
  endTime?: number;
}

interface Measure {
  treble: Tick[];
  bass: Tick[];
}

interface ScoreModel {
  measures: Measure[];
  bpm: number;
  numerator: number;
  denominator: number;
  timeSignature: string;
  truncated: boolean;
}

/** A rest position that reads cleanly on each clef. */
function restKeyFor(clef: 'treble' | 'bass'): string {
  return clef === 'treble' ? 'b/4' : 'd/3';
}

function restTicks(seconds: number, bpm: number, clef: 'treble' | 'bass'): Tick[] {
  return decomposeRest(seconds, bpm).map((duration) => ({
    isRest: true,
    keys: [restKeyFor(clef)],
    duration,
    accidentals: [null],
  }));
}

function buildClefMeasure(
  clefNotes: NoteEvent[],
  measureStart: number,
  measureEnd: number,
  bpm: number,
  gridSeconds: number,
  clef: 'treble' | 'bass',
): Tick[] {
  const epsilon = gridSeconds * 0.5;
  const inMeasure = clefNotes
    .filter((n) => n.startTime >= measureStart - epsilon && n.startTime < measureEnd - epsilon)
    .sort((a, b) => a.startTime - b.startTime || a.midi - b.midi);

  if (inMeasure.length === 0) {
    // A single bar-filling rest reads as an empty measure on any time signature.
    return [{ isRest: true, keys: [restKeyFor(clef)], duration: '1', accidentals: [null] }];
  }

  // Collapse notes that start on (near) the same grid slot into one chord.
  const groups: Array<{ onset: number; notes: NoteEvent[] }> = [];
  for (const note of inMeasure) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(note.startTime - last.onset) <= epsilon) {
      last.notes.push(note);
    } else {
      groups.push({ onset: note.startTime, notes: [note] });
    }
  }

  const ticks: Tick[] = [];
  let position = measureStart;

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (!group) continue;
    const nextOnset = groups[index + 1]?.onset ?? measureEnd;

    if (group.onset - position > epsilon) {
      ticks.push(...restTicks(group.onset - position, bpm, clef));
    }

    // The chord's own longest note, clipped so it never overruns the next onset
    // or the barline, then floored to one grid step and bucketed to a plain
    // value. `position` then advances by that *shown* value so a note shorter
    // than the gap to the next onset leaves a rest behind it.
    const rawDuration = Math.max(...group.notes.map((n) => n.duration));
    const shownDuration = Math.max(
      gridSeconds,
      Math.min(rawDuration, nextOnset - group.onset, measureEnd - group.onset),
    );
    const value = secondsToNoteValue(shownDuration, bpm);
    const sorted = [...group.notes].sort((a, b) => a.midi - b.midi);
    ticks.push({
      isRest: false,
      keys: sorted.map((n) => midiToVexKey(n.midi).key),
      duration: value,
      accidentals: sorted.map((n) => midiToVexKey(n.midi).accidental),
      startTime: group.onset,
      // Use the source span rather than the shortened engraving duration. A
      // note can overlap the next onset in MIDI, and it should remain active
      // for the whole sounding interval even when the approximate notation
      // clips its displayed value.
      endTime: Math.max(...group.notes.map((n) => n.startTime + n.duration)),
    });

    position = group.onset + noteValueSeconds(value, bpm);
  }

  if (measureEnd - position > epsilon) {
    ticks.push(...restTicks(measureEnd - position, bpm, clef));
  }
  if (ticks.length === 0) {
    ticks.push({ isRest: true, keys: [restKeyFor(clef)], duration: '1', accidentals: [null] });
  }
  return ticks;
}

function buildScoreModel(song: Performance): ScoreModel | null {
  if (song.notes.length === 0) return null;

  const bpm = song.tempoMap?.[0]?.bpm ?? 120;
  const signature = song.timeSignatureMap?.[0];
  const numerator = signature?.numerator && signature.numerator > 0 ? signature.numerator : 4;
  const denominator =
    signature?.denominator && signature.denominator > 0 ? signature.denominator : 4;

  const gridSeconds = gridSecondsFor(bpm, GRID_SUBDIVISION);
  const quantized = quantizeNotes(song.notes, { gridSeconds, strength: 1 })
    .filter((n) => n.duration > 0)
    .sort((a, b) => a.startTime - b.startTime || a.midi - b.midi);
  if (quantized.length === 0) return null;

  const quarterBeatsPerMeasure = numerator * (4 / denominator);
  const measureSeconds = quarterBeatsPerMeasure * secondsPerQuarter(bpm);
  if (!(measureSeconds > 0)) return null;

  const span = Math.max(
    song.duration,
    ...quantized.map((n) => n.startTime + n.duration),
  );
  const neededMeasures = Math.max(1, Math.ceil(span / measureSeconds - 1e-6));
  const measureCount = Math.min(MAX_MEASURES, neededMeasures);

  const treble = quantized.filter((n) => n.midi >= MIDDLE_C);
  const bass = quantized.filter((n) => n.midi < MIDDLE_C);

  const measures: Measure[] = [];
  for (let m = 0; m < measureCount; m += 1) {
    const start = m * measureSeconds;
    const end = start + measureSeconds;
    measures.push({
      treble: buildClefMeasure(treble, start, end, bpm, gridSeconds, 'treble'),
      bass: buildClefMeasure(bass, start, end, bpm, gridSeconds, 'bass'),
    });
  }

  return {
    measures,
    bpm,
    numerator,
    denominator,
    timeSignature: `${numerator}/${denominator}`,
    truncated: neededMeasures > MAX_MEASURES,
  };
}

function readInk(): string {
  if (typeof window === 'undefined') return '#e9e9ee';
  const value = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
  return value || '#e9e9ee';
}

/**
 * The slice of `vexflow`'s runtime module we use, described structurally so the
 * dynamic `import('vexflow')` needs no `import()` type annotation. Instance
 * shapes come from `vexflow`'s own exported class types.
 */
interface VexModule {
  Renderer: {
    new (element: HTMLElement, backend: number): {
      resize(width: number, height: number): unknown;
      getContext(): RenderContext;
    };
    Backends: { SVG: number; CANVAS: number };
  };
  Stave: { new (x: number, y: number, width: number): Stave };
  StaveNote: {
    new (struct: { keys: string[]; duration: string; clef?: string }): StaveNote;
  };
  Accidental: { new (type: string): Accidental };
  StaveConnector: { new (top: Stave, bottom: Stave): StaveConnector };
  Formatter: {
    FormatAndDraw(
      ctx: RenderContext,
      stave: Stave,
      notes: StaveNote[],
      params?: { alignRests?: boolean; autoBeam?: boolean },
    ): unknown;
  };
}

interface RenderedScoreNote {
  element: SVGElement;
  startTime: number;
  endTime: number;
}

interface RenderedScore {
  notes: RenderedScoreNote[];
}

function isHighlightableTransportState(state: string): boolean {
  return state === 'playing' || state === 'counting-in' || state === 'paused';
}

function updateScoreHighlight(
  rendered: RenderedScore | null,
  currentTime: number,
  transportState: string,
  previousActiveIndex: number | null,
): number | null {
  if (!rendered) return null;

  const canHighlight = isHighlightableTransportState(transportState);
  let activeIndex: number | null = null;
  rendered.notes.forEach((note, index) => {
    const active =
      canHighlight && currentTime >= note.startTime - 0.02 && currentTime < note.endTime;
    note.element.classList.toggle('score-note--active', active);
    if (active && activeIndex === null) activeIndex = index;
  });

  if (activeIndex !== null && activeIndex !== previousActiveIndex) {
    rendered.notes[activeIndex]?.element.scrollIntoView?.({
      block: 'center',
      inline: 'nearest',
      behavior: 'smooth',
    });
  }
  return activeIndex;
}

function drawVoice(
  VF: VexModule,
  ctx: RenderContext,
  stave: Stave,
  ticks: Tick[],
  ink: string,
  clef: 'treble' | 'bass',
): RenderedScoreNote[] {
  const staveNotes = ticks.map((tick) => {
    const staveNote = new VF.StaveNote({
      keys: tick.keys,
      duration: tick.isRest ? `${tick.duration}r` : tick.duration,
      clef,
    });
    staveNote.setStyle({ fillStyle: ink, strokeStyle: ink });
    if (!tick.isRest) {
      tick.accidentals.forEach((accidental, i) => {
        if (accidental) staveNote.addModifier(new VF.Accidental(accidental), i);
      });
    }
    return staveNote;
  });
  if (staveNotes.length === 0) return [];
  // FormatAndDraw builds a SOFT-mode Voice internally, so an approximate bar
  // that does not sum to its exact length still renders instead of throwing.
  VF.Formatter.FormatAndDraw(ctx, stave, staveNotes, { alignRests: true });

  return staveNotes.flatMap((staveNote, index) => {
    const tick = ticks[index];
    if (!tick || tick.isRest || tick.startTime === undefined || tick.endTime === undefined) {
      return [];
    }
    const element = staveNote.getSVGElement();
    return element ? [{ element, startTime: tick.startTime, endTime: tick.endTime }] : [];
  });
}

function renderScore(
  VF: VexModule,
  host: HTMLDivElement,
  model: ScoreModel,
  containerWidth: number,
  ink: string,
): RenderedScore {
  host.replaceChildren();

  const width = Math.max(320, containerWidth || FALLBACK_WIDTH);
  const pad = 10;
  const clefExtra = 64;
  const trebleY = 0;
  const bassY = 92;
  const rowHeight = 210;

  const measuresPerRow = Math.max(1, Math.min(4, Math.floor((width - pad * 2) / 260)));
  const rowCount = Math.ceil(model.measures.length / measuresPerRow);
  const usableWidth = width - pad * 2;
  const totalHeight = rowCount * rowHeight + pad * 2;

  const renderer = new VF.Renderer(host, VF.Renderer.Backends.SVG);
  renderer.resize(width, totalHeight);
  const ctx = renderer.getContext();
  ctx.setFillStyle(ink);
  ctx.setStrokeStyle(ink);

  const renderedNotes: RenderedScoreNote[] = [];

  for (let row = 0; row < rowCount; row += 1) {
    const rowMeasures = model.measures.slice(
      row * measuresPerRow,
      row * measuresPerRow + measuresPerRow,
    );
    const perMeasureWidth = (usableWidth - clefExtra) / rowMeasures.length;
    const rowTop = pad + row * rowHeight;
    let x = pad;

    for (let mi = 0; mi < rowMeasures.length; mi += 1) {
      const measure = rowMeasures[mi];
      if (!measure) continue;
      const isRowStart = mi === 0;
      const staveWidth = isRowStart ? perMeasureWidth + clefExtra : perMeasureWidth;

      const treble = new VF.Stave(x, rowTop + trebleY, staveWidth);
      const bass = new VF.Stave(x, rowTop + bassY, staveWidth);
      treble.setStyle({ fillStyle: ink, strokeStyle: ink });
      bass.setStyle({ fillStyle: ink, strokeStyle: ink });

      if (isRowStart) {
        treble.addClef('treble');
        bass.addClef('bass');
        if (row === 0) {
          treble.addTimeSignature(model.timeSignature);
          bass.addTimeSignature(model.timeSignature);
        }
      }

      treble.setContext(ctx).draw();
      bass.setContext(ctx).draw();

      if (isRowStart) {
        new VF.StaveConnector(treble, bass).setType('brace').setContext(ctx).draw();
        new VF.StaveConnector(treble, bass).setType('singleLeft').setContext(ctx).draw();
      }
      if (mi === rowMeasures.length - 1) {
        new VF.StaveConnector(treble, bass).setType('singleRight').setContext(ctx).draw();
      }

      try {
        renderedNotes.push(...drawVoice(VF, ctx, treble, measure.treble, ink, 'treble'));
        renderedNotes.push(...drawVoice(VF, ctx, bass, measure.bass, ink, 'bass'));
      } catch {
        // One malformed bar must not blank the whole score; leave the empty
        // stave drawn above and carry on.
      }

      x += staveWidth;
    }
  }

  // Keep the mapping on the rendered SVG instead of rebuilding the notation
  // on every transport tick. CSS can then recolour the whole VexFlow group
  // (notehead, stem, flag and accidental) as one visual unit.
  renderedNotes.forEach(({ element }, index) => {
    element.classList.add('score-note');
    element.dataset.scoreNoteIndex = String(index);
  });

  return { notes: renderedNotes };
}

export function ScoreView() {
  const song = useAppStore((s) => s.song);
  const currentTime = useAppStore((s) => (s as { currentTime?: number }).currentTime ?? 0);
  const transportState = useAppStore(
    (s) => (s as { transportState?: string }).transportState ?? 'idle',
  );
  const hostRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [renderFailed, setRenderFailed] = useState(false);
  const renderedScoreRef = useRef<RenderedScore | null>(null);
  const lastActiveIndexRef = useRef<number | null>(null);
  const playbackRef = useRef({ currentTime, transportState });
  playbackRef.current = { currentTime, transportState };

  const eligible = song != null && song.sourceType === 'midi-file';
  const model = useMemo(
    () => (eligible && song ? buildScoreModel(song) : null),
    [eligible, song],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    setContainerWidth(host.clientWidth);
    const observer = new ResizeObserver(() => setContainerWidth(host.clientWidth));
    observer.observe(host);
    return () => observer.disconnect();
  }, [eligible]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    if (!model) {
      host.replaceChildren();
      renderedScoreRef.current = null;
      lastActiveIndexRef.current = null;
      setRenderFailed(false);
      return;
    }

    let cancelled = false;
    setRenderFailed(false);

    void (async () => {
      try {
        // Dynamic import keeps ~0.5 MB of VexFlow out of the initial bundle —
        // notation is opt-in and collapsed by default. Narrowed to the
        // structural `VexModule` at this single boundary.
        const VF = (await import('vexflow')) as unknown as VexModule;
        if (cancelled) return;
        renderedScoreRef.current = renderScore(
          VF,
          host,
          model,
          containerWidth || host.clientWidth,
          readInk(),
        );
        lastActiveIndexRef.current = updateScoreHighlight(
          renderedScoreRef.current,
          playbackRef.current.currentTime,
          playbackRef.current.transportState,
          null,
        );
      } catch {
        if (!cancelled) {
          host.replaceChildren();
          renderedScoreRef.current = null;
          setRenderFailed(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [model, containerWidth]);

  // The playback engine already advances currentTime from Tone.Transport. This
  // effect only toggles classes on the existing SVG, so highlighting remains
  // cheap even for a long score.
  useEffect(() => {
    const rendered = renderedScoreRef.current;
    if (!rendered) return;

    lastActiveIndexRef.current = updateScoreHighlight(
      rendered,
      currentTime,
      transportState,
      lastActiveIndexRef.current,
    );
  }, [currentTime, transportState]);

  if (!eligible) {
    return (
      <div className="score-view score-view--empty">
        <p>{REFUSAL_MESSAGE}</p>
      </div>
    );
  }

  return (
    <div className="score-view">
      {renderFailed && (
        <p className="score-view__fallback">
          Notation couldn’t be rendered in this browser — the keyboard and piano roll are
          unaffected.
        </p>
      )}
      {!renderFailed && !model && (
        <p className="score-view__note">This song has no notes to display.</p>
      )}
      <div
        ref={hostRef}
        className="score-view__host"
        role="img"
        aria-label={`Staff notation for ${song?.name ?? 'the current song'}`}
      />
      {model?.truncated && (
        <p className="score-view__note">Showing the first {MAX_MEASURES} bars.</p>
      )}
      {model && (
        <p className="score-view__note">
          Approximate rhythm at {Math.round(model.bpm)} bpm, {model.timeSignature}: onsets
          snapped to a 1/16 grid, each note shown as the nearest of 1/1–1/16 (no dotted
          values, tuplets, ties, or key-signature spelling).
        </p>
      )}
    </div>
  );
}
