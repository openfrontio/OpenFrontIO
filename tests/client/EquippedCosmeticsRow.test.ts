import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResolvedCosmetic } from "../../src/client/Cosmetics";

const { getUserMe, fetchCosmetics, resolveCosmetics } = vi.hoisted(() => ({
  getUserMe: vi.fn(async () => false),
  fetchCosmetics: vi.fn(async () => null),
  resolveCosmetics: vi.fn((): ResolvedCosmetic[] => []),
}));

vi.mock("../../src/client/Api", () => ({ getUserMe }));
vi.mock("../../src/client/Cosmetics", () => ({
  fetchCosmetics,
  resolveCosmetics,
  translateCosmetic: (_prefix: string, name: string) => name,
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

import { EquippedCosmeticsRow } from "../../src/client/components/EquippedCosmeticsRow";

function crownEntry(
  relationship: ResolvedCosmetic["relationship"],
): ResolvedCosmetic {
  return {
    type: "crown",
    cosmetic: { name: "gold", rarity: "legendary" } as never,
    colorPalette: null,
    relationship,
    key: "crown:gold",
  };
}

async function renderRow(): Promise<EquippedCosmeticsRow> {
  if (!customElements.get("equipped-cosmetics-row")) {
    customElements.define("equipped-cosmetics-row", EquippedCosmeticsRow);
  }
  const el = document.createElement(
    "equipped-cosmetics-row",
  ) as EquippedCosmeticsRow;
  el.cosmetics = { crown: { name: "gold", url: "/crown.png" } };
  document.body.appendChild(el);
  await el.updateComplete;
  // Second settle: the catalog and account load after the first render.
  await Promise.resolve();
  await el.updateComplete;
  return el;
}

describe("equipped-cosmetics-row", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resolveCosmetics.mockReturnValue([]);
  });

  it("renders nothing for a player with no cosmetics", async () => {
    const el = await renderRow();
    el.cosmetics = {};
    await el.updateComplete;

    expect(el.querySelector("button")).toBeNull();
    // The host must not keep taking up a flex gap once it has no tiles.
    expect(el.hasAttribute("hidden")).toBe(true);
  });

  it("unhides the host once the player has cosmetics", async () => {
    resolveCosmetics.mockReturnValue([crownEntry("owned")]);
    const el = await renderRow();

    expect(el.hasAttribute("hidden")).toBe(false);
  });

  it("opens the store in a new tab for an item the viewer can buy", async () => {
    resolveCosmetics.mockReturnValue([crownEntry("purchasable")]);
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    const el = await renderRow();
    const tile = el.querySelector("button")!;
    expect(tile.hasAttribute("disabled")).toBe(false);
    tile.click();

    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("#modal=store&tab=cosmetics&item=crown%3Agold"),
      "_blank",
      "noopener",
    );
    open.mockRestore();
  });

  it("shows an owned item without a store link", async () => {
    resolveCosmetics.mockReturnValue([crownEntry("owned")]);
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    const el = await renderRow();
    const tile = el.querySelector("button")!;
    tile.click();

    expect(tile.hasAttribute("disabled")).toBe(true);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});

// The player panel passes the player's card: its paid items join the row,
// with Store links for the ones the viewer doesn't own. Taunts and titles are
// held back and never appear.
describe("equipped-cosmetics-row: card items", () => {
  const sold = { product: null, priceHard: 200 };
  const CATALOG = {
    patterns: {},
    flags: {},
    playerCards: {
      standard: { ...sold, name: "standard", rarity: "rare" },
    },
    cardBackgrounds: {
      bg_pacific: {
        ...sold,
        name: "bg_pacific",
        rarity: "epic",
        url: "/cosmetics/bg_pacific.webp",
      },
    },
    cardTrackers: {
      wins: { ...sold, name: "wins", stat: "wins", rarity: "common" },
      best_elo: {
        product: null,
        name: "best_elo",
        stat: "best_elo",
        rarity: "common",
        unlockSource: { label: "Play ranked" },
      },
    },
    cardTitles: { warmonger: { ...sold, name: "warmonger", text: "War" } },
    taunts: {
      salute: { ...sold, name: "salute", tauntKind: "icon", preset: "s" },
    },
  };
  const CARD = {
    username: "Volt",
    clanTag: null,
    badge: null,
    background: {
      name: "bg_pacific",
      url: "/cosmetics/bg_pacific.webp",
      rarity: "epic",
    },
    title: { text: "War" },
    trackers: [
      { stat: "wins", value: 10 },
      { stat: "best_elo", value: 1800 },
    ],
    taunt: { name: "salute", tauntKind: "icon", preset: "s" },
  };

  async function renderCardRow(flares: string[], card: unknown = CARD) {
    fetchCosmetics.mockResolvedValue(CATALOG as never);
    getUserMe.mockResolvedValue({ player: { flares } } as never);
    if (!customElements.get("equipped-cosmetics-row")) {
      customElements.define("equipped-cosmetics-row", EquippedCosmeticsRow);
    }
    const el = document.createElement(
      "equipped-cosmetics-row",
    ) as EquippedCosmeticsRow;
    el.cosmetics = {};
    el.card = card as never;
    document.body.appendChild(el);
    await el.updateComplete;
    await Promise.resolve();
    await Promise.resolve();
    await el.updateComplete;
    return el;
  }

  const tile = (el: Element, key: string) =>
    el.querySelector<HTMLButtonElement>(`[data-card-item="${key}"]`);

  beforeEach(() => {
    document.body.innerHTML = "";
    resolveCosmetics.mockReturnValue([]);
  });

  it("adds the card, its background and trackers, never title or taunt", async () => {
    const el = await renderCardRow([]);
    expect(tile(el, "playerCard:standard")).not.toBeNull();
    expect(tile(el, "cardBackground:bg_pacific")).not.toBeNull();
    expect(tile(el, "cardTracker:wins")).not.toBeNull();
    expect(tile(el, "cardTracker:best_elo")).not.toBeNull();
    expect(el.querySelector('[data-card-item^="cardTitle:"]')).toBeNull();
    expect(el.querySelector('[data-card-item^="taunt:"]')).toBeNull();
    expect(el.hasAttribute("hidden")).toBe(false);
  });

  it("the buy mark on a card tile is at least 11px", async () => {
    const el = await renderCardRow([]);
    const mark = tile(el, "cardBackground:bg_pacific")!.querySelector(
      "span[aria-hidden='true'].absolute",
    )!;
    expect(mark.textContent).toBe("+");
    expect(mark.className).not.toContain("text-[10px]");
    expect(mark.className).toMatch(/text-\[(1[1-9]|[2-9]\d)px\]|text-xs/);
  });

  it("links an unowned paid item to it in the Store, in a new tab", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const el = await renderCardRow(["playerCard:standard"]);
    const bg = tile(el, "cardBackground:bg_pacific")!;
    expect(bg.disabled).toBe(false);
    bg.click();
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining(
        "#modal=store&tab=cosmetics&item=cardBackground%3Abg_pacific",
      ),
      "_blank",
      "noopener",
    );
    open.mockRestore();
  });

  it("owned items and earned-only items have no link", async () => {
    const el = await renderCardRow([
      "playerCard:standard",
      "cardBackground:bg_pacific",
    ]);
    expect(tile(el, "playerCard:standard")!.disabled).toBe(true);
    expect(tile(el, "cardBackground:bg_pacific")!.disabled).toBe(true);
    // Earned by playing, not sold.
    expect(tile(el, "cardTracker:best_elo")!.disabled).toBe(true);
    expect(tile(el, "cardTracker:wins")!.disabled).toBe(false);
  });

  it("no card: no card items", async () => {
    const el = await renderCardRow([], null);
    expect(el.querySelector("[data-card-item]")).toBeNull();
    expect(el.hasAttribute("hidden")).toBe(true);
  });
});
