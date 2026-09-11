import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopDisplaySnapshot } from "../../src/client/DesktopDisplay";
import { modalRouter } from "../../src/client/ModalRouter";
import "../../src/client/UserSettingModal";
import type { UserSettingModal } from "../../src/client/UserSettingModal";

type TestModal = UserSettingModal & {
  updateComplete: Promise<unknown>;
  activeTab: string;
  open(args?: Record<string, unknown>): void;
};

const SNAPSHOT: DesktopDisplaySnapshot = {
  prefs: { mode: "borderless", displayId: null },
  displays: [
    {
      id: 1,
      label: "Dell U2718Q",
      primary: true,
      bounds: { x: 0, y: 0, width: 2560, height: 1440 },
      scaleFactor: 1,
    },
  ],
  activeDisplayId: 1,
  preferredDisplayPresent: true,
};

/**
 * A shell exposing both namespaces the Display tab needs. `quit` is separate
 * from `display` on purpose: the tab and the button feature-detect on
 * different methods, and the tests below turn one off without the other.
 */
function installShell(over: { quit?: unknown; display?: unknown } = {}): {
  quit: ReturnType<typeof vi.fn>;
} {
  const quit = vi.fn(async () => undefined);
  window.openfrontDesktop = {
    shell: { api: 4 },
    display: {
      getPrefs: vi.fn(async () => SNAPSHOT),
      setPrefs: vi.fn(async () => SNAPSHOT),
      listDisplays: vi.fn(async () => SNAPSHOT.displays),
      subscribe: vi.fn(() => () => {}),
    },
    quit,
    ...over,
  };
  return { quit };
}

async function mountOnDisplay(): Promise<TestModal> {
  const el = document.createElement("user-setting") as TestModal;
  document.body.appendChild(el);
  await el.updateComplete;
  el.open({ tab: "display" });
  await el.updateComplete;
  // Let the tab's getPrefs() round trip and the resulting update land.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await el.updateComplete;
  return el;
}

function quitButton(el: TestModal): HTMLButtonElement | null {
  return el.querySelector("#desktop-quit-button");
}

// See the note in UserSettingModal.display.test.ts: vitest tears down the
// jsdom without removing elements first, so anything still connected never
// gets disconnectedCallback and whatever it armed outlives the document.
afterEach(async () => {
  for (const el of [...document.body.children]) el.remove();
  await Promise.resolve();
  window.openfrontDesktop = undefined;
  vi.useRealTimers();
});

function resetDom(): void {
  document.body.innerHTML = "";
  localStorage.clear();
  location.hash = "";
  modalRouter.register("settings", {
    tag: "user-setting",
    pageId: "page-settings",
  });
}

describe("the Exit game control", () => {
  beforeEach(resetDom);

  it("renders on a desktop shell that exposes quit()", async () => {
    installShell();
    const el = await mountOnDisplay();
    expect(el.activeTab).toBe("display");
    expect(quitButton(el)).not.toBeNull();
  });

  // The regression that matters most: a Quit button on the web is a button
  // that cannot work. The web build has no bridge at all, so it has no Display
  // tab either -- asserted here from the rendered body rather than from the
  // tab list, because that is the thing a player would see.
  it("is absent with no desktop shell", async () => {
    window.openfrontDesktop = undefined;
    const el = document.createElement("user-setting") as TestModal;
    document.body.appendChild(el);
    await el.updateComplete;
    el.open({ tab: "display" });
    await el.updateComplete;
    expect(quitButton(el)).toBeNull();
  });

  // CrazyGames is a web build: it sets no openfrontDesktop global, so it is
  // covered by the case above. This is the one that is NOT covered by it --
  // the shell currently in the Steam depot, which has display.* but no quit().
  // The Display tab must still render; only the button goes.
  it("is absent on a shell with display.* but no quit()", async () => {
    installShell({ quit: undefined });
    const el = await mountOnDisplay();
    expect(el.activeTab).toBe("display");
    // The tab itself is still there, so this is not passing for the trivial
    // reason that nothing rendered.
    expect(el.querySelector("#display-mode-select")).not.toBeNull();
    expect(quitButton(el)).toBeNull();
  });

  it("asks the shell to quit when pressed", async () => {
    const { quit } = installShell();
    const el = await mountOnDisplay();
    quitButton(el)!.click();
    expect(quit).toHaveBeenCalledTimes(1);
  });

  // No confirmation dialog, by decision (see renderQuitControl). Quitting from
  // here is the same action as closing the window, which has never asked. If
  // someone adds a confirm later this fails, which is the point: it should be
  // a deliberate change, not one that slips in with a component swap.
  it("quits on the first press, with nothing in between", async () => {
    const { quit } = installShell();
    const el = await mountOnDisplay();
    // The modal's own chrome has buttons of its own, so this is a before/after
    // comparison rather than a count: what must not happen is a confirmation
    // appearing between the press and the quit.
    const before = el.querySelectorAll("button").length;
    quitButton(el)!.click();
    await el.updateComplete;
    expect(quit).toHaveBeenCalledTimes(1);
    expect(el.querySelectorAll("button").length).toBe(before);
  });

  // The tab withholds its selects until the shell's first snapshot arrives.
  // The way out must not be withheld with them -- it reads nothing from that
  // snapshot, and a player waiting on a wedged IPC read is exactly the player
  // who wants it.
  it("renders before the first display snapshot arrives", async () => {
    const { quit } = installShell({
      display: {
        // Never settles, so no snapshot is ever adopted.
        getPrefs: vi.fn(() => new Promise<DesktopDisplaySnapshot>(() => {})),
        setPrefs: vi.fn(async () => SNAPSHOT),
        subscribe: vi.fn(() => () => {}),
      },
    });
    const el = await mountOnDisplay();
    expect(el.querySelector("#display-mode-select")).toBeNull();
    expect(quitButton(el)).not.toBeNull();
    quitButton(el)!.click();
    expect(quit).toHaveBeenCalledTimes(1);
  });

  // A shell whose quit() rejects (the renderer torn down mid-invoke is the
  // ordinary case) must not produce an unhandled rejection out of a click
  // handler. requestDesktopQuit owns that; this checks it through the button.
  it("survives a quit() that rejects", async () => {
    window.openfrontDesktop = {
      shell: { api: 4 },
      display: {
        getPrefs: vi.fn(async () => SNAPSHOT),
        setPrefs: vi.fn(async () => SNAPSHOT),
        subscribe: vi.fn(() => () => {}),
      },
      quit: () => Promise.reject(new Error("channel closed")),
    };
    const el = await mountOnDisplay();
    expect(() => quitButton(el)!.click()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});
