import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Keep translations deterministic in tests
vi.mock("../../src/client/Utils", () => ({
  translateText: (k: string) => k,
  getSvgAspectRatio: async () => 1,
}));

// Mock cosmetics fetch + relationship logic so we can deterministically render
// purchasable vs owned patterns without depending on real server data.
const fetchCosmeticsMock = vi.fn();
const patternRelationshipMock = vi.fn();
const handlePurchaseMock = vi.fn();
vi.mock("../../src/client/Cosmetics", () => ({
  fetchCosmetics: (...args: any[]) => fetchCosmeticsMock(...args),
  patternRelationship: (...args: any[]) => patternRelationshipMock(...args),
  handlePurchase: (...args: any[]) => handlePurchaseMock(...args),
}));

// Mock PatternButton to avoid canvas + pattern decoding in JSDOM, while still
// allowing us to simulate a user clicking the "Preview Skin" button.
vi.mock("../../src/client/components/PatternButton", () => {
  class PatternButton extends HTMLElement {
    private _pattern: any = null;
    private _colorPalette: any = null;
    private _requiresPurchase = false;
    private _onTest?: (pattern: any, colorPalette: any) => void;

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

    get onTest() {
      return this._onTest;
    }
    set onTest(v: ((pattern: any, colorPalette: any) => void) | undefined) {
      this._onTest = v;
      this.render();
    }

    connectedCallback() {
      this.render();
    }

    render() {
      this.innerHTML = "";
      if (this.requiresPurchase && this.onTest && this.pattern) {
        const btn = document.createElement("button");
        btn.setAttribute("data-testid", "preview-skin");
        btn.textContent = "skin_test_modal.preview_skin";
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.onTest?.(this.pattern, this.colorPalette ?? null);
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
    // TerritoryPatternsModal.refresh() calls this; returning a simple string keeps
    // lit's render() happy without invoking canvas.
    renderPatternPreview: () => "",
  };
});

import { TerritoryPatternsModal } from "../../src/client/TerritoryPatternsModal";

const makeCosmetics = () =>
  ({
    patterns: {
      // purchasable: no palettes => exactly 1 rendered button (null palette only)
      purch_pattern: {
        name: "purch_pattern",
        affiliateCode: "aff",
        pattern: "AQID",
        product: { price: "$1.00", priceId: "price_test" },
        colorPalettes: [],
      },
      // owned: has one palette => 2 rendered buttons (palette + null)
      owned_pattern: {
        name: "owned_pattern",
        affiliateCode: "aff",
        pattern: "BAUG",
        product: null,
        colorPalettes: [{ name: "pal1" }],
      },
    },
    colorPalettes: {
      pal1: {
        name: "pal1",
        primaryColor: "#ffffff",
        secondaryColor: "#000000",
      },
    },
  }) as any;

const makeUserMe = (overrides?: Partial<any>) =>
  ({
    user: { discord: { id: "d" } },
    player: { publicId: "client123", flares: [] },
    ...overrides,
  }) as any;

describe("TerritoryPatternsModal skin button simulation", () => {
  let modal: TerritoryPatternsModal;

  beforeEach(async () => {
    // Some test environments inject a non-standard localStorage. The modal uses
    // UserSettings which expects the Storage API.
    if (typeof (globalThis as any).localStorage?.getItem !== "function") {
      let store: Record<string, string> = {};
      Object.defineProperty(globalThis, "localStorage", {
        value: {
          getItem: (k: string) => (k in store ? store[k] : null),
          setItem: (k: string, v: string) => {
            store[k] = String(v);
          },
          removeItem: (k: string) => {
            delete store[k];
          },
          clear: () => {
            store = {};
          },
        },
        configurable: true,
      });
    }

    if (!customElements.get("territory-patterns-modal")) {
      customElements.define("territory-patterns-modal", TerritoryPatternsModal);
    }

    fetchCosmeticsMock.mockResolvedValue(makeCosmetics());
    patternRelationshipMock.mockImplementation((pattern: any) => {
      if (pattern?.name === "owned_pattern") return "owned";
      if (pattern?.name === "purch_pattern") return "purchasable";
      return "blocked";
    });

    modal = document.createElement(
      "territory-patterns-modal",
    ) as TerritoryPatternsModal;
    modal.inline = true;
    document.body.appendChild(modal);
    await modal.updateComplete;

    // Load user + cosmetics so the modal can render the store grid.
    await modal.onUserMe(makeUserMe());
    await modal.updateComplete;

    // Ensure we're in store mode (showOnlyOwned=false) and using the expected store code.
    await modal.open({ affiliateCode: "aff", showOnlyOwned: false });
    await modal.updateComplete;
  });

  afterEach(() => {
    document.body.removeChild(modal);
    vi.clearAllMocks();
  });

  it("toggles the 'My Skins' (show only owned) button", async () => {
    // Store mode hides owned items => only purchasable should render (1 element)
    expect(modal.querySelectorAll("pattern-button").length).toBe(1);

    const toggleBtn = Array.from(modal.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("territory_patterns.show_only_owned"),
    );
    expect(toggleBtn).toBeTruthy();

    toggleBtn!.click();
    await modal.updateComplete;

    // Owned-only mode shows owned items including the default pattern (null),
    // so we expect: 1 default + 2 owned_pattern variants = 3.
    expect(modal.querySelectorAll("pattern-button").length).toBe(3);
  });

  it("clicking 'Preview Skin' dispatches a join-lobby event with isSkinTest=true", async () => {
    const joinLobbyHandler = vi.fn();
    modal.addEventListener("join-lobby", joinLobbyHandler as any);

    const testBtn = modal.querySelector(
      'button[data-testid="preview-skin"]',
    ) as HTMLButtonElement | null;
    expect(testBtn).toBeTruthy();

    testBtn!.click();

    expect(joinLobbyHandler).toHaveBeenCalledTimes(1);
    const event = joinLobbyHandler.mock.calls[0][0] as CustomEvent;
    expect(event.detail.isSkinTest).toBe(true);
    expect(event.detail.clientID).toBe("client123");
    expect(event.detail.gameID).toBe("purch_pattern");

    const player0 = event.detail.gameStartInfo.players[0];
    expect(player0.clientID).toBe("client123");
    expect(player0.cosmetics.pattern.name).toBe("purch_pattern");
  });
});
