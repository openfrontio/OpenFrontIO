// @vitest-environment node
/**
 * Replays kept in this browser: found again by game, the least recently
 * watched dropped first under the cap, and never an error when storage
 * isn't there.
 */

import {
  evictionsFor,
  fromStored,
  openIndexedDbBackend,
  replayKey,
  replaySize,
  ReplayStore,
  toStored,
  type ReplayBackend,
  type StoredMeta,
  type StoredReplay,
} from "../../../src/client/replay/ReplayStore";
import {
  REPLAY_VERSION,
  type ReplayData,
} from "../../../src/client/replay/codec/ReplayTypes";

/** What IndexedDB holds, in memory. */
function memoryBackend() {
  const files = new Map<string, StoredReplay>();
  const meta = new Map<string, StoredMeta>();
  const backend: ReplayBackend = {
    getReplay: async (key) => files.get(key),
    putReplay: async (key, replay, m) => {
      files.set(key, replay);
      meta.set(key, m);
    },
    touch: async (key, usedAt) => {
      const m = meta.get(key);
      if (m !== undefined) meta.set(key, { ...m, usedAt });
    },
    remove: async (key) => {
      files.delete(key);
      meta.delete(key);
    },
    allMeta: async () => [...meta.values()],
  };
  return { backend, files, meta };
}

/** A replay whose chunks take `n` bytes (plus a little for the rest). */
const file = (n: number): ReplayData => ({
  base: {} as ReplayData["base"],
  append: {
    chunks: [{ compressed: new Uint8Array(n).fill(7), frameCount: 1 }],
    players: [],
    unitTypes: [],
    events: {
      nukeImpacts: [],
      railroadEvents: [],
      motionPlans: [],
      constructionStarts: [],
      deadUnitEvents: [],
      spawnPhaseEnd: null,
    },
  },
});
/** The size of the non-chunk part of `file(n)` as stored. */
const REST = replaySize(await toStored(file(0)));

const BUILD = () => "abc123";

test("keys carry the build and the format version", () => {
  expect(replayKey("abcd1234", "abc123")).toBe(
    `abcd1234.abc123.v${REPLAY_VERSION}`,
  );
});

test("a replay's size is its chunks, plus the rest as JSON", async () => {
  expect(replaySize(await toStored(file(40)))).toBe(40 + REST);
});

test("nuke impacts and dead units are kept packed and gzipped", async () => {
  const replay = file(4);
  replay.append.events.nukeImpacts = [
    { tick: 30, land: [2105, 2100, 2101], water: [9] },
    { tick: 31, land: [], water: [7, 3] },
  ];
  replay.append.events.deadUnitEvents = [
    {
      tick: 31,
      unitId: 812,
      unitType: "Atom Bomb",
      ownerSmallID: 3,
      pos: 2101,
      reachedTarget: true,
    },
  ];
  const stored = await toStored(replay);
  expect(stored.append.events).not.toHaveProperty("nukeImpacts");
  expect(stored.append.events).not.toHaveProperty("deadUnitEvents");
  // Tiles come back sorted; their order never mattered.
  replay.append.events.nukeImpacts[0].land.sort((a, b) => a - b);
  replay.append.events.nukeImpacts[1].water.sort((a, b) => a - b);
  expect(await fromStored(stored)).toEqual(replay);
});

test("evictions drop the least recently watched until the new one fits", () => {
  const stored: StoredMeta[] = [
    { key: "new", size: 40, usedAt: 300 },
    { key: "old", size: 40, usedAt: 100 },
    { key: "mid", size: 40, usedAt: 200 },
  ];
  expect(evictionsFor(stored, 10, 200)).toEqual([]);
  expect(evictionsFor(stored, 50, 100)).toEqual(["old", "mid"]);
  expect(evictionsFor(stored, 100, 100)).toEqual(["old", "mid", "new"]);
});

test("a stored replay comes back, and watching it keeps it longest", async () => {
  const { backend, meta } = memoryBackend();
  let now = 0;
  const store = new ReplayStore(
    async () => backend,
    BUILD,
    100 + 2 * REST,
    () => now,
  );
  now = 1;
  await store.put("gameAAAA", file(40));
  now = 2;
  await store.put("gameBBBB", file(40));
  expect(await store.get("gameCCCC")).toBeUndefined();

  now = 3;
  expect(await store.get("gameAAAA")).toEqual(file(40)); // A is fresher now
  now = 4;
  await store.put("gameCCCC", file(40)); // needs room: B goes
  expect([...meta.keys()].sort()).toEqual(
    [replayKey("gameAAAA", "abc123"), replayKey("gameCCCC", "abc123")].sort(),
  );
  expect(await store.get("gameBBBB")).toBeUndefined();
});

