import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DISPLAY_SETTLE_TIMEOUT_MS,
  type DesktopDisplaySnapshot,
} from "../../src/client/DesktopDisplay";
import "../../src/client/hud/layers/GameRightSidebar";
import type { GameRightSidebar } from "../../src/client/hud/layers/GameRightSidebar";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";

type TestSidebar = GameRightSidebar & { updateComplete: Promise<unknown> };

const DISPLAY = {
  id: 1,
  label: "Dell U2718Q",
  primary: true,
  bounds: { x: 0, y: 0, width: 2560, height: 1440 },
  scaleFactor: 1,
};

function snapshot(mode: "windowed" | "borderless"): DesktopDisplaySnapshot {
  return {
    prefs: { mode, displayId: null },
    displays: [DISPLAY],
    activeDisplayId: 1,
    preferredDisplayPresent: true,
  };
}

function fakeGame(): GameView {
  const config = {
    gameConfig: () => ({ maxTimerValue: undefined }),
    doomsdayClockConfig: () => ({ enabled: false }),
    overtimeConfig: () => ({ enabled: false, startMinutes: 0 }),
    isReplay: () => false,
    listed: true,
  };
  return {
    config: () => config,
    inSpawnPhase: () => false,
    elapsedGameSeconds: () => 0,
    myPlayer: () => undefined,
    gameID: () => "test-game",
  } as unknown as GameView;
}

function fakeBridge(initial = snapshot("borderless")) {
  const listeners = new Set<(s: DesktopDisplaySnapshot) => void>();
  let unsubscribeCalls = 0;
  const bridge = {
    getPrefs: vi.fn(async () => initial),
    setPrefs: vi.fn(async () => initial),
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
    push(next: DesktopDisplaySnapshot) {
      for (const cb of [...listeners]) cb(next);
    },
    listenerCount: () => listeners.size,
    unsubscribeCalls: () => unsubscribeCalls,
  };
}

async function mount(): Promise<TestSidebar> {
  const el = document.createElement("game-right-sidebar") as TestSidebar;
  el.game = fakeGame();
  el.eventBus = new EventBus();
  document.body.appendChild(el);
  await flush(el);
  return el;
}

async function flush(el: TestSidebar): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await el.updateComplete;
}

function fullscreenButton(el: TestSidebar): HTMLImageElement {
  const images = [
    ...el.renderRoot.querySelectorAll<HTMLImageElement>("img"),
  ].filter((img) => img.alt !== "settings" && img.alt !== "exit");
  return images[0];
}

function clickFullscreen(el: TestSidebar): void {
  fullscreenButton(el).parentElement!.dispatchEvent(
    new MouseEvent("click", { bubbles: true }),
  );
}

// Elements mounted by a test are removed by the global DOM teardown in
// tests/domTeardown.ts, which runs after this file's own hooks. Only the
// globals this file installs need undoing here.
afterEach(() => {
  window.openfrontDesktop = undefined;
  vi.useRealTimers();
});

