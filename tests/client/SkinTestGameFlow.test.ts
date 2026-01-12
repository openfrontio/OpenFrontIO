import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (k: string) => k,
  getSvgAspectRatio: async () => 1,
}));

// Avoid any audio side effects.
vi.mock("../../src/client/sound/SoundManager", () => ({
  default: {
    playBackgroundMusic: vi.fn(),
    stopBackgroundMusic: vi.fn(),
  },
}));

const fetchCosmeticsMock = vi.fn();
const handlePurchaseMock = vi.fn();
vi.mock("../../src/client/Cosmetics", () => ({
  fetchCosmetics: (...args: any[]) => fetchCosmeticsMock(...args),
  handlePurchase: (...args: any[]) => handlePurchaseMock(...args),
  // Not needed in this suite
  patternRelationship: () => "blocked",
}));

// Mock PatternButton so SkinTestWinModal can render a purchase click target in JSDOM.
vi.mock("../../src/client/components/PatternButton", () => {
  class PatternButton extends HTMLElement {
    private _pattern: any = null;
    private _colorPalette: any = null;
    private _requiresPurchase = false;
    private _onPurchase?: (pattern: any, colorPalette: any) => void;

    get pattern() {
      return this._pattern;
    }
    set pattern(v: any) {
      this._pattern = v;
      this.render();
    }

    get colorPalette() {
      return this._colorPalette;
    }
    set colorPalette(v: any) {
      this._colorPalette = v;
      this.render();
    }

    get requiresPurchase() {
      return this._requiresPurchase;
    }
    set requiresPurchase(v: boolean) {
      this._requiresPurchase = v;
      this.render();
    }

    get onPurchase() {
      return this._onPurchase;
    }
    set onPurchase(v: ((pattern: any, colorPalette: any) => void) | undefined) {
      this._onPurchase = v;
      this.render();
    }

    connectedCallback() {
      this.render();
    }

    render() {
      this.innerHTML = "";
      if (this.requiresPurchase && this.onPurchase && this.pattern) {
        const btn = document.createElement("button");
        btn.setAttribute("data-testid", "buy-skin");
        btn.textContent = "territory_patterns.purchase";
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.onPurchase?.(this.pattern, this.colorPalette ?? null);
        });
        this.appendChild(btn);
      }
    }
  }

  if (!customElements.get("pattern-button")) {
    customElements.define("pattern-button", PatternButton);
  }

  return {
    PatternButton,
    renderPatternPreview: () => "",
  };
});

import { ClientGameRunner } from "../../src/client/ClientGameRunner";
import { SkinTestWinModal } from "../../src/client/graphics/layers/SkinTestWinModal";
import { GameUpdateType } from "../../src/core/game/GameUpdates";

const makeCosmetics = () =>
  ({
    patterns: {
      purch_pattern: {
        name: "purch_pattern",
        affiliateCode: "aff",
        pattern: "AQID",
        product: { price: "$1.00", priceId: "price_test" },
        colorPalettes: [],
      },
    },
    colorPalettes: {},
  }) as any;

describe("Skin test game flow", () => {
  let modal: SkinTestWinModal;

  beforeEach(async () => {
    fetchCosmeticsMock.mockResolvedValue(makeCosmetics());

    // Ensure the skin test win modal exists in DOM.
    if (!customElements.get("skin-test-win-modal")) {
      customElements.define("skin-test-win-modal", SkinTestWinModal);
    }

    modal = document.createElement("skin-test-win-modal") as SkinTestWinModal;
    document.body.appendChild(modal);
    await modal.updateComplete;
  });

  afterEach(() => {
    document.body.removeChild(modal);
    vi.clearAllMocks();
  });

  it("when a skin-test game ends (win update), it shows the buy modal and purchase calls handlePurchase", async () => {
    // Minimal stubs for runner dependencies.
    // Use a real EventBus so the modal can subscribe to events.
    const { EventBus } = await import("../../src/core/EventBus");
    const eventBus = new EventBus();
    modal.eventBus = eventBus;

    const renderer = {
      initialize: vi.fn(),
      tick: vi.fn(),
    } as any;

    const input = {
      initialize: vi.fn(),
    } as any;

    const transport = {
      turnComplete: vi.fn(),
      updateCallback: vi.fn(),
      rejoinGame: vi.fn(),
      leaveGame: vi.fn(),
    } as any;

    let workerCallback: any;
    const worker = {
      start: (cb: any) => {
        workerCallback = cb;
      },
      sendHeartbeat: vi.fn(),
      sendTurn: vi.fn(),
      cleanup: vi.fn(),
    } as any;

    const myPlayer = {
      cosmetics: {
        pattern: {
          name: "purch_pattern",
          colorPalette: null,
        },
      },
      troops: () => 1000,
      clientID: () => "client123",
    } as any;

    const gameView = {
      update: vi.fn(),
      playerByClientID: vi.fn(() => myPlayer),
      config: () => ({ isRandomSpawn: () => false }),
      inSpawnPhase: () => false,
      myPlayer: () => myPlayer,
    } as any;

    const lobby = {
      clientID: "client123",
      gameID: "purch_pattern",
      playerName: "Tester",
      cosmetics: {},
      serverConfig: {} as any,
      turnstileToken: null,
      isSkinTest: true,
      gameStartInfo: {
        gameID: "purch_pattern",
        players: [],
        config: { isRandomSpawn: () => false },
        lobbyCreatedAt: Date.now(),
      },
    } as any;

    const runner = new ClientGameRunner(
      lobby,
      eventBus,
      renderer,
      input,
      transport,
      worker,
      gameView,
    ) as any;

    // Seed the private myPlayer field so showSkinTestModal can resolve the pattern.
    runner.myPlayer = myPlayer;

    // Start the runner so it registers the worker callback.
    runner.start();
    expect(workerCallback).toBeTruthy();

    // Simulate the game ending via a Win update.
    const updates: any[] = [];
    updates[GameUpdateType.Hash] = [];
    updates[GameUpdateType.Win] = [
      {
        type: GameUpdateType.Win,
        winner: ["player", "client123"],
        allPlayersStats: {},
      },
    ];

    workerCallback({
      tick: 1,
      updates,
      packedTileUpdates: new BigUint64Array(),
      playerNameViewData: {},
      tickExecutionDuration: 0,
    });

    // showSkinTestModal() is async (fetchCosmetics + lit updates). Give the
    // microtask queue a moment, then await the next render.
    await new Promise((r) => setTimeout(r, 0));
    await modal.updateComplete;
    expect(modal.isVisible).toBe(true);

    // PatternButton is also a custom element; give it a tick to render.
    await new Promise((r) => setTimeout(r, 0));

    const buyBtn = modal.querySelector(
      'button[data-testid="buy-skin"]',
    ) as HTMLButtonElement | null;
    expect(buyBtn).toBeTruthy();

    buyBtn!.click();

    expect(handlePurchaseMock).toHaveBeenCalledTimes(1);
    expect(handlePurchaseMock.mock.calls[0][0].name).toBe("purch_pattern");
  });
});
