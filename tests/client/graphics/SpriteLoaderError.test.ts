import { colord } from "colord";
import { describe, expect, it } from "vitest";
import { getColoredSprite } from "../../../src/client/hud/SpriteLoader";
import type { Theme } from "../../../src/client/theme/ThemeProvider";
import type { UnitView } from "../../../src/client/view";
import { UnitType } from "../../../src/core/game/Game";

function makeUnit(): UnitView {
  return {
    type: () => UnitType.Warship,
    trainType: () => undefined,
    isLoaded: () => false,
    owner: () => ({
      id: () => "player1",
      territoryColor: () => colord("#ff0000"),
      borderColor: () => colord("#00ff00"),
    }),
  } as unknown as UnitView;
}

const theme = {
  spawnHighlightColor: () => colord("#ffffff"),
} as unknown as Theme;

describe("getColoredSprite", () => {
  it("throws, naming the unit type, when its sprite was never loaded", () => {
    expect(() => getColoredSprite(makeUnit(), theme)).toThrow(
      `Failed to load sprite for ${UnitType.Warship}`,
    );
  });
});
