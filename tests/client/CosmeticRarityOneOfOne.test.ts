import { describe, expect, it } from "vitest";
import {
  cosmeticRarityBadgeClass,
  cosmeticRarityLabel,
} from "../../src/client/components/CosmeticPresentation";
import type { ResolvedCosmetic } from "../../src/client/Cosmetics";

function withRarity(rarity: string): ResolvedCosmetic {
  return {
    type: "cardBackground",
    cosmetic: { name: "bg_test", product: null, rarity } as never,
    colorPalette: null,
    relationship: "owned",
    key: "cardBackground:bg_test",
  } as never;
}

// Without a language loaded, translateText returns the key, so each label
// reads as the key it looks up.
describe("a 1 of 1 cosmetic's rarity", () => {
  it("is labelled 1 of 1, not Common", () => {
    expect(cosmeticRarityLabel(withRarity("oneofone"))).toBe(
      "cosmetics.oneofone",
    );
  });

  it("gets its own badge colour, not Common's", () => {
    expect(cosmeticRarityBadgeClass(withRarity("oneofone"))).not.toBe(
      cosmeticRarityBadgeClass(withRarity("common")),
    );
  });

  it("an unknown rarity still reads as Common", () => {
    expect(cosmeticRarityLabel(withRarity("mythic"))).toBe("cosmetics.common");
  });
});
