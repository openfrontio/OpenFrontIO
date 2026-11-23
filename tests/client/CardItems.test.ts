import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

import {
  CARD_ITEM_GROUP,
  CARD_ITEM_TYPES,
  cardItemName,
} from "../../src/client/components/card/CardItems";

const base = { product: null, rarity: "epic" } as const;

describe("cardItemName", () => {
  it("a background with no translation reads as words, without its prefix", () => {
    expect(
      cardItemName("cardBackground", {
        ...base,
        name: "bg_neon_grid",
        url: "/x.webp",
      }),
    ).toBe("Neon Grid");
  });
});

// The one map from a card item type to its catalogue group (Cosmetics.ts,
// and CardStoreGrid both read it).
describe("CARD_ITEM_GROUP", () => {
  it("names every card item type's catalogue group", () => {
    expect(Object.keys(CARD_ITEM_GROUP).sort()).toEqual(
      [...CARD_ITEM_TYPES].sort(),
    );
    expect(CARD_ITEM_GROUP).toEqual({
      playerCard: "playerCards",
      cardTracker: "cardTrackers",
      cardBackground: "cardBackgrounds",
    });
  });
});
