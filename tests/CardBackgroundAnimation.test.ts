import {
  CardBackgroundAnimationSchema,
  FX_DEFAULTS,
} from "@openfront/shared/CardBackgroundAnimation";
import {
  CardBackgroundSchema,
  CosmeticsSchema,
} from "@openfront/shared/CosmeticSchemas";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const FIXTURES = path.join(__dirname, "testdata", "card-backgrounds");

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function layers(...ls: Record<string, unknown>[]) {
  return { kind: "layers", layers: ls };
}

const ok = (v: unknown) => CardBackgroundAnimationSchema.safeParse(v).success;

describe("CardBackgroundAnimationSchema", () => {
  it.each(["neon-grid", "storm-front", "reactor-core"])(
    "parses the %s fixture with its animation intact",
    (name) => {
      const raw = fixture(name);
      const parsed = CardBackgroundSchema.parse(raw);
      expect(parsed.animation).toEqual(raw.animation);
      expect(ok(raw.animation)).toBe(true);
    },
  );

  it("allows 1 to 3 layers", () => {
    const l = { src: "/a.png", effect: "pulse" };
    expect(ok(layers())).toBe(false);
    expect(ok(layers(l))).toBe(true);
    expect(ok(layers(l, l, l))).toBe(true);
    expect(ok(layers(l, l, l, l))).toBe(false);
  });

  it("bounds the drift period to 15–180 s", () => {
    const drift = (period: number) =>
      ok(layers({ src: "/a.png", effect: "drift", period }));
    expect(drift(10)).toBe(false);
    expect(drift(15)).toBe(true);
    expect(drift(180)).toBe(true);
    expect(drift(181)).toBe(false);
  });

  it("bounds the pulse and shimmer period to 0.8–10 s", () => {
    for (const effect of ["pulse", "shimmer"]) {
      const p = (period: number) =>
        ok(layers({ src: "/a.png", effect, period }));
      expect(p(0.7)).toBe(false);
      expect(p(0.8)).toBe(true);
      expect(p(10)).toBe(true);
      expect(p(10.1)).toBe(false);
    }
  });

  it("bounds strength to 0–1", () => {
    const s = (strength: number) =>
      ok(layers({ src: "/a.png", effect: "pulse", strength }));
    expect(s(-0.1)).toBe(false);
    expect(s(0)).toBe(true);
    expect(s(1)).toBe(true);
    expect(s(1.1)).toBe(false);
  });

  it("requires min < max on a pulse", () => {
    const p = (min: number, max: number) =>
      ok(layers({ src: "/a.png", effect: "pulse", min, max }));
    expect(p(0.9, 0.5)).toBe(false);
    expect(p(0.5, 0.5)).toBe(false);
    expect(p(0.2, 0.6)).toBe(true);
    // With one side defaulted, the default takes part in the check.
    expect(
      ok(layers({ src: "/a.png", effect: "pulse", min: FX_DEFAULTS.max })),
    ).toBe(false);
  });

  it("bounds the angle to −90..90", () => {
    const a = (angle: number) =>
      ok(layers({ src: "/a.png", effect: "shimmer", angle }));
    expect(a(91)).toBe(false);
    expect(a(-91)).toBe(false);
    expect(a(90)).toBe(true);
    expect(a(-90)).toBe(true);
  });

  it("only takes low, medium or high as a flicker rate", () => {
    const r = (rate: string) =>
      ok(layers({ src: "/a.png", effect: "flicker", rate }));
    expect(r("fast")).toBe(false);
    expect(r("low")).toBe(true);
    expect(r("high")).toBe(true);
  });

  it("rejects an unknown effect", () => {
    expect(ok(layers({ src: "/a.png", effect: "spin" }))).toBe(false);
  });

  it("takes only #rrggbb colours on a mask", () => {
    const flow = (colour: string) =>
      ok({ kind: "mask", mask: "/m.png", flow: { colour } });
    expect(flow("cyan")).toBe(false);
    expect(flow("#5ff")).toBe(false);
    expect(flow("#5ff0ff")).toBe(true);
    expect(
      ok({
        kind: "mask",
        mask: "/m.png",
        pulse: { colourCycle: ["#ff0000", "red"] },
      }),
    ).toBe(false);
  });

  it("bounds the mask's periods and ripple centre", () => {
    expect(ok({ kind: "mask", mask: "/m.png", flow: { period: 0.7 } })).toBe(
      false,
    );
    expect(
      ok({ kind: "mask", mask: "/m.png", shimmer: { rippleCentre: [10, 20] } }),
    ).toBe(true);
    expect(
      ok({ kind: "mask", mask: "/m.png", shimmer: { rippleCentre: [10] } }),
    ).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(ok({ kind: "shader", layers: [] })).toBe(false);
  });

  it("has the spec's defaults", () => {
    expect(FX_DEFAULTS).toEqual({
      period: 2.5,
      driftPeriod: 60,
      strength: 1,
      min: 0.3,
      max: 1,
      angle: 20,
      rate: "medium",
      flowColour: "#5ff0ff",
    });
  });
});

describe("a catalogue with a bad animation", () => {
  const catalogue = (badAnimation: unknown) => ({
    patterns: {},
    flags: {},
    cardBackgrounds: {
      bg_bad: {
        name: "bg_bad",
        product: null,
        rarity: "rare",
        url: "/cosmetics/bg_bad.webp",
        artist: "Someone",
        animation: badAnimation,
      },
      bg_neon_grid: fixture("neon-grid"),
      bg_still: {
        name: "bg_still",
        product: null,
        rarity: "common",
        url: "/cosmetics/bg_still.webp",
      },
    },
  });

  it.each([
    ["no layers", { kind: "layers", layers: [] }],
    ["a string", "sparkly"],
    ["a bad period", layers({ src: "/a.png", effect: "drift", period: 1 })],
    ["an unknown kind", { kind: "video" }],
  ])("still parses with %s, and that background is still", (_, bad) => {
    const parsed = CosmeticsSchema.parse(catalogue(bad));
    const bgs = parsed.cardBackgrounds!;
    expect(Object.keys(bgs).sort()).toEqual([
      "bg_bad",
      "bg_neon_grid",
      "bg_still",
    ]);
    expect(bgs.bg_bad.animation).toBeUndefined();
    expect(bgs.bg_bad).toMatchObject({
      name: "bg_bad",
      rarity: "rare",
      url: "/cosmetics/bg_bad.webp",
      artist: "Someone",
    });
    expect(bgs.bg_neon_grid.animation).toEqual(fixture("neon-grid").animation);
    expect(bgs.bg_still.animation).toBeUndefined();
  });
});
