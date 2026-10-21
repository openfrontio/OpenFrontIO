/**
 * WorkerClient.initialize: the engine gets its map in `init` and loads
 * nothing itself, and a failed start doesn't leave the worker running.
 */

import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import type { GameStartInfo } from "@openfront/engine-api/Schemas";
import {
  readSnapshotHeader,
  WorkerClient,
} from "../../../src/client/WorkerClient";

const worker = vi.hoisted(() => ({
  posted: [] as { msg: Record<string, unknown>; transfer: unknown[] }[],
  listeners: [] as ((e: MessageEvent) => void)[],
  errorListeners: [] as ((e: ErrorEvent) => void)[],
  terminated: false,
}));
const mapFiles = vi.hoisted(() => ({ fail: false }));

vi.mock("@openfront/engine/worker/Worker.worker?worker&inline", () => ({
  default: class {
    addEventListener(type: string, l: (e: any) => void) {
      if (type === "error") worker.errorListeners.push(l);
      else worker.listeners.push(l);
    }
    postMessage(msg: Record<string, unknown>, transfer: unknown[] = []) {
      worker.posted.push({ msg, transfer });
    }
    terminate() {
      worker.terminated = true;
    }
  },
}));

vi.mock("../../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: {
    getMapData: () => {
      const bin = async () => {
        if (mapFiles.fail) throw new Error("map not found");
        return new Uint8Array(4);
      };
      return {
        manifest: async () => ({ name: "onion" }),
        mapBin: bin,
        map4xBin: bin,
        map16xBin: bin,
      };
    },
  },
}));

const start = {
  gameID: "initTest1",
  config: { gameMap: GameMapType.Onion, gameMapSize: GameMapSize.Normal },
} as unknown as GameStartInfo;

beforeEach(() => {
  worker.posted = [];
  worker.listeners = [];
  worker.errorListeners = [];
  worker.terminated = false;
  mapFiles.fail = false;
});

describe("WorkerClient.initialize", () => {
  test("hands the engine the map files, moved, in init", async () => {
    const client = new WorkerClient(start, undefined);
    const ready = client.initialize();
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    const { msg, transfer } = worker.posted[0];
    expect(msg).toMatchObject({
      type: "init",
      map: { map: GameMapType.Onion, mapSize: GameMapSize.Normal },
    });
    expect(msg).not.toHaveProperty("cdnBase");
    expect(transfer).toHaveLength(2);
    for (const l of worker.listeners) {
      l(
        new MessageEvent("message", {
          data: { type: "initialized", id: msg.id },
        }),
      );
    }
    await ready;
  });

  test("an engine that can't start the game fails with its reason", async () => {
    const client = new WorkerClient(start, undefined);
    const ready = client.initialize();
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    const { id } = worker.posted[0].msg;
    for (const l of worker.listeners) {
      l(
        new MessageEvent("message", {
          data: { type: "init_error", id, error: "bad map" },
        }),
      );
    }
    await expect(ready).rejects.toThrow("bad map");
    expect(worker.terminated).toBe(true);
  });

  test("a map that can't load stops the worker", async () => {
    mapFiles.fail = true;
    const client = new WorkerClient(start, undefined);
    await expect(client.initialize()).rejects.toThrow("map not found");
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
    expect(worker.posted).toEqual([]);
  });
});

describe("readSnapshotHeader", () => {
  function answer(data: Record<string, unknown>) {
    for (const l of worker.listeners) l(new MessageEvent("message", { data }));
  }

  test("asks a worker of its own for the header, then stops it", async () => {
    const snapshot = new Uint8Array([1, 2, 3]);
    const header = readSnapshotHeader(snapshot);
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    const { msg, transfer } = worker.posted[0];
    expect(msg).toEqual({ type: "read_snapshot_header", snapshot });
    // Copied, not moved: the caller starts the game from the same bytes.
    expect(transfer).toEqual([]);
    const result = {
      format: 1,
      gitCommit: "abc",
      gameID: "game0001",
      tick: 500,
      gameConfig: start.config,
      humans: [{ clientID: "HUMAN001", name: "me" }],
    };
    answer({ type: "read_snapshot_header_result", header: result });
    await expect(header).resolves.toEqual(result);
    expect(worker.terminated).toBe(true);
    expect(snapshot).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("fails with the engine's reason when the bytes aren't a snapshot", async () => {
    const header = readSnapshotHeader(new Uint8Array([9]));
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    answer({
      type: "read_snapshot_header_result",
      header: null,
      error: "not a game snapshot",
    });
    await expect(header).rejects.toThrow("not a game snapshot");
    expect(worker.terminated).toBe(true);
  });

  test("fails at once when the worker dies", async () => {
    const header = readSnapshotHeader(new Uint8Array([9]));
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    for (const l of worker.errorListeners) {
      l({ message: "out of memory" } as ErrorEvent);
    }
    await expect(header).rejects.toThrow("out of memory");
    expect(worker.terminated).toBe(true);
  });
});
