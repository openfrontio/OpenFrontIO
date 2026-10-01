// @vitest-environment node
/**
 * Processing a game in the browser: what the viewer is told as the worker
 * runs, and that what the browser's own compression writes is a replay the
 * viewer plays as it grows, and stores once it's done.
 */

import {
  gunzipInBrowser,
  gzipInBrowser,
} from "../../../src/client/replay/BrowserGzip";
import type {
  ReplayAppend,
  ReplayBase,
} from "../../../src/client/replay/codec/ReplayTypes";
import {
  processInBrowser,
  type ProcessingHandlers,
} from "../../../src/client/replay/LocalProcessing";
import { processGameRecord } from "../../../src/client/replay/processor/ReplayProcessor";
import type { ProcessorResponse } from "../../../src/client/replay/ProcessorMessages";
import { ReplayPlayback } from "../../../src/client/replay/ReplayPlayback";
import type { GameRecord } from "../../../src/core/Schemas";
import {
  config,
  human,
  mapLoader,
  playAndArchive,
  spawnOnLand,
} from "./util/ArchiveGame";

/** Stands in for the worker: the test says what it answers. */
class FakeWorker extends EventTarget {
  posted: unknown[] = [];
  terminated = false;
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  answer(msg: ProcessorResponse) {
    this.dispatchEvent(new MessageEvent("message", { data: msg }));
  }
}

function handlers() {
  const calls: string[] = [];
  const h: ProcessingHandlers = {
    onProgress: (p) => calls.push(`progress ${p}`),
    onStart: () => calls.push("start"),
    onAppend: () => calls.push("append"),
    onDone: () => calls.push("done"),
    onError: (m, desync) => calls.push(`error ${m} ${desync}`),
  };
  return { h, calls };
}

const RECORD = { info: { gameID: "abcd1234" } } as unknown as GameRecord;

describe("processInBrowser", () => {
  test("passes the record on, then relays what the worker says", async () => {
    const worker = new FakeWorker();
    const { h, calls } = handlers();
    processInBrowser(RECORD, h, async () => worker as unknown as Worker);
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    expect(worker.posted[0]).toMatchObject({ record: RECORD });

    worker.answer({ type: "progress", percent: 10 });
    worker.answer({ type: "start", base: {} as ReplayBase });
    worker.answer({ type: "append", append: {} as ReplayAppend });
    worker.answer({ type: "append", append: {} as ReplayAppend });
    worker.answer({ type: "done" });
    expect(calls).toEqual(["progress 10", "start", "append", "append", "done"]);
    expect(worker.terminated).toBe(true);
  });

  test("a failure is reported once, and says whether it was a desync", async () => {
    const worker = new FakeWorker();
    const { h, calls } = handlers();
    processInBrowser(RECORD, h, async () => worker as unknown as Worker);
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    worker.answer({ type: "error", message: "diverged", desync: true });
    worker.answer({ type: "progress", percent: 50 }); // after the end
    expect(calls).toEqual(["error diverged true"]);
    expect(worker.terminated).toBe(true);
  });

  test("a worker that can't start is a failure", async () => {
    const { h, calls } = handlers();
    processInBrowser(RECORD, h, () => Promise.reject(new Error("no workers")));
    await vi.waitFor(() => expect(calls).toEqual(["error no workers false"]));
  });

  test("cancelled, it stops the worker and says nothing more", async () => {
    const worker = new FakeWorker();
    const { h, calls } = handlers();
    let started!: () => void;
    const ready = new Promise<void>((r) => (started = r));
    const p = processInBrowser(RECORD, h, async () => {
      await ready;
      return worker as unknown as Worker;
    });
    p.cancel();
    started();
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
    worker.answer({ type: "progress", percent: 10 });
    expect(worker.posted).toEqual([]);
    expect(calls).toEqual([]);
  });
});

test("the browser's compression makes a replay the viewer plays as it grows", async () => {
  const { record } = await playAndArchive({
    gameID: "procBRWS1",
    config: config({ bots: 5 }),
    players: [human(1)],
    ticks: 65,
    intents: (game, t) =>
      t === 3 ? [spawnOnLand(game, "client001", 1000)] : [],
  });
  let base!: ReplayBase;
  const appends: ReplayAppend[] = [];
  const result = await processGameRecord(record, {
    mapLoader,
    gzip: gzipInBrowser,
    keyframeInterval: 20,
    appendEveryMs: 0.001, // one per chunk
    onStart: (b) => (base = b),
    // Across the worker boundary, as the viewer gets it.
    onAppend: (append) => void appends.push(structuredClone(append)),
  });
  expect(result.totalTicks).toBe(65);
  expect(appends.length).toBeGreaterThan(1);

  const rules = { allianceDuration: 100, doomsdayClockWarnTicks: 150 };
  const [first, ...more] = appends;
  const playback = await ReplayPlayback.open(
    { base, append: first },
    gunzipInBrowser,
    rules,
  );
  playback.onError = (err) => {
    throw err;
  };
  playback.live = true;
  await playback.seek(10);
  for (const append of more) playback.append(append);
  expect(playback.totalFrames).toBe(65);
  expect(playback.frame).toBe(10);
  await playback.seek(64);
  expect(playback.frame).toBe(64);

  // What the viewer stores opens again, after a structured clone like
  // IndexedDB makes.
  const stored = await ReplayPlayback.open(
    structuredClone(playback.data()),
    gunzipInBrowser,
    rules,
  );
  expect(stored.totalFrames).toBe(65);
  await stored.seek(64);
  expect(stored.frame).toBe(64);
}, 60_000);
