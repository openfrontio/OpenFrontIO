import {
  computeAllianceClipPath,
  computeAllianceTopCutPercent,
} from "../src/client/graphics/PlayerIcons";
import {
  computeNameLayerLayout,
  computeTraitorFlashAlpha,
  computeTraitorFlashDurationSeconds,
  replaceUnsupportedNameGlyphs,
  resetNameLayerGlyphWarningsForTests,
} from "../src/client/graphics/layers/NameLayerLayout";

describe("PlayerIcons", () => {
  describe("computeAllianceClipPath", () => {
    test("returns full visibility (20% top cut) when alliance time is at 100%", () => {
      const result = computeAllianceClipPath(1.0);
      // topCut = 20 + (1 - 1.0) * 80 * 0.78 = 20 + 0 = 20.00
      expect(result).toBe("inset(20.00% -2px 0 -2px)");
    });

    test("returns maximum cut (82.40% top cut) when alliance time is at 0%", () => {
      const result = computeAllianceClipPath(0.0);
      // topCut = 20 + (1 - 0.0) * 80 * 0.78 = 20 + 62.4 = 82.40
      expect(result).toBe("inset(82.40% -2px 0 -2px)");
    });

    test("returns 51.20% top cut when alliance time is at 50%", () => {
      const result = computeAllianceClipPath(0.5);
      // topCut = 20 + (1 - 0.5) * 80 * 0.78 = 20 + 31.2 = 51.20
      expect(result).toBe("inset(51.20% -2px 0 -2px)");
    });

    test("returns 27.80% top cut when alliance time is at 87.5%", () => {
      const result = computeAllianceClipPath(0.875);
      // topCut = 20 + (1 - 0.875) * 80 * 0.78 = 20 + 7.8 = 27.80
      expect(result).toBe("inset(27.80% -2px 0 -2px)");
    });

    test("returns 74.60% top cut when alliance time is at 12.5%", () => {
      const result = computeAllianceClipPath(0.125);
      // topCut = 20 + (1 - 0.125) * 80 * 0.78 = 20 + 54.6 = 74.60
      expect(result).toBe("inset(74.60% -2px 0 -2px)");
    });

    test("includes -2px horizontal overscan to prevent subpixel gaps", () => {
      const result = computeAllianceClipPath(0.5);
      expect(result).toContain("-2px");
      expect(result.match(/-2px/g)).toHaveLength(2); // Should appear twice (left and right)
    });

    test("shares numeric top-cut helper with Pixi masks", () => {
      expect(computeAllianceTopCutPercent(1.0)).toBeCloseTo(20);
      expect(computeAllianceTopCutPercent(0.5)).toBeCloseTo(51.2);
      expect(computeAllianceTopCutPercent(0.0)).toBeCloseTo(82.4);
    });
  });
});

describe("NameLayerLayout", () => {
  test("computes DOM-compatible local row positions with flag and icon gaps", () => {
    const layout = computeNameLayerLayout({
      fontSize: 10,
      iconSize: 15,
      iconCount: 2,
      centeredIconCount: 1,
      hasFlag: true,
      flagAspectRatio: 2,
      nameWidth: 40,
      troopWidth: 30,
    });

    expect(layout.iconPositions).toEqual([
      { x: -9.5, y: -9.75 },
      { x: 9.5, y: -9.75 },
    ]);
    expect(layout.flag).toEqual({ x: -20, y: 2.75, width: 20, height: 10 });
    expect(layout.nameText).toEqual({ x: 10, y: 2.75 });
    expect(layout.troopText).toEqual({ x: 0, y: 12.25 });
    expect(layout.centeredIconPositions).toEqual([{ x: 0, y: 2.75 }]);
  });

  test("keeps no-flag names centered on the text width", () => {
    const layout = computeNameLayerLayout({
      fontSize: 12,
      iconSize: 18,
      iconCount: 0,
      centeredIconCount: 0,
      hasFlag: false,
      flagAspectRatio: 1,
      nameWidth: 60,
      troopWidth: 24,
    });

    expect(layout.flag).toBeNull();
    expect(layout.nameText.x).toBe(0);
    expect(layout.width).toBe(60);
  });

  test("matches traitor flash duration thresholds and alpha extrema", () => {
    expect(computeTraitorFlashDurationSeconds(156)).toBeNull();
    expect(computeTraitorFlashDurationSeconds(150)).toBeCloseTo(1);
    expect(computeTraitorFlashDurationSeconds(0)).toBeCloseTo(0.2);
    expect(computeTraitorFlashAlpha(150, 0)).toBeCloseTo(1);
    expect(computeTraitorFlashAlpha(150, 500)).toBeCloseTo(0.3);
  });

  test("replaces unsupported glyphs once per glyph", () => {
    resetNameLayerGlyphWarningsForTests();
    const warn = vi.fn();

    expect(replaceUnsupportedNameGlyphs("A🙂🙂B", warn)).toBe("A??B");
    expect(replaceUnsupportedNameGlyphs("🙂", warn)).toBe("?");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
