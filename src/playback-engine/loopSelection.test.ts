import { describe, expect, it } from 'vitest';
import { clearLoopSelection, expireLoopSelection, initialLoopSelection, selectLoopNote, type LoopNoteRef } from './loopSelection';

const ref = (anchorId: string, startTime: number, endTime = startTime + 0.5): LoopNoteRef => ({ anchorId, sourceIds: [anchorId], startTime, endTime });

describe('note click loop selection', () => {
  it.each([9_999, 10_000])('accepts a second point at %sms', (elapsed) => {
    let state = selectLoopNote(initialLoopSelection(), ref('a', 2), 100);
    state = selectLoopNote(state, ref('b', 4), 100 + elapsed);
    expect(state.status).toBe('looping');
    if (state.status === 'looping') expect(state.range).toMatchObject({ startTime: 2, endTime: 4.5 });
  });
  it('treats a click after 10 seconds as a new first point', () => {
    let state = selectLoopNote(initialLoopSelection(), ref('a', 2), 100);
    state = selectLoopNote(state, ref('b', 4), 10_100.001);
    expect(state.status).toBe('awaiting-second');
    if (state.status === 'awaiting-second') expect(state.first.anchorId).toBe('b');
  });
  it('does not refresh the deadline or create a zero-length range for duplicates', () => {
    const first = ref('a', 2);
    let state = selectLoopNote(initialLoopSelection(), first, 100);
    const deadline = state.status === 'awaiting-second' ? state.deadline : 0;
    state = selectLoopNote(state, first, 105);
    expect(state.status).toBe('awaiting-second');
    if (state.status === 'awaiting-second') expect(state.deadline).toBe(deadline);
    expect(selectLoopNote(state, ref('same-onset', 2.0000001), 106).status).toBe('awaiting-second');
  });
  it('orders reverse selections and includes the end note duration', () => {
    let state = selectLoopNote(initialLoopSelection(), ref('late', 8, 9), 0);
    state = selectLoopNote(state, ref('early', 3, 3.75), 1);
    expect(state.status).toBe('looping');
    if (state.status === 'looping') expect(state.range).toMatchObject({ startTime: 3, endTime: 9 });
  });
  it('keeps endpoint clicks inert but exits on a different third note', () => {
    let state = selectLoopNote(initialLoopSelection(), ref('a', 0), 0);
    state = selectLoopNote(state, ref('b', 2), 1);
    state = selectLoopNote(state, ref('b', 2), 2);
    expect(state.status).toBe('looping');
    state = selectLoopNote(state, ref('c', 4), 3);
    expect(state.status).toBe('idle');
  });
  it('expires only after the strict deadline and invalidates old versions', () => {
    const state = selectLoopNote(initialLoopSelection(), ref('a', 0), 0);
    expect(expireLoopSelection(state, 10_000)).toBe(state);
    expect(expireLoopSelection(state, 10_000.001).status).toBe('idle');
    expect(clearLoopSelection(state)).toMatchObject({ status: 'idle', version: 2 });
  });
});
