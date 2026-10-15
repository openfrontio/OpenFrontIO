/**
 * Replays this browser has already processed, so watching a game again
 * opens right away. Stored in IndexedDB nearly as they are held (the
 * chunks stay gzipped, and the nuke impacts and dead units are packed and
 * gzipped, see PackedEvents), with a size cap, and the least recently
 * watched are removed first.
 *
 * Everything here is best effort. Storage can be missing, full or blocked
 * (private windows, cleared site data), in which case the replay just gets
 * processed again. Keys include the build and the format version, so a
 * replay is only ever read by a build that can decode it.
 *
 * On the main site, replays from other builds are removed the next time
 * one is stored: games from other builds are watched on their versioned
 * shell (replay.<domain>), so nothing here reads them again. The shells of
 * every build share that one origin, so there they're kept and only the
 * size cap removes them.
 */

import { ClientEnv } from "../ClientEnv";
import { isReplayShellHost } from "../VersionedReplay";
import { gunzipInBrowser, gzipInBrowser } from "./BrowserGzip";
import {
  packEvents,
  unpackEvents,
  type PackedEventLists,
} from "./codec/PackedEvents";
import {
  REPLAY_VERSION,
  type GzipFn,
  type InflateFn,
  type ReplayAppend,
  type ReplayData,
  type ReplayEvents,
} from "./codec/ReplayTypes";

/** Total size of the replays kept. */
export const MAX_STORED_BYTES = 256 * 1024 * 1024;

export interface StoredMeta {
  key: string;
  size: number;
  /** When it was last watched (ms since epoch). */
  usedAt: number;
}

/**
 * A replay as it's kept: ReplayData with its nuke impacts and dead units
 * packed and gzipped.
 */
export interface StoredReplay {
  base: ReplayData["base"];
  append: Omit<ReplayAppend, "events"> & {
    events: Omit<ReplayEvents, keyof PackedEventLists>;
    packedEvents: Uint8Array;
  };
}

export async function toStored(
  replay: ReplayData,
  gzip: GzipFn = gzipInBrowser,
): Promise<StoredReplay> {
  const { nukeImpacts, deadUnitEvents, ...events } = replay.append.events;
  const packed = packEvents({ nukeImpacts, deadUnitEvents });
  return {
    base: replay.base,
    append: { ...replay.append, events, packedEvents: await gzip(packed) },
  };
}

export async function fromStored(
  stored: StoredReplay,
  gunzip: InflateFn = gunzipInBrowser,
): Promise<ReplayData> {
  const { packedEvents, events, ...rest } = stored.append;
  const unpacked = unpackEvents(await gunzip(packedEvents));
  return {
    base: stored.base,
    append: { ...rest, events: { ...events, ...unpacked } },
  };
}

/** Storage backend (IndexedDB in the browser). */
export interface ReplayBackend {
  getReplay(key: string): Promise<StoredReplay | undefined>;
  putReplay(key: string, replay: StoredReplay, meta: StoredMeta): Promise<void>;
  /** Mark a replay as watched now. */
  touch(key: string, usedAt: number): Promise<void>;
  remove(key: string): Promise<void>;
  allMeta(): Promise<StoredMeta[]>;
}

/**
 * `build` is the client's git commit. Dev builds are all "DEV", so the
 * format version is in the key too.
 */
export function replayKey(gameID: string, build: string): string {
  return `${gameID}${keySuffix(build)}`;
}

function keySuffix(build: string): string {
  return `.${build}.v${REPLAY_VERSION}`;
}

/**
 * About how much space a stored replay takes: its gzipped chunks and
 * events, plus the rest as JSON. The chunks are nearly all of it.
 */
export function replaySize(replay: StoredReplay): number {
  let size = replay.append.packedEvents.byteLength;
  for (const c of replay.append.chunks) size += c.compressed.byteLength;
  const rest = JSON.stringify(
    [replay.base, { ...replay.append, chunks: [], packedEvents: null }],
    (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v),
  );
  return size + rest.length;
}

/** Which stored replays to drop so that `incoming` more bytes fit. */
export function evictionsFor(
  stored: StoredMeta[],
  incoming: number,
  maxBytes: number,
): string[] {
  let total = incoming;
  for (const m of stored) total += m.size;
  const out: string[] = [];
  for (const m of [...stored].sort((a, b) => a.usedAt - b.usedAt)) {
    if (total <= maxBytes) break;
    out.push(m.key);
    total -= m.size;
  }
  return out;
}

export class ReplayStore {
  constructor(
    private readonly backend: () => Promise<ReplayBackend | null>,
    /** The client's git commit. */
    private readonly build: () => string,
    private readonly maxBytes = MAX_STORED_BYTES,
    private readonly now: () => number = Date.now,
    /**
     * Whether other builds share this storage (the versioned shells on
     * replay.<domain>), so their replays are still wanted.
     */
    private readonly sharedAcrossBuilds: () => boolean = () => false,
  ) {}

