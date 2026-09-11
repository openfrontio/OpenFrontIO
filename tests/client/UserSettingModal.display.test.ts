import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DISPLAY_SETTLE_TIMEOUT_MS,
  type DesktopDisplayPrefsPatch,
  type DesktopDisplaySnapshot,
} from "../../src/client/DesktopDisplay";
import { modalRouter } from "../../src/client/ModalRouter";
import { Platform } from "../../src/client/Platform";
import "../../src/client/UserSettingModal";
import type { UserSettingModal } from "../../src/client/UserSettingModal";

type TestModal = UserSettingModal & {
  updateComplete: Promise<unknown>;
  activeTab: string;
  modalConfig(): { tabs?: { key: string; label: string }[] };
};

const PRIMARY = {
  id: 1,
  label: "Dell U2718Q",
  primary: true,
  bounds: { x: 0, y: 0, width: 2560, height: 1440 },
  scaleFactor: 1,
};

const SECOND = {
  id: 2,
  label: "LG 27GL850",
  primary: false,
  bounds: { x: 2560, y: 0, width: 2560, height: 1440 },
  scaleFactor: 1,
};

function snapshot(
  over: Partial<DesktopDisplaySnapshot> = {},
): DesktopDisplaySnapshot {
  return {
    prefs: { mode: "borderless", displayId: null },
    displays: [PRIMARY],
    activeDisplayId: 1,
    preferredDisplayPresent: true,
    ...over,
  };
}

/**
 * The tab list is shared with other work (a Graphics tab is landing beside
 * this one), so order is asserted RELATIVELY: this file owns where Display
 * sits, not what else is in the list.
 */
function tabKeys(el: TestModal): string[] {
  return el.modalConfig().tabs?.map((t) => t.key) ?? [];
}

/**
 * A stand-in for the shell's `display.*` namespace.
 *
 * `setPrefs` deliberately does NOT resolve on its own: the tab's contract is
 * that it renders what the shell reports, so every test expecting the
 * selection to move has to say what the shell reported.
 */
function fakeBridge(initial: DesktopDisplaySnapshot = snapshot()) {
  const listeners = new Set<(s: DesktopDisplaySnapshot) => void>();
  let unsubscribeCalls = 0;
  let current = initial;
  let pendingSet: {
    patch: DesktopDisplayPrefsPatch;
    resolve: (s: DesktopDisplaySnapshot) => void;
    reject: (e: unknown) => void;
  } | null = null;

  const bridge = {
    getPrefs: vi.fn(async () => current),
    setPrefs: vi.fn(
      (patch: DesktopDisplayPrefsPatch) =>
        new Promise<DesktopDisplaySnapshot>((resolve, reject) => {
          pendingSet = { patch, resolve, reject };
        }),
    ),
    subscribe: vi.fn((cb: (s: DesktopDisplaySnapshot) => void) => {
      listeners.add(cb);
      return () => {
        unsubscribeCalls++;
        listeners.delete(cb);
      };
    }),
  };

  return {
    bridge,
    install() {
      window.openfrontDesktop = { shell: { api: 3 }, display: bridge };
    },
    /** What the next getPrefs() answers with. */
    setStored(next: DesktopDisplaySnapshot) {
      current = next;
    },
    push(next: DesktopDisplaySnapshot) {
      for (const cb of [...listeners]) cb(next);
    },
    settle(next: DesktopDisplaySnapshot) {
      pendingSet?.resolve(next);
      pendingSet = null;
    },
    fail(reason: unknown = new Error("ipc failed")) {
      pendingSet?.reject(reason);
      pendingSet = null;
    },
    listenerCount: () => listeners.size,
    unsubscribeCalls: () => unsubscribeCalls,
  };
}

async function mount(): Promise<TestModal> {
  const el = document.createElement("user-setting") as TestModal;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

/** Let the bridge promises and the resulting Lit update both land. */
async function flush(el: TestModal): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await el.updateComplete;
}

function modeSelect(el: TestModal): HTMLSelectElement | null {
  return el.querySelector("#display-mode-select select");
}

function monitorSelect(el: TestModal): HTMLSelectElement | null {
  return el.querySelector("#display-monitor-select select");
}

function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

