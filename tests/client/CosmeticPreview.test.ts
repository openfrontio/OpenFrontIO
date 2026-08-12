import { afterEach, describe, expect, it } from "vitest";
import type { ResolvedCosmetic } from "../../src/client/Cosmetics";
import {
  cosmeticDisplayName,
  cosmeticRarity,
} from "../../src/client/components/CosmeticPresentation";
import "../../src/client/components/CosmeticPreview";
import type { CosmeticPreview } from "../../src/client/components/CosmeticPreview";

const translations = {
  "cosmetics.free": "+{numFree} BONUS!",
  "territory_patterns.pattern.default": "Default",
  "territory_patterns.pattern.stripes": "Ocean Stripes",
  "territory_patterns.pattern.forest": "Forest Skin",
  "flags.us": "United States",
  "crowns.golden": "Golden Crown",
  "effects.blue_wake": "Blue Wake",
  "subscriptions.gold": "Gold Membership",
};

const resolved = {
  pattern: {
    type: "pattern",
    cosmetic: {
      name: "stripes",
      pattern: "AAAAAA",
      product: null,
      rarity: "rare",
    },
    colorPalette: {
      name: "ocean",
      primaryColor: "#0ea5e9",
      secondaryColor: "#082f49",
    },
    relationship: "owned",
    key: "pattern:stripes:ocean",
  },
  skin: {
    type: "skin",
    cosmetic: {
      name: "forest",
      url: "/skins/forest.png",
      product: null,
      rarity: "uncommon",
    },
    colorPalette: null,
    relationship: "owned",
    key: "skin:forest",
  },
  flag: {
    type: "flag",
    cosmetic: {
      name: "us",
      url: "/flags/us.svg",
      product: null,
      rarity: "common",
    },
    colorPalette: null,
    relationship: "owned",
    key: "country:us",
  },
  crown: {
    type: "crown",
    cosmetic: {
      name: "golden",
      url: "/crowns/golden.png",
      product: null,
      rarity: "epic",
    },
    colorPalette: null,
    relationship: "owned",
    key: "crown:golden",
  },
  effect: {
    type: "effect",
    cosmetic: {
      name: "blue_wake",
      effectType: "transportShipTrail",
      attributes: {
        type: "gradient",
        colors: ["#0ea5e9", "#1d4ed8"],
        colorSize: 1,
        movementSpeed: 0,
      },
      product: null,
      rarity: "legendary",
    },
    colorPalette: null,
    relationship: "owned",
    key: "effect:transportShipTrail:blue_wake",
  },
  transitionEffect: {
    type: "effect",
    cosmetic: {
      name: "nuke_patriotic_transition",
      effectType: "nukeTrail",
      attributes: {
        type: "transition",
        colors: ["#ff0000", "#ffffff", "#0400ff"],
        frequency: 5,
      },
      product: null,
      rarity: "rare",
    },
    colorPalette: null,
    relationship: "owned",
    key: "effect:nukeTrail:nuke_patriotic_transition",
    effectType: "nukeTrail",
  },
  pack: {
    type: "pack",
    cosmetic: {
      name: "plutonium",
      displayName: "1,000 Plutonium",
      currency: "hard",
      amount: 1000,
      bonusAmount: 0,
      product: null,
      rarity: "rare",
    },
    colorPalette: null,
    relationship: "purchasable",
    key: "pack:plutonium",
  },
  subscription: {
    type: "subscription",
    cosmetic: {
      name: "gold",
      description: "Gold membership",
      priceMonthly: 5,
      dailySoftCurrency: 0,
      dailyHardCurrency: 10,
      hardCurrencySignupBonus: 100,
      unlimitedRanked: true,
      canCreatePublicLobbies: true,
      product: null,
      rarity: "legendary",
    },
    colorPalette: null,
    relationship: "purchasable",
    key: "subscription:gold",
  },
  default: {
    type: "pattern",
    cosmetic: null,
    colorPalette: null,
    relationship: "owned",
    key: "pattern:default",
  },
} as const satisfies Record<string, ResolvedCosmetic>;

