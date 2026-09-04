/**
 * Deterministic id helpers.
 *
 * Practice results must be reproducible (spec §21.1: "The same inputs MUST always
 * produce the same result"), so note ids derived during import/evaluation are
 * counter-based, not random. `randomId` is only for runtime-only entities
 * (live attempts, store keys) that never feed the scoring algorithm.
 */

export function makeIdFactory(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

export function randomId(prefix = 'id'): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return `${prefix}-${g.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
