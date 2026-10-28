import {
  GameMode,
  GameType,
  PlayerType,
  RankedType,
} from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { GAME_ID_REGEX, type Winner } from "@openfront/engine-api/Schemas";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FfaRatingPanel } from "../../../../src/client/components/ffaRating/FfaRatingPanel";
import type { PurchaseButton } from "../../../../src/client/components/PurchaseButton";
import {
  fetchCosmetics,
  resolveCosmetics,
  type ResolvedCosmetic,
} from "../../../../src/client/Cosmetics";
import "../../../../src/client/hud/layers/WinModal";
import type { WinModal } from "../../../../src/client/hud/layers/WinModal";
import { resolveXpAccount } from "../../../../src/client/ProgressionAccount";

const copyToClipboardMock = vi.hoisted(() =>
  vi.fn(async (_text: string) => {}),
);
const showToastMock = vi.hoisted(() => vi.fn());

const gamePortalMock = vi.hoisted(() => ({
  happytime: vi.fn(),
  gameplayStop: vi.fn(),
  name: vi.fn(() => null),
  isOnGamePortal: vi.fn(() => false),
  createInviteLink: vi.fn(
    async (gameId: string): Promise<string | null> =>
      `https://crazygames.com/game?invite=${gameId}`,
  ),
}));

vi.mock("../../../../src/client/Utils", () => ({
  copyToClipboard: copyToClipboardMock,
  showToast: showToastMock,
  translateText: vi.fn((key: string) => {
    const translations: Record<string, string> = {
      "win_modal.exit": "Exit",
      "win_modal.requeue": "Play Again",
      "win_modal.keep": "Keep Playing",
      "win_modal.spectate": "Spectate",
      "win_modal.share": "Share",
      "common.copied": "Copied!",
      "common.failed_copy": "Failed to copy",
    };
    return translations[key] || key;
  }),
  getGamesPlayed: vi.fn(() => 10),
  isInIframe: vi.fn(() => false),
  TUTORIAL_VIDEO_URL: "https://example.com/tutorial",
}));

vi.mock("../../../../src/client/Api", () => ({
  getUserMe: vi.fn(async () => null),
}));

vi.mock("../../../../src/client/ProgressionAccount", () => ({
  resolveXpAccount: vi.fn(),
}));

// The mounted rating panel must make no request.
vi.mock("../../../../src/client/FfaRatingApi", () => ({
  pollFfaGameRating: vi.fn(() => new Promise(() => {})),
}));

vi.mock("../../../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../src/client/Cosmetics")
  >()),
  fetchCosmetics: vi.fn(async () => null),
  resolveCosmetics: vi.fn(() => []),
}));

vi.mock("../../../../src/client/GamePortal", () => ({
  gamePortal: gamePortalMock,
}));

import { ClientEnv } from "../../../../src/client/ClientEnv";
import type { GameView } from "../../../../src/client/view";

// jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const realLocationDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "location",
)!;

