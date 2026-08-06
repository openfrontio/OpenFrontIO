import { afterEach, describe, expect, it, vi } from "vitest";
import { ResolvedCosmetic } from "../../src/client/Cosmetics";
import { CosmeticButton } from "../../src/client/components/CosmeticButton";

function patternVariant(name: string, palette: string): ResolvedCosmetic {
  return {
    type: "pattern",
    cosmetic: { name, pattern: "AAAAAA" } as never,
    colorPalette: {
      name: palette,
      primaryColor: "#ffffff",
      secondaryColor: "#000000",
    },
    relationship: "owned",
    key: `pattern:${name}:${palette}`,
  };
}

describe("CosmeticButton variants", () => {
  let button: CosmeticButton | undefined;

  afterEach(() => {
    button?.remove();
    button = undefined;
  });

  it("uses the resolved variant until a swatch is selected", () => {
    const red = patternVariant("stripes", "red");
    const blue = patternVariant("stripes", "blue");
    const onSelect = vi.fn();
    button = new CosmeticButton();
    button.resolved = blue;
    button.variants = [red, blue];
    button.onSelect = onSelect;

    (
      button as unknown as {
        handleClick(): void;
      }
    ).handleClick();

    expect(onSelect).toHaveBeenCalledWith(blue);
  });
});