// Vitest tears down this file's jsdom when the file ends, but it does NOT
// remove elements from document.body first -- so a component still connected
// at that point never gets disconnectedCallback, and anything it has armed
// outlives the document.
//
// That is not hypothetical here: three of the tests below deliberately leave a
// write in flight, which leaves the 2s settle ceiling armed. When it fired
// after teardown it set a @state field, Lit scheduled an update, and
// modalConfig() -> translateText() -> getCachedLangSelector() reached for a
// `document` that no longer existed. Vitest reports that as an unhandled
// rejection against whichever FILE happened to be running at the time, which
// is why it read as an unrelated flake.
//
// Removing every element here runs disconnectedCallback, which clears the
// timer and the subscription.
afterEach(async () => {
  for (const el of [...document.body.children]) el.remove();
  // Let any update already scheduled run while the document still exists.
  await Promise.resolve();
  window.openfrontDesktop = undefined;
  vi.useRealTimers();
});

function resetDom(): void {
  document.body.innerHTML = "";
  localStorage.clear();
  location.hash = "";
  // Main.ts registers this at boot; the URL sync is a no-op without it.
  modalRouter.register("settings", {
    tag: "user-setting",
    pageId: "page-settings",
  });
}

describe("Display tab visibility", () => {
  beforeEach(resetDom);

  afterEach(() => {
    window.openfrontDesktop = undefined;
  });

  // The web build. No Display tab, and no bridge reference is ever evaluated.
  it("is absent with no desktop shell", async () => {
    window.openfrontDesktop = undefined;
    const el = await mount();
    expect(tabKeys(el)).not.toContain("display");
  });

  it("is absent on a shell older than the display bridge", async () => {
    window.openfrontDesktop = { shell: { api: 2 } };
    const el = await mount();
    expect(tabKeys(el)).not.toContain("display");
  });

  it("is absent on a display namespace missing setPrefs", async () => {
    window.openfrontDesktop = { display: { getPrefs: () => undefined } };
    const el = await mount();
    expect(tabKeys(el)).not.toContain("display");
  });

  // A deep link or a stale bookmark must not reach the tab body on the web:
  // BaseModal validates the requested tab against tabs[].
  it("cannot be opened by name without a bridge", async () => {
    window.openfrontDesktop = undefined;
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);
    expect(el.activeTab).toBe("gameplay");
    expect(modeSelect(el)).toBeNull();
  });

  it("sits after Gameplay and before Audio with a bridge", async () => {
    fakeBridge().install();
    const el = await mount();
    const keys = tabKeys(el);
    expect(keys).toContain("display");
    expect(keys.indexOf("display")).toBeGreaterThan(keys.indexOf("gameplay"));
    expect(keys.indexOf("display")).toBeLessThan(keys.indexOf("audio"));
  });
});

// Keybinds is about having keys, not about screen size, so this is gated on
// the primary pointer rather than a breakpoint.
describe("Keybinds tab on touch devices", () => {
  beforeEach(resetDom);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is present with a fine pointer", async () => {
    vi.spyOn(Platform, "isTouch", "get").mockReturnValue(false);
    const el = await mount();
    expect(tabKeys(el)).toContain("keybinds");
  });

  it("is absent on a touch device", async () => {
    vi.spyOn(Platform, "isTouch", "get").mockReturnValue(true);
    const el = await mount();
    expect(tabKeys(el)).not.toContain("keybinds");
  });

  // Removed from the list, not merely hidden -- so a deep link or a bookmark
  // lands on Gameplay rather than selecting a tab with nothing behind it.
  it("cannot be opened by name on a touch device", async () => {
    vi.spyOn(Platform, "isTouch", "get").mockReturnValue(true);
    const el = await mount();
    el.open({ tab: "keybinds" });
    await flush(el);
    expect(el.activeTab).toBe("gameplay");
  });

  it("leaves the order of the remaining tabs alone", async () => {
    vi.spyOn(Platform, "isTouch", "get").mockReturnValue(true);
    const el = await mount();
    expect(tabKeys(el)).toEqual(["gameplay", "graphics", "audio"]);
  });

  // The Display tab is orthogonal: a touch device with a desktop shell is not
  // a real combination, but the two gates must not interfere.
  it("still hides only Keybinds when the display bridge is present", async () => {
    vi.spyOn(Platform, "isTouch", "get").mockReturnValue(true);
    fakeBridge().install();
    const el = await mount();
    expect(tabKeys(el)).toEqual(["gameplay", "graphics", "display", "audio"]);
  });
});

