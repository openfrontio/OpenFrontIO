import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdGatekeeper } from "../src/client/AdGatekeeper";

const STORAGE_KEY = "adblock-detected";

// A probe whose reading we flip at will, so we can drive the state machine
// without a real adblocker (jsdom does no layout, so the DOM bait is useless).
function controllableProbe() {
  const ref = { blocked: false };
  return { ref, probe: () => Promise.resolve(ref.blocked) };
}

// Flush the async probe microtask (no timers involved in the state machine now).
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("AdGatekeeper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it("clears (shows ads) for a user who has been blocker-free", async () => {
    const { probe } = controllableProbe(); // adblock off
    const gate = new AdGatekeeper({ probe });
    let cleared = 0;
    gate.whenClear(() => cleared++);
    gate.start();

    await flush();
    expect(gate.canShowAds).toBe(true);
    expect(cleared).toBe(1);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull(); // clean users aren't persisted

    gate.stop();
  });

  it("stays blocked while adblock is on", async () => {
    const { ref, probe } = controllableProbe();
    ref.blocked = true;
    const gate = new AdGatekeeper({ probe });
    gate.start();

    await flush();
    expect(gate.canShowAds).toBe(false);

    gate.stop();
  });

  it("is terminal: disabling the blocker does NOT unlock ads", async () => {
    const { ref, probe } = controllableProbe();
    ref.blocked = true;
    const gate = new AdGatekeeper({ probe });
    let cleared = 0;
    gate.whenClear(() => cleared++);
    gate.start();
    await flush();
    expect(gate.canShowAds).toBe(false);

    // User turns the blocker off; a re-check runs but the verdict stands.
    ref.blocked = false;
    window.dispatchEvent(new Event("focus"));
    await flush();
    expect(gate.canShowAds).toBe(false);
    expect(cleared).toBe(0);

    gate.stop();
  });

  it("latches blocked if the blocker is enabled after a clean start", async () => {
    const { ref, probe } = controllableProbe(); // starts off → clear
    const gate = new AdGatekeeper({ probe });
    gate.start();
    await flush();
    expect(gate.canShowAds).toBe(true);

    ref.blocked = true;
    window.dispatchEvent(new Event("focus"));
    await flush();
    expect(gate.canShowAds).toBe(false);

    gate.stop();
  });

  it("seed latches blocked terminally", async () => {
    const { probe } = controllableProbe(); // bait reads unblocked
    const gate = new AdGatekeeper({ probe });
    gate.start();
    await flush();
    expect(gate.canShowAds).toBe(true);

    gate.seed(true);
    expect(gate.canShowAds).toBe(false);

    // A later "unblocked" seed cannot revive it.
    gate.seed(false);
    expect(gate.canShowAds).toBe(false);

    gate.stop();
  });

  it("seed is ignored before start()", () => {
    const { probe } = controllableProbe();
    const gate = new AdGatekeeper({ probe });
    gate.seed(true);
    expect(gate.canShowAds).toBe(false);
  });

  it("whenClear fires synchronously once already clear", async () => {
    const { probe } = controllableProbe();
    const gate = new AdGatekeeper({ probe });
    gate.start();
    await flush();
    expect(gate.canShowAds).toBe(true);

    let fired = false;
    gate.whenClear(() => (fired = true));
    expect(fired).toBe(true);

    gate.stop();
  });

  it("persists the block so a future session stays suppressed even with adblock off", async () => {
    const { ref, probe } = controllableProbe();
    ref.blocked = true;
    const g1 = new AdGatekeeper({ probe });
    g1.start();
    await flush();
    expect(g1.canShowAds).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1");
    g1.stop();

    // New session: adblock now OFF, but the persisted verdict stands.
    let fired = false;
    const g2 = new AdGatekeeper({ probe: () => Promise.resolve(false) });
    g2.whenClear(() => (fired = true));
    g2.start();
    await flush();
    expect(g2.canShowAds).toBe(false);
    expect(fired).toBe(false);
    g2.stop();
  });

  it("a pre-existing persisted flag latches blocked on start without probing", async () => {
    localStorage.setItem(STORAGE_KEY, "1");
    let probed = false;
    const gate = new AdGatekeeper({
      probe: () => {
        probed = true;
        return Promise.resolve(false);
      },
    });
    gate.start();
    await flush();
    expect(gate.canShowAds).toBe(false);
    expect(probed).toBe(false); // verdict was already final — never probed
    gate.stop();
  });
});