describe("CosmeticPreview", () => {
  let languageFixture: HTMLElement | undefined;
  let preview: CosmeticPreview | undefined;

  afterEach(() => {
    preview?.remove();
    languageFixture?.remove();
    preview = undefined;
    languageFixture = undefined;
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

  async function render(resolvedCosmetic: ResolvedCosmetic) {
    preview = document.createElement("cosmetic-preview") as CosmeticPreview;
    preview.resolved = resolvedCosmetic;
    document.body.appendChild(preview);
    await preview.updateComplete;
  }

  it("renders the resolved pattern palette", async () => {
    installTranslations();
    await render(resolved.pattern);

    expect(
      preview!.querySelector('[data-cosmetic-preview="pattern"] img'),
    ).toBeTruthy();
    expect(cosmeticDisplayName(preview!.resolved)).toBe("Ocean Stripes");
    expect(cosmeticRarity(preview!.resolved)).toBe("rare");
  });

  it("renders each resolved cosmetic type with its translated name", async () => {
    installTranslations();
    const cases = [
      [resolved.skin, "skin", "Forest Skin", "uncommon"],
      [resolved.flag, "flag", "United States", "common"],
      [resolved.crown, "crown", "Golden Crown", "epic"],
      [resolved.effect, "effect", "Blue Wake", "legendary"],
      [resolved.pack, "pack", "1,000 Plutonium", "rare"],
      [resolved.subscription, "subscription", "Gold Membership", "legendary"],
    ] as const;

    for (const [resolvedCosmetic, type, displayName, rarity] of cases) {
      await render(resolvedCosmetic);

      expect(
        preview!.querySelector(`[data-cosmetic-preview="${type}"]`),
      ).toBeTruthy();
      expect(cosmeticDisplayName(preview!.resolved)).toBe(displayName);
      expect(cosmeticRarity(preview!.resolved)).toBe(rarity);
      if (type === "skin" || type === "flag" || type === "crown") {
        expect(preview!.querySelector("img")?.alt).toBe(displayName);
      }
      preview!.remove();
      preview = undefined;
    }
  });

  it("renders Default without requiring a catalog cosmetic", async () => {
    installTranslations();
    await render(resolved.default);

    expect(
      preview!.querySelector('[data-cosmetic-preview="default"]'),
    ).toBeTruthy();
    expect(cosmeticDisplayName(preview!.resolved)).toBe("Default");
    expect(cosmeticRarity(preview!.resolved)).toBe("common");
  });

  it("keeps trail transitions visible in a block-sized preview host", async () => {
    installTranslations();
    Element.prototype.animate ??= (() => ({
      cancel: () => {},
    })) as unknown as typeof Element.prototype.animate;
    await render(resolved.transitionEffect as ResolvedCosmetic);

    const trail = preview!.querySelector("trail-swatch")!;
    expect(preview!.classList).toContain("block");
    expect(trail.classList).toContain("block");
    expect(trail.querySelector("div")?.getAttribute("style")).toContain(
      "#ff0000",
    );
  });

  it("uses the server-provided pack display name", async () => {
    installTranslations();
    const heroPack = {
      ...resolved.pack,
      cosmetic: {
        ...resolved.pack.cosmetic!,
        name: "hero_pack",
      },
      key: "pack:hero_pack",
    } as ResolvedCosmetic;
    expect(cosmeticDisplayName(heroPack)).toBe("1,000 Plutonium");
  });

  it("keeps pack icons and bonus ribbons inside the card preview", async () => {
    installTranslations();
    await render({
      ...resolved.pack,
      cosmetic: { ...resolved.pack.cosmetic!, bonusAmount: 250 },
    });

    const previewBox = preview!.querySelector(
      '[data-cosmetic-preview="pack"] > div',
    )!;
    expect(previewBox.className).not.toContain("pb-1");
    expect(previewBox.querySelector("plutonium-icon")?.classList).toContain(
      "shrink-0",
    );
    expect(previewBox.textContent).toContain("+250 BONUS!");
  });
});
