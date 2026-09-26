import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../src/client/hud/layers/GameRightSidebar";
import type { GameRightSidebar } from "../../src/client/hud/layers/GameRightSidebar";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";

type TestSidebar = GameRightSidebar & { updateComplete: Promise<unknown> };

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

// A desktop shell with a display bridge. The sidebar must never touch it: the
// button is not rendered there, and window mode lives in the settings Display
// tab instead.
function installDesktopShell() {
  const bridge = {
    getPrefs: vi.fn(),
    setPrefs: vi.fn(),
    subscribe: vi.fn(),
  };
  window.openfrontDesktop = { shell: { api: 3 }, display: bridge };
  return bridge;
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

function fullscreenButton(el: TestSidebar): HTMLImageElement | undefined {
  const images = [
    ...el.renderRoot.querySelectorAll<HTMLImageElement>("img"),
  ].filter((img) => img.alt !== "settings" && img.alt !== "exit");
  return images[0];
}

function clickFullscreen(el: TestSidebar): void {
  fullscreenButton(el)!.parentElement!.dispatchEvent(
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

  // On the desktop the shell owns its window mode from the settings Display
  // tab, so the sidebar offers no fullscreen button at all -- and must not
  // reach for the display bridge either.
  it("does not render the button on the desktop shell", async () => {
    const bridge = installDesktopShell();
    const el = await mount();

    expect(fullscreenButton(el)).toBeUndefined();
    expect(bridge.getPrefs).not.toHaveBeenCalled();
    expect(bridge.subscribe).not.toHaveBeenCalled();
  });

  it("ignores HTML fullscreen changes on the desktop", async () => {
    installDesktopShell();
    const el = await mount();

    (document as { fullscreenElement: Element | null }).fullscreenElement =
      document.documentElement;
    document.dispatchEvent(new Event("fullscreenchange"));
    await flush(el);
    expect(fullscreenButton(el)).toBeUndefined();
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("still tracks HTML fullscreen changes on the web", async () => {
    window.openfrontDesktop = undefined;
    const el = await mount();
    expect(fullscreenButton(el)!.src).not.toContain("ExitFullscreen");

    (document as { fullscreenElement: Element | null }).fullscreenElement =
      document.documentElement;
    document.dispatchEvent(new Event("fullscreenchange"));
    await flush(el);
    expect(fullscreenButton(el)!.src).toContain("ExitFullscreen");
  });
});
