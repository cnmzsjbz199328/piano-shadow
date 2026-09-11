import { describe, expect, it } from 'vitest';
import type { NoteEvent, Performance } from '@/music-model';
import { groupNotesByOnset, notesInLookAheadWindow, voiceFilteredNotes } from './referenceNotes';

function note(id: string, midi: number, startTime: number, hand?: 'left' | 'right', duration = 0.25): NoteEvent {
  return { id, midi, noteName: '', startTime, duration, source: 'midi-file', hand };
}

function song(notes: NoteEvent[]): Performance {
  return { id: 'fixture', name: 'Fixture', notes, duration: 2, sourceType: 'midi-file', createdAt: '' };
}

describe('shared reference-note selectors', () => {
  it('uses the selected hand everywhere and falls back when hand metadata is absent', () => {
    const notes = [note('l', 48, 0, 'left'), note('r', 60, 0, 'right')];
    expect(voiceFilteredNotes(song(notes), 'left').map((item) => item.id)).toEqual(['l']);
    expect(voiceFilteredNotes(song(notes), 'right').map((item) => item.id)).toEqual(['r']);
    expect(voiceFilteredNotes(song(notes.map(({ hand: _hand, ...item }) => item)), 'left')).toEqual(notes.map(({ hand: _hand, ...item }) => item));
  });

  it('keeps simultaneous chord events in one onset group, including duplicate pitches', () => {
    const groups = groupNotesByOnset([
      note('second', 64, 1.0008),
      note('first', 60, 1),
      note('duplicate', 60, 1.0005),
      note('arpeggio', 67, 1.02),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.notes.map((item) => item.id)).toEqual(['first', 'duplicate', 'second']);
    expect(groups[1]!.notes.map((item) => item.id)).toEqual(['arpeggio']);
  });

  it('keeps a sustain crossing the window boundary while excluding distant notes', () => {
    const visible = notesInLookAheadWindow([
      note('sustain', 48, -10, undefined, 11),
      note('near', 60, 2.49),
      note('far', 64, 2.51),
    ], 0);
    expect(visible.map((item) => item.id)).toEqual(['sustain', 'near']);
  });
});