describe("Display tab contents", () => {
  beforeEach(resetDom);

  afterEach(() => {
    window.openfrontDesktop = undefined;
  });

  // The in-game entry point: SettingsModal opens this same modal on a named
  // tab, so Display has to be reachable that way and not only by clicking
  // across from Gameplay.
  it("opens straight onto Display and reads the snapshot", async () => {
    const fake = fakeBridge();
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);

    expect(el.activeTab).toBe("display");
    expect(fake.bridge.getPrefs).toHaveBeenCalledTimes(1);
    expect(modeSelect(el)?.value).toBe("borderless");
  });

  it("hides the monitor picker with a single display", async () => {
    fakeBridge().install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);
    expect(monitorSelect(el)).toBeNull();
  });

  it("shows the monitor picker with two displays, naming the primary", async () => {
    fakeBridge(snapshot({ displays: [PRIMARY, SECOND] })).install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);

    const options = [...(monitorSelect(el)?.options ?? [])];
    expect(options.map((o) => o.value)).toEqual(["1", "2"]);
    expect(options[0].textContent).toContain("Dell U2718Q");
    expect(options[1].textContent).toContain("LG 27GL850");
    // The primary is marked, so "which one is which" is answerable without
    // dragging the window across to find out.
    expect(options[0].textContent).not.toBe(options[1].textContent);
    expect(options[0].textContent?.trim()).not.toBe("Dell U2718Q");
  });

  // A display id is an opaque OS number, not stable across sessions. An empty
  // label must still produce a readable name, never the bare id.
  it("names an unlabelled display rather than showing its id", async () => {
    const blank = { ...SECOND, label: "   " };
    fakeBridge(snapshot({ displays: [PRIMARY, blank] })).install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);

    const second = [...(monitorSelect(el)?.options ?? [])][1];
    expect(second.textContent?.trim()).not.toBe("");
    expect(second.textContent?.trim()).not.toBe("2");
  });

  // The remembered monitor being unplugged usually drops the count to one,
  // which hides the picker -- so the explanation cannot live inside it.
  it("explains a remembered display that is not connected", async () => {
    fakeBridge(
      snapshot({
        prefs: { mode: "borderless", displayId: 99 },
        preferredDisplayPresent: false,
      }),
    ).install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);

    expect(el.querySelector("#display-missing-note")).not.toBeNull();
    expect(monitorSelect(el)).toBeNull();
  });

  it("says nothing about a missing display when none is missing", async () => {
    fakeBridge().install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);
    expect(el.querySelector("#display-missing-note")).toBeNull();
  });

  // Borderless removes the title bar, so the way back out is worth naming.
  it("tells the player F11 toggles the mode", async () => {
    fakeBridge().install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);
    expect(el.querySelector("#display-f11-hint")).not.toBeNull();
  });

  // null means "the OS primary", so it has to be resolved to the primary's id
  // before asking whether the preference is still present -- no display has
  // id null, so asking first made every null preference look absent.
  it("shows the primary when the preference is null and the window is not there", async () => {
    fakeBridge(
      snapshot({
        prefs: { mode: "borderless", displayId: null },
        displays: [PRIMARY, SECOND],
        activeDisplayId: 2,
      }),
    ).install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);
    expect(monitorSelect(el)?.value).toBe("1");
  });

  // The same bug's other half: picking Primary sends null, the snapshot comes
  // back with null, and the control used to snap straight back to the
  // secondary -- making "Primary" impossible to select at all.
  it("keeps Primary selected after the shell echoes a null preference", async () => {
    const fake = fakeBridge(
      snapshot({
        prefs: { mode: "borderless", displayId: 2 },
        displays: [PRIMARY, SECOND],
        activeDisplayId: 2,
      }),
    );
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);

    choose(monitorSelect(el)!, "1");
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledWith({ displayId: null });

    // The window has not moved yet, so activeDisplayId is still the secondary.
    fake.settle(
      snapshot({
        prefs: { mode: "borderless", displayId: null },
        displays: [PRIMARY, SECOND],
        activeDisplayId: 2,
      }),
    );
    await flush(el);
    expect(monitorSelect(el)?.value).toBe("1");
  });

  it("falls back to the active display when the remembered one is gone", async () => {
    fakeBridge(
      snapshot({
        prefs: { mode: "windowed", displayId: 99 },
        displays: [PRIMARY, SECOND],
        activeDisplayId: 2,
        preferredDisplayPresent: false,
      }),
    ).install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);
    expect(monitorSelect(el)?.value).toBe("2");
  });
});

