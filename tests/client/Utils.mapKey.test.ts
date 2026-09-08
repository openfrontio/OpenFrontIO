import { describe, expect, it } from "vitest";
import { normaliseMapKey, presenceMapKey } from "../../src/client/Utils";
import { GameMapType, maps } from "../../src/core/game/Game";

describe("normaliseMapKey", () => {
  it("resolves tourney maps to their asset directory, not their display name", () => {
    expect(normaliseMapKey(GameMapType.Tourney1)).toBe("tourney1");
    expect(normaliseMapKey(GameMapType.Tourney2)).toBe("tourney2");
    expect(normaliseMapKey(GameMapType.Tourney3)).toBe("tourney3");
    expect(normaliseMapKey(GameMapType.Tourney4)).toBe("tourney4");
  });

  it("matches the lowercased map id for every known map", () => {
    for (const map of maps) {
      expect(normaliseMapKey(map.type)).toBe(map.id.toLowerCase());
    }
  });

  it("falls back to stripping spaces and dots for unknown map names", () => {
    expect(normaliseMapKey("Some. Unknown Map")).toBe("someunknownmap");
  });
});

describe("presenceMapKey", () => {
  // Desktop rich presence sends this as a token suffix: the Steam
  // localization file composes "#Map_<key>" and resolves it in the VIEWING
  // user's language. A display name would compose a token that does not
  // exist, and Steam hides the whole status line when a token fails to
  // resolve rather than dropping that one field.
  it("normalises a map name to its translation key", () => {
    expect(presenceMapKey(GameMapType.Europe)).toBe("europe");
    expect(presenceMapKey(GameMapType.Tourney1)).toBe("tourney1");
  });

  it("produces a key containing only characters Steam allows in a token", () => {
    for (const map of maps) {
      expect(presenceMapKey(map.type)).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it("leaves an absent map absent rather than inventing a key", () => {
    expect(presenceMapKey(undefined)).toBeUndefined();
  });
});
