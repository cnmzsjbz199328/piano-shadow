import { Midi } from '@tonejs/midi';
import type { Performance } from '@/music-model';

/** Serialize the canonical performance model back to a Standard MIDI File. */
export function writeMidiFile(performance: Performance): Uint8Array {
  const midi = new Midi();
  const firstTempo = performance.tempoMap?.[0];
  if (firstTempo) midi.header.setTempo(firstTempo.bpm);
  const track = midi.addTrack();
  track.name = performance.name;
  for (const note of performance.notes) {
    track.addNote({
      midi: note.midi,
      time: note.startTime,
      duration: note.duration,
      velocity: (note.velocity ?? 100) / 127,
    });
  }
  return midi.toArray();
}
