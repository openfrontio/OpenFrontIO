import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", async (orig) => ({
  ...(await orig<typeof import("../../src/client/Utils")>()),
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import { defaultPlayerCardView } from "../../src/client/components/card/PlayerCardModel";
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