describe("Display tab writes", () => {
  beforeEach(resetDom);

  afterEach(() => {
    window.openfrontDesktop = undefined;
    vi.useRealTimers();
  });

  it("sends a mode patch and re-renders from what the shell reports", async () => {
    const fake = fakeBridge();
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);

    choose(modeSelect(el)!, "windowed");
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledWith({ mode: "windowed" });

    fake.settle(snapshot({ prefs: { mode: "windowed", displayId: null } }));
    await flush(el);
    expect(modeSelect(el)?.value).toBe("windowed");
  });

  // null is what "the OS primary" MEANS to the shell. Storing the primary's
  // id instead would strand a player if the OS primary later changed.
  it("stores the primary display as null, not as its id", async () => {
    const fake = fakeBridge(
      snapshot({
        prefs: { mode: "borderless", displayId: 2 },
        displays: [PRIMARY, SECOND],
        activeDisplayId: 2,
      }),
    );
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);

    choose(monitorSelect(el)!, "1");
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledWith({ displayId: null });
  });

  it("sends the chosen id for a display that is not the primary", async () => {
    const fake = fakeBridge(snapshot({ displays: [PRIMARY, SECOND] }));
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);

    choose(monitorSelect(el)!, "2");
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledWith({ displayId: 2 });
  });

  it("disables both controls while a change is in flight", async () => {
    const fake = fakeBridge(snapshot({ displays: [PRIMARY, SECOND] }));
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);
    expect(modeSelect(el)?.disabled).toBe(false);

    choose(modeSelect(el)!, "windowed");
    await flush(el);
    expect(modeSelect(el)?.disabled).toBe(true);
    expect(monitorSelect(el)?.disabled).toBe(true);

    fake.settle(
      snapshot({
        prefs: { mode: "windowed", displayId: null },
        displays: [PRIMARY, SECOND],
      }),
    );
    await flush(el);
    expect(modeSelect(el)?.disabled).toBe(false);
  });

  it("ignores a second change while the first is still settling", async () => {
    const fake = fakeBridge(snapshot({ displays: [PRIMARY, SECOND] }));
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);

    choose(modeSelect(el)!, "windowed");
    await flush(el);
    choose(monitorSelect(el)!, "2");
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledTimes(1);
  });

  // A push is the shell's current truth, and it is what normally settles a
  // write -- the shell emits it as part of applying the change.
  it("re-renders from a pushed snapshot and settles the write", async () => {
    const fake = fakeBridge();
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);

    choose(modeSelect(el)!, "windowed");
    await flush(el);
    expect(modeSelect(el)?.disabled).toBe(true);

    fake.push(snapshot({ prefs: { mode: "windowed", displayId: null } }));
    await flush(el);
    expect(modeSelect(el)?.value).toBe("windowed");
    expect(modeSelect(el)?.disabled).toBe(false);
  });

  // An unplugged monitor arrives with no write in flight at all.
  it("re-renders from an unsolicited push", async () => {
    const fake = fakeBridge(snapshot({ displays: [PRIMARY, SECOND] }));
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);
    expect(monitorSelect(el)).not.toBeNull();

    fake.push(
      snapshot({
        prefs: { mode: "borderless", displayId: 2 },
        displays: [PRIMARY],
        preferredDisplayPresent: false,
      }),
    );
    await flush(el);
    expect(monitorSelect(el)).toBeNull();
    expect(el.querySelector("#display-missing-note")).not.toBeNull();
  });

  // The shell answers a patch it REFUSES with the state that actually holds,
  // so a rejection means the bridge itself broke. Keep the real mode on
  // screen, re-enable, and never throw out of a settings change handler.
  it("keeps the previous value and re-enables when setPrefs rejects", async () => {
    const fake = fakeBridge();
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);

    choose(modeSelect(el)!, "windowed");
    await flush(el);
    fake.fail();
    await flush(el);

    expect(modeSelect(el)?.value).toBe("borderless");
    expect(modeSelect(el)?.disabled).toBe(false);
  });

  // The bridge that never answers: no push, no resolve, no rejection. The
  // disabled state has to have a ceiling, and what the player ends up looking
  // at has to be the shell's state rather than the click they made.
  it("re-enables and re-reads when the shell never answers", async () => {
    vi.useFakeTimers();
    const fake = fakeBridge();
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);
    expect(fake.bridge.getPrefs).toHaveBeenCalledTimes(1);

    choose(modeSelect(el)!, "windowed");
    await flush(el);
    expect(modeSelect(el)?.disabled).toBe(true);

    // Still waiting just short of the ceiling.
    vi.advanceTimersByTime(1999);
    await flush(el);
    expect(modeSelect(el)?.disabled).toBe(true);
    expect(fake.bridge.getPrefs).toHaveBeenCalledTimes(1);

    fake.setStored(snapshot({ prefs: { mode: "windowed", displayId: null } }));
    vi.advanceTimersByTime(1);
    await flush(el);

    expect(modeSelect(el)?.disabled).toBe(false);
    expect(fake.bridge.getPrefs).toHaveBeenCalledTimes(2);
    expect(modeSelect(el)?.value).toBe("windowed");
  });

  // ...and the re-read failing too must not leave the tab disabled.
  it("re-enables even when the re-read fails as well", async () => {
    vi.useFakeTimers();
    const fake = fakeBridge();
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);

    choose(modeSelect(el)!, "windowed");
    await flush(el);
    fake.bridge.getPrefs.mockRejectedValueOnce(new Error("ipc failed"));
    vi.advanceTimersByTime(2000);
    await flush(el);

    expect(modeSelect(el)?.disabled).toBe(false);
    expect(modeSelect(el)?.value).toBe("borderless");
  });

  // A snapshot this build cannot read (a mode from a newer shell) must leave
  // the last good one on screen rather than blanking the control.
  it("ignores a snapshot it cannot read", async () => {
    const fake = fakeBridge();
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);

    fake.push({
      ...snapshot(),
      prefs: { mode: "exclusive-fullscreen", displayId: null },
    } as unknown as DesktopDisplaySnapshot);
    await flush(el);
    expect(modeSelect(el)?.value).toBe("borderless");
  });

  // ...and it must not RETIRE a write either. Dropping the snapshot is only
  // half of it: bumping the request id and settling on an unreadable push
  // would discard the real answer still in flight, so the player's change
  // would read as reverted even though the shell had applied it.
  it("does not let an unreadable push settle a write", async () => {
    vi.useFakeTimers();
    const fake = fakeBridge();
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);

    choose(modeSelect(el)!, "windowed");
    await flush(el);
    expect(modeSelect(el)?.disabled).toBe(true);

    fake.push({
      ...snapshot(),
      prefs: { mode: "exclusive-fullscreen", displayId: null },
    } as unknown as DesktopDisplaySnapshot);
    await flush(el);
    // Still waiting: the unreadable push settled nothing.
    expect(modeSelect(el)?.disabled).toBe(true);

    // The real answer is still adopted when it arrives...
    fake.settle(snapshot({ prefs: { mode: "windowed", displayId: null } }));
    await flush(el);
    expect(modeSelect(el)?.value).toBe("windowed");
    expect(modeSelect(el)?.disabled).toBe(false);

    // ...and the ceiling was cleared by that real settle, not left armed.
    const readsSoFar = fake.bridge.getPrefs.mock.calls.length;
    vi.advanceTimersByTime(DISPLAY_SETTLE_TIMEOUT_MS);
    await flush(el);
    expect(fake.bridge.getPrefs).toHaveBeenCalledTimes(readsSoFar);
  });
});

