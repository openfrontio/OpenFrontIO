import { TimelineCheckpointRecord, TimelineTickRecord } from "./types";

const DB_NAME = "openfront_timeline_v1";
const DB_VERSION = 1;
const TICK_STORE = "tickRecords";
const CHECKPOINT_STORE = "checkpoints";

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

export class TimelineIdb {
  private db: IDBDatabase | null = null;

  get isAvailable(): boolean {
    return isIndexedDbAvailable();
  }

  async open(): Promise<void> {
    if (!this.isAvailable) return;
    if (this.db) return;

    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TICK_STORE)) {
          db.createObjectStore(TICK_STORE, { keyPath: "tick" });
        }
        if (!db.objectStoreNames.contains(CHECKPOINT_STORE)) {
          db.createObjectStore(CHECKPOINT_STORE, { keyPath: "tick" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(req.error ?? new Error("indexedDB open failed"));
    });
  }

  private requireDb(): IDBDatabase {
    if (!this.db) {
      throw new Error("TimelineIdb not opened");
    }
    return this.db;
  }

  async putTickRecord(record: TimelineTickRecord): Promise<void> {
    if (!this.isAvailable) return;
    const db = this.requireDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(TICK_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("tickRecords tx failed"));
      tx.objectStore(TICK_STORE).put(record);
    });
  }

  async getTickRecord(tick: number): Promise<TimelineTickRecord | null> {
    if (!this.isAvailable) return null;
    const db = this.requireDb();
    return await new Promise<TimelineTickRecord | null>((resolve, reject) => {
      const tx = db.transaction(TICK_STORE, "readonly");
      const req = tx.objectStore(TICK_STORE).get(tick);
      req.onsuccess = () => resolve((req.result as TimelineTickRecord) ?? null);
      req.onerror = () =>
        reject(req.error ?? new Error("tickRecords get failed"));
    });
  }

  async getTickRecordsRange(
    fromTick: number,
    toTick: number,
  ): Promise<TimelineTickRecord[]> {
    if (!this.isAvailable) return [];
    const db = this.requireDb();
    const range = IDBKeyRange.bound(fromTick, toTick);
    return await new Promise<TimelineTickRecord[]>((resolve, reject) => {
      const out: TimelineTickRecord[] = [];
      const tx = db.transaction(TICK_STORE, "readonly");
      const store = tx.objectStore(TICK_STORE);
      const req = store.openCursor(range, "next");
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        out.push(cursor.value as TimelineTickRecord);
        cursor.continue();
      };
      req.onerror = () =>
        reject(req.error ?? new Error("tickRecords openCursor failed"));
    });
  }

  async putCheckpoint(record: TimelineCheckpointRecord): Promise<void> {
    if (!this.isAvailable) return;
    const db = this.requireDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CHECKPOINT_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("checkpoints tx failed"));
      tx.objectStore(CHECKPOINT_STORE).put(record);
    });
  }

  async getCheckpointAtOrBefore(
    tick: number,
  ): Promise<TimelineCheckpointRecord | null> {
    if (!this.isAvailable) return null;
    const db = this.requireDb();
    const range = IDBKeyRange.upperBound(tick);
    return await new Promise<TimelineCheckpointRecord | null>(
      (resolve, reject) => {
        const tx = db.transaction(CHECKPOINT_STORE, "readonly");
        const store = tx.objectStore(CHECKPOINT_STORE);
        const req = store.openCursor(range, "prev");
        req.onsuccess = () => {
          const cursor = req.result;
          resolve(cursor ? (cursor.value as TimelineCheckpointRecord) : null);
        };
        req.onerror = () =>
          reject(req.error ?? new Error("checkpoints openCursor failed"));
      },
    );
  }

  async deleteTickRecordsAfter(tick: number): Promise<void> {
    if (!this.isAvailable) return;
    const db = this.requireDb();
    const range = IDBKeyRange.lowerBound(tick + 1);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(TICK_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("tickRecords delete tx failed"));
      const store = tx.objectStore(TICK_STORE);
      const req = store.openCursor(range, "next");
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      req.onerror = () =>
        reject(req.error ?? new Error("tickRecords delete cursor failed"));
    });
  }

  async deleteCheckpointsAfter(tick: number): Promise<void> {
    if (!this.isAvailable) return;
    const db = this.requireDb();
    const range = IDBKeyRange.lowerBound(tick + 1);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CHECKPOINT_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("checkpoints delete tx failed"));
      const store = tx.objectStore(CHECKPOINT_STORE);
      const req = store.openCursor(range, "next");
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      req.onerror = () =>
        reject(req.error ?? new Error("checkpoints delete cursor failed"));
    });
  }
}
