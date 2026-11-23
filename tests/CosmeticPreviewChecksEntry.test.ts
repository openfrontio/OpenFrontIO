import { describe, expect, test } from "vitest";
import {
  CARD_ART_HEIGHT,
  CARD_ART_WIDTH,
  checkCardBackground,
  type LayerSrcOptions,
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
    // Every host the shape cases use, so they test the regex, not the list.
    const ANY_TEST_HOST = {
      allowedLayerHosts: [
        "https://pub-0123456789abcdef.r2.dev",
        "https://cdn.example.com",
        "https://cdn.ofedge.io",
        "https://localhost:8787",
      ],
    };

    test.each([
      "/cosmetics/card-backgrounds/bg_neon-grid_fx-pulse.png",
      "bg_x_fx-pulse.png",
      "cosmetics/bg_x.v2_fx-pulse.PNG",
    ])("accepts the relative %s, with or without hosts", (src) => {
      expect(parseCardAnimation(withSrc(src)).ok).toBe(true);
      expect(parseCardAnimation(withSrc(src), ANY_TEST_HOST).ok).toBe(true);
    });

    test.each([
      // What the infra Assets page hands out: the bucket's public URL.
      "https://pub-0123456789abcdef.r2.dev/cosmetics/card-backgrounds/bg_x_fx-pulse.png",
      // The shape infra's tests use for the same regex.
      "https://cdn.ofedge.io/cosmetics/card_background/neon_grid.png",
      "https://localhost:8787/cosmetics/bg_x_fx-pulse.png",
    ])("accepts %s from a listed host", (src) => {
      expect(parseCardAnimation(withSrc(src), ANY_TEST_HOST).ok).toBe(true);
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
      const parsed = parseCardAnimation(withSrc(src), ANY_TEST_HOST);
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
            { effect: "pulse", image: px(0), type: "image/png", bytes: 1 },
            { effect: "drift", image: px(0), type: "image/png", bytes: 1 },
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
        layers: [
          {
            effect: "pulse" as const,
            image: px(0),
            type: "image/png",
            bytes: 1,
          },
        ],
      };
      const BUCKET = "https://cdn.ofedge.io";
      const LISTED = { allowedLayerHosts: [BUCKET] };
      const ASSETS_LINK = `${BUCKET}/cosmetics/card_background/neon_grid.png`;
      const srcIssues = (src: string, options: LayerSrcOptions = LISTED) =>
        checkCardBackground(
          files,
          { kind: "layers", layers: [{ src, effect: "pulse" }] },
          options,
        ).filter((i) => i.code === "layer_src");
      const refused = (src: string) => [
        { code: "layer_src", level: "error", layer: 0, params: { src } },
      ];

      test("an Assets page link from the listed bucket passes", () => {
        expect(srcIssues(ASSETS_LINK)).toEqual([]);
      });

      test("with no hosts listed, the default, every https src is refused", () => {
        expect(srcIssues(ASSETS_LINK, {})).toEqual(refused(ASSETS_LINK));
        expect(
          checkCardBackground(files, {
            kind: "layers",
            layers: [{ src: ASSETS_LINK, effect: "pulse" }],
          }).filter((i) => i.code === "layer_src"),
        ).toEqual(refused(ASSETS_LINK));
        expect(parseCardAnimation(withSrc(ASSETS_LINK)).ok).toBe(false);
      });

      test("relative srcs don't depend on the host list", () => {
        const src = "/cosmetics/card-backgrounds/bg_x_fx-pulse.png";
        expect(srcIssues(src, {})).toEqual([]);
        expect(srcIssues(src)).toEqual([]);
      });

      test.each([
        // Not a listed origin.
        "https://evil.example/cosmetics/card_background/x.png",
        "https://cdn.ofedge.io.evil.example/cosmetics/x.png",
        "https://ofedge.io/cosmetics/x.png",
        "https://cdn.ofedge.io:8443/cosmetics/x.png",
        // Listed, but not under /cosmetics/.
        "https://cdn.ofedge.io/x.png",
        "https://cdn.ofedge.io/assets/cosmetics/x.png",
        "https://cdn.ofedge.io/cosmeticsx/x.png",
        "https://cdn.ofedge.io/Cosmetics/x.png",
      ])("%s is a layer_src error", (src) => {
        expect(srcIssues(src)).toEqual(refused(src));
      });

      test("a listed origin is matched without case, with or without https:// and a trailing /", () => {
        for (const host of [
          "https://CDN.ofedge.io",
          "cdn.ofedge.io",
          "https://cdn.ofedge.io/",
        ]) {
          expect(srcIssues(ASSETS_LINK, { allowedLayerHosts: [host] })).toEqual(
            [],
          );
        }
        expect(
          srcIssues("HTTPS://CDN.OFEDGE.IO/cosmetics/x.png", LISTED),
        ).toEqual([]);
      });

      test("an http:// origin in the list doesn't allow https links from it", () => {
        expect(
          srcIssues(ASSETS_LINK, {
            allowedLayerHosts: ["http://cdn.ofedge.io"],
          }),
        ).toEqual(refused(ASSETS_LINK));
      });

      test("a port must match as listed", () => {
        const src = "https://localhost:8787/cosmetics/x.png";
        const listed = { allowedLayerHosts: ["https://localhost:8787"] };
        expect(srcIssues(src, listed)).toEqual([]);
        expect(srcIssues("https://localhost/cosmetics/x.png", listed)).toEqual(
          refused("https://localhost/cosmetics/x.png"),
        );
      });

      test.each([
        "http://cdn.example.com/bg_x_fx-pulse.png",
        "https://cdn.example.com/bg_x_fx-pulse.png?q",
        "https://cdn.example.com/bg_x_fx-pulse.png#f",
        "javascript:alert(1)//.png",
        "data:image/png;base64,AAAA.png",
        "//cdn.example.com/x.png",
        "https://cdn.example.com/bg_x_fx-pulse.webp",
      ])("%s is a layer_src error, even from a listed host", (src) => {
        expect(srcIssues(src, ANY_TEST_HOST)).toEqual(refused(src));
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
