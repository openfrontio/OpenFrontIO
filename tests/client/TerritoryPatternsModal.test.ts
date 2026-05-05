import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Keep translations deterministic in tests
vi.mock("../../src/client/Utils", () => ({
  translateText: (k: string) => k,
  getSvgAspectRatio: async () => 1,
}));

// Mock cosmetics fetch so we can deterministically render owned patterns.
const fetchCosmeticsMock = vi.fn();
const getPlayerCosmeticsMock = vi.fn();
const resolveCosmetics = vi.fn();
const resolvedToPlayerPatternMock = vi.fn();
vi.mock("../../src/client/Cosmetics", () => ({
  fetchCosmetics: (...args: any[]) => fetchCosmeticsMock(...args),
  getPlayerCosmetics: (...args: any[]) => getPlayerCosmeticsMock(...args),
  resolveCosmetics: (...args: any[]) => resolveCosmetics(...args),
  resolvedToPlayerPattern: (...args: any[]) =>
    resolvedToPlayerPatternMock(...args),
  purchaseCosmetic: vi.fn(),
}));

// Stub CosmeticButton to avoid canvas rendering in JSDOM.
vi.mock("../../src/client/components/CosmeticButton", () => {
  if (!customElements.get("cosmetic-button")) {
    customElements.define(
      "cosmetic-button",
      class extends HTMLElement {
        connectedCallback() {
          this.innerHTML = '<button data-testid="cosmetic-btn">mock</button>';
        }
      },
    );
  }
  return {};
});

import { TerritoryPatternsModal } from "../../src/client/TerritoryPatternsModal";

const makeUserMe = () =>
  ({
    user: { discord: { id: "d" } },
    player: { publicId: "client123", flares: [] },
  }) as any;

const makeOwnedPattern = () =>
  ({
    type: "pattern",
    cosmetic: { name: "owned_pattern", pattern: "AQID" },
    colorPalette: null,
    relationship: "owned",
    key: "pattern:owned_pattern",
  }) as any;

describe("TerritoryPatternsModal", () => {
  let modal: TerritoryPatternsModal;

  beforeEach(async () => {
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

    fetchCosmeticsMock.mockResolvedValue({
      patterns: {},
      colorPalettes: {},
    });
    getPlayerCosmeticsMock.mockResolvedValue({ pattern: null, color: null });
    resolveCosmetics.mockReturnValue([makeOwnedPattern()]);

    modal = document.createElement(
      "territory-patterns-modal",
    ) as TerritoryPatternsModal;
    modal.inline = true;
    document.body.appendChild(modal);
    await modal.updateComplete;

    await modal.onUserMe(makeUserMe());
    await modal.updateComplete;
  });

  afterEach(() => {
    document.body.removeChild(modal);
    vi.clearAllMocks();
  });

  it("renders owned patterns via cosmetic-button", async () => {
    await modal.open();
    await modal.updateComplete;

    const buttons = modal.querySelectorAll("cosmetic-button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("shows the Store navigation button", async () => {
    await modal.open();
    await modal.updateComplete;

    // The store button is rendered as an <o-button> custom element with translationKey="main.store"
    const storeBtn = modal.querySelector(
      'o-button[translationKey="main.store"]',
    );
    expect(storeBtn).toBeTruthy();
  });
});
