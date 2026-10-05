import { colord } from "colord";
import { resolvePlayerColors } from "../../src/client/view/PlayerColors";
import type { PlayerCosmetics } from "../../src/core/Schemas";

const theme = {
  borderColor: () => colord("#111111"),
  focusedBorderColor: () => colord("#ffffff"),
};
const themed = colord("#336699");
const hex = (c: {
  territory: { toHex(): string };
  border: { toHex(): string };
}) => [c.territory.toHex(), c.border.toHex()];
const pattern = (colorPalette?: {
  name: string;
  primaryColor: string;
  secondaryColor: string;
}) =>
  ({
    name: "stripes",
    patternData: "x",
    ...(colorPalette ? { colorPalette } : {}),
  }) as PlayerCosmetics["pattern"];

describe("resolvePlayerColors", () => {
  test("the theme's colours by default, the focused border for the local player", () => {
    expect(hex(resolvePlayerColors(theme, themed, {}, null, false))).toEqual([
      "#336699",
      "#111111",
    ]);
    expect(hex(resolvePlayerColors(theme, themed, {}, null, true))).toEqual([
      "#336699",
      "#ffffff",
    ]);
  });

  test("a colour cosmetic colours territory and border, but not a team's territory", () => {
    const cosmetics = { color: { name: "red", color: "#ff0000" } };
    expect(
      hex(resolvePlayerColors(theme, themed, cosmetics, null, false)),
    ).toEqual(["#ff0000", "#ff0000"]);
    expect(
      hex(resolvePlayerColors(theme, themed, cosmetics, "Red", false)),
    ).toEqual(["#336699", "#ff0000"]);
  });

  test("a pattern's palette wins over the border colour", () => {
    const cosmetics = {
      color: { name: "red", color: "#ff0000" },
      pattern: pattern({
        name: "p",
        primaryColor: "#00ff00",
        secondaryColor: "#0000ff",
      }),
    };
    expect(
      hex(resolvePlayerColors(theme, themed, cosmetics, null, false)),
    ).toEqual(["#ff0000", "#0000ff"]);
  });

  test("a pattern without a palette uses the theme's, and the cosmetics aren't changed", () => {
    const cosmetics = {
      color: { name: "red", color: "#ff0000" },
      pattern: pattern(),
    };
    expect(
      hex(resolvePlayerColors(theme, themed, cosmetics, null, true)),
    ).toEqual(["#ff0000", "#111111"]);
    // A later theme change must be able to pick new colours.
    expect(cosmetics.pattern).not.toHaveProperty("colorPalette");
  });
});
