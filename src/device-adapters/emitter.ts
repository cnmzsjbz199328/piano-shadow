/** Minimal typed listener set, shared by every adapter. Returns an unsubscribe fn. */
export class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  on(callback: (value: T) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emit(value: T): void {
    for (const cb of this.listeners) cb(value);
  }

  clear(): void {
    this.listeners.clear();
  }
}
