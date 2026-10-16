import { setTimeout as nodeDelay } from "node:timers/promises";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { drainFakeTimers, removeAndSettle } from "../../domTeardown";
import {
  disconnects,
  lateUpdates,
  LEAK_DELAY_MS,
  type TeardownLeaker,
} from "./LeakyElement";

/**
 * The control for tests/domTeardown.ts. The first test here deliberately leaves
 * a component mounted with a late update armed; the rest assert the global hook
 * cleaned up after it. Disable the afterEach in tests/domTeardown.ts and this
 * file fails.
 *
 * A leaked timer really can outlive the environment: `globalThis.setTimeout` is
 * Node's, not jsdom's, so `dom.window.close()` does not cancel it, and the
 * worker keeps running timers for a while after the teardown has deleted
 * `document`. The mechanism, and how it was measured, is written up in
 * tests/domTeardown.ts.
 *
 * That window is ~10 ms here and only wide enough to catch a timer that happens
 * to land inside it, which is why the CI failure was intermittent and why these
 * tests do not try to reproduce it directly. They pin the deterministic half:
 * the element and its timer are gone as soon as the test that mounted them
 * ends. Disable the afterEach in tests/domTeardown.ts and this file fails --
 * and so do 18 tests in tests/client/UserSettingModal.graphics.test.ts, which
 * had grown its own copy of this cleanup.
 */

let leaked: TeardownLeaker | null = null;
const order: string[] = [];
const drained: string[] = [];

// Registered at import time, so Vitest registers it AFTER the setup file's
// hooks. afterEach is LIFO within a file, so this one runs FIRST and still sees
// what the test mounted. If that order ever inverts, the second test catches it.
afterEach(() => {
  if (!leaked) return;
  order.push(
    document.body.contains(leaked) ? "file-hook-first" : "global-hook-first",
  );
});

describe("global DOM teardown", () => {
  it("leaves a component mounted with a late update armed", async () => {
    leaked = document.createElement("teardown-leaker") as TeardownLeaker;
    document.body.appendChild(leaked);
    await leaked.updateComplete;

    expect(document.body.contains(leaked)).toBe(true);
    expect(lateUpdates.count).toBe(0);
    // Deliberately no cleanup: this is the leak the global hook exists for.
  });

  it("removed it once the test ended, without pre-empting this file's hooks", () => {
    expect(order).toEqual(["file-hook-first"]);
    expect(document.body.children.length).toBe(0);
    expect(leaked!.isConnected).toBe(false);
  });

  it("disarmed what it had armed", async () => {
    // Well past the point the leaked update was scheduled for.
    // disconnectedCallback cleared the timer, so it never fires; leave the
    // element mounted and this is 1, in a test that never asked for it.
    await nodeDelay(LEAK_DELAY_MS * 4);
    expect(lateUpdates.count).toBe(0);
  });

  it("leaves a pending fake timer behind", () => {
    vi.useFakeTimers();
    setTimeout(() => drained.push("armed-under-fake-timers"), 5_000);

    expect(drained).toEqual([]);
    // Deliberately neither advanced nor restored: vi.useRealTimers() discards
    // the fake clock, so without the hook's drain this callback never runs.
  });

  it("drained it and handed control back to real timers", async () => {
    expect(drained).toEqual(["armed-under-fake-timers"]);
    expect(vi.isFakeTimers()).toBe(false);
    // Would hang if fake timers were still installed.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  // The drain is deliberately not error-swallowing: a pending callback that
  // throws is the test's own code failing, and afterEach runs per test, so
  // letting it propagate fails the test that armed it. Catching it would turn
  // that failure into a pass. Asserted against the helper rather than the hook,
  // because a hook that throws fails its test by design -- there is no vantage
  // point inside a passing test from which to watch it happen.
  it("surfaces an error thrown by a drained timer, real timers restored", () => {
    vi.useFakeTimers();
    setTimeout(() => {
      throw new Error("armed and dangerous");
    }, 1_000);

    expect(() => drainFakeTimers()).toThrow("armed and dangerous");
    expect(vi.isFakeTimers()).toBe(false);
  });

  it("is a no-op when the test already restored real timers", () => {
    expect(vi.isFakeTimers()).toBe(false);
    expect(() => drainFakeTimers()).not.toThrow();
  });
});

/**
 * The afterAll sweep is what gives a beforeAll fixture its disconnectedCallback.
 * It cannot be asserted from inside a test file -- running last is the point, so
 * nothing here runs after it to look -- so the two halves are covered
 * separately: that the per-test hook SPARES such a fixture, which is observable,
 * and that removeAndSettle (all the sweep does) disconnects it, which is
 * testable directly.
 */
describe("what the afterAll sweep is left holding", () => {
  let fixture: TeardownLeaker;

  beforeAll(() => {
    fixture = document.createElement("teardown-leaker") as TeardownLeaker;
    document.body.appendChild(fixture);
  });

  it("mounts a transient element alongside the fixture", async () => {
    const transient = document.createElement("teardown-leaker");
    document.body.appendChild(transient);
    await (transient as TeardownLeaker).updateComplete;

    expect(document.body.children.length).toBe(2);
  });

  it("took the transient element and spared the fixture", () => {
    expect([...document.body.children]).toEqual([fixture]);
  });

  it("removeAndSettle disconnects what is left", async () => {
    const before = disconnects.count;

    await removeAndSettle([...document.body.children]);

    expect(disconnects.count).toBe(before + 1);
    expect(fixture.isConnected).toBe(false);
    expect(document.body.children.length).toBe(0);
  });
});
