import { describe, expect, it } from "vitest";
import { ResolvedCosmetic } from "../../src/client/Cosmetics";
import { subTabForItem } from "../../src/client/Store";
import {
  matchesStoreItem,
  storeRouteFor,
  wornCosmetics,
} from "../../src/client/WornCosmetics";
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

const wornPattern: PlayerCosmetics = {
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

describe("wornCosmetics", () => {
  it("matches a worn pattern to its colour variant in the catalog", () => {
    const [worn] = wornCosmetics(wornPattern, [
      catalogEntry("pattern:hearts", "pattern", "purchasable"),
      catalogEntry("pattern:hearts:red", "pattern", "owned"),
    ]);

    expect(worn.key).toBe("pattern:hearts:red");
    expect(worn.relationship).toBe("owned");
    expect(worn.pattern?.name).toBe("hearts");
  });

  it("still renders a pattern the catalog doesn't list", () => {
    const [worn] = wornCosmetics(wornPattern, []);

    expect(worn.relationship).toBe("unknown");
    expect(worn.pattern?.patternData).toBe("AAAAAA");
    expect(storeRouteFor(worn)).toBeNull();
  });

  it("lists skins, crowns and every effect slot", () => {
    const worn = wornCosmetics(
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

    expect(worn.map((w) => w.key)).toEqual([
      "skin:mountain",
      "crown:gold",
      "effect:nukeTrail:embers",
      "effect:transportShipTrail:foam",
    ]);
    expect(worn[0].imageUrl).toBe("/skin.png");
  });

  it("skips the flag, which the panel already shows", () => {
    expect(wornCosmetics({ flag: "us" }, [])).toEqual([]);
  });
});

describe("storeRouteFor", () => {
  it("links a purchasable item to its store tile", () => {
    const [worn] = wornCosmetics(wornPattern, [
      catalogEntry("pattern:hearts:red", "pattern", "purchasable"),
    ]);

    expect(storeRouteFor(worn)).toBe(
      "#modal=store&tab=cosmetics&item=pattern%3Ahearts%3Ared",
    );
  });

  it("offers no link for owned or blocked items", () => {
    for (const relationship of ["owned", "blocked"] as const) {
      const [worn] = wornCosmetics(wornPattern, [
        catalogEntry("pattern:hearts:red", "pattern", relationship),
      ]);
      expect(storeRouteFor(worn)).toBeNull();
    }
  });

  it("sends effects to their tab, which has no per-item target", () => {
    const [worn] = wornCosmetics(
      { effects: { nukeTrail: { name: "embers", effectType: "nukeTrail" } } },
      [catalogEntry("effect:nukeTrail:embers", "effect", "purchasable")],
    );

    expect(storeRouteFor(worn)).toBe("#modal=store&tab=effects");
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
