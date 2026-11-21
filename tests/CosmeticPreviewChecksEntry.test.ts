import { describe, expect, test } from "vitest";
import {
  CARD_ART_HEIGHT,
  CARD_ART_WIDTH,
  checkCardBackground,
  parseCardAnimation,
} from "../src/client/cosmetic-preview/checks";

// The package's DOM-free entry (@openfront/cosmetic-preview/checks): what a
// host's server uses to re-check a submission against the game's schema.
describe("cosmetic-preview checks entry", () => {
  test("parses a layer animation with the game's schema", () => {
    const parsed = parseCardAnimation({
      kind: "layers",
      layers: [{ src: "bg_x_fx-pulse.png", effect: "pulse", period: 2 }],
    });
    expect(parsed).toEqual({
      ok: true,
      animation: {
        kind: "layers",
        layers: [{ src: "bg_x_fx-pulse.png", effect: "pulse", period: 2 }],
      },
    });
  });

  test("refuses what the game would refuse, with the reason", () => {
    const parsed = parseCardAnimation({
      kind: "layers",
      layers: [{ src: "a.png", effect: "pulse", min: 0.9, max: 0.2 }],
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("min");
    expect(parseCardAnimation({ kind: "mask", mask: "m.png" }).ok).toBe(false);
    expect(parseCardAnimation({ kind: "layers", layers: [] }).ok).toBe(false);
  });

  describe("layer srcs must be relative catalogue paths", () => {
    const withSrc = (src: unknown) => ({
      kind: "layers",
      layers: [{ src, effect: "pulse" }],
    });

    test.each([
      "/cosmetics/card-backgrounds/bg_neon-grid_fx-pulse.png",
      "bg_x_fx-pulse.png",
      "cosmetics/bg_x.v2_fx-pulse.PNG",
    ])("accepts %s", (src) => {
      expect(parseCardAnimation(withSrc(src)).ok).toBe(true);
    });

    test.each([
      "data:image/svg+xml,<svg onload=alert(1)>",
      "https://cdn.example.com/bg_x_fx-pulse.png",
      "blob:https://dash.example/1234",
      "javascript:alert(1)//.png",
      "//evil.example/x.png",
      "/cosmetics/../../x.png",
      "cosmetics\\x.png",
      '/x".png',
      "/cosmetics/x.webp",
      "",
    ])("refuses %s", (src) => {
      const parsed = parseCardAnimation(withSrc(src));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).toContain("src");
    });

    test("checkCardBackground reports it as layer_src, per layer", () => {
      const W = CARD_ART_WIDTH;
      const H = CARD_ART_HEIGHT;
      const px = (a: number) => {
        const data = new Uint8ClampedArray(W * H * 4);
        for (let i = 3; i < data.length; i += 4) data[i] = a;
        return { width: W, height: H, data };
      };
      const issues = checkCardBackground(
        {
          base: { image: px(255), type: "image/webp", bytes: 1 },
          layers: [
            { effect: "pulse", image: px(0), bytes: 1 },
            { effect: "drift", image: px(0), bytes: 1 },
          ],
        },
        {
          kind: "layers",
          layers: [
            { src: "/cosmetics/card-backgrounds/ok.png", effect: "pulse" },
            { src: "data:image/svg+xml,<svg/>", effect: "drift" },
          ],
        },
      );
      expect(issues.filter((i) => i.code === "layer_src")).toEqual([
        {
          code: "layer_src",
          level: "error",
          layer: 1,
          params: { src: "data:image/svg+xml,<svg/>" },
        },
      ]);
    });
  });

  test("re-exports the checks and the art size", () => {
    expect([CARD_ART_WIDTH, CARD_ART_HEIGHT]).toEqual([2800, 400]);
    expect(typeof checkCardBackground).toBe("function");
  });

  test("never touches the DOM", async () => {
    // Runs in the node environment: importing it must not need a document.
    expect(typeof document).toBe("undefined");
  });
});
