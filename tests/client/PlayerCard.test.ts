import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
// The card and badge components take translateText from Translate.ts.
vi.mock("../../src/client/Translate", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import { CardBackground } from "../../src/client/components/card/CardBackground";
import { PlayerCard } from "../../src/client/components/card/PlayerCard";
import {
  buildPlayerCardView,
  defaultPlayerCardView,
  formatTracker,
  type PlayerCardView,
} from "../../src/client/components/card/PlayerCardModel";

if (!customElements.get("player-card")) {
  customElements.define("player-card", PlayerCard);
}
if (!customElements.get("card-background")) {
  customElements.define("card-background", CardBackground);
}

const item = { product: null, rarity: "legendary" };
const COSMETICS = {
  patterns: {},
  flags: {},
  cardBackgrounds: {
    bg_frontline: {
      ...item,
      name: "bg_frontline",
      url: "/cosmetics/bg_frontline.webp",
    },
    bg_bespoke: {
      ...item,
      rarity: "oneofone",
      name: "bg_bespoke",
      url: "/cosmetics/bg_bespoke.webp",
    },
  },
  cardTitles: {
    warmonger: { ...item, name: "warmonger", text: "Warmonger" },
  },
  taunts: {
    salute: { ...item, name: "salute", tauntKind: "icon", preset: "salute" },
  },
} as unknown as Cosmetics;

const VOLT = buildPlayerCardView(
  {
    username: "Volt",
    clanTag: "UN",
    flag: "/flags/gb.svg",
    badge: { level: 47, prestige: 2, legend: false },
    card: {
      background: "bg_frontline",
      // Saved, but held back: never shown.
      title: "warmonger",
      taunt: "salute",
      trackers: [
        { stat: "wins", value: 1204 },
        { stat: "nukes_launched", value: 38912 },
        { stat: "best_elo", value: 1840 },
      ],
    },
  },
  COSMETICS,
);

describe("buildPlayerCardView", () => {
  it("resolves the equipped items through the catalogue", () => {
    expect(VOLT.background).toEqual({
      name: "bg_frontline",
      url: "/cosmetics/bg_frontline.webp",
      rarity: "legendary",
      animation: undefined,
    });
    expect(VOLT.trackers).toHaveLength(3);
  });

  it("unknown names resolve to null, keeping the rest", () => {
    const view = buildPlayerCardView(
      {
        username: "Volt",
        clanTag: null,
        badge: null,
        card: {
          background: "bg_gone",
          trackers: [{ stat: "wins", value: 3 }],
        },
      },
      COSMETICS,
    );
    expect(view.background).toBeNull();
    expect(view.trackers).toEqual([{ stat: "wins", value: 3 }]);
  });

  it("no catalogue yet: items are null, trackers kept", () => {
    const view = buildPlayerCardView(
      {
        username: "Volt",
        clanTag: null,
        badge: null,
        card: {
          background: "bg_frontline",
          trackers: [{ stat: "wins", value: 3 }],
        },
      },
      null,
    );
    expect(view.background).toBeNull();
    expect(view.trackers).toEqual([{ stat: "wins", value: 3 }]);
  });

  it("default card has no background or trackers", () => {
    const view = defaultPlayerCardView("Volt", "UN", "/flags/gb.svg");
    expect(view).toMatchObject({
      username: "Volt",
      clanTag: "UN",
      background: null,
      trackers: [],
    });
  });
});

describe("formatTracker", () => {
  it("full numbers have separators", () => {
    expect(formatTracker(38912, false)).toBe((38912).toLocaleString());
  });
  it("compact numbers shorten", () => {
    expect(formatTracker(1234567, true)).toBe("1.2M");
    expect(formatTracker(38912, true)).toBe("38.9k");
    expect(formatTracker(840, true)).toBe("840");
  });
});

describe("<player-card>", () => {
  let card: PlayerCard;
  afterEach(() => card?.remove());

  async function render(view: PlayerCardView, props: Partial<PlayerCard> = {}) {
    card = document.createElement("player-card") as PlayerCard;
    card.view = view;
    Object.assign(card, props);
    document.body.appendChild(card);
    await card.updateComplete;
    const bg = card.querySelector("card-background") as CardBackground | null;
    await bg?.updateComplete;
    return card;
  }
  const text = (sel: string) => card.querySelector(sel)?.textContent ?? "";

  it("a saved title or taunt is never shown (held back)", async () => {
    await render(VOLT);
    expect(card.querySelector("[data-card-title]")).toBeNull();
    expect(card.querySelector("[data-card-taunt-icon]")).toBeNull();
    expect(card.textContent).not.toContain("Warmonger");
  });

  it("renders badge, flag, clan tag, name, level line and three trackers", async () => {
    await render(VOLT);
    expect(card.querySelector("level-badge")).not.toBeNull();
    expect(
      card.querySelector<HTMLImageElement>("[data-card-flag]")!.src,
    ).toContain("/flags/gb.svg");
    expect(text("[data-profile-clan]")).toContain("[UN]");
    expect(text("[data-profile-name]")).toContain("Volt");
    expect(text("[data-profile-level-line]")).toContain(
      'progression.level:{"level":47}',
    );
    const trackers = [...card.querySelectorAll("[data-card-tracker]")];
    expect(trackers.map((t) => t.getAttribute("data-card-tracker"))).toEqual([
      "wins",
      "nukes_launched",
      "best_elo",
    ]);
    expect(trackers[1].textContent).toContain((38912).toLocaleString());
    expect(trackers[1].textContent).toContain(
      "player_card.tracker_nukes_launched",
    );
  });

  it("border takes background rarity", async () => {
    await render(VOLT);
    expect(
      card
        .querySelector("[data-player-card]")!
        .getAttribute("data-card-rarity"),
    ).toBe("legendary");
  });

  it("oneofone rarity gets its own border", async () => {
    const view = buildPlayerCardView(
      {
        username: "Volt",
        clanTag: null,
        badge: null,
        card: { background: "bg_bespoke", trackers: [] },
      },
      COSMETICS,
    );
    await render(view);
    expect(
      card
        .querySelector("[data-player-card]")!
        .getAttribute("data-card-rarity"),
    ).toBe("oneofone");
  });

  it("unknown background name renders default", async () => {
    await render(defaultPlayerCardView("Volt", null));
    expect(card.querySelector("card-background img")).toBeNull();
    expect(card.querySelector("[data-card-bg-default]")).not.toBeNull();
  });

  it("base error shows default fill", async () => {
    await render(VOLT);
    const img = card.querySelector("card-background img")!;
    img.dispatchEvent(new Event("error"));
    const bg = card.querySelector("card-background") as CardBackground;
    await bg.updateComplete;
    expect(card.querySelector("card-background img")).toBeNull();
    expect(card.querySelector("[data-card-bg-default]")).not.toBeNull();
  });

  it("phone layout uses compact numbers", async () => {
    await render(VOLT, { narrow: true });
    const nukes = card.querySelector("[data-card-tracker='nukes_launched']")!;
    expect(nukes.textContent).toContain("38.9k");
    expect(card.querySelector("[data-card-trackers-inline]")).not.toBeNull();
  });

  it("the host is a block, so its width can be measured for the phone layout", async () => {
    await render(VOLT);
    expect(getComputedStyle(card).display).toBe("block");
  });

  it("no badge: no level badge or level line", async () => {
    await render(defaultPlayerCardView("Volt", null));
    expect(card.querySelector("level-badge")).toBeNull();
    expect(card.querySelector("[data-profile-level-line]")).toBeNull();
  });
});
