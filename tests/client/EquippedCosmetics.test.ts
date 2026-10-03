import { describe, expect, it } from "vitest";
import { ResolvedCosmetic } from "../../src/client/Cosmetics";
import {
  equippedCosmetics,
  matchesStoreItem,
  storeRouteFor,
} from "../../src/client/EquippedCosmetics";
import { subTabForItem } from "../../src/client/Store";
import { PlayerCosmetics } from "../../src/core/Schemas";

function catalogEntry(
  key: string,
  type: ResolvedCosmetic["type"],
  relationship: ResolvedCosmetic["relationship"],
): ResolvedCosmetic {
  return {
    type,
    cosmetic: { name: key.split(":")[1], rarity: "rare" } as never,
    colorPalette: null,
    relationship,
    key,
  };
}

function effectEntry(
  key: string,
  effectType: string,
  name: string,
  relationship: ResolvedCosmetic["relationship"],
): ResolvedCosmetic {
  return {
    type: "effect",
    cosmetic: { name, rarity: "rare" } as never,
    colorPalette: null,
    relationship,
    key,
    effectType,
  } as ResolvedCosmetic;
}

const equippedPattern: PlayerCosmetics = {
  pattern: {
    name: "hearts",
    patternData: "AAAAAA",
    colorPalette: {
      name: "red",
      primaryColor: "#ff0000",
      secondaryColor: "#000000",
    },
  },
};

describe("equippedCosmetics", () => {
  it("matches a equipped pattern to its colour variant in the catalog", () => {
    const [equipped] = equippedCosmetics(equippedPattern, [
      catalogEntry("pattern:hearts", "pattern", "purchasable"),
      catalogEntry("pattern:hearts:red", "pattern", "owned"),
    ]);

    expect(equipped.key).toBe("pattern:hearts:red");
    expect(equipped.relationship).toBe("owned");
    expect(equipped.pattern?.name).toBe("hearts");
  });

  it("still renders a pattern the catalog doesn't list", () => {
    const [equipped] = equippedCosmetics(equippedPattern, []);

    expect(equipped.relationship).toBe("unknown");
    expect(equipped.pattern?.patternData).toBe("AAAAAA");
    expect(storeRouteFor(equipped)).toBeNull();
  });

  it("lists skins, crowns and every effect slot", () => {
    const equipped = equippedCosmetics(
      {
        skin: { name: "mountain", url: "/skin.png" },
        crown: { name: "gold", url: "/crown.png" },
        effects: {
          nukeTrail: { name: "embers", effectType: "nukeTrail" },
          transportShipTrail: {
            name: "foam",
            effectType: "transportShipTrail",
          },
        },
      },
      [],
    );

    expect(equipped.map((w) => w.key)).toEqual([
      "skin:mountain",
      "crown:gold",
      "effect:nukeTrail:embers",
      "effect:transportShipTrail:foam",
    ]);
    expect(equipped[0].imageUrl).toBe("/skin.png");
  });

  it("skips the flag, which the panel already shows", () => {
    expect(equippedCosmetics({ flag: "us" }, [])).toEqual([]);
  });
});

describe("storeRouteFor", () => {
  it("links a purchasable item to its store tile", () => {
    const [equipped] = equippedCosmetics(equippedPattern, [
      catalogEntry("pattern:hearts:red", "pattern", "purchasable"),
    ]);

    expect(storeRouteFor(equipped)).toBe(
      "#modal=store&tab=cosmetics&item=pattern%3Ahearts%3Ared",
    );
  });

  it("offers no link for owned or blocked items", () => {
    for (const relationship of ["owned", "blocked"] as const) {
      const [equipped] = equippedCosmetics(equippedPattern, [
        catalogEntry("pattern:hearts:red", "pattern", relationship),
      ]);
      expect(storeRouteFor(equipped)).toBeNull();
    }
  });

  it("matches an effect whose catalog key differs from its name", () => {
    // the catalog keys effects by their map key, which need not be the name
    const [equipped] = equippedCosmetics(
      { effects: { nukeTrail: { name: "embers", effectType: "nukeTrail" } } },
      [
        effectEntry(
          "effect:nukeTrail:ember_v2",
          "nukeTrail",
          "embers",
          "purchasable",
        ),
      ],
    );

    expect(equipped.key).toBe("effect:nukeTrail:ember_v2");
    expect(equipped.relationship).toBe("purchasable");
  });

  it("sends effects to their tab, which has no per-item target", () => {
    const [equipped] = equippedCosmetics(
      { effects: { nukeTrail: { name: "embers", effectType: "nukeTrail" } } },
      [catalogEntry("effect:nukeTrail:embers", "effect", "purchasable")],
    );

    expect(storeRouteFor(equipped)).toBe("#modal=store&tab=effects");
  });
});

describe("store deep links", () => {
  it("matches any colour variant of the requested pattern", () => {
    expect(matchesStoreItem("pattern:hearts:blue", "pattern:hearts:red")).toBe(
      true,
    );
    expect(matchesStoreItem("pattern:stars:red", "pattern:hearts:red")).toBe(
      false,
    );
    expect(matchesStoreItem("crown:gold", "crown:gold")).toBe(true);
    expect(matchesStoreItem("crown:gold", "crown:silver")).toBe(false);
  });

  it("opens the sub-tab holding the item", () => {
    expect(subTabForItem("crown:gold")).toBe("crowns");
    expect(subTabForItem("flag:pirate")).toBe("flags");
    expect(subTabForItem("pattern:hearts:red")).toBe("patterns");
    expect(subTabForItem("skin:mountain")).toBe("patterns");
  });
});
