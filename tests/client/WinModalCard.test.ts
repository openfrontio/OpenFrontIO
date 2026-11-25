import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", async (orig) => ({
  ...(await orig<typeof import("../../src/client/Utils")>()),
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

const catalogue = vi.hoisted(() => ({
  cached: null as unknown,
  fetched: null as unknown,
}));
vi.mock("../../src/client/Cosmetics", async (orig) => ({
  ...(await orig<typeof import("../../src/client/Cosmetics")>()),
  getCachedCosmetics: () => catalogue.cached,
  fetchCosmetics: async () => catalogue.fetched,
}));

import { defaultPlayerCardView } from "../../src/client/components/card/PlayerCardModel";
import { COSMETICS_CHANGED } from "../../src/client/Experiments";
import { WinModal } from "../../src/client/hud/layers/WinModal";

if (!customElements.get("win-modal")) {
  customElements.define("win-modal", WinModal);
}

// WinModal with no game attached: enough to render the modal's frame and
// check where the card section sits and that nothing else moved.
async function renderModal(state: Record<string, unknown>) {
  const modal = document.createElement("win-modal") as unknown as WinModal &
    Record<string, unknown>;
  Object.assign(modal, {
    isVisible: true,
    _title: "You died",
    // The store-skins turn, so no random Steam or Discord promo.
    rand: 0.9,
    ...state,
  });
  document.body.appendChild(modal as unknown as Node);
  await modal.updateComplete;
  const section = modal.querySelector("end-card-section") as unknown as {
    updateComplete: Promise<unknown>;
  } | null;
  await section?.updateComplete;
  return modal as unknown as HTMLElement;
}

describe("WinModal card section", () => {
  // Past the first three games, so the tutorial doesn't take the promo box.
  beforeEach(() => {
    localStorage.setItem("gamesPlayed", "10");
  });
  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.removeItem("gamesPlayed");
  });

  it("eliminated by a human shows label and killer card above XP panel", async () => {
    const modal = await renderModal({
      endCardMode: "eliminatedBy",
      endCardView: defaultPlayerCardView("Volt", "UN"),
    });
    const order = [
      ...modal.querySelectorAll("h2, [data-end-card], game-xp-panel"),
    ].map((el) =>
      el.tagName === "H2"
        ? "h2"
        : el.hasAttribute("data-end-card")
          ? "card"
          : "xp",
    );
    expect(order).toEqual(["h2", "card", "xp"]);
  });

  it("loadout takes the skins turn on an eliminated-by card", async () => {
    const modal = await renderModal({
      endCardMode: "eliminatedBy",
      endCardView: defaultPlayerCardView("Volt", "UN"),
      rand: 0.9,
      loadout: [
        {
          type: "taunt",
          item: { name: "salute", rarity: "epic", product: null },
          state: "buy",
          priceSoft: 800,
        },
      ],
    });
    expect(modal.querySelector("loadout-row")).not.toBeNull();
    expect(modal.querySelector("[data-win-cosmetic-promo]")).toBeNull();
  });

  it("fetches the catalogue when it isn't cached, then shows the items", async () => {
    catalogue.cached = null;
    catalogue.fetched = {
      patterns: {},
      flags: {},
      cardBackgrounds: {
        bg_pacific: {
          product: null,
          rarity: "epic",
          name: "bg_pacific",
          url: "/bg.webp",
        },
      },
    };
    const modal = (await renderModal({})) as unknown as {
      game: unknown;
      setEndCard(choose: () => unknown): void;
      endCardView: { background: { name: string } | null } | null;
      updateComplete: Promise<unknown>;
    };
    modal.game = {
      myPlayer: () => null,
      gameID: () => "g1",
      config: () => ({ gameConfig: () => ({}) }),
      resumedFromSave: () => false,
      playerByClientID: () => ({
        name: () => "Volt",
        clanTag: () => null,
        territoryColor: () => ({ toHex: () => "#123456" }),
      }),
      playerCardOf: () => ({
        card: { background: "bg_pacific", trackers: [] },
        flag: undefined,
      }),
    };
    modal.setEndCard(() => ({ kind: "winner", clientID: "KILLER01" }));
    expect(modal.endCardView?.background).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    await modal.updateComplete;
    expect(modal.endCardView?.background?.name).toBe("bg_pacific");
    catalogue.fetched = null;
  });

  it("rebuilds the eliminated-by loadout at the new catalog's prices", async () => {
    const withBackground = (priceHard: number) => ({
      patterns: {},
      flags: {},
      cardBackgrounds: {
        bg_pacific: {
          product: null,
          rarity: "epic",
          name: "bg_pacific",
          url: "/bg.webp",
          priceHard,
        },
      },
    });
    catalogue.cached = withBackground(240);
    const modal = (await renderModal({})) as unknown as {
      game: unknown;
      setEndCard(choose: () => unknown): void;
      loadout: { priceHard?: number }[];
    };
    modal.game = {
      myPlayer: () => null,
      gameID: () => "g1",
      config: () => ({ gameConfig: () => ({}) }),
      resumedFromSave: () => false,
      playerByClientID: () => ({
        name: () => "Volt",
        clanTag: () => null,
        territoryColor: () => ({ toHex: () => "#123456" }),
      }),
      playerCardOf: () => ({
        card: { background: "bg_pacific", trackers: [] },
        flag: undefined,
      }),
    };
    modal.setEndCard(() => ({ kind: "eliminatedBy", clientID: "KILLER01" }));
    await vi.waitFor(() => expect(modal.loadout[0]?.priceHard).toBe(240));
    // A cohort catalog, or a price_changed refusal's reload, lands.
    document.dispatchEvent(
      new CustomEvent(COSMETICS_CHANGED, { detail: withBackground(300) }),
    );
    await vi.waitFor(() => expect(modal.loadout[0]?.priceHard).toBe(300));
    catalogue.cached = null;
  });

  it("a failure choosing the card leaves today's screen", async () => {
    const modal = (await renderModal({
      endCardMode: "eliminatedBy",
      endCardView: defaultPlayerCardView("Volt", "UN"),
    })) as unknown as {
      game: unknown;
      setEndCard(choose: () => unknown): void;
      endCardMode: string;
    };
    // A game without the card lookups (an older view, a test double).
    modal.game = {
      myPlayer: () => null,
      gameID: () => "g1",
      config: () => ({ gameConfig: () => ({}) }),
      resumedFromSave: () => false,
    };
    expect(() =>
      modal.setEndCard(() => {
        throw new TypeError("playerCardOf is not a function");
      }),
    ).not.toThrow();
    expect(modal.endCardMode).toBe("none");
  });

  it("no card shows today's screen", async () => {
    const modal = await renderModal({ endCardMode: "none" });
    expect(modal.querySelector("[data-end-card]")).toBeNull();
  });

  it("promo slot, buttons and ffa panel unchanged", async () => {
    const actions = (modal: HTMLElement) =>
      [...modal.querySelectorAll("[data-win-action]")].map((a) =>
        a.getAttribute("data-win-action"),
      );
    const without = await renderModal({ endCardMode: "none", rand: 0.9 });
    const before = {
      actions: actions(without),
      promo: without.querySelector("[data-win-cosmetic-promo]") !== null,
    };
    expect(before.actions.length).toBeGreaterThan(0);
    document.body.innerHTML = "";
    const withCard = await renderModal({
      endCardMode: "winner",
      endCardView: defaultPlayerCardView("Volt", "UN"),
      rand: 0.9,
    });
    expect({
      actions: actions(withCard),
      promo: withCard.querySelector("[data-win-cosmetic-promo]") !== null,
    }).toEqual(before);
  });
});
