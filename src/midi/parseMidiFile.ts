import { Midi } from '@tonejs/midi';
import {
  buildPerformance,
  performanceDuration,
  type Performance,
  type TempoPoint,
  type TimeSignaturePoint,
} from '@/music-model';

export class MidiImportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MidiImportError';
  }
}

export interface ParseMidiOptions {
  /** Falls back to the embedded SMF track/file name, then "Imported MIDI". */
  name?: string;
  id?: string;
}

/**
 * Parse a Standard MIDI File into the canonical `Performance` model (spec §2.1).
 *
 * Extracts: MIDI number, note name, onset, duration, velocity, track, channel,
 * and the tempo / time-signature maps. All timing is normalized to seconds from
 * the start of the performance.
 */
export function parseMidiFile(data: ArrayBuffer | Uint8Array, options: ParseMidiOptions = {}): Performance {
  let midi: Midi;
  try {
    midi = new Midi(data instanceof Uint8Array ? data : new Uint8Array(data));
  } catch (err) {
    throw new MidiImportError('This file could not be read as a Standard MIDI File.', { cause: err });
  }

  const rawNotes = midi.tracks.flatMap((track, trackIndex) =>
    track.notes.map((note) => ({
      midi: note.midi,
      startTime: note.time,
      duration: note.duration,
      velocity: Math.round(note.velocity * 127),
      channel: track.channel,
      track: trackIndex,
    })),
  );

  if (rawNotes.length === 0) {
    throw new MidiImportError('This MIDI file contains no playable notes.');
  }

  const tempoMap: TempoPoint[] = midi.header.tempos
    .map((t) => ({ time: t.time ?? 0, bpm: t.bpm }))
    .sort((a, b) => a.time - b.time);
  if (tempoMap.length === 0) tempoMap.push({ time: 0, bpm: 120 });

  const timeSignatureMap: TimeSignaturePoint[] = midi.header.timeSignatures.map((ts) => ({
    time: ts.ticks ? midi.header.ticksToSeconds(ts.ticks) : 0,
    numerator: ts.timeSignature[0] ?? 4,
    denominator: ts.timeSignature[1] ?? 4,
  }));

  const name =
    options.name?.trim() ||
    midi.name?.trim() ||
    midi.tracks.find((t) => t.name?.trim())?.name?.trim() ||
    'Imported MIDI';

  const performance = buildPerformance(rawNotes, {
    name,
    id: options.id,
    source: 'midi-file',
    idPrefix: 'ref',
    tempoMap,
    timeSignatureMap: timeSignatureMap.length > 0 ? timeSignatureMap : undefined,
  });

  // Honour an explicit SMF end-of-track / duration if it is longer than the last note.
  performance.duration = Math.max(performance.duration, performanceDuration(performance.notes), midi.duration || 0);
  return performance;
}
