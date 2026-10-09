import { GameType } from "@openfront/engine-api/game/GameTypes";
import { GAME_ID_REGEX } from "@openfront/engine-api/Schemas";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const copyToClipboardMock = vi.hoisted(() =>
  vi.fn(async (_text: string) => {}),
);
const showToastMock = vi.hoisted(() => vi.fn());

const crazyGamesSDKMock = vi.hoisted(() => ({
  gameplayStop: vi.fn(),
  gameplayStart: vi.fn(),
  requestMidgameAd: vi.fn(),
  isInstantMultiplayer: vi.fn(async () => false),
  isOnCrazyGames: vi.fn(() => false),
  createInviteLink: vi.fn(
    (gameId: string): string | null =>
      `https://crazygames.com/game?invite=${gameId}`,
  ),
}));

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  copyToClipboard: copyToClipboardMock,
  showToast: showToastMock,
  translateText: vi.fn((key: string) => {
    const translations: Record<string, string> = {
      "game_right_sidebar.share_link": "Share Link",
      "common.copied": "Copied!",
      "common.failed_copy": "Failed to copy",
      "fullscreen.exit": "Exit Fullscreen",
      "fullscreen.enter": "Enter Fullscreen",
    };
    return translations[key] || key;
  }),
}));

vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: crazyGamesSDKMock,
}));

import { ClientEnv } from "../../src/client/ClientEnv";
import "../../src/client/hud/layers/GameRightSidebar";
import type { GameRightSidebar } from "../../src/client/hud/layers/GameRightSidebar";
import type { GameView } from "../../src/client/view";

const realLocationDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "location",
)!;

type TestSidebar = GameRightSidebar & { updateComplete: Promise<unknown> };

interface CreateGameOpts {
  gameId?: string;
  gameType?: GameType;
  isReplay?: boolean;
}

function fakeGame(opts: CreateGameOpts = {}): GameView {
  const gameType = opts.gameType ?? GameType.Public;
  const isReplay = opts.isReplay ?? false;
  const gameId = opts.gameId ?? "gamexyz123";

  return {
    config: () => ({
      gameConfig: () => ({ gameType, maxTimerValue: undefined }),
      doomsdayClockConfig: () => ({ enabled: false }),
      overtimeConfig: () => ({ enabled: false, startMinutes: 0 }),
      isReplay: () => isReplay,
      listed: true,
      numSpawnPhaseTurns: () => 400,
    }),
    inSpawnPhase: () => false,
    elapsedGameSeconds: () => 0,
    myPlayer: () => undefined,
    gameID: () => gameId,
  } as unknown as GameView;
}

