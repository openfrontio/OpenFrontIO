export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly capacity: number) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error(`Invalid LruCache capacity: ${capacity}`);
    }
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Refresh recency
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldestKey = this.map.keys().next().value as K | undefined;
      if (oldestKey === undefined) break;
      this.map.delete(oldestKey);
    }
  }

  values(): IterableIterator<V> {
    return this.map.values();
  }
}
