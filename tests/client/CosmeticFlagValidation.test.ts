import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserMe } from "../../src/client/Api";
import {
  getPlayerCosmeticsRefs,
  invalidateCosmetics,
} from "../../src/client/Cosmetics";
import type { UserMeResponse } from "../../src/core/ApiSchemas";
import { FLAG_KEY, UserSettings } from "../../src/core/game/UserSettings";

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  // Resolving the real API base needs the runtime config these tests don't
  // boot; the URL is not what is under test.
  getApiBase: () => "https://api.test",
  getUserMe: vi.fn(),
}));

const catalog = {
  patterns: {
    stripes: {
      name: "stripes",
      pattern: "AAAAAA",
      product: null,
      rarity: "rare",
    },
  },
  colorPalettes: {
    fire: {
      name: "fire",
      primaryColor: "#ff0000",
      secondaryColor: "#ffff00",
    },
  },
  flags: {
    donator: {
      name: "donator",
      url: "https://cdn.test/flags/donator.svg",
      product: null,
      rarity: "rare",
    },
  },
  skins: {
    cool: {
      name: "cool",
      url: "https://cdn.test/skins/cool.png",
      product: null,
      rarity: "rare",
    },
  },
  crowns: {
    golden: {
      name: "golden",
      url: "https://cdn.test/crowns/golden.png",
      product: null,
      rarity: "rare",
    },
  },
  effects: {
    transportShipTrail: {
      spectrum: {
        name: "spectrum",
        effectType: "transportShipTrail",
        url: "https://cdn.test/trails/spectrum.png",
        product: null,
        rarity: "rare",
        attributes: {
          type: "gradient",
          colors: ["#ffffff"],
          colorSize: 1,
          movementSpeed: 1,
        },
      },
    },
  },
};

function userWithFlares(flares: string[]): UserMeResponse {
  return {
    player: { publicId: "player-1", flares },
  } as unknown as UserMeResponse;
}

// UserSettings memoises reads in a static cache, so clearing localStorage
// alone leaves the previous test's values visible.
function resetSettings(): void {
  UserSettings.setPlayerId(null);
  localStorage.clear();
  (
    UserSettings as unknown as { cache: Map<string, string | null> }
  ).cache.clear();
}