describe("Display tab subscription lifecycle", () => {
  beforeEach(resetDom);

  afterEach(() => {
    window.openfrontDesktop = undefined;
    vi.useRealTimers();
  });

  it("subscribes on entering the tab and unsubscribes on close", async () => {
    const fake = fakeBridge();
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);
    expect(fake.listenerCount()).toBe(1);

    el.close();
    await flush(el);
    expect(fake.listenerCount()).toBe(0);
    expect(fake.unsubscribeCalls()).toBe(1);
  });

  it("unsubscribes when the player moves to another tab", async () => {
    const fake = fakeBridge();
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);
    expect(fake.listenerCount()).toBe(1);

    el.setActiveTab("audio");
    await flush(el);
    expect(fake.listenerCount()).toBe(0);
  });

  // Entering is re-entrant by contract: BaseModal reaches it from onTabEnter,
  // which fires on every open as well as on every tab change, and a second
  // subscribe without a matching unsubscribe leaks one listener per entry for
  // the life of the page. Driven directly because today's BaseModal happens
  // not to enter twice in a row — a guard nothing can trip is not a guard.
  it("does not stack listeners when the tab is entered twice", async () => {
    const fake = fakeBridge();
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);
    expect(fake.listenerCount()).toBe(1);

    (el as unknown as { onTabEnter(key: string): void }).onTabEnter("display");
    await flush(el);
    expect(fake.listenerCount()).toBe(1);
    expect(fake.unsubscribeCalls()).toBe(1);
  });

  it("never stacks listeners across repeated opens", async () => {
    const fake = fakeBridge();
    fake.install();
    const el = await mount();

    for (let i = 0; i < 3; i++) {
      el.open({ tab: "display" });
      await flush(el);
      expect(fake.listenerCount()).toBe(1);
      el.close();
      await flush(el);
      expect(fake.listenerCount()).toBe(0);
    }
    expect(fake.unsubscribeCalls()).toBe(3);
  });

  it("unsubscribes when the element is torn down without closing", async () => {
    const fake = fakeBridge();
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);

    el.remove();
    await Promise.resolve();
    expect(fake.listenerCount()).toBe(0);
  });

  // Nothing in flight when the tab closed may land on the next open and
  // re-enable controls, or overwrite a snapshot read since.
  it("drops a write that answers after the tab closed", async () => {
    const fake = fakeBridge();
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);

    choose(modeSelect(el)!, "windowed");
    await flush(el);
    el.close();
    await flush(el);

    // The reopen's own read is left hanging deliberately. If it answered, it
    // would overwrite the stale value with the truth and this test would pass
    // whether or not the guard exists -- the stale "windowed" has to be the
    // ONLY thing that could move the control.
    fake.bridge.getPrefs.mockImplementation(
      () => new Promise<DesktopDisplaySnapshot>(() => undefined),
    );
    el.open({ tab: "display" });
    await flush(el);

    fake.settle(snapshot({ prefs: { mode: "windowed", displayId: null } }));
    await flush(el);
    expect(modeSelect(el)?.value).toBe("borderless");
  });

  // A push is strictly newer than any request that has not answered yet, so
  // it has to invalidate them. Otherwise a slow initial read lands after a
  // monitor-unplugged push and overwrites fresher truth with staler truth.
  it("drops a read that answers after a push", async () => {
    const fake = fakeBridge();
    let resolveRead: ((s: DesktopDisplaySnapshot) => void) | null = null;
    fake.bridge.getPrefs.mockImplementation(
      () =>
        new Promise<DesktopDisplaySnapshot>((resolve) => {
          resolveRead = resolve;
        }),
    );
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);

    // The push wins the race.
    fake.push(snapshot({ prefs: { mode: "windowed", displayId: null } }));
    await flush(el);
    expect(modeSelect(el)?.value).toBe("windowed");

    // ...and the read it overtook must not undo it.
    resolveRead!(snapshot({ prefs: { mode: "borderless", displayId: null } }));
    await flush(el);
    expect(modeSelect(el)?.value).toBe("windowed");
  });

  // Disconnecting is the one teardown path the modal does not control: the
  // in-game instance goes away with the match, with no close() first. Nothing
  // it had in flight may keep talking to the bridge afterwards -- both because
  // the answer is useless and because touching @state on a detached element
  // schedules a Lit update against a document that may be gone.
  it("goes quiet when disconnected with a write in flight", async () => {
    const fake = fakeBridge();
    fake.install();
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);
    const readsBeforeTeardown = fake.bridge.getPrefs.mock.calls.length;

    choose(modeSelect(el)!, "windowed");
    await flush(el);
    el.remove();
    await flush(el);

    // The subscription is gone...
    expect(fake.listenerCount()).toBe(0);
    // ...the in-flight write's answer is ignored...
    fake.settle(snapshot({ prefs: { mode: "windowed", displayId: null } }));
    await flush(el);
    // ...and the ceiling does not fire a re-read at a dead element.
    vi.useFakeTimers();
    vi.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(fake.bridge.getPrefs).toHaveBeenCalledTimes(readsBeforeTeardown);
  });

  // A shell that exposes getPrefs/setPrefs but no push. The tab must still
  // work -- subscribe is not part of the availability test.
  it("works against a bridge with no subscribe", async () => {
    const fake = fakeBridge();
    window.openfrontDesktop = {
      display: {
        getPrefs: fake.bridge.getPrefs,
        setPrefs: fake.bridge.setPrefs,
      },
    };
    const el = await mount();
    el.open({ tab: "display" });
    await flush(el);

    expect(modeSelect(el)?.value).toBe("borderless");
    choose(modeSelect(el)!, "windowed");
    await flush(el);
    fake.settle(snapshot({ prefs: { mode: "windowed", displayId: null } }));
    await flush(el);
    expect(modeSelect(el)?.value).toBe("windowed");
  });
});
