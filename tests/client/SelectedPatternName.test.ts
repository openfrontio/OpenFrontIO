import { describe, expect, it } from "vitest";
import {
  selectedPatternNameFor,
  type ResolvedCosmetic,
} from "../../src/client/Cosmetics";

function item(partial: Partial<ResolvedCosmetic>): ResolvedCosmetic {
  return {
    type: "pattern",
    cosmetic: null,
    colorPalette: null,
    relationship: "owned",
    key: "k",
    ...partial,
  } as ResolvedCosmetic;
}

describe("selectedPatternNameFor", () => {
  it("names a skin skin:<name>", () => {
    expect(
      selectedPatternNameFor(
        item({
          type: "skin",
          cosmetic: { name: "mountain" } as ResolvedCosmetic["cosmetic"],
        }),
      ),
    ).toBe("skin:mountain");
  });

  it("names a pattern with a palette pattern:<name>:<palette>", () => {
    expect(
      selectedPatternNameFor(
        item({
          cosmetic: {
            name: "camo",
            pattern: "AAAA",
          } as ResolvedCosmetic["cosmetic"],
          colorPalette: { name: "crimson" } as ResolvedCosmetic["colorPalette"],
        }),
      ),
    ).toBe("pattern:camo:crimson");
  });

  it("names a pattern without a palette pattern:<name>", () => {
    expect(
      selectedPatternNameFor(
        item({
          cosmetic: {
            name: "camo",
            pattern: "AAAA",
          } as ResolvedCosmetic["cosmetic"],
        }),
      ),
    ).toBe("pattern:camo");
  });

  it("is undefined for the default pattern", () => {
    expect(selectedPatternNameFor(item({}))).toBeUndefined();
  });

  it("is undefined for a skin with no catalog entry", () => {
    expect(selectedPatternNameFor(item({ type: "skin" }))).toBeUndefined();
  });

  it("is undefined for other cosmetic types", () => {
    expect(selectedPatternNameFor(item({ type: "flag" }))).toBeUndefined();
  });
});
