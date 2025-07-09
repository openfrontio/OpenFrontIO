export class LruCache<T> {
  private values: Map<string, T> = new Map<string, T>();

  constructor(private maxEntries: number) {}

  get(key: string): T | undefined {
    const entry = this.values.get(key);
    if (entry !== undefined) {
      this.values.delete(key);
      this.values.set(key, entry);
    }
    return entry;
  }

  set(key: string, value: T): void {
    this.values.delete(key);
    this.values.set(key, value);
    if (this.values.size > this.maxEntries) {
      const keyToDelete = this.values.keys().next().value;
      this.values.delete(keyToDelete);
    }
  }
}
