import { beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.hoisted(() => vi.fn());
vi.mock("../../src/client/CardLoadoutApi", () => ({
  saveCardLoadout: save,
}));
// The account the session's token belongs to.
const auth = vi.hoisted(() => ({ publicId: "a" as string | null }));
vi.mock("../../src/client/Auth", () => ({
  currentPublicId: () => auth.publicId,
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
  auth.publicId = "a";
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
    expect(save).toHaveBeenLastCalledWith(loadout("c"), expect.any(Function));
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

  it("portal re-auth drops what was queued: it is never sent", async () => {
    const run = requestCardSave("a", loadout("a"));
    await tick();
    void requestCardSave("a", loadout("b"));
    document.dispatchEvent(new CustomEvent("session-reauth"));
    expect(cardSaveInFlight("a")).toBeNull();
    waiting.shift()!(true);
    expect((await run).result).toEqual({ ok: false, error: "cancelled" });
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
  it("a sign-out while the token is read stops the PUT", async () => {
    // The queue's guard is what saveCardLoadout asks once it holds a token.
    let guard: (() => boolean) | undefined;
    save.mockImplementationOnce(
      (_body: CardLoadoutBody, stillWanted: () => boolean) => {
        guard = stillWanted;
        return new Promise(() => {});
      },
    );
    void requestCardSave("a", loadout("a"));
    await tick();
    expect(guard!()).toBe(true);
    document.dispatchEvent(new CustomEvent("session-cleared"));
    expect(guard!()).toBe(false);
  });

  it("sends nothing once the token belongs to another account", async () => {
    // A refresh that picked up another tab's sign-in fires no session
    // event: the guard checks whose token it is.
    let guard: (() => boolean) | undefined;
    save.mockImplementationOnce(
      (_body: CardLoadoutBody, stillWanted: () => boolean) => {
        guard = stillWanted;
        return new Promise(() => {});
      },
    );
    void requestCardSave("a", loadout("a"));
    await tick();
    expect(guard!()).toBe(true);
    auth.publicId = "b";
    expect(guard!()).toBe(false);
    auth.publicId = null;
    expect(guard!()).toBe(false);
  });

  // As saveCardLoadout does: asks the guard once it holds a token, and
  // sends nothing when it says no.
  const guarded = () =>
    save.mockImplementationOnce(
      async (_body: CardLoadoutBody, stillWanted: () => boolean) =>
        stillWanted()
          ? { ok: true, loadout: _body }
          : { ok: false, error: "cancelled" },
    );

  it("no session once the token is read (a failing refresh) ends failed, to retry", async () => {
    guarded();
    auth.publicId = null;
    const run = requestCardSave("a", loadout("a"));
    expect((await run).result).toEqual({ ok: false, error: "failed" });
  });

  it("the token now another account's ends cancelled", async () => {
    guarded();
    auth.publicId = "b";
    const run = requestCardSave("a", loadout("a"));
    expect((await run).result).toEqual({ ok: false, error: "cancelled" });
  });

  it("a cancelled run whose next PUT fails reports cancelled", async () => {
    // Its first PUT was stored, then the run was dropped: the failure of
    // the PUT after it must not hand that superseded loadout back.
    const run = requestCardSave("a", loadout("a"));
    await tick();
    void requestCardSave("a", loadout("b"));
    waiting.shift()!(true);
    await tick();
    document.dispatchEvent(new CustomEvent("session-cleared"));
    waiting.shift()!(false);
    expect(await run).toEqual({
      result: { ok: false, error: "cancelled" },
      saved: loadout("a"),
    });
  });

  it("a run cancelled with its last PUT out never reports success", async () => {
    // Signed out and back into the same account: the old run's late answer
    // must not pass for the newer run's.
    const old = requestCardSave("a", loadout("old"));
    await tick();
    document.dispatchEvent(new CustomEvent("session-cleared"));
    const next = requestCardSave("a", loadout("new"));
    expect(next).not.toBe(old);
    await tick();
    waiting[1](true);
    expect((await next).result).toEqual({ ok: true, loadout: loadout("new") });
    waiting[0](true);
    expect(await old).toEqual({
      result: { ok: false, error: "cancelled" },
      saved: loadout("old"),
    });
  });
});
