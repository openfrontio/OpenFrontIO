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

  describe("layer srcs must be catalogue PNG paths or https links", () => {
    const withSrc = (src: unknown) => ({
      kind: "layers",
      layers: [{ src, effect: "pulse" }],
    });

    test.each([
      "/cosmetics/card-backgrounds/bg_neon-grid_fx-pulse.png",
      "bg_x_fx-pulse.png",
      "cosmetics/bg_x.v2_fx-pulse.PNG",
      // What the infra Assets page hands out: the bucket's public URL.
      "https://pub-0123456789abcdef.r2.dev/cosmetics/card-backgrounds/bg_x_fx-pulse.png",
      "https://cdn.example.com/bg_x_fx-pulse.png",
      // The shape infra's tests use for the same regex.
      "https://cdn.ofedge.io/cosmetics/card_background/neon_grid.png",
      "https://localhost:8787/assets/bg_x_fx-pulse.png",
    ])("accepts %s", (src) => {
      expect(parseCardAnimation(withSrc(src)).ok).toBe(true);
    });

    test.each([
      "data:image/svg+xml,<svg onload=alert(1)>",
      "http://cdn.example.com/bg_x_fx-pulse.png",
      "https://cdn.example.com/bg_x_fx-pulse.png?q=1",
      "https://cdn.example.com/bg_x_fx-pulse.png#f",
      "https://cdn.example.com/bg_x_fx-pulse.webp",
      "https://cdn.example.com/x.png?.png",
      "https://user@cdn.example.com/x.png",
      'https://cdn.example.com/x".png',
      "https://cdn.example.com/x'.png",
      "https://cdn.example.com/../x.png",
      "https://cdn.example.com/a b.png",
      "https://cdn.example.com/x).png",
      "https:///x.png",
      "https://cdn.example.com",
      `https://cdn.example.com/${"a".repeat(180)}.png`,
      "blob:https://dash.example/1234",
      "javascript:alert(1)//.png",
      "javascript://cdn.example.com/x.png",
      "data:image/png;base64,iVBORw0KGgo=.png",
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

    describe("checkCardBackground and the https rule", () => {
      const W = CARD_ART_WIDTH;
      const H = CARD_ART_HEIGHT;
      const px = (a: number) => {
        const data = new Uint8ClampedArray(W * H * 4);
        for (let i = 3; i < data.length; i += 4) data[i] = a;
        return { width: W, height: H, data };
      };
      const files = {
        base: { image: px(255), type: "image/webp", bytes: 1 },
        layers: [{ effect: "pulse" as const, image: px(0), bytes: 1 }],
      };
      const srcIssues = (src: string) =>
        checkCardBackground(files, {
          kind: "layers",
          layers: [{ src, effect: "pulse" }],
        }).filter((i) => i.code === "layer_src");

      test("an Assets page link passes", () => {
        expect(
          srcIssues(
            "https://pub-0123456789abcdef.r2.dev/cosmetics/card-backgrounds/bg_x_fx-pulse.png",
          ),
        ).toEqual([]);
      });

      test.each([
        "http://cdn.example.com/bg_x_fx-pulse.png",
        "https://cdn.example.com/bg_x_fx-pulse.png?q",
        "https://cdn.example.com/bg_x_fx-pulse.png#f",
        "javascript:alert(1)//.png",
        "data:image/png;base64,AAAA.png",
        "//cdn.example.com/x.png",
        "https://cdn.example.com/bg_x_fx-pulse.webp",
      ])("%s is a layer_src error", (src) => {
        expect(srcIssues(src)).toEqual([
          { code: "layer_src", level: "error", layer: 0, params: { src } },
        ]);
      });
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
