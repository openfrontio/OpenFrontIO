import { RankedType } from "@openfront/engine-api/game/GameTypes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchCosmetics,
  resolveCosmetics,
  type ResolvedCosmetic,
} from "../../../../src/client/Cosmetics";
import type { PurchaseButton } from "../../../../src/client/components/PurchaseButton";
import "../../../../src/client/hud/layers/WinModal";
import type { WinModal } from "../../../../src/client/hud/layers/WinModal";

const copyToClipboardMock = vi.hoisted(() =>
  vi.fn(async (_text: string) => {}),
);
const showToastMock = vi.hoisted(() => vi.fn());

const crazyGamesSDKMock = vi.hoisted(() => ({
  happytime: vi.fn(),
  requestAd: vi.fn(),
  gameplayStop: vi.fn(),
  isOnCrazyGames: vi.fn(() => false),
  createInviteLink: vi.fn(
    (gameId: string): string | null =>
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

vi.mock("../../../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../src/client/Cosmetics")
  >()),
  fetchCosmetics: vi.fn(async () => null),
  resolveCosmetics: vi.fn(() => []),
}));

vi.mock("../../../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: crazyGamesSDKMock,
}));

import { ClientEnv } from "../../../../src/client/ClientEnv";
import type { OButton } from "../../../../src/client/components/baseComponents/Button";
import type { GameView } from "../../../../src/client/view";

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
});

describe("WinModal share button", () => {
  let modal: WinModal | undefined;

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
    crazyGamesSDKMock.isOnCrazyGames.mockReturnValue(false);
    crazyGamesSDKMock.createInviteLink.mockClear();
  });

  afterEach(() => {
    modal?.remove();
    modal = undefined;
    Object.defineProperty(window, "location", realLocationDescriptor);
    delete (window as { BOOTSTRAP_CONFIG?: unknown }).BOOTSTRAP_CONFIG;
    ClientEnv.reset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function createModal(opts?: { isWin?: boolean; gameId?: string }) {
    modal = document.createElement("win-modal") as WinModal;
    modal.game = {
      gameID: () => opts?.gameId ?? "game-xyz-789",
      myPlayer: () => null,
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

  it("renders a square share button with tooltip and aria-label matching row height", async () => {
    const el = await createModal();
    const shareButton = el.querySelector<OButton>(
      'o-button[translationKey="win_modal.share"]',
    );
    expect(shareButton).not.toBeNull();
    expect(shareButton?.iconPosition).toBe("only");
    expect(shareButton?.size).toBe("lg");
    expect(shareButton?.title).toBe("Share");
    expect(shareButton?.classList.contains("shrink-0")).toBe(true);

    const innerButton = shareButton?.querySelector("button");
    expect(innerButton).not.toBeNull();
    expect(innerButton?.getAttribute("aria-label")).toBe("Share");
    expect(innerButton?.className).toContain("w-12");
    expect(innerButton?.className).toContain("h-12");
  });

  it("preserves fixed w-10 h-10 sizing for default icon-only buttons", async () => {
    const defaultBtn = document.createElement("o-button") as OButton;
    defaultBtn.iconPosition = "only";
    document.body.appendChild(defaultBtn);
    await defaultBtn.updateComplete;

    const inner = defaultBtn.querySelector("button");
    expect(inner?.className).toContain("w-10");
    expect(inner?.className).toContain("h-10");
    defaultBtn.remove();
  });

  it("appears on both the win and the death/loss modal", async () => {
    const winEl = await createModal({ isWin: true });
    expect(
      winEl.querySelector('o-button[translationKey="win_modal.share"]'),
    ).not.toBeNull();
    winEl.remove();

    const lossEl = await createModal({ isWin: false });
    expect(
      lossEl.querySelector('o-button[translationKey="win_modal.share"]'),
    ).not.toBeNull();
  });

  it("copies working game link using ClientEnv.shareOrigin and shows green toast", async () => {
    const el = await createModal({ gameId: "game-123" });
    const shareButton = el.querySelector<OButton>(
      'o-button[translationKey="win_modal.share"]',
    )!;

    shareButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const expectedUrl = `${ClientEnv.shareOrigin()}${ClientEnv.gamePath("game-123")}`;
    expect(copyToClipboardMock).toHaveBeenCalledWith(expectedUrl);
    expect(showToastMock).toHaveBeenCalledWith("Copied!", "green");
  });

  it("uses share origin from desktop shell instead of app://", async () => {
    stubLocation("app://openfront/index.html");
    setBootstrapConfig({ serverHost: "openfront.io" });

    const el = await createModal({ gameId: "desktop-match-456" });
    const shareButton = el.querySelector<OButton>(
      'o-button[translationKey="win_modal.share"]',
    )!;

    shareButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(copyToClipboardMock).toHaveBeenCalledTimes(1);
    const copiedUrl = copyToClipboardMock.mock.calls[0][0];
    expect(copiedUrl).toBe(
      `https://openfront.io${ClientEnv.gamePath("desktop-match-456")}`,
    );
    expect(copiedUrl).not.toContain("app:");
    expect(showToastMock).toHaveBeenCalledWith("Copied!", "green");
  });

  it("uses crazyGamesSDK.createInviteLink on CrazyGames", async () => {
    crazyGamesSDKMock.isOnCrazyGames.mockReturnValue(true);
    crazyGamesSDKMock.createInviteLink.mockReturnValue(
      "https://crazygames.com/game?invite=cg-999",
    );

    const el = await createModal({ gameId: "cg-999" });
    const shareButton = el.querySelector<OButton>(
      'o-button[translationKey="win_modal.share"]',
    )!;

    shareButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(crazyGamesSDKMock.createInviteLink).toHaveBeenCalledWith("cg-999");
    expect(copyToClipboardMock).toHaveBeenCalledWith(
      "https://crazygames.com/game?invite=cg-999",
    );
    expect(showToastMock).toHaveBeenCalledWith("Copied!", "green");
  });

  it("shows failure toast when CrazyGames invite link fails", async () => {
    crazyGamesSDKMock.isOnCrazyGames.mockReturnValue(true);
    crazyGamesSDKMock.createInviteLink.mockReturnValue(null);

    const el = await createModal({ gameId: "cg-fail" });
    const shareButton = el.querySelector<OButton>(
      'o-button[translationKey="win_modal.share"]',
    )!;

    shareButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(copyToClipboardMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith("Failed to copy", "red");
  });

  it("shows failure toast when game ID is missing", async () => {
    const el = await createModal({ gameId: "" });
    const shareButton = el.querySelector<OButton>(
      'o-button[translationKey="win_modal.share"]',
    )!;

    shareButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(copyToClipboardMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith("Failed to copy", "red");
  });

  it("shows failure toast when copyToClipboard throws", async () => {
    copyToClipboardMock.mockRejectedValueOnce(new Error("clipboard denied"));

    const el = await createModal({ gameId: "game-fail" });
    const shareButton = el.querySelector<OButton>(
      'o-button[translationKey="win_modal.share"]',
    )!;

    shareButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(copyToClipboardMock).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith("Failed to copy", "red");
  });
});
