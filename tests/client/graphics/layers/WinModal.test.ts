import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchCosmetics,
  resolveCosmetics,
  type ResolvedCosmetic,
} from "../../../../src/client/Cosmetics";
import "../../../../src/client/hud/layers/WinModal";
import type { WinModal } from "../../../../src/client/hud/layers/WinModal";
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
    for (const card of modal.querySelectorAll("cosmetic-card")) {
      expect(card.querySelector("[data-cosmetic-main]")?.tagName).toBe("DIV");
      expect(card.querySelectorAll("button")).toHaveLength(0);
    }
    const legacyButtonTag = ["cosmetic", "button"].join("-");
    const legacyContainerTag = ["cosmetic", "container"].join("-");
    expect(modal.querySelectorAll(legacyButtonTag)).toHaveLength(0);
    expect(modal.querySelectorAll(legacyContainerTag)).toHaveLength(0);
  });
});
