import { describe, expect, it, vi } from "vitest";

const save = vi.hoisted(() => vi.fn());
vi.mock("../../src/client/CardLoadoutApi", () => ({
  saveCardLoadout: save,
}));

import type { CardLoadoutBody } from "../../src/client/CardLoadoutApi";
import {
  cardSaveInFlight,
  cardSaveRunning,
  requestCardSave,
} from "../../src/client/CardSaveQueue";

const loadout = (background: string | null): CardLoadoutBody => ({
  background,
  title: null,
  taunt: null,
  trackers: [],
});

// Each save waits until the test answers it.
function deferredSaves() {
  const waiting: ((ok: boolean) => void)[] = [];
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
  return waiting;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("CardSaveQueue", () => {
  it("sends one save at a time, the newest asked for last", async () => {
    const waiting = deferredSaves();
    const first = requestCardSave(loadout("a"));
    const second = requestCardSave(loadout("b"));
    const third = requestCardSave(loadout("c"));
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(cardSaveInFlight()).toEqual(loadout("c"));
    expect(cardSaveRunning()).toBe(first);
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
    expect(cardSaveInFlight()).toBeNull();
    expect(cardSaveRunning()).toBeNull();
    save.mockReset();
  });

  it("a failure ends the run, keeping what was stored before it", async () => {
    const waiting = deferredSaves();
    const run = requestCardSave(loadout("a"));
    await tick();
    void requestCardSave(loadout("b"));
    waiting.shift()!(true);
    await tick();
    waiting.shift()!(false);
    expect(await run).toEqual({
      result: { ok: false, error: "failed" },
      saved: loadout("a"),
    });
    expect(cardSaveInFlight()).toBeNull();
    // The next request starts a new run.
    const next = requestCardSave(loadout("c"));
    expect(next).not.toBe(run);
    await tick();
    waiting.shift()!(true);
    expect((await next).saved).toEqual(loadout("c"));
    save.mockReset();
  });
});