describe("flag validation against an unknown profile", () => {
  beforeEach(() => {
    invalidateCosmetics();
    resetSettings();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => catalog,
      })),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    invalidateCosmetics();
    resetSettings();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function selectFlag(): void {
    new UserSettings().setFlag("flag:donator");
  }

  // The defect: getUserMe() returns the same `false` for "signed out" and
  // "couldn't ask", so a profile call that failed — a refused connection, a
  // timed-out request — used to read as "not entitled" and erase the saved
  // flag from local storage. The catalog still has to load for this to be
  // reachable, which is why bounding the profile fetch surfaced it.
  it("keeps a saved flag when the profile cannot be resolved", async () => {
    selectFlag();
    vi.mocked(getUserMe).mockResolvedValue(false);

    await getPlayerCosmeticsRefs();

    expect(new UserSettings().getFlag()).toBe("flag:donator");
  });

  // The other half of the same decision: keeping the selection must not mean
  // claiming it. The server does not strip an unverifiable cosmetic ref — it
  // closes the socket with CosmeticsForbidden — so sending a flag we could
  // not verify would trade a lost flag for an unjoinable multiplayer.
  it("does not send a flag it could not verify", async () => {
    selectFlag();
    vi.mocked(getUserMe).mockResolvedValue(false);

    const refs = await getPlayerCosmeticsRefs();

    expect(refs.flag).toBeUndefined();
  });

  // The narrow case that actually loses data. A flag written before per-player
  // keying lives under the bare key and is only migrated to `flag:<publicId>`
  // by a successful profile resolve, so a session whose profile never resolves
  // is the one chance to erase it permanently.
  it("leaves the unmigrated bare key intact when the profile fails", async () => {
    localStorage.setItem(FLAG_KEY, "flag:donator");
    vi.mocked(getUserMe).mockResolvedValue(false);

    await getPlayerCosmeticsRefs();

    expect(localStorage.getItem(FLAG_KEY)).toBe("flag:donator");
  });

  // The other half: when the profile does answer, its answer is still
  // authoritative. Skipping validation on an unknown profile must not become
  // skipping validation altogether.
  it("still clears a flag the profile says the player does not own", async () => {
    selectFlag();
    vi.mocked(getUserMe).mockResolvedValue(userWithFlares([]));

    const refs = await getPlayerCosmeticsRefs();

    expect(refs.flag).toBeUndefined();
    expect(new UserSettings().getFlag()).toBeNull();
  });

  it("keeps a flag the profile says the player owns", async () => {
    selectFlag();
    vi.mocked(getUserMe).mockResolvedValue(userWithFlares(["flag:donator"]));

    const refs = await getPlayerCosmeticsRefs();

    expect(refs.flag).toBe("flag:donator");
  });

  it("honours the wildcard flare", async () => {
    selectFlag();
    vi.mocked(getUserMe).mockResolvedValue(userWithFlares(["flag:*"]));

    const refs = await getPlayerCosmeticsRefs();

    expect(refs.flag).toBe("flag:donator");
  });

  // Unchanged behaviour: a catalog that loaded and no longer lists the flag is
  // a definite answer, so the stale selection is still dropped.
  it("still clears a flag the loaded catalog no longer lists", async () => {
    new UserSettings().setFlag("flag:retired");
    vi.mocked(getUserMe).mockResolvedValue(userWithFlares(["flag:*"]));

    const refs = await getPlayerCosmeticsRefs();

    expect(refs.flag).toBeUndefined();
    expect(new UserSettings().getFlag()).toBeNull();
  });
});