test("on the main site, another build's replays are never read, and go when one is stored", async () => {
  const { backend, meta } = memoryBackend();
  const old = new ReplayStore(
    async () => backend,
    () => "old456",
  );
  await old.put("gameAAAA", file(4));
  const store = new ReplayStore(async () => backend, BUILD);
  expect(await store.get("gameAAAA")).toBeUndefined();
  await store.put("gameBBBB", file(4));
  expect([...meta.keys()]).toEqual([replayKey("gameBBBB", "abc123")]);
});

test("on the shells' shared origin, other builds' replays stay until the cap needs the room", async () => {
  const { backend, meta } = memoryBackend();
  let now = 0;
  const store = (build: string) =>
    new ReplayStore(
      async () => backend,
      () => build,
      8 + 2 * REST,
      () => now,
      () => true,
    );
  now = 1;
  await store("old456").put("gameAAAA", file(4));
  now = 2;
  await store("abc123").put("gameBBBB", file(4));
  // Both fit: switching between shells doesn't wipe the other's replays.
  now = 3;
  expect(await store("old456").get("gameAAAA")).toBeDefined();
  expect(await store("abc123").get("gameAAAA")).toBeUndefined();
  now = 4;
  // No room for a third: the least recently watched goes, whatever build.
  await store("xyz789").put("gameCCCC", file(4));
  expect([...meta.keys()].sort()).toEqual(
    [replayKey("gameAAAA", "old456"), replayKey("gameCCCC", "xyz789")].sort(),
  );
});

test("a replay can be forgotten", async () => {
  const { backend, files } = memoryBackend();
  const store = new ReplayStore(async () => backend, BUILD);
  await store.put("gameAAAA", file(4));
  await store.remove("gameAAAA");
  expect(files.size).toBe(0);
  expect(await store.get("gameAAAA")).toBeUndefined();
});

test("a stored replay that won't unpack is forgotten", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const { backend, files, meta } = memoryBackend();
  const store = new ReplayStore(async () => backend, BUILD);
  await store.put("gameAAAA", file(4));
  const key = replayKey("gameAAAA", "abc123");
  files.get(key)!.append.packedEvents = new Uint8Array([1, 2, 3]);
  expect(await store.get("gameAAAA")).toBeUndefined();
  expect(files.size).toBe(0);
  expect(meta.size).toBe(0);
  vi.restoreAllMocks();
});

test("a replay bigger than the cap is not kept", async () => {
  const { backend, files } = memoryBackend();
  const store = new ReplayStore(async () => backend, BUILD, 10 + REST);
  await store.put("gameAAAA", file(11));
  expect(files.size).toBe(0);
});

test("no storage, or storage that fails, is never an error", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const none = new ReplayStore(async () => null, BUILD);
  await none.put("gameAAAA", file(1));
  expect(await none.get("gameAAAA")).toBeUndefined();

  const broken: ReplayBackend = {
    getReplay: () => Promise.reject(new Error("QuotaExceededError")),
    putReplay: () => Promise.reject(new Error("QuotaExceededError")),
    touch: () => Promise.reject(new Error("x")),
    remove: () => Promise.reject(new Error("x")),
    allMeta: () => Promise.reject(new Error("x")),
  };
  const failing = new ReplayStore(async () => broken, BUILD);
  await expect(failing.put("gameAAAA", file(1))).resolves.toBeUndefined();
  await expect(failing.get("gameAAAA")).resolves.toBeUndefined();
  await expect(failing.remove("gameAAAA")).resolves.toBeUndefined();
  vi.restoreAllMocks();
});

/**
 * An IndexedDB that opens once `succeed` is called, never if another tab
 * holds an older version.
 */
function fakeIndexedDb() {
  const db = { close: vi.fn(), onversionchange: null as (() => void) | null };
  const req = {
    result: db,
    onsuccess: null as (() => void) | null,
  } as unknown as IDBOpenDBRequest & { onsuccess: () => void };
  const idb = { open: () => req } as unknown as IDBFactory;
  return { idb, db, succeed: () => req.onsuccess() };
}

describe("the IndexedDB backend", () => {
  test("a database that doesn't open in time is given up on", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { idb, db, succeed } = fakeIndexedDb();
    expect(await openIndexedDbBackend(idb, 5)).toBeNull();
    // If it opens after all, it isn't left open.
    succeed();
    expect(db.close).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  test("it closes when a newer build wants to upgrade it", async () => {
    const { idb, db, succeed } = fakeIndexedDb();
    const opened = openIndexedDbBackend(idb, 1000);
    succeed();
    expect(await opened).not.toBeNull();
    db.onversionchange!();
    expect(db.close).toHaveBeenCalled();
  });
});
