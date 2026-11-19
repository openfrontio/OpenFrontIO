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

import {
  clearSavedLooks,
  isLookSaved,
  savedLooks,
} from "../../src/client/components/card/SavedLooks";
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

// The player panel passes another player's card: one "Get the look" tile, with
// the card's background as its art. It never opens the Store (a purchase
// reloads the page and would end the game): it saves the look for the end
// screen, and a second click removes it.
describe("equipped-cosmetics-row: get the look", () => {
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
  const EVERYTHING = [
    "playerCard:standard",
    "cardBackground:bg_pacific",
    "cardTracker:wins",
    "cardTracker:best_elo",
  ];

  async function renderLookRow(
    flares: string[],
    card: unknown = CARD,
    clientID: string | null = "volt",
  ) {
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
    el.lookGameID = clientID === null ? null : "g1";
    el.lookClientID = clientID;
    document.body.appendChild(el);
    await el.updateComplete;
    await Promise.resolve();
    await Promise.resolve();
    await el.updateComplete;
    return el;
  }

  const lookTile = (el: Element) =>
    el.querySelector<HTMLButtonElement>("[data-get-look]");

  beforeEach(() => {
    document.body.innerHTML = "";
    resolveCosmetics.mockReturnValue([]);
    clearSavedLooks();
  });

  it("one tile, labelled, with the card's background as its art", async () => {
    const el = await renderLookRow([]);
    const t = lookTile(el)!;
    expect(t).not.toBeNull();
    expect(t.textContent).toContain("player_panel.get_the_look");
    expect(t.querySelector("img")!.getAttribute("src")).toContain(
      "bg_pacific.webp",
    );
    expect(t.getAttribute("aria-pressed")).toBe("false");
    // No separate card, background or tracker tiles any more.
    expect(el.querySelector("[data-card-item]")).toBeNull();
    expect(el.hasAttribute("hidden")).toBe(false);
  });

  it("a click saves the look and never opens the Store", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const el = await renderLookRow(["playerCard:standard"]);
    lookTile(el)!.click();
    await el.updateComplete;
    expect(open).not.toHaveBeenCalled();
    expect(isLookSaved("g1", "volt")).toBe(true);
    const [look] = savedLooks("g1");
    expect(look.name).toBe("Volt");
    // The end screen's items, minus what the viewer owns.
    expect(look.items.map((i) => `${i.type}:${i.item.name}`)).toEqual([
      "cardBackground:bg_pacific",
      "cardTracker:wins",
      "cardTracker:best_elo",
    ]);
    const t = lookTile(el)!;
    expect(t.textContent).toContain("player_panel.look_saved");
    expect(t.getAttribute("aria-pressed")).toBe("true");
    open.mockRestore();
  });

  it("a second click removes it", async () => {
    const el = await renderLookRow([]);
    lookTile(el)!.click();
    await el.updateComplete;
    lookTile(el)!.click();
    await el.updateComplete;
    expect(isLookSaved("g1", "volt")).toBe(false);
    expect(lookTile(el)!.textContent).toContain("player_panel.get_the_look");
  });

  it("shows Saved for a look saved earlier this game", async () => {
    const first = await renderLookRow([]);
    lookTile(first)!.click();
    document.body.innerHTML = "";
    const again = await renderLookRow([]);
    expect(lookTile(again)!.textContent).toContain("player_panel.look_saved");
  });

  it("hidden when the viewer owns everything in the look", async () => {
    const el = await renderLookRow(EVERYTHING);
    expect(lookTile(el)).toBeNull();
    expect(el.hasAttribute("hidden")).toBe(true);
  });

  it("hidden when only earned items are left (nothing to buy)", async () => {
    const el = await renderLookRow([
      "playerCard:standard",
      "cardBackground:bg_pacific",
      "cardTracker:wins",
    ]);
    expect(lookTile(el)).toBeNull();
    expect(el.hasAttribute("hidden")).toBe(true);
  });

  it("hidden on the viewer's own panel", async () => {
    const el = await renderLookRow([], CARD, null);
    expect(lookTile(el)).toBeNull();
  });

  it("hidden with no card (none, withheld, bot or nation)", async () => {
    const el = await renderLookRow([], null);
    expect(lookTile(el)).toBeNull();
    expect(el.hasAttribute("hidden")).toBe(true);
  });
});
