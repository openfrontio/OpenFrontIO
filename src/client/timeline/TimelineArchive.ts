import { LruCache } from "./LruCache";
import { TimelineIdb } from "./TimelineIdb";
import { TimelineCheckpointRecord, TimelineTickRecord } from "./types";

export class TimelineArchive {
  private readonly tickCache: LruCache<number, TimelineTickRecord>;
  private readonly checkpointCache: LruCache<number, TimelineCheckpointRecord>;
  private readonly idb: TimelineIdb;
  private _storageError: string | null = null;
  private readonly pendingWrites = new Set<Promise<void>>();

  constructor(
    opts: {
      tickCacheSize?: number;
      checkpointCacheSize?: number;
      idb?: TimelineIdb;
    } = {},
  ) {
    this.tickCache = new LruCache(opts.tickCacheSize ?? 5000);
    this.checkpointCache = new LruCache(opts.checkpointCacheSize ?? 50);
    this.idb = opts.idb ?? new TimelineIdb();
  }

  get storageError(): string | null {
    return this._storageError;
  }

  async open(): Promise<void> {
    try {
      await this.idb.open();
    } catch (e) {
      this._storageError = `IndexedDB unavailable: ${String(e)}`;
    }
  }

  putTickRecord(record: TimelineTickRecord): void {
    this.tickCache.set(record.tick, record);
    if (!this.idb.isAvailable) return;
    const p = this.idb.putTickRecord(record).catch((e) => {
      this._storageError = `IndexedDB write failed: ${String(e)}`;
    });
    this.pendingWrites.add(p);
    void p.finally(() => this.pendingWrites.delete(p));
  }

  async getTickRecord(tick: number): Promise<TimelineTickRecord | null> {
    const cached = this.tickCache.get(tick);
    if (cached) return cached;
    if (!this.idb.isAvailable) return null;
    try {
      const rec = await this.idb.getTickRecord(tick);
      if (rec) this.tickCache.set(tick, rec);
      return rec;
    } catch (e) {
      this._storageError = `IndexedDB read failed: ${String(e)}`;
      return null;
    }
  }

  async getTickRecordsRange(
    fromTick: number,
    toTick: number,
  ): Promise<TimelineTickRecord[]> {
    if (fromTick > toTick) return [];

    if (!this.idb.isAvailable) {
      const out: TimelineTickRecord[] = [];
      for (let t = fromTick; t <= toTick; t++) {
        const rec = this.tickCache.get(t);
        if (!rec) {
          throw new Error(`Missing tick record ${t} (memory-only archive)`);
        }
        out.push(rec);
      }
      return out;
    }

    try {
      const recs = await this.idb.getTickRecordsRange(fromTick, toTick);
      for (const rec of recs) {
        this.tickCache.set(rec.tick, rec);
      }
      return recs;
    } catch (e) {
      this._storageError = `IndexedDB range read failed: ${String(e)}`;
      return [];
    }
  }

  putCheckpoint(record: TimelineCheckpointRecord): void {
    this.checkpointCache.set(record.tick, record);
    if (!this.idb.isAvailable) return;
    const p = this.idb.putCheckpoint(record).catch((e) => {
      this._storageError = `IndexedDB checkpoint write failed: ${String(e)}`;
    });
    this.pendingWrites.add(p);
    void p.finally(() => this.pendingWrites.delete(p));
  }

  async getCheckpointAtOrBefore(
    tick: number,
  ): Promise<TimelineCheckpointRecord | null> {
    let best: TimelineCheckpointRecord | null = null;
    for (const rec of this.checkpointCache.values()) {
      if (rec.tick <= tick && (best === null || rec.tick > best.tick)) {
        best = rec;
      }
    }
    if (best) return best;

    if (!this.idb.isAvailable) return null;
    try {
      const rec = await this.idb.getCheckpointAtOrBefore(tick);
      if (rec) this.checkpointCache.set(rec.tick, rec);
      return rec;
    } catch (e) {
      this._storageError = `IndexedDB checkpoint read failed: ${String(e)}`;
      return null;
    }
  }

  async truncateAfterTick(tick: number): Promise<void> {
    // Ensure all outstanding IDB puts have completed so they don't re-introduce
    // deleted records after truncation.
    await Promise.allSettled(Array.from(this.pendingWrites.values()));

    for (const k of Array.from(this.tickCache.keys())) {
      if (k > tick) this.tickCache.delete(k);
    }
    for (const k of Array.from(this.checkpointCache.keys())) {
      if (k > tick) this.checkpointCache.delete(k);
    }

    if (!this.idb.isAvailable) return;
    try {
      await this.idb.deleteTickRecordsAfter(tick);
      await this.idb.deleteCheckpointsAfter(tick);
    } catch (e) {
      this._storageError = `IndexedDB truncate failed: ${String(e)}`;
    }
  }
}
