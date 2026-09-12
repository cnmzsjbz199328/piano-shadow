import { isBlackKey } from '@/music-model';

/**
 * Pure, React-free key geometry for the virtual piano keyboard.
 *
 * All x-coordinates and dimensions here are in the SAME units as the SVG
 * `viewBox` rendered by `PianoKeyboard.tsx` (`0 0 totalWidth WHITE_HEIGHT`).
 * The SVG is drawn fluidly (`width="100%"`, `preserveAspectRatio="none"`) so it
 * scales to the viewport, but the coordinate space is unchanged — a consumer
 * that wants pixel x-positions multiplies by `renderedWidth / totalWidth`.
 *
 * This module is deliberately free of React and DOM imports so other layers
 * (e.g. a falling-notes canvas) can share the exact key x-positions.
 */

/** White-key width in viewBox units (52 white keys × 26 = 1352 for the 88-key default). */
export const WHITE_WIDTH = 26;
/** Black-key width in viewBox units. */
export const BLACK_WIDTH = 16;
/** Full keyboard height in viewBox units. */
export const WHITE_HEIGHT = 130;
/** Black-key height in viewBox units. */
export const BLACK_HEIGHT = 82;
/** Reserved strip above the keys for current/next target note-name labels. */
export const LABEL_ROW_HEIGHT = 13;

export interface KeyLayout {
  whites: Array<{ midi: number; x: number }>;
  blacks: Array<{ midi: number; x: number }>;
  totalWidth: number;
}

export function buildKeyLayout(low: number, high: number): KeyLayout {
  const whites: KeyLayout['whites'] = [];
  for (let m = low, i = 0; m <= high; m++) {
    if (!isBlackKey(m)) {
      whites.push({ midi: m, x: i * WHITE_WIDTH });
      i++;
    }
  }
  const whiteByMidi = new Map(whites.map((w) => [w.midi, w]));
  const blacks: KeyLayout['blacks'] = [];
  for (let m = low; m <= high; m++) {
    if (!isBlackKey(m)) continue;
    const prevWhite = whiteByMidi.get(m - 1);
    if (prevWhite) blacks.push({ midi: m, x: prevWhite.x + WHITE_WIDTH - BLACK_WIDTH / 2 });
  }
  return { whites, blacks, totalWidth: whites.length * WHITE_WIDTH };
}

/** White-key x-centre for a pitch (falls back to the nearest lower white key). */
export function centreXForMidi(layout: KeyLayout, midi: number): number | null {
  const target = isBlackKey(midi) ? midi - 1 : midi;
  const white = layout.whites.find((w) => w.midi === target) ?? layout.whites.find((w) => w.midi >= target);
  return white ? white.x + WHITE_WIDTH / 2 : null;
}
