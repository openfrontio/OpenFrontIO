import { describe, expect, it, vi } from "vitest";

// The real English strings: what the Save bar and the unsaved-changes guard
// say.
vi.mock("../../src/client/Utils", async () => {
  const en = (await import("../../resources/lang/en.json")).default;
  return {
    translateText: (key: string, params: Record<string, unknown> = {}) => {
      let text = key
        .split(".")
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown>)?.[part],
          en,
        );
      if (typeof text !== "string") return key;
      for (const [k, v] of Object.entries(params)) {
        text = (text as string).replace(`{${k}}`, String(v));
      }
      return text;
    },
  };
});

import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import { cardChangeLine } from "../../src/client/components/inventory/CardChangeText";

const COSMETICS = {
  patterns: {},
  flags: {},
  cardTitles: {
    warmonger: {
      product: null,
      rarity: "rare",
      name: "warmonger",
      text: "Warmonger",
    },
  },
} as unknown as Cosmetics;

describe("cardChangeLine", () => {
  it("names a title change by its text", () => {
    expect(
      cardChangeLine(COSMETICS, {
        slot: { kind: "title" },
        from: null,
        to: "warmonger",
      }),
    ).toBe("Title: No title → Warmonger");
  });

  it("a title the catalogue no longer has reads No title", () => {
    expect(
      cardChangeLine(COSMETICS, {
        slot: { kind: "title" },
        from: "gone",
        to: "warmonger",
      }),
    ).toBe("Title: No title → Warmonger");
  });
});
