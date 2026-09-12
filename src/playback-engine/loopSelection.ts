/** Pure Note Click Loop selection state machine (NCL-02..NCL-07, NCL-12). */

export const LOOP_SELECTION_TIMEOUT_MS = 10_000;

export interface LoopNoteRef {
  anchorId: string;
  sourceIds: string[];
  startTime: number;
  endTime: number;
}

export interface LoopRange {
  startTime: number;
  endTime: number;
  startRef: LoopNoteRef;
  endRef: LoopNoteRef;
}

export type LoopSelectionState =
  | { status: 'idle'; version: number }
  | { status: 'awaiting-second'; first: LoopNoteRef; deadline: number; version: number }
  | { status: 'looping'; range: LoopRange; version: number };

export function initialLoopSelection(): LoopSelectionState {
  return { status: 'idle', version: 0 };
}

function sameAnchor(a: LoopNoteRef, b: LoopNoteRef): boolean {
  return a.anchorId === b.anchorId || Math.abs(a.startTime - b.startTime) < 1e-6;
}

function orderedRange(a: LoopNoteRef, b: LoopNoteRef): LoopRange | null {
  const startRef = a.startTime <= b.startTime ? a : b;
  const endRef = startRef === a ? b : a;
  if (!(endRef.startTime > startRef.startTime)) return null;
  return { startTime: startRef.startTime, endTime: Math.max(startRef.startTime, endRef.endTime), startRef, endRef };
}

export function selectLoopNote(
  state: LoopSelectionState,
  note: LoopNoteRef,
  now: number,
  timeoutMs = LOOP_SELECTION_TIMEOUT_MS,
): LoopSelectionState {
  if (state.status === 'looping') {
    // Clicking either endpoint is harmless; a different valid note explicitly
    // exits the loop and leaves the playhead where the engine currently is.
    if (sameAnchor(state.range.startRef, note) || sameAnchor(state.range.endRef, note)) return state;
    return { status: 'idle', version: state.version + 1 };
  }
  if (state.status === 'awaiting-second') {
    if (now > state.deadline) {
      return { status: 'awaiting-second', first: note, deadline: now + timeoutMs, version: state.version + 1 };
    }
    if (sameAnchor(state.first, note)) return state;
    const range = orderedRange(state.first, note);
    if (!range) return state;
    return { status: 'looping', range, version: state.version + 1 };
  }
  return { status: 'awaiting-second', first: note, deadline: now + timeoutMs, version: state.version + 1 };
}

export function expireLoopSelection(state: LoopSelectionState, now: number): LoopSelectionState {
  if (state.status !== 'awaiting-second' || now <= state.deadline) return state;
  return { status: 'idle', version: state.version + 1 };
}

export function clearLoopSelection(state: LoopSelectionState): LoopSelectionState {
  return { status: 'idle', version: state.version + 1 };
}