describe("pattern, skin, crown, and effect validation against unknown and verified profiles (#5660)", () => {
  beforeEach(() => {
    invalidateCosmetics();
    resetSettings();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => catalog,
      })),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    invalidateCosmetics();
    resetSettings();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps saved pattern, crown, and effect when the profile cannot be resolved", async () => {
    const s = new UserSettings();
    s.setSelectedPatternName("pattern:stripes:fire");
    s.setSelectedCrownName("golden");
    s.setSelectedEffectName("transportShipTrail", "spectrum");
    vi.mocked(getUserMe).mockResolvedValue(false);

    const refs = await getPlayerCosmeticsRefs();

    expect(refs.patternName).toBeUndefined();
    expect(refs.patternColorPaletteName).toBeUndefined();
    expect(refs.crownName).toBeUndefined();
    expect(refs.effects).toBeUndefined();

    expect(s.getSelectedPatternName(catalog as any)?.name).toBe("stripes");
    expect(s.getSelectedCrownName()).toBe("golden");
    expect(s.getSelectedEffects()).toEqual({ transportShipTrail: "spectrum" });
  });

  it("keeps saved skin when the profile cannot be resolved", async () => {
    const s = new UserSettings();
    s.setSelectedPatternName("skin:cool");
    vi.mocked(getUserMe).mockResolvedValue(false);

    const refs = await getPlayerCosmeticsRefs();

    expect(refs.skinName).toBeUndefined();
    expect(s.getSelectedSkinName()).toBe("cool");
  });

  it("clears pattern, crown, and effect when the profile lacks required flares", async () => {
    const s = new UserSettings();
    s.setSelectedPatternName("pattern:stripes:fire");
    s.setSelectedCrownName("golden");
    s.setSelectedEffectName("transportShipTrail", "spectrum");
    vi.mocked(getUserMe).mockResolvedValue(userWithFlares([]));

    const refs = await getPlayerCosmeticsRefs();

    expect(refs.patternName).toBeUndefined();
    expect(refs.patternColorPaletteName).toBeUndefined();
    expect(refs.crownName).toBeUndefined();
    expect(refs.effects).toBeUndefined();

    expect(s.getSelectedPatternName(catalog as any)).toBeNull();
    expect(s.getSelectedCrownName()).toBeNull();
    expect(s.getSelectedEffects()).toEqual({});
  });

  it("clears skin when the profile lacks required skin flare", async () => {
    const s = new UserSettings();
    s.setSelectedPatternName("skin:cool");
    vi.mocked(getUserMe).mockResolvedValue(userWithFlares([]));

    const refs = await getPlayerCosmeticsRefs();

    expect(refs.skinName).toBeUndefined();
    expect(s.getSelectedSkinName()).toBeNull();
  });

  it("keeps and sends pattern, crown, and effect when the profile owns flares", async () => {
    const s = new UserSettings();
    s.setSelectedPatternName("pattern:stripes:fire");
    s.setSelectedCrownName("golden");
    s.setSelectedEffectName("transportShipTrail", "spectrum");
    vi.mocked(getUserMe).mockResolvedValue(
      userWithFlares([
        "pattern:stripes:fire",
        "crown:golden",
        "effect:spectrum",
      ]),
    );

    const refs = await getPlayerCosmeticsRefs();

    expect(refs.patternName).toBe("stripes");
    expect(refs.patternColorPaletteName).toBe("fire");
    expect(refs.crownName).toBe("golden");
    expect(refs.effects).toEqual({ transportShipTrail: "spectrum" });
  });

  it("keeps and sends skin when the profile owns skin flare", async () => {
    const s = new UserSettings();
    s.setSelectedPatternName("skin:cool");
    vi.mocked(getUserMe).mockResolvedValue(userWithFlares(["skin:cool"]));

    const refs = await getPlayerCosmeticsRefs();

    expect(refs.skinName).toBe("cool");
    expect(s.getSelectedSkinName()).toBe("cool");
  });

  it("honours wildcard flares for pattern, skin, crown, and effects", async () => {
    const s = new UserSettings();
    s.setSelectedPatternName("pattern:stripes:fire");
    s.setSelectedCrownName("golden");
    s.setSelectedEffectName("transportShipTrail", "spectrum");
    vi.mocked(getUserMe).mockResolvedValue(
      userWithFlares(["pattern:*", "crown:*", "effect:*"]),
    );

    const refs = await getPlayerCosmeticsRefs();

    expect(refs.patternName).toBe("stripes");
    expect(refs.patternColorPaletteName).toBe("fire");
    expect(refs.crownName).toBe("golden");
    expect(refs.effects).toEqual({ transportShipTrail: "spectrum" });

    // Skin wildcard
    s.setSelectedPatternName("skin:cool");
    vi.mocked(getUserMe).mockResolvedValue(userWithFlares(["skin:*"]));
    const skinRefs = await getPlayerCosmeticsRefs();
    expect(skinRefs.skinName).toBe("cool");
  });

  it("clears skin, crown, and effects when the loaded catalog no longer lists them", async () => {
    const s = new UserSettings();
    s.setSelectedCrownName("retired");
    s.setSelectedEffectName("transportShipTrail", "retired");
    vi.mocked(getUserMe).mockResolvedValue(
      userWithFlares(["crown:*", "effect:*"]),
    );

    const refs = await getPlayerCosmeticsRefs();

    expect(refs.crownName).toBeUndefined();
    expect(refs.effects).toBeUndefined();

    expect(s.getSelectedCrownName()).toBeNull();
    expect(s.getSelectedEffects()).toEqual({});

    // Retired skin
    s.setSelectedPatternName("skin:retired");
    vi.mocked(getUserMe).mockResolvedValue(userWithFlares(["skin:*"]));
    const skinRefs = await getPlayerCosmeticsRefs();
    expect(skinRefs.skinName).toBeUndefined();
    expect(s.getSelectedSkinName()).toBeNull();
  });
});
