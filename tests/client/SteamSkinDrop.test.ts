import { UserMeResponseSchema } from "@openfront/shared/ApiSchemas";
import { beforeEach, describe, expect, it } from "vitest";
import type { ResolvedCosmetic } from "../../src/client/Cosmetics";
import {
  findSteamSkinDrop,
  resetSteamSkinDropForTest,
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
