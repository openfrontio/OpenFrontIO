import { describe, expect, it } from "vitest";
import { normaliseMapKey } from "../../src/client/Utils";
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
