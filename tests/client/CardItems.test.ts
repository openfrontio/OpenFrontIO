import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

import { cardItemName } from "../../src/client/components/card/CardItems";

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

  it("a taunt with no translation reads as words", () => {
    expect(
      cardItemName("taunt", {
        ...base,
        name: "crown_drop",
        tauntKind: "icon",
        preset: "crown_drop",
      }),
    ).toBe("Crown Drop");
  });

  it("a title is its own text", () => {
    expect(
      cardItemName("cardTitle", {
        ...base,
        name: "warmonger",
        text: "Warmonger",
      }),
    ).toBe("Warmonger");
  });
});