describe("GameRightSidebar share button", () => {
  let sidebar: TestSidebar | undefined;

  function stubLocation(href: string) {
    const url = new URL(href);
    const origin =
      url.protocol === "app:" ? `${url.protocol}//${url.hostname}` : url.origin;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        href,
        origin,
        protocol: url.protocol,
        pathname: url.pathname,
        hash: url.hash,
        search: url.search,
        host: url.host,
        hostname: url.hostname,
      },
    });
  }

  function setBootstrapConfig(
    overrides: { jwtAudience?: string; serverHost?: string } = {},
  ) {
    (window as any).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      numWorkers: 1,
      turnstileSiteKey: "x",
      jwtAudience: "openfront.io",
      instanceId: "d",
      gitCommit: "t",
      ...overrides,
    };
    ClientEnv.reset();
  }

  beforeEach(() => {
    stubLocation("https://openfront.io/");
    setBootstrapConfig({ serverHost: "openfront.io" });
    copyToClipboardMock.mockClear();
    showToastMock.mockClear();
    crazyGamesSDKMock.isOnCrazyGames.mockReturnValue(false);
    crazyGamesSDKMock.createInviteLink.mockClear();
  });

  afterEach(() => {
    sidebar?.remove();
    sidebar = undefined;
    Object.defineProperty(window, "location", realLocationDescriptor);
    delete (window as { BOOTSTRAP_CONFIG?: unknown }).BOOTSTRAP_CONFIG;
    ClientEnv.reset();
    vi.restoreAllMocks();
  });

  async function mount(opts: CreateGameOpts = {}): Promise<TestSidebar> {
    sidebar = document.createElement("game-right-sidebar") as TestSidebar;
    sidebar.game = fakeGame(opts);
    sidebar.eventBus = new EventBus();
    document.body.appendChild(sidebar);
    sidebar.init();
    await sidebar.updateComplete;
    return sidebar;
  }

  function getShareButton(el: TestSidebar): HTMLElement | null {
    const img = el.renderRoot.querySelector<HTMLImageElement>(
      'img[src*="ShareIconWhite"]',
    );
    return img ? (img.parentElement as HTMLElement) : null;
  }

  it("renders a 20x20 share icon between settings and exit in multiplayer games", async () => {
    const el = await mount({ gameType: GameType.Public });
    const shareBtn = getShareButton(el);

    expect(shareBtn).not.toBeNull();
    expect(shareBtn?.classList.contains("cursor-pointer")).toBe(true);
    expect(shareBtn?.getAttribute("title")).toBe("Share Link");

    const img = shareBtn?.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("alt")).toBe("Share Link");
    expect(img?.getAttribute("width")).toBe("20");
    expect(img?.getAttribute("height")).toBe("20");

    // Verify ordering: settings button -> share button -> exit button
    const container = el.renderRoot.querySelector("aside");
    expect(container).not.toBeNull();
    const buttons = Array.from(
      container!.querySelectorAll<HTMLElement>("div.cursor-pointer"),
    );
    const settingsIdx = buttons.findIndex((b) =>
      b.querySelector('img[alt="settings"]'),
    );
    const shareIdx = buttons.findIndex((b) =>
      b.querySelector('img[src*="ShareIconWhite"]'),
    );
    const exitIdx = buttons.findIndex((b) =>
      b.querySelector('img[alt="exit"]'),
    );

    expect(settingsIdx).toBeGreaterThanOrEqual(0);
    expect(shareIdx).toBeGreaterThan(settingsIdx);
    expect(exitIdx).toBeGreaterThan(shareIdx);
  });

  it("copies working game link using ClientEnv.shareOrigin and shows green toast", async () => {
    const gameId = "game123456";
    expect(GAME_ID_REGEX.test(gameId)).toBe(true);

    const el = await mount({ gameId });
    const shareBtn = getShareButton(el);
    expect(shareBtn).not.toBeNull();

    shareBtn!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const expectedUrl = `${ClientEnv.shareOrigin()}${ClientEnv.gamePath(gameId)}`;
    expect(copyToClipboardMock).toHaveBeenCalledWith(expectedUrl);
    expect(showToastMock).toHaveBeenCalledWith("Copied!", "green");

    const url = new URL(expectedUrl);
    const pathMatch = url.pathname.match(
      /^(?:\/v\/[^/]+)?\/(?:w\d+\/)?game\/([^/]+)/,
    );
    expect(pathMatch).not.toBeNull();
    expect(pathMatch![1]).toBe(gameId);
    expect(GAME_ID_REGEX.test(pathMatch![1])).toBe(true);
  });

  it("uses share origin from desktop shell instead of app://", async () => {
    stubLocation("app://openfront/index.html");
    setBootstrapConfig({ serverHost: "openfront.io" });

    const gameId = "desk456789";
    expect(GAME_ID_REGEX.test(gameId)).toBe(true);

    const el = await mount({ gameId });
    const shareBtn = getShareButton(el);
    expect(shareBtn).not.toBeNull();

    shareBtn!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(copyToClipboardMock).toHaveBeenCalledTimes(1);
    const copiedUrl = copyToClipboardMock.mock.calls[0][0];
    expect(copiedUrl).toBe(`https://openfront.io${ClientEnv.gamePath(gameId)}`);
    expect(copiedUrl).not.toContain("app:");
    expect(showToastMock).toHaveBeenCalledWith("Copied!", "green");

    const url = new URL(copiedUrl);
    const pathMatch = url.pathname.match(
      /^(?:\/v\/[^/]+)?\/(?:w\d+\/)?game\/([^/]+)/,
    );
    expect(pathMatch).not.toBeNull();
    expect(pathMatch![1]).toBe(gameId);
    expect(GAME_ID_REGEX.test(pathMatch![1])).toBe(true);
  });

  it("uses crazyGamesSDK.createInviteLink on CrazyGames", async () => {
    const gameId = "cg99912345";
    expect(GAME_ID_REGEX.test(gameId)).toBe(true);

    crazyGamesSDKMock.isOnCrazyGames.mockReturnValue(true);
    crazyGamesSDKMock.createInviteLink.mockReturnValue(
      `https://crazygames.com/game?invite=${gameId}`,
    );

    const el = await mount({ gameId });
    const shareBtn = getShareButton(el);
    expect(shareBtn).not.toBeNull();

    shareBtn!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(crazyGamesSDKMock.createInviteLink).toHaveBeenCalledWith(gameId);
    expect(copyToClipboardMock).toHaveBeenCalledWith(
      `https://crazygames.com/game?invite=${gameId}`,
    );
    expect(showToastMock).toHaveBeenCalledWith("Copied!", "green");
  });

  it("shows failure toast when CrazyGames invite link fails", async () => {
    const gameId = "cgfail1234";
    crazyGamesSDKMock.isOnCrazyGames.mockReturnValue(true);
    crazyGamesSDKMock.createInviteLink.mockReturnValue(null);

    const el = await mount({ gameId });
    const shareBtn = getShareButton(el);
    expect(shareBtn).not.toBeNull();

    shareBtn!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(copyToClipboardMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith("Failed to copy", "red");
  });

  it("shows failure toast when game ID is empty", async () => {
    const el = await mount({ gameId: "" });
    const shareBtn = getShareButton(el);
    // Since gameId is empty, button should not even be rendered
    expect(shareBtn).toBeNull();
  });

  it("shows failure toast when copyToClipboard throws", async () => {
    copyToClipboardMock.mockRejectedValueOnce(new Error("clipboard denied"));

    const gameId = "gamefail12";
    const el = await mount({ gameId });
    const shareBtn = getShareButton(el);
    expect(shareBtn).not.toBeNull();

    shareBtn!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(copyToClipboardMock).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith("Failed to copy", "red");
  });

  it("does not render the share button in singleplayer games", async () => {
    const el = await mount({ gameType: GameType.Singleplayer });
    const shareBtn = getShareButton(el);
    expect(shareBtn).toBeNull();
  });

  it("does not render the share button during replays", async () => {
    const el = await mount({ isReplay: true });
    const shareBtn = getShareButton(el);
    expect(shareBtn).toBeNull();
  });
});
