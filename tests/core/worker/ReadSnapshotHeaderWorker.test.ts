/**
 * The engine worker answers read_snapshot_header before (and without) any
 * game: the page asks it what a saved game is before it can start one.
 */

import type { ReadSnapshotHeaderResultMessage } from "@openfront/engine-api/worker/WorkerMessages";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { gunzipSync } from "zlib";
import { SCRIPTED_HUMANS } from "../../util/ScriptedGame";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(
  __dirname,
  "../../testdata/snapshots/format-1.snapshot.gz",
);

const self = Object.assign(new EventTarget(), { postMessage: vi.fn() });

beforeAll(async () => {
  vi.stubGlobal("self", self);
  await import("@openfront/engine/worker/Worker.worker");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  self.postMessage.mockClear();
});

async function ask(
  snapshot: Uint8Array,
): Promise<ReadSnapshotHeaderResultMessage> {
  self.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "read_snapshot_header", id: "ask1", snapshot },
    }),
  );
  await vi.waitFor(() => expect(self.postMessage).toHaveBeenCalledTimes(1));
  return self.postMessage.mock.calls[0][0];
}

test("reads a saved game's header without starting a game", async () => {
  const bytes = new Uint8Array(gunzipSync(fs.readFileSync(FIXTURE)));
  const result = await ask(bytes);
  expect(result.type).toBe("read_snapshot_header_result");
  expect(result.id).toBe("ask1");
  expect(result.error).toBeUndefined();
  expect(result.header?.tick).toBeGreaterThan(0);
  expect(result.header?.gameConfig.gameMap).toBeDefined();
  expect(result.header?.humans.map((h) => h.clientID)).toEqual([
    ...SCRIPTED_HUMANS,
  ]);
});

test("answers bytes that aren't a snapshot with null and the reason", async () => {
  const result = await ask(new Uint8Array([1, 2, 3, 4]));
  expect(result.id).toBe("ask1");
  expect(result.header).toBeNull();
  expect(result.error).toMatch(/snapshot/);
});
