import { afterEach, describe, expect, it, vi } from "vitest";
import {
  purchaseCosmetic,
  type ResolvedCosmetic,
} from "../../src/client/Cosmetics";

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getUserMe: vi.fn(),
}));

const { getUserMe } = await import("../../src/client/Api");

const translations = {
  "cosmetics.hard": "plutonium",
  "inventory.selected_cosmetic_variant": "{name} ({variant})",
  "territory_patterns.pattern.stripes": "Ocean Stripes",
  "territory_patterns.color_palette.red": "Crimson",
};

const red: ResolvedCosmetic = {
  type: "pattern",
  cosmetic: {
    name: "stripes",
    pattern: "AAAAAA",
    product: null,
    priceHard: 120,
    rarity: "rare",
  } as never,
  colorPalette: {
    name: "red",
    primaryColor: "#ef4444",
    secondaryColor: "#7f1d1d",
  },
  relationship: "purchasable",
  key: "pattern:stripes:red",
};

describe("purchaseCosmetic naming", () => {
  let languageFixture: HTMLElement | undefined;

  afterEach(() => {
    languageFixture?.remove();
    languageFixture = undefined;
    vi.mocked(getUserMe).mockReset();
  });

  function installTranslations() {
    languageFixture = document.createElement("lang-selector");
    Object.assign(languageFixture, {
      translations,
      defaultTranslations: translations,
      currentLang: "en",
    });
    document.body.appendChild(languageFixture);
  }

  it("names the colour when the balance is short", async () => {
    installTranslations();
    vi.mocked(getUserMe).mockResolvedValue({
      player: { currency: { hard: 10, soft: 0 } },
    } as never);

    const result = await purchaseCosmetic(red, "hard");

    // Every palette of a pattern shares one name, so "you need 110 more for
    // Ocean Stripes" would not say which tile is short.
    expect(result).toMatchObject({
      item: "Ocean Stripes (Crimson)",
      shortfall: 110,
      currency: "plutonium",
    });
  });
});