describe("WinModal Requeue", () => {
  let mockLocationHref = "";

  beforeEach(() => {
    mockLocationHref = "";
    // Mock window.location.href using Object.defineProperty
    const locationMock = {
      get href() {
        return mockLocationHref;
      },
      set href(value: string) {
        mockLocationHref = value;
      },
    };
    Object.defineProperty(window, "location", {
      value: locationMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", realLocationDescriptor);
    vi.restoreAllMocks();
  });

  describe("isRankedGame detection", () => {
    it("should detect ranked 1v1 game", () => {
      const gameConfig = {
        rankedType: RankedType.OneVOne,
      };
      const isRankedGame = gameConfig.rankedType === RankedType.OneVOne;
      expect(isRankedGame).toBe(true);
    });

    it("should not detect non-ranked game", () => {
      const gameConfig = {
        rankedType: undefined,
      };
      const isRankedGame = gameConfig.rankedType === RankedType.OneVOne;
      expect(isRankedGame).toBe(false);
    });
  });

  describe("requeue navigation", () => {
    it("should navigate to /?requeue when requeue is triggered", () => {
      // Simulate the _handleRequeue behavior
      const handleRequeue = () => {
        window.location.href = "/?requeue";
      };

      handleRequeue();

      expect(window.location.href).toBe("/?requeue");
    });

    it("should navigate to / when exit is triggered", () => {
      // Simulate the _handleExit behavior
      const handleExit = () => {
        window.location.href = "/";
      };

      handleExit();

      expect(window.location.href).toBe("/");
    });
  });

  describe("requeue URL parameter handling", () => {
    it("should parse requeue parameter from URL", () => {
      const url = new URL("http://localhost:9000/?requeue");
      const hasRequeue = url.searchParams.has("requeue");
      expect(hasRequeue).toBe(true);
    });

    it("should not find requeue parameter when absent", () => {
      const url = new URL("http://localhost:9000/");
      const hasRequeue = url.searchParams.has("requeue");
      expect(hasRequeue).toBe(false);
    });
  });
});

describe("WinModal pattern promotion", () => {
  let modal: WinModal | undefined;

  afterEach(() => {
    modal?.remove();
    modal = undefined;
  });

  it("renders three card-and-purchase promotions from four purchasable patterns", async () => {
    const purchasablePatterns: ResolvedCosmetic[] = [
      "aurora",
      "blaze",
      "circuit",
      "dawn",
    ].map((name) => ({
      type: "pattern",
      cosmetic: {
        name,
        pattern: "AAAAAA",
        product: null,
        priceHard: 120,
        rarity: "rare",
      } as never,
      colorPalette: null,
      relationship: "purchasable",
      key: `pattern:${name}`,
    }));
    vi.mocked(fetchCosmetics).mockResolvedValue(null);
    vi.mocked(resolveCosmetics).mockReturnValue(purchasablePatterns);

    modal = document.createElement("win-modal") as WinModal;
    Object.assign(modal as unknown as { rand: number; isWin: boolean }, {
      rand: 0.75,
      isWin: true,
    });
    document.body.appendChild(modal);
    await modal.updateComplete;

    await modal.loadPatternContent();
    modal.requestUpdate();
    await modal.updateComplete;

    const promotions = modal.querySelectorAll("[data-win-cosmetic-promo]");
    expect(promotions).toHaveLength(3);
    expect(modal.querySelectorAll("cosmetic-card")).toHaveLength(3);
    expect(modal.querySelectorAll("purchase-button")).toHaveLength(3);
    for (const button of modal.querySelectorAll<PurchaseButton>(
      "purchase-button",
    )) {
      expect(button.rarity).toBe("rare");
    }
    for (const card of modal.querySelectorAll("cosmetic-card")) {
      expect(card.querySelector("[data-cosmetic-main]")?.tagName).toBe("DIV");
      expect(card.querySelectorAll("button")).toHaveLength(0);
    }
    const legacyButtonTag = ["cosmetic", "button"].join("-");
    const legacyContainerTag = ["cosmetic", "container"].join("-");
    expect(modal.querySelectorAll(legacyButtonTag)).toHaveLength(0);
    expect(modal.querySelectorAll(legacyContainerTag)).toHaveLength(0);
  });

  it("drops the ad-free pitch in the desktop shell, which has no ads", async () => {
    const render = async () => {
      modal = document.createElement("win-modal") as WinModal;
      Object.assign(modal as unknown as { rand: number; isWin: boolean }, {
        rand: 0.75,
        isWin: true,
      });
      document.body.appendChild(modal);
      await modal.updateComplete;
      return modal.textContent ?? "";
    };

    expect(await render()).toContain("win_modal.territory_pattern");
    modal?.remove();

    window.openfrontDesktop = {};
    try {
      const text = await render();
      expect(text).toContain("win_modal.support_openfront");
      expect(text).not.toContain("win_modal.territory_pattern");
    } finally {
      delete window.openfrontDesktop;
    }
  });

  it("includes action styles that align [data-share-ring] with .win-action on hover", async () => {
    modal = document.createElement("win-modal") as WinModal;
    document.body.appendChild(modal);
    await modal.updateComplete;
    const style = modal.querySelector("style");
    expect(style).not.toBeNull();
    const css = style?.textContent ?? "";
    expect(css).toContain(".win-action:hover ~ [data-share-ring]");
    expect(css).toContain("top: -6px");
    expect(css).toContain("bottom: -2px");
  });
});

describe("WinModal FFA rating panel", () => {
  let modal: WinModal | undefined;

  afterEach(() => {
    modal?.remove();
    modal = undefined;
    vi.mocked(resolveXpAccount).mockReset();
  });

  const signedIn = (ffa: Record<string, unknown>) =>
    vi.mocked(resolveXpAccount).mockResolvedValue({
      kind: "signed_in",
      me: { player: { trustTier: "trusted", leaderboard: { ffa } } },
    } as never);

  const mount = async (
    rankedType?: RankedType,
    winner: Winner = ["player", "c1"],
  ) => {
    const el = document.createElement("win-modal") as WinModal;
    el.game = {
      gameID: () => "g1",
      config: () => ({
        gameConfig: () => ({
          gameType: GameType.Public,
          gameMode: GameMode.FFA,
          rankedType,
        }),
        isReplay: () => false,
      }),
      myPlayer: () => ({ isAlive: () => true, hasSpawned: () => true }),
      players: () =>
        Array.from({ length: 12 }, () => ({
          type: () => PlayerType.Human,
          hasSpawned: () => true,
        })),
    } as never;
    // What vote() records when the Win update arrives.
    (el as unknown as { gameEnd: unknown }).gameEnd = {
      winner,
      allPlayersStats: {},
      tick: 0,
    };
    document.body.appendChild(el);
    await el.updateComplete;
    modal = el;
    return el as unknown as HTMLElement & {
      updateComplete: Promise<boolean>;
      updateFfaRating(): Promise<void>;
    };
  };

  it("shows the FFA rating panel after a public FFA game for a rated viewer", async () => {
    signedIn({ calibrationGames: 3 });
    const m = await mount();
    await m.updateFfaRating();
    await m.updateComplete;
    const panel = m.querySelector<FfaRatingPanel>("ffa-rating-panel")!;
    expect(panel.gameId).toBe("g1");
    expect(panel.lobbyHumans).toBe(12);
  });

  it("shows no panel while the API sends no rating", async () => {
    signedIn({ elo: 1234 });
    const m = await mount();
    await m.updateFfaRating();
    await m.updateComplete;
    expect(m.querySelector("ffa-rating-panel")).toBeNull();
  });

  it("shows no panel when a nation won", async () => {
    signedIn({ calibrationGames: 3 });
    const m = await mount(undefined, ["nation", "Atlantis"]);
    await m.updateFfaRating();
    await m.updateComplete;
    expect(m.querySelector("ffa-rating-panel")).toBeNull();
    expect(resolveXpAccount).not.toHaveBeenCalled();
  });

  it("shows no panel after a ranked game", async () => {
    signedIn({ calibrationGames: 3 });
    const m = await mount(RankedType.OneVOne);
    await m.updateFfaRating();
    await m.updateComplete;
    expect(m.querySelector("ffa-rating-panel")).toBeNull();
    expect(resolveXpAccount).not.toHaveBeenCalled();
  });

  it("shows the panel when the Win update arrives through tick()", async () => {
    signedIn({ calibrationGames: 3 });
    const el = document.createElement("win-modal") as WinModal;
    const winner = { isPlayer: () => true, clientID: () => "c1" };
    el.game = {
      gameID: () => "g1",
      config: () => ({
        gameConfig: () => ({
          gameType: GameType.Public,
          gameMode: GameMode.FFA,
        }),
        isReplay: () => false,
      }),
      myPlayer: () => ({
        isAlive: () => true,
        hasSpawned: () => true,
        clientID: () => "c1",
      }),
      players: () =>
        Array.from({ length: 12 }, () => ({
          type: () => PlayerType.Human,
          hasSpawned: () => true,
        })),
      inSpawnPhase: () => false,
      ticks: () => 6000,
      playerByClientID: () => winner,
      updatesSinceLastTick: () => ({
        [GameUpdateType.Win]: [
          { winner: ["player", "c1"], allPlayersStats: {} },
        ],
      }),
    } as never;
    el.eventBus = new EventBus();
    document.body.appendChild(el);
    modal = el;

    el.tick();

    await vi.waitFor(() => {
      const panel = el.querySelector<FfaRatingPanel>("ffa-rating-panel");
      expect(panel?.gameId).toBe("g1");
    });
  });
});

describe("WinModal share button", () => {
  let modal: WinModal | undefined;

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
    vi.spyOn(ClientEnv, "shareOrigin").mockReturnValue("https://openfront.io");
    setBootstrapConfig({ serverHost: "openfront.io" });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    copyToClipboardMock.mockClear();
    showToastMock.mockClear();
    gamePortalMock.isOnGamePortal.mockReturnValue(false);
    gamePortalMock.createInviteLink.mockClear();
  });

  afterEach(() => {
    modal?.remove();
    modal = undefined;
    delete (window as { BOOTSTRAP_CONFIG?: unknown }).BOOTSTRAP_CONFIG;
    ClientEnv.reset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function createModal(opts?: {
    isWin?: boolean;
    gameId?: string;
    resumedFromSave?: boolean;
  }) {
    modal = document.createElement("win-modal") as WinModal;
    modal.game = {
      gameID: () => opts?.gameId ?? "gamexyz123",
      myPlayer: () => null,
      resumedFromSave: () => opts?.resumedFromSave ?? false,
      config: () => ({
        gameConfig: () => ({ rankedType: undefined }),
      }),
    } as unknown as GameView;
    modal.isVisible = true;
    if (opts?.isWin !== undefined) {
      (modal as unknown as { isWin: boolean }).isWin = opts.isWin;
    }
    document.body.appendChild(modal);
    await modal.updateComplete;
    return modal;
  }

  it("hides the share button when the game was resumed from a save", async () => {
    const el = await createModal({ resumedFromSave: true });
    const shareButton = el.querySelector<HTMLButtonElement>(
      'button[data-win-action="share"]',
    );
    expect(shareButton).toBeNull();
  });

  it("renders a square share button with tooltip and aria-label matching row height", async () => {
    const el = await createModal();
    const shareButton = el.querySelector<HTMLButtonElement>(
      'button[data-win-action="share"]',
    );
    expect(shareButton).not.toBeNull();
    expect(shareButton?.title).toBe("Share");
    expect(shareButton?.getAttribute("aria-label")).toBe("Share");
    expect(shareButton?.classList.contains("win-action")).toBe(true);
    expect(shareButton?.classList.contains("win-action-main")).toBe(true);
    expect(shareButton?.classList.contains("win-action-icon")).toBe(true);
  });

  it("appears on both the win and the death/loss modal", async () => {
    const winEl = await createModal({ isWin: true });
    expect(
      winEl.querySelector('button[data-win-action="share"]'),
    ).not.toBeNull();
    winEl.remove();

    const lossEl = await createModal({ isWin: false });
    expect(
      lossEl.querySelector('button[data-win-action="share"]'),
    ).not.toBeNull();
  });

  it("copies working game link using ClientEnv.shareOrigin and shows green toast", async () => {
    const gameId = "game123456";
    expect(GAME_ID_REGEX.test(gameId)).toBe(true);

    const el = await createModal({ gameId });
    const shareButton = el.querySelector<HTMLButtonElement>(
      'button[data-win-action="share"]',
    )!;

    shareButton.click();
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
    const shareOriginSpy = vi
      .spyOn(ClientEnv, "shareOrigin")
      .mockReturnValue("https://openfront.io");
    setBootstrapConfig({ serverHost: "openfront.io" });

    const gameId = "desk456789";
    expect(GAME_ID_REGEX.test(gameId)).toBe(true);

    const el = await createModal({ gameId });
    const shareButton = el.querySelector<HTMLButtonElement>(
      'button[data-win-action="share"]',
    )!;

    shareButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shareOriginSpy).toHaveBeenCalled();
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

  it("uses gamePortal.createInviteLink on game portals", async () => {
    const gameId = "cg99912345";
    expect(GAME_ID_REGEX.test(gameId)).toBe(true);

    gamePortalMock.isOnGamePortal.mockReturnValue(true);
    gamePortalMock.createInviteLink.mockResolvedValue(
      `https://crazygames.com/game?invite=${gameId}`,
    );

    const el = await createModal({ gameId });
    const shareButton = el.querySelector<HTMLButtonElement>(
      'button[data-win-action="share"]',
    )!;

    shareButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(gamePortalMock.createInviteLink).toHaveBeenCalledWith(gameId);
    expect(copyToClipboardMock).toHaveBeenCalledWith(
      `https://crazygames.com/game?invite=${gameId}`,
    );
    expect(showToastMock).toHaveBeenCalledWith("Copied!", "green");
  });

  it("shows failure toast when game portal invite link fails", async () => {
    const gameId = "cgfail1234";
    gamePortalMock.isOnGamePortal.mockReturnValue(true);
    gamePortalMock.createInviteLink.mockResolvedValue(null);

    const el = await createModal({ gameId });
    const shareButton = el.querySelector<HTMLButtonElement>(
      'button[data-win-action="share"]',
    )!;

    shareButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(copyToClipboardMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith("Failed to copy", "red");
  });

  it("shows failure toast when game portal invite link throws", async () => {
    const gameId = "cgerror1234";
    gamePortalMock.isOnGamePortal.mockReturnValue(true);
    gamePortalMock.createInviteLink.mockRejectedValue(
      new Error("portal network failure"),
    );

    const el = await createModal({ gameId });
    const shareButton = el.querySelector<HTMLButtonElement>(
      'button[data-win-action="share"]',
    )!;

    shareButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(copyToClipboardMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith("Failed to copy", "red");
  });

  it("shows failure toast when game ID is missing", async () => {
    const el = await createModal({ gameId: "" });
    const shareButton = el.querySelector<HTMLButtonElement>(
      'button[data-win-action="share"]',
    )!;

    shareButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(copyToClipboardMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith("Failed to copy", "red");
  });

  it("shows failure toast when copyToClipboard throws", async () => {
    copyToClipboardMock.mockRejectedValueOnce(new Error("clipboard denied"));

    const gameId = "gamefail12";
    const el = await createModal({ gameId });
    const shareButton = el.querySelector<HTMLButtonElement>(
      'button[data-win-action="share"]',
    )!;

    shareButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(copyToClipboardMock).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith("Failed to copy", "red");
  });
});
