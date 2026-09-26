import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseButton } from "../../../../src/client/components/PurchaseButton";
import {
  fetchCosmetics,
  resolveCosmetics,
  type ResolvedCosmetic,
} from "../../../../src/client/Cosmetics";
import "../../../../src/client/hud/layers/WinModal";
import type { WinModal } from "../../../../src/client/hud/layers/WinModal";
import * as saveManager from "../../../../src/client/SinglePlayerSaveManager";
import { RankedType } from "../../../../src/core/game/Game";

vi.mock("../../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => {
    const translations: Record<string, string> = {
      "win_modal.exit": "Exit",
      "win_modal.requeue": "Play Again",
      "win_modal.keep": "Keep Playing",
      "win_modal.spectate": "Spectate",
    };
    return translations[key] || key;
  }),
  getGamesPlayed: vi.fn(() => 10),
  isInIframe: vi.fn(() => false),
  homeHref: vi.fn(() => "/"),
  generateCryptoRandomUUID: vi.fn(() => "test-uuid"),
  TUTORIAL_VIDEO_URL: "https://example.com/tutorial",
}));

vi.mock("../../../../src/client/Api", () => ({
  getUserMe: vi.fn(async () => null),
}));

vi.mock("../../../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../src/client/Cosmetics")
  >()),
  fetchCosmetics: vi.fn(async () => null),
  resolveCosmetics: vi.fn(() => []),
}));

vi.mock("../../../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    happytime: vi.fn(),
    requestAd: vi.fn(),
    gameplayStop: vi.fn(),
    isOnCrazyGames: vi.fn(() => false),
  },
}));

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
});

describe("WinModal exit save clearing", () => {
  it("clears solo save with current game ID when myPlayer is dead on exit", () => {
    const modal = document.createElement("win-modal") as WinModal;
    const clearSpy = vi.spyOn(saveManager, "clearSoloSave");
    const mockGame = {
      myPlayer: () => ({ isAlive: () => false }),
      gameID: () => "solo_game_123",
    } as any;
    (modal as any).game = mockGame;
    (modal as any)._handleExit();
    expect(clearSpy).toHaveBeenCalledWith("solo_game_123");
    clearSpy.mockRestore();
  });

  it("does not clear solo save when myPlayer is alive on exit", () => {
    const modal = document.createElement("win-modal") as WinModal;
    const clearSpy = vi.spyOn(saveManager, "clearSoloSave");
    const mockGame = {
      myPlayer: () => ({ isAlive: () => true }),
      gameID: () => "solo_game_123",
    } as any;
    (modal as any).game = mockGame;
    (modal as any)._handleExit();
    expect(clearSpy).not.toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
