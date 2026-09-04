import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { randomId, type Performance } from '@/music-model';
import type { EvaluationResult } from '@/practice-engine';

/**
 * Local persistence (spec §18): imported songs, practice attempts + score
 * summaries, and user settings (last MIDI input, playback speed, …). IndexedDB,
 * no login, no cloud — everything lives in the browser.
 */

export type PracticeMode = 'listen' | 'play-along' | 'wait';

export interface SongRecord {
  id: string;
  performance: Performance;
  savedAt: string;
  isDemo: boolean;
}

export interface AttemptRecord {
  id: string;
  songId: string;
  songName: string;
  mode: PracticeMode;
  learnerPerformance: Performance;
  result: EvaluationResult;
  createdAt: string;
}

export interface SettingsRecord {
  tempoScale: number;
  metronomeEnabled: boolean;
  countInEnabled: boolean;
  lastMidiInputId: string | null;
  showDebugPanel: boolean;
}

interface PianoShadowDB extends DBSchema {
  songs: { key: string; value: SongRecord; indexes: { savedAt: string } };
  attempts: { key: string; value: AttemptRecord; indexes: { songId: string; createdAt: string } };
  settings: { key: string; value: SettingsRecord & { id: 'settings' } };
}

const DB_NAME = 'piano-shadow';
const DB_VERSION = 1;
const SETTINGS_KEY = 'settings' as const;

export const DEFAULT_SETTINGS: SettingsRecord = {
  tempoScale: 1,
  metronomeEnabled: false,
  countInEnabled: true,
  lastMidiInputId: null,
  showDebugPanel: false,
};

let dbPromise: Promise<IDBPDatabase<PianoShadowDB>> | null = null;

function getDb(): Promise<IDBPDatabase<PianoShadowDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PianoShadowDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const songs = db.createObjectStore('songs', { keyPath: 'id' });
        songs.createIndex('savedAt', 'savedAt');
        const attempts = db.createObjectStore('attempts', { keyPath: 'id' });
        attempts.createIndex('songId', 'songId');
        attempts.createIndex('createdAt', 'createdAt');
        db.createObjectStore('settings', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

/** Test-only: drop the cached connection and wipe the database so each test starts clean. */
export async function _resetForTests(): Promise<void> {
  const hadConnection = dbPromise !== null;
  if (hadConnection) (await dbPromise!).close();
  dbPromise = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

// --- songs ---

export async function saveSong(performance: Performance, isDemo = false): Promise<SongRecord> {
  const db = await getDb();
  const record: SongRecord = { id: performance.id, performance, savedAt: new Date().toISOString(), isDemo };
  await db.put('songs', record);
  return record;
}

export async function listSongs(): Promise<SongRecord[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('songs', 'savedAt');
  return all.reverse(); // most recently saved first
}

export async function getSong(id: string): Promise<SongRecord | undefined> {
  const db = await getDb();
  return db.get('songs', id);
}

export async function deleteSong(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('songs', id);
}

// --- attempts ---

export async function saveAttempt(
  input: Omit<AttemptRecord, 'id' | 'createdAt'>,
): Promise<AttemptRecord> {
  const db = await getDb();
  const record: AttemptRecord = { ...input, id: randomId('attempt'), createdAt: new Date().toISOString() };
  await db.put('attempts', record);
  return record;
}

export async function listAttempts(songId?: string): Promise<AttemptRecord[]> {
  const db = await getDb();
  const all = songId ? await db.getAllFromIndex('attempts', 'songId', songId) : await db.getAll('attempts');
  return [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // most recent first
}

export async function getAttempt(id: string): Promise<AttemptRecord | undefined> {
  const db = await getDb();
  return db.get('attempts', id);
}

// --- settings ---

export async function loadSettings(): Promise<SettingsRecord> {
  const db = await getDb();
  const existing = await db.get('settings', SETTINGS_KEY);
  if (!existing) return DEFAULT_SETTINGS;
  const { id: _id, ...settings } = existing;
  return settings;
}

export async function saveSettings(patch: Partial<SettingsRecord>): Promise<SettingsRecord> {
  const db = await getDb();
  const current = await loadSettings();
  const next: SettingsRecord = { ...current, ...patch };
  await db.put('settings', { id: SETTINGS_KEY, ...next });
  return next;
}
