import { beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.hoisted(() => vi.fn());
vi.mock("../../src/client/CardLoadoutApi", () => ({
  saveCardLoadout: save,
}));

import type { CardLoadoutBody } from "../../src/client/CardLoadoutApi";
import {
  cardSaveInFlight,
  cardSaveRunning,
  requestCardSave,
  resetCardSavesForTests,
} from "../../src/client/CardSaveQueue";

const loadout = (background: string | null): CardLoadoutBody => ({
  background,
  title: null,
  taunt: null,
  trackers: [],
});

// Each save waits until the test answers it.
let waiting: ((ok: boolean) => void)[] = [];
beforeEach(() => {
  resetCardSavesForTests();
  save.mockReset();
  waiting = [];
  save.mockImplementation(
    (body: CardLoadoutBody) =>
      new Promise((resolve) => {
        waiting.push((ok) =>
          resolve(
            ok ? { ok: true, loadout: body } : { ok: false, error: "failed" },
          ),
        );
      }),
  );
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("CardSaveQueue", () => {
  it("sends one save at a time, the newest asked for last", async () => {
    const first = requestCardSave("a", loadout("a"));
    const second = requestCardSave("a", loadout("b"));
    const third = requestCardSave("a", loadout("c"));
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(cardSaveInFlight("a")).toEqual(loadout("c"));
    expect(cardSaveRunning("a")).toBe(first);
    await tick();
    expect(save).toHaveBeenCalledTimes(1);
    waiting.shift()!(true);
    await tick();
    // "b" was overtaken by "c" before it was sent.
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(loadout("c"));
    waiting.shift()!(true);
    expect(await first).toEqual({
      result: { ok: true, loadout: loadout("c") },
      saved: loadout("c"),
    });
    expect(cardSaveInFlight("a")).toBeNull();
    expect(cardSaveRunning("a")).toBeNull();
  });

  it("a failure ends the run, keeping what was stored before it", async () => {
    const run = requestCardSave("a", loadout("a"));
    await tick();
    void requestCardSave("a", loadout("b"));
    waiting.shift()!(true);
    await tick();
    waiting.shift()!(false);
    expect(await run).toEqual({
      result: { ok: false, error: "failed" },
      saved: loadout("a"),
    });
    expect(cardSaveInFlight("a")).toBeNull();
    // The next request starts a new run.
    const next = requestCardSave("a", loadout("c"));
    expect(next).not.toBe(run);
    await tick();
    waiting.shift()!(true);
    expect((await next).saved).toEqual(loadout("c"));
  });

  it("another account's run is invisible", async () => {
    void requestCardSave("a", loadout("a"));
    expect(cardSaveInFlight("b")).toBeNull();
    expect(cardSaveRunning("b")).toBeNull();
  });

  it("sign-out drops what was queued: it is never sent", async () => {
    const run = requestCardSave("a", loadout("a"));
    await tick();
    void requestCardSave("a", loadout("b"));
    document.dispatchEvent(new CustomEvent("session-cleared"));
    expect(cardSaveInFlight("a")).toBeNull();
    waiting.shift()!(true);
    expect(await run).toEqual({
      result: { ok: false, error: "cancelled" },
      saved: loadout("a"),
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a save for another account drops the old account's queue", async () => {
    const runA = requestCardSave("a", loadout("a"));
    await tick();
    void requestCardSave("a", loadout("a2"));
    const runB = requestCardSave("b", loadout("b"));
    expect(runB).not.toBe(runA);
    expect(cardSaveInFlight("a")).toBeNull();
    expect(cardSaveInFlight("b")).toEqual(loadout("b"));
    await tick();
    // A's first PUT and B's are both out; A's queued "a2" never is.
    waiting.shift()!(true);
    waiting.shift()!(true);
    expect((await runA).result).toEqual({ ok: false, error: "cancelled" });
    expect((await runB).saved).toEqual(loadout("b"));
    expect(save.mock.calls.map((c) => c[0])).toEqual([
      loadout("a"),
      loadout("b"),
    ]);
  });
});