  /** The stored replay of a game, or undefined. Never throws. */
  async get(gameID: string): Promise<ReplayData | undefined> {
    try {
      const b = await this.backend();
      if (b === null) return undefined;
      const key = replayKey(gameID, this.build());
      const stored = await b.getReplay(key);
      if (stored === undefined) return undefined;
      let replay: ReplayData;
      try {
        replay = await fromStored(stored);
      } catch (err) {
        // A damaged copy: forget it, so the game is processed again.
        console.warn("replay store: stored replay unreadable", err);
        await b.remove(key);
        return undefined;
      }
      await b.touch(key, this.now());
      return replay;
    } catch (err) {
      console.warn("replay store: read failed", err);
      return undefined;
    }
  }

  /** Keep a finished replay, making room if needed. Never throws. */
  async put(gameID: string, replay: ReplayData): Promise<void> {
    try {
      const stored = await toStored(replay);
      const size = replaySize(stored);
      if (size > this.maxBytes) return;
      const b = await this.backend();
      if (b === null) return;
      const key = replayKey(gameID, this.build());
      const suffix = keySuffix(this.build());
      const shared = this.sharedAcrossBuilds();
      const others: StoredMeta[] = [];
      for (const m of await b.allMeta()) {
        if (m.key === key) continue;
        if (!shared && !m.key.endsWith(suffix)) await b.remove(m.key);
        else others.push(m);
      }
      for (const k of evictionsFor(others, size, this.maxBytes)) {
        await b.remove(k);
      }
      await b.putReplay(key, stored, { key, size, usedAt: this.now() });
    } catch (err) {
      console.warn("replay store: write failed", err);
    }
  }

  /** Forget a game's replay (one that failed to load). Never throws. */
  async remove(gameID: string): Promise<void> {
    try {
      const b = await this.backend();
      await b?.remove(replayKey(gameID, this.build()));
    } catch (err) {
      console.warn("replay store: remove failed", err);
    }
  }
}

const DB_NAME = "openfront-replays";
const DB_VERSION = 1;
const REPLAYS = "replays";
const META = "meta";
/**
 * How long to wait for the database. A version upgrade waits until every
 * other tab has closed the old version, and the viewer shouldn't wait on
 * that, it can process the game instead.
 */
const OPEN_TIMEOUT_MS = 3000;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** The database, or null if it didn't open in time. */
function openDatabase(
  idb: IDBFactory,
  timeoutMs: number,
): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      console.warn("replay store: the database didn't open in time");
      resolve(null);
    }, timeoutMs);
    const open = idb.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      // Nothing from an older version is worth keeping.
      for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
      db.createObjectStore(REPLAYS);
      db.createObjectStore(META, { keyPath: "key" });
    };
    open.onsuccess = () => {
      const db = open.result;
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      // A tab on a newer build wants to upgrade: let it. This tab's store
      // stops working, which only means its replays aren't kept.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    open.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(open.error);
    };
  });
}

/**
 * Replays and metadata are kept apart so listing sizes doesn't load
 * replays.
 */
export async function openIndexedDbBackend(
  idb: IDBFactory | undefined = globalThis.indexedDB,
  timeoutMs = OPEN_TIMEOUT_MS,
): Promise<ReplayBackend | null> {
  if (idb === undefined) return null;
  const db = await openDatabase(idb, timeoutMs);
  if (db === null) return null;
  return {
    async getReplay(key) {
      const tx = db.transaction(REPLAYS, "readonly");
      return (await request(tx.objectStore(REPLAYS).get(key))) as
        | StoredReplay
        | undefined;
    },
    async putReplay(key, replay, meta) {
      const tx = db.transaction([REPLAYS, META], "readwrite");
      tx.objectStore(REPLAYS).put(replay, key);
      tx.objectStore(META).put(meta);
      await done(tx);
    },
    async touch(key, usedAt) {
      const tx = db.transaction(META, "readwrite");
      const store = tx.objectStore(META);
      const meta = (await request(store.get(key))) as StoredMeta | undefined;
      if (meta !== undefined) store.put({ ...meta, usedAt });
      await done(tx);
    },
    async remove(key) {
      const tx = db.transaction([REPLAYS, META], "readwrite");
      tx.objectStore(REPLAYS).delete(key);
      tx.objectStore(META).delete(key);
      await done(tx);
    },
    async allMeta() {
      const tx = db.transaction(META, "readonly");
      return (await request(tx.objectStore(META).getAll())) as StoredMeta[];
    },
  };
}

let shared: Promise<ReplayBackend | null> | null = null;

/** The browser's store, opened on first use. */
export const replayStore = new ReplayStore(
  () => {
    shared ??= openIndexedDbBackend().then(
      (backend) => {
        // Timed out: try again next time, the other tab may have closed.
        if (backend === null) shared = null;
        return backend;
      },
      (err: unknown) => {
        console.warn("replay store: unavailable", err);
        return null;
      },
    );
    return shared;
  },
  ClientEnv.gitCommit,
  MAX_STORED_BYTES,
  Date.now,
  () => isReplayShellHost(window.location.hostname),
);
