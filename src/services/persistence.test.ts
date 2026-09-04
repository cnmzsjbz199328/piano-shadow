import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveSong,
  listSongs,
  getSong,
  deleteSong,
  saveAttempt,
  listAttempts,
  getAttempt,
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  _resetForTests,
} from './persistence';
import { buildPerformance } from '@/music-model';
import { evaluatePerformance } from '@/practice-engine';

function demoPerformance(name: string) {
  return buildPerformance(
    [
      { midi: 60, startTime: 0, duration: 0.4 },
      { midi: 62, startTime: 0.5, duration: 0.4 },
    ],
    { name, source: 'midi-file' },
  );
}

beforeEach(async () => {
  await _resetForTests();
});

describe('songs', () => {
  it('saves and lists songs, most recently saved first', async () => {
    const a = demoPerformance('A');
    const b = demoPerformance('B');
    await saveSong(a);
    await saveSong(b);
    const list = await listSongs();
    expect(list.map((s) => s.performance.name)).toEqual(['B', 'A']);
  });

  it('round-trips a song by id and supports deletion', async () => {
    const perf = demoPerformance('Round trip');
    await saveSong(perf, true);
    const found = await getSong(perf.id);
    expect(found?.performance.notes).toEqual(perf.notes);
    expect(found?.isDemo).toBe(true);

    await deleteSong(perf.id);
    expect(await getSong(perf.id)).toBeUndefined();
  });
});

describe('attempts', () => {
  it('saves an attempt with its score result and can list it back by song', async () => {
    const song = demoPerformance('Song');
    await saveSong(song);
    const learner = demoPerformance('Attempt');
    const result = evaluatePerformance(song.notes, learner.notes);

    const saved = await saveAttempt({
      songId: song.id,
      songName: song.name,
      mode: 'play-along',
      learnerPerformance: learner,
      result,
    });

    const bySong = await listAttempts(song.id);
    expect(bySong).toHaveLength(1);
    expect(bySong[0]!.id).toBe(saved.id);
    expect(bySong[0]!.result.scores).toEqual(result.scores);

    const fetched = await getAttempt(saved.id);
    expect(fetched?.songName).toBe('Song');
  });

  it('lists all attempts, most recent first, when no songId is given', async () => {
    const song = demoPerformance('Song');
    const perf = evaluatePerformance(song.notes, song.notes);
    const first = await saveAttempt({ songId: song.id, songName: song.name, mode: 'listen', learnerPerformance: song, result: perf });
    await new Promise((r) => setTimeout(r, 2));
    const second = await saveAttempt({ songId: song.id, songName: song.name, mode: 'listen', learnerPerformance: song, result: perf });
    const all = await listAttempts();
    expect(all.map((a) => a.id)).toEqual([second.id, first.id]);
  });
});

describe('settings', () => {
  it('returns defaults when nothing has been saved', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('persists a partial patch merged onto the current settings', async () => {
    await saveSettings({ tempoScale: 0.75 });
    await saveSettings({ lastMidiInputId: 'dev-1' });
    const settings = await loadSettings();
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, tempoScale: 0.75, lastMidiInputId: 'dev-1' });
  });
});
