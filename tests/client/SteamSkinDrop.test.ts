import { UserMeResponseSchema } from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedCosmetic } from "../../src/client/Cosmetics";
import {
  findSteamSkinDrop,
  resetSteamSkinDropForTest,
  showSteamSkinDrop,
  steamSkinDropFor,
  steamSkinDropDueThisLaunch,
  steamSkinDropShown,
  steamSkinDropStringsReady,
  STEAM_SKIN_DROP_KEYS,
} from "../../src/client/SteamSkinDrop";

function resolved(key: string): ResolvedCosmetic {
  return {
    type: key.startsWith("skin:") ? "skin" : "pattern",
    cosmetic: null,
    colorPalette: null,
    relationship: "blocked",
    key,
  };
}

const catalog = [
  resolved("pattern:default"),
  resolved("skin:mountain"),
  resolved("pattern:camo"),
  resolved("pattern:camo:crimson"),
];

describe("findSteamSkinDrop", () => {
  it("finds a skin by name", () => {
    expect(
      findSteamSkinDrop(
        { type: "skin", name: "mountain", colorPalette: null, notice: "n" },
        catalog,
      ),
    ).toBe(catalog[1]);
  });

  it("finds a pattern by name and palette", () => {
    expect(
      findSteamSkinDrop(
        {
          type: "pattern",
          name: "camo",
          colorPalette: "crimson",
          notice: "n",
        },
        catalog,
      ),
    ).toBe(catalog[3]);
  });

  it("returns null when the catalog lacks the item", () => {
    expect(
      findSteamSkinDrop(
        { type: "skin", name: "gone", colorPalette: null, notice: "n" },
        catalog,
      ),
    ).toBeNull();
    expect(
      findSteamSkinDrop(
        { type: "pattern", name: "camo", colorPalette: "teal", notice: "n" },
        catalog,
      ),
    ).toBeNull();
  });

  it("returns null for no drop", () => {
    expect(findSteamSkinDrop(null, catalog)).toBeNull();
    expect(findSteamSkinDrop(undefined, catalog)).toBeNull();
  });
});

describe("steamSkinDrop on the user response", () => {
  const field = UserMeResponseSchema.shape.steamSkinDrop;

  it("the user response parses without the field", () => {
    expect(field.safeParse(undefined).success).toBe(true);
    expect(field.safeParse(null)).toEqual({ success: true, data: null });
  });

  it("parses a well-formed drop", () => {
    const drop = {
      type: "skin",
      name: "mountain",
      colorPalette: null,
      notice: "steam_skin:mountain",
    };
    expect(field.parse(drop)).toEqual(drop);
  });

  it("a malformed field reads as null", () => {
    expect(field.parse({ type: "banner", name: 3 })).toBeNull();
    expect(field.parse("nonsense")).toBeNull();
  });
});

describe("steamSkinDropDueThisLaunch", () => {
  beforeEach(resetSteamSkinDropForTest);

  it("due until shown, then not due for that notice", () => {
    expect(steamSkinDropDueThisLaunch("steam_skin:a")).toBe(true);
    steamSkinDropShown("steam_skin:a");
    expect(steamSkinDropDueThisLaunch("steam_skin:a")).toBe(false);
  });

  it("a different notice is still due", () => {
    steamSkinDropShown("steam_skin:a");
    expect(steamSkinDropDueThisLaunch("steam_skin:b")).toBe(true);
  });
});

describe("steamSkinDropStringsReady", () => {
  it("is ready only when every key translates", () => {
    expect(steamSkinDropStringsReady((key) => `t(${key})`)).toBe(true);
    expect(steamSkinDropStringsReady((key) => key)).toBe(false);
    expect(
      steamSkinDropStringsReady((key) =>
        key === STEAM_SKIN_DROP_KEYS.claim ? key : "x",
      ),
    ).toBe(false);
  });
});

describe("steamSkinDropFor", () => {
  const drop = {
    type: "skin" as const,
    name: "mountain",
    colorPalette: null,
    notice: "steam_skin:mountain",
  };
  const catalogJson = {} as Cosmetics;

  it("does not touch the catalog when the API names no drop", async () => {
    const fetchCatalog = vi.fn(async () => catalogJson);
    expect(
      await steamSkinDropFor(null, fetchCatalog, () => catalog),
    ).toBeNull();
    expect(
      await steamSkinDropFor(undefined, fetchCatalog, () => catalog),
    ).toBeNull();
    expect(fetchCatalog).not.toHaveBeenCalled();
  });

  it("pairs the notice with the catalog entry", async () => {
    expect(
      await steamSkinDropFor(
        drop,
        async () => catalogJson,
        () => catalog,
      ),
    ).toEqual({ notice: "steam_skin:mountain", resolved: catalog[1] });
  });

  it("is null when the catalog failed to load", async () => {
    expect(
      await steamSkinDropFor(
        drop,
        async () => null,
        // resolveCosmetics answers an empty list for a missing catalog.
        (cosmetics) => (cosmetics ? catalog : []),
      ),
    ).toBeNull();
  });

  it("is null when the catalog lacks the item", async () => {
    expect(
      await steamSkinDropFor(
        drop,
        async () => catalogJson,
        () => [catalog[0]],
      ),
    ).toBeNull();
  });
});

describe("showSteamSkinDrop", () => {
  const item = resolved("skin:mountain");

  it("loads the modal, then shows the item and returns the answer", async () => {
    const order: string[] = [];
    const answer = await showSteamSkinDrop(
      item,
      async () => {
        order.push("load");
      },
      () => ({
        show: async (r) => {
          order.push(r === item ? "show" : "wrong item");
          return "equip";
        },
      }),
    );
    expect(answer).toBe("equip");
    expect(order).toEqual(["load", "show"]);
  });

  it("is abandoned when the chunk fails to load", async () => {
    const find = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await showSteamSkinDrop(
        item,
        async () => {
          throw new Error("chunk");
        },
        find,
      ),
    ).toBe("abandoned");
    expect(find).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("is abandoned when the element is missing", async () => {
    expect(
      await showSteamSkinDrop(
        item,
        async () => {},
        () => null,
      ),
    ).toBe("abandoned");
  });
});
