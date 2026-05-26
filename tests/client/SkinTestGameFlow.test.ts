import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (k: string) => k,
  getSvgAspectRatio: async () => 1,
}));

vi.mock("../../src/client/sound/SoundManager", () => ({
  SoundManager: vi.fn().mockImplementation(() => ({
    playBackgroundMusic: vi.fn(),
    stopBackgroundMusic: vi.fn(),
  })),
}));

const fetchCosmeticsMock = vi.fn();
const purchaseCosmeticMock = vi.fn();
vi.mock("../../src/client/Cosmetics", () => ({
  fetchCosmetics: (...args: any[]) => fetchCosmeticsMock(...args),
  purchaseCosmetic: (...args: any[]) => purchaseCosmeticMock(...args),
  patternRelationship: () => "blocked",
  resolveCosmetics: () => [],
}));

// Mock CosmeticButton so the modal can render a clickable purchase target in
// JSDOM without dragging in real canvas rendering.
vi.mock("../../src/client/components/CosmeticButton", () => {
  class CosmeticButton extends HTMLElement {
    private _resolved: any = null;
    private _onPurchase?: (resolved: any, method: string) => void;

    get resolved() {
      return this._resolved;
    }
    set resolved(v: any) {
      this._resolved = v;
      this.renderBtn();
    }

    get onPurchase() {
      return this._onPurchase;
    }
    set onPurchase(v: ((resolved: any, method: string) => void) | undefined) {
      this._onPurchase = v;
      this.renderBtn();
    }

    connectedCallback() {
      this.renderBtn();
    }

    renderBtn() {
      this.innerHTML = "";
      if (this._resolved && this._onPurchase) {
        const btn = document.createElement("button");
        btn.setAttribute("data-testid", "buy-skin");
        btn.textContent = "territory_patterns.purchase";
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          this._onPurchase?.(this._resolved, "dollar");
        });
        this.appendChild(btn);
      }
    }
  }

  if (!customElements.get("cosmetic-button")) {
    customElements.define("cosmetic-button", CosmeticButton);
  }

  return { CosmeticButton };
});

import { ClientGameRunner } from "../../src/client/ClientGameRunner";
import { SkinTestWinModal } from "../../src/client/hud/layers/SkinTestWinModal";
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
  let runner: ClientGameRunner | null = null;

  beforeEach(async () => {
    fetchCosmeticsMock.mockResolvedValue(makeCosmetics());

    if (!customElements.get("skin-test-win-modal")) {
      customElements.define("skin-test-win-modal", SkinTestWinModal);
    }

    modal = document.createElement("skin-test-win-modal") as SkinTestWinModal;
    document.body.appendChild(modal);
    await modal.updateComplete;
  });

  afterEach(() => {
    runner?.stop();
    runner = null;
    document.body.removeChild(modal);
    vi.clearAllMocks();
  });

  it("shows the buy modal on game-end and routes purchase through the modal", async () => {
    const { EventBus } = await import("../../src/core/EventBus");
    const eventBus = new EventBus();

    const renderer = {
      initialize: vi.fn(),
      tick: vi.fn(),
      skinTestWinModal: modal,
    } as any;

    const input = { initialize: vi.fn() } as any;

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
        pattern: { name: "purch_pattern", colorPalette: null },
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

    runner = new ClientGameRunner(
      lobby,
      "client123",
      eventBus,
      renderer,
      input,
      transport,
      worker,
      gameView,
      { playBackgroundMusic: vi.fn(), dispose: vi.fn() } as any,
      {} as any,
    );

    runner.start();
    expect(workerCallback).toBeTruthy();

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

    // showByName() is async (fetchCosmetics + lit updates); wait for the
    // microtask queue to drain, then for the next render.
    await new Promise((r) => setTimeout(r, 0));
    await modal.updateComplete;
    expect(modal.isVisible).toBe(true);

    // The mock cosmetic-button is also a custom element; let it render.
    await new Promise((r) => setTimeout(r, 0));

    const buyBtn = modal.querySelector(
      'button[data-testid="buy-skin"]',
    ) as HTMLButtonElement | null;
    expect(buyBtn).toBeTruthy();

    buyBtn!.click();

    expect(purchaseCosmeticMock).toHaveBeenCalledTimes(1);
    expect(purchaseCosmeticMock.mock.calls[0][0].cosmetic.name).toBe(
      "purch_pattern",
    );
  });
});
