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
});
