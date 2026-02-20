import { LruCache } from "./LruCache";
import { TimelineIdb } from "./TimelineIdb";
import { TimelineCheckpointRecord, TimelineTickRecord } from "./types";

export class TimelineArchive {
  private readonly tickCache: LruCache<number, TimelineTickRecord>;
  private readonly checkpointCache: LruCache<number, TimelineCheckpointRecord>;
  private readonly idb: TimelineIdb;
  private _storageError: string | null = null;

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
    void this.idb.putTickRecord(record).catch((e) => {
      this._storageError = `IndexedDB write failed: ${String(e)}`;
    });
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
    void this.idb.putCheckpoint(record).catch((e) => {
      this._storageError = `IndexedDB checkpoint write failed: ${String(e)}`;
    });
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
}