describe("GameRightSidebar fullscreen button", () => {
  let requestFullscreen: ReturnType<typeof vi.fn>;
  let exitFullscreen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    requestFullscreen = vi.fn(async () => undefined);
    exitFullscreen = vi.fn(async () => undefined);
    // jsdom implements neither, and the sidebar's web path gates its own
    // rendering on fullscreenEnabled.
    Object.defineProperty(document, "fullscreenEnabled", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(document, "fullscreenElement", {
      value: null,
      writable: true,
      configurable: true,
    });
    document.documentElement.requestFullscreen =
      requestFullscreen as unknown as HTMLElement["requestFullscreen"];
    document.exitFullscreen =
      exitFullscreen as unknown as Document["exitFullscreen"];
  });

  afterEach(() => {
    window.openfrontDesktop = undefined;
    vi.useRealTimers();
  });

  // The web build, and any shell older than the display bridge. Unchanged.
  it("uses HTML fullscreen with no desktop shell", async () => {
    window.openfrontDesktop = undefined;
    const el = await mount();

    clickFullscreen(el);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it("leaves HTML fullscreen the same way on the web", async () => {
    window.openfrontDesktop = undefined;
    const el = await mount();
    (document as { fullscreenElement: Element | null }).fullscreenElement =
      document.documentElement;

    clickFullscreen(el);
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  // On the desktop the button toggles the SHELL's window mode. Going through
  // requestFullscreen there would put the Electron window into a fullscreen
  // state the shell's stored preference does not know about.
  it("toggles the shell's window mode instead of HTML fullscreen", async () => {
    const fake = fakeBridge(snapshot("borderless"));
    fake.install();
    const el = await mount();

    clickFullscreen(el);
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledWith({ mode: "windowed" });
    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it("toggles back to borderless from windowed", async () => {
    const fake = fakeBridge(snapshot("windowed"));
    fake.install();
    const el = await mount();

    clickFullscreen(el);
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledWith({ mode: "borderless" });
  });

  it("reads the shell's mode when the sidebar mounts", async () => {
    const fake = fakeBridge(snapshot("borderless"));
    fake.install();
    const el = await mount();
    expect(fake.bridge.getPrefs).toHaveBeenCalledTimes(1);
    // Borderless fills the screen, so the button offers the way out of it.
    expect(fullscreenButton(el).src).toContain("ExitFullscreen");
  });

  // F11, or the Display tab, or the shell reacting to anything else: the icon
  // follows the shell rather than the click that may not have caused it.
  it("follows a pushed snapshot", async () => {
    const fake = fakeBridge(snapshot("borderless"));
    fake.install();
    const el = await mount();
    expect(fullscreenButton(el).src).toContain("ExitFullscreen");

    fake.push(snapshot("windowed"));
    await flush(el);
    expect(fullscreenButton(el).src).not.toContain("ExitFullscreen");
    expect(fullscreenButton(el).src).toContain("Fullscreen");
  });

  // The clan map and anything else calling requestFullscreen still fire
  // fullscreenchange. On the desktop that is not this button's business, and
  // repainting the icon from it would misreport the window's real mode.
  it("ignores HTML fullscreen changes on the desktop", async () => {
    fakeBridge(snapshot("windowed")).install();
    const el = await mount();
    expect(fullscreenButton(el).src).not.toContain("ExitFullscreen");

    (document as { fullscreenElement: Element | null }).fullscreenElement =
      document.documentElement;
    document.dispatchEvent(new Event("fullscreenchange"));
    await flush(el);
    expect(fullscreenButton(el).src).not.toContain("ExitFullscreen");
  });

  it("still tracks HTML fullscreen changes on the web", async () => {
    window.openfrontDesktop = undefined;
    const el = await mount();
    expect(fullscreenButton(el).src).not.toContain("ExitFullscreen");

    (document as { fullscreenElement: Element | null }).fullscreenElement =
      document.documentElement;
    document.dispatchEvent(new Event("fullscreenchange"));
    await flush(el);
    expect(fullscreenButton(el).src).toContain("ExitFullscreen");
  });

  it("subscribes on mount and unsubscribes on teardown", async () => {
    const fake = fakeBridge();
    fake.install();
    const el = await mount();
    expect(fake.listenerCount()).toBe(1);

    el.remove();
    await Promise.resolve();
    expect(fake.listenerCount()).toBe(0);
    expect(fake.unsubscribeCalls()).toBe(1);
  });

  // A sidebar is built per match, so a leak here compounds over a session.
  it("never stacks listeners across remounts", async () => {
    const fake = fakeBridge();
    fake.install();
    for (let i = 0; i < 3; i++) {
      const el = await mount();
      expect(fake.listenerCount()).toBe(1);
      el.remove();
      await Promise.resolve();
      expect(fake.listenerCount()).toBe(0);
    }
    expect(fake.unsubscribeCalls()).toBe(3);
  });

  // A shell that can read and write but never pushes.
  it("works against a bridge with no subscribe", async () => {
    const fake = fakeBridge(snapshot("borderless"));
    window.openfrontDesktop = {
      display: {
        getPrefs: fake.bridge.getPrefs,
        setPrefs: fake.bridge.setPrefs,
      },
    };
    const el = await mount();

    clickFullscreen(el);
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledWith({ mode: "windowed" });
  });

  // The bridge lives in another repository on its own release schedule, so
  // "it returns a promise" is a claim about it rather than a guarantee. A
  // synchronous throw out of connectedCallback would abort the HUD mount.
  it("finishes mounting when getPrefs throws synchronously", async () => {
    const fake = fakeBridge();
    fake.bridge.getPrefs.mockImplementation(() => {
      throw new Error("bridge exploded");
    });
    fake.install();

    const el = await mount();
    expect(el.isConnected).toBe(true);
    // The throw escaping connectedCallback would abandon the rest of it --
    // asserted on the subscribe, which comes after the read, because a
    // half-mounted sidebar is deaf to F11 and to the Display tab rather than
    // visibly broken. jsdom swallows a throw out of a custom-element
    // callback, so "it still mounted" alone would prove nothing.
    expect(fake.listenerCount()).toBe(1);
    expect(fullscreenButton(el).src).not.toContain("ExitFullscreen");
  });

  it("does not wedge the button when setPrefs throws synchronously", async () => {
    const fake = fakeBridge();
    fake.install();
    const el = await mount();
    fake.bridge.setPrefs.mockImplementationOnce(() => {
      throw new Error("bridge exploded");
    });

    clickFullscreen(el);
    await flush(el);
    // A throw that escapes leaves the in-flight guard latched and the button
    // dead for the rest of the match. The next click has to still work.
    clickFullscreen(el);
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledTimes(2);
  });

  // A mode change is a window transition and there is no control to disable
  // here -- the guard is the whole of the protection against a second click.
  it("sends one patch for two rapid clicks", async () => {
    const fake = fakeBridge(snapshot("borderless"));
    let settle: ((s: DesktopDisplaySnapshot) => void) | null = null;
    fake.bridge.setPrefs.mockImplementation(
      () =>
        new Promise<DesktopDisplaySnapshot>((resolve) => {
          settle = resolve;
        }),
    );
    fake.install();
    const el = await mount();

    clickFullscreen(el);
    clickFullscreen(el);
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledTimes(1);

    // ...and the button works again once the shell has answered.
    settle!(snapshot("windowed"));
    await flush(el);
    clickFullscreen(el);
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledTimes(2);
  });

  // In borderless the button is one of the few ways back to a titled window,
  // so a bridge that answers neither the invoke nor the push must not disable
  // it for the rest of the match.
  it("re-enables the button when the shell never answers", async () => {
    vi.useFakeTimers();
    const fake = fakeBridge(snapshot("borderless"));
    fake.bridge.setPrefs.mockImplementation(
      () => new Promise<DesktopDisplaySnapshot>(() => undefined),
    );
    fake.install();
    const el = await mount();

    clickFullscreen(el);
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledTimes(1);

    // Still waiting just short of the ceiling.
    vi.advanceTimersByTime(1999);
    await flush(el);
    clickFullscreen(el);
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await flush(el);
    // Re-read on the way out, so the icon ends on the shell's state.
    expect(fake.bridge.getPrefs).toHaveBeenCalledTimes(2);
    clickFullscreen(el);
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledTimes(2);
  });

  // The shell emits the push as part of applying the change, so by the time
  // one arrives the transition has happened whether or not the invoke ever
  // answers. Waiting out the ceiling after that would disable the button for
  // up to two seconds with nothing left to wait for.
  it("lets a push settle a write the invoke never answers", async () => {
    vi.useFakeTimers();
    const fake = fakeBridge(snapshot("borderless"));
    fake.bridge.setPrefs.mockImplementation(
      () => new Promise<DesktopDisplaySnapshot>(() => undefined),
    );
    fake.install();
    const el = await mount();

    clickFullscreen(el);
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledTimes(1);

    fake.push(snapshot("windowed"));
    await flush(el);
    // Showing the mode the shell reported.
    expect(fullscreenButton(el).src).not.toContain("ExitFullscreen");

    // The ceiling was CLEARED, not merely beaten: firing it after the write
    // has already settled would send a pointless re-read, and would do it
    // while the player may have a fresh change in flight.
    const readsAfterMount = fake.bridge.getPrefs.mock.calls.length;
    vi.advanceTimersByTime(DISPLAY_SETTLE_TIMEOUT_MS);
    await flush(el);
    expect(fake.bridge.getPrefs).toHaveBeenCalledTimes(readsAfterMount);

    // And the button is usable again -- without having waited out the ceiling.
    clickFullscreen(el);
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledTimes(2);
  });

  // An unparseable push is not evidence that anything happened, so it must
  // not settle a pending write.
  it("does not let an unreadable push settle a write", async () => {
    vi.useFakeTimers();
    const fake = fakeBridge(snapshot("borderless"));
    fake.bridge.setPrefs.mockImplementation(
      () => new Promise<DesktopDisplaySnapshot>(() => undefined),
    );
    fake.install();
    const el = await mount();

    clickFullscreen(el);
    await flush(el);
    fake.push({
      prefs: { mode: "nonsense" },
    } as unknown as DesktopDisplaySnapshot);
    await flush(el);

    clickFullscreen(el);
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledTimes(1);
  });

  // Once the ceiling can hand the button back, two writes can be in flight at
  // once -- so the guard has to know WHICH write it belongs to. Otherwise the
  // overtaken one adopts its stale snapshot, clears the live one's timer and
  // releases the guard on its behalf, letting a third click overlap it.
  it("does not let an overtaken write settle the one that replaced it", async () => {
    vi.useFakeTimers();
    const fake = fakeBridge(snapshot("borderless"));
    const pending: Array<(s: DesktopDisplaySnapshot) => void> = [];
    fake.bridge.setPrefs.mockImplementation(
      () =>
        new Promise<DesktopDisplaySnapshot>((resolve) => {
          pending.push(resolve);
        }),
    );
    fake.install();
    const el = await mount();

    // A goes out and is left unanswered past its ceiling, which hands the
    // button back.
    clickFullscreen(el);
    await flush(el);
    vi.advanceTimersByTime(DISPLAY_SETTLE_TIMEOUT_MS);
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledTimes(1);

    // B goes out on the recovered button.
    clickFullscreen(el);
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledTimes(2);

    // A finally answers, late and stale.
    pending[0](snapshot("windowed"));
    await flush(el);

    // Its snapshot is not adopted -- the window is still borderless, so the
    // button still offers the way out of it.
    expect(fullscreenButton(el).src).toContain("ExitFullscreen");

    // ...and it did not release B's guard: a third click is refused.
    clickFullscreen(el);
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledTimes(2);

    // B's own ceiling is intact and still owns the recovery. If A's finally
    // had cleared it, nothing would ever hand the button back and this last
    // click could not happen.
    vi.advanceTimersByTime(DISPLAY_SETTLE_TIMEOUT_MS);
    await flush(el);
    clickFullscreen(el);
    await flush(el);
    expect(fake.bridge.setPrefs).toHaveBeenCalledTimes(3);
  });

  // The ceiling's own recovery read can outlive the operation that asked for
  // it, and it describes the world BEFORE the write that overtook it.
  it("drops a ceiling re-read that answers after a newer write", async () => {
    vi.useFakeTimers();
    const fake = fakeBridge(snapshot("borderless"));
    fake.bridge.setPrefs.mockImplementation(
      () => new Promise<DesktopDisplaySnapshot>(() => undefined),
    );
    fake.install();
    const el = await mount();

    let resolveRead: ((s: DesktopDisplaySnapshot) => void) | null = null;
    fake.bridge.getPrefs.mockImplementation(
      () =>
        new Promise<DesktopDisplaySnapshot>((resolve) => {
          resolveRead = resolve;
        }),
    );

    // A times out; its recovery read is left hanging.
    clickFullscreen(el);
    await flush(el);
    vi.advanceTimersByTime(DISPLAY_SETTLE_TIMEOUT_MS);
    await flush(el);
    expect(resolveRead).not.toBeNull();

    // B goes out on the recovered button.
    clickFullscreen(el);
    await flush(el);

    // A's recovery read answers late, describing the pre-B world.
    resolveRead!(snapshot("windowed"));
    await flush(el);
    expect(fullscreenButton(el).src).toContain("ExitFullscreen");
  });

  // The same race against a push rather than against a newer click: settling
  // retires the write, so its recovery read is answering a question that has
  // already been answered better.
  it("drops a ceiling re-read that answers after a push", async () => {
    vi.useFakeTimers();
    const fake = fakeBridge(snapshot("borderless"));
    fake.bridge.setPrefs.mockImplementation(
      () => new Promise<DesktopDisplaySnapshot>(() => undefined),
    );
    fake.install();
    const el = await mount();

    let resolveRead: ((s: DesktopDisplaySnapshot) => void) | null = null;
    fake.bridge.getPrefs.mockImplementation(
      () =>
        new Promise<DesktopDisplaySnapshot>((resolve) => {
          resolveRead = resolve;
        }),
    );

    clickFullscreen(el);
    await flush(el);
    vi.advanceTimersByTime(DISPLAY_SETTLE_TIMEOUT_MS);
    await flush(el);
    expect(resolveRead).not.toBeNull();

    // The shell reports the truth before the recovery read comes back.
    fake.push(snapshot("windowed"));
    await flush(el);
    expect(fullscreenButton(el).src).not.toContain("ExitFullscreen");

    // The stale read must not undo it.
    resolveRead!(snapshot("borderless"));
    await flush(el);
    expect(fullscreenButton(el).src).not.toContain("ExitFullscreen");
  });

  // The mount read is the slowest async path here and the easiest to miss.
  // A toggle that lands while it is still in flight sets the new mode; the
  // read then resolves describing the world before it.
  it("drops the mount read when a toggle beats it home", async () => {
    const fake = fakeBridge(snapshot("borderless"));
    let resolveRead: ((s: DesktopDisplaySnapshot) => void) | null = null;
    fake.bridge.getPrefs.mockImplementation(
      () =>
        new Promise<DesktopDisplaySnapshot>((resolve) => {
          resolveRead = resolve;
        }),
    );
    fake.bridge.setPrefs.mockImplementation(async () => snapshot("windowed"));
    fake.install();
    const el = await mount();
    expect(resolveRead).not.toBeNull();

    // The player toggles before the mount read has answered.
    clickFullscreen(el);
    await flush(el);
    expect(fullscreenButton(el).src).not.toContain("ExitFullscreen");

    // The mount read now answers with the pre-toggle world.
    resolveRead!(snapshot("borderless"));
    await flush(el);
    expect(fullscreenButton(el).src).not.toContain("ExitFullscreen");
  });

  // The same read outliving the element entirely.
  it("does not write from the mount read after disconnect", async () => {
    const fake = fakeBridge(snapshot("borderless"));
    let resolveRead: ((s: DesktopDisplaySnapshot) => void) | null = null;
    fake.bridge.getPrefs.mockImplementation(
      () =>
        new Promise<DesktopDisplaySnapshot>((resolve) => {
          resolveRead = resolve;
        }),
    );
    fake.install();
    const el = await mount();

    el.remove();
    await flush(el);
    resolveRead!(snapshot("borderless"));
    await flush(el);

    const probe = el as unknown as { displayMode: unknown };
    expect(probe.displayMode).toBeNull();
  });

  it("does not throw when the bridge rejects", async () => {
    const fake = fakeBridge(snapshot("borderless"));
    fake.install();
    const el = await mount();
    fake.bridge.setPrefs.mockRejectedValueOnce(new Error("ipc failed"));

    clickFullscreen(el);
    await flush(el);
    // Still borderless, because that is still what the window is.
    expect(fullscreenButton(el).src).toContain("ExitFullscreen");
  });
});
