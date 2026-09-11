import { setTimeout as nodeDelay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LEAK_DELAY_MS,
  lateUpdates,
  type TeardownLeaker,
} from "./LeakyElement";

/**
 * The control for tests/domTeardown.ts. The first test here deliberately leaves
 * a component mounted with a late update armed; the rest assert the global hook
 * cleaned up after it. Disable the afterEach in tests/domTeardown.ts and this
 * file fails.
 *
 * WHAT A LEAK ACTUALLY COSTS, MEASURED
 *
 * The escape route these leaks are usually described as taking -- work landing
 * after the file's jsdom is gone -- could not be reproduced on Vitest 4.1.5.
 * Two things close it: the jsdom teardown calls `dom.window.close()`, and jsdom
 * stops every timer it owns, so a leaked setTimeout is cancelled outright; and
 * with the default forks pool each file gets its own child process, which exits
 * at the end of the file, so a promise settled by Node cannot reach it either.
 * Removing #5357's guard and running the whole suite with this hook disabled
 * produced no unhandled rejection at all.
 *
 * What is reproducible, and what these tests pin, is the leak WITHIN the file:
 * the element outlives the test that mounted it, so the next test starts with
 * someone else's DOM and someone else's timer armed against it. That is a real
 * cost -- removing the ad-hoc cleanup from
 * tests/client/UserSettingModal.graphics.test.ts fails 18 of its tests without
 * this hook -- and it is the same disconnectedCallback that never runs in
 * either story, so fixing it closes both.
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
});
