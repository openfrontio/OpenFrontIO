import { CardBackgroundAnimationSchema } from "@openfront/shared/CardBackgroundAnimation";
import {
  type CardBackgroundFiles,
  type CardCheckImage,
  type CardIssue,
  CARD_ART_HEIGHT,
  CARD_ART_WIDTH,
  checkCardBackground,
  MAX_SET_BYTES,
} from "@openfront/shared/CardBackgroundChecks";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";

// Every rule here is a row of the checks table in the card background
// previewer plan (and the artist guide it comes from).

const W = CARD_ART_WIDTH;
const H = CARD_ART_HEIGHT;

type Rgba = [number, number, number, number];

// An image filled with `fill`, then `paint` run over every pixel.
function image(
  width = W,
  height = H,
  paint: (x: number, y: number) => Rgba = () => [0, 0, 0, 0],
): CardCheckImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = paint(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

const OPAQUE_BASE = image(W, H, () => [20, 30, 60, 255]);

// A small dim blob on the right of the card: transparent everywhere else,
// well under a third of the area, nowhere near the name.
const SMALL_RIGHT_LAYER = image(W, H, (x, y) =>
  x > 2000 && x < 2400 && y > 100 && y < 300
    ? [80, 80, 160, 255]
    : [0, 0, 0, 0],
);

function files(
  overrides: Partial<CardBackgroundFiles> = {},
): CardBackgroundFiles {
  return {
    base: { image: OPAQUE_BASE, type: "image/webp", bytes: 200_000 },
    layers: [],
    ...overrides,
  };
}

function layer(
  effect: "pulse" | "shimmer" | "flicker" | "drift",
  img: CardCheckImage = SMALL_RIGHT_LAYER,
  bytes = 50_000,
) {
  return { effect, image: img, bytes };
}

function anim(...layers: Record<string, unknown>[]) {
  return { kind: "layers", layers };
}

const codes = (issues: CardIssue[]) => issues.map((i) => i.code);

describe("checkCardBackground", () => {
  test("a clean set has no issues", () => {
    expect(
      checkCardBackground(
        files({ layers: [layer("pulse")] }),
        anim({ src: "a.png", effect: "pulse" }),
      ),
    ).toEqual([]);
  });

  test("a still background with no animation has no issues", () => {
    expect(checkCardBackground(files(), undefined)).toEqual([]);
  });

  describe("base image is 2800 × 400, WebP or JPG (error)", () => {
    test("wrong size", () => {
      const issues = checkCardBackground(
        files({
          base: { image: image(1400, 200), type: "image/webp", bytes: 1 },
        }),
        undefined,
      );
      expect(issues).toContainEqual({
        code: "base_size",
        level: "error",
        params: { width: 1400, height: 200 },
      });
    });

    test("JPG passes, PNG and GIF don't", () => {
      expect(
        codes(
          checkCardBackground(
            files({
              base: { image: OPAQUE_BASE, type: "image/jpeg", bytes: 1 },
            }),
            undefined,
          ),
        ),
      ).toEqual([]);
      for (const type of ["image/png", "image/gif", ""]) {
        const issues = checkCardBackground(
          files({ base: { image: OPAQUE_BASE, type, bytes: 1 } }),
          undefined,
        );
        expect(issues).toContainEqual({
          code: "base_format",
          level: "error",
          params: { type },
        });
      }
    });
  });

  test("every layer is 2800 × 400 (error)", () => {
    const issues = checkCardBackground(
      files({
        layers: [
          layer("pulse"),
          layer(
            "drift",
            image(2000, 400, () => [255, 255, 255, 0]),
          ),
        ],
      }),
      anim({ src: "a", effect: "pulse" }, { src: "b", effect: "drift" }),
    );
    expect(issues).toContainEqual({
      code: "layer_size",
      level: "error",
      layer: 1,
      params: { width: 2000, height: 400 },
    });
    expect(issues.filter((i) => i.code === "layer_size")).toHaveLength(1);
  });

  describe("at most 3 layers; the settings pass the game's schema (error)", () => {
    test("four layers", () => {
      const four = [1, 2, 3, 4].map(() => layer("pulse"));
      const issues = checkCardBackground(
        files({ layers: four }),
        anim(...four.map((_, i) => ({ src: `${i}`, effect: "pulse" }))),
      );
      expect(issues).toContainEqual({
        code: "too_many_layers",
        level: "error",
        params: { count: 4, max: 3 },
      });
    });

    test("a setting out of range", () => {
      const issues = checkCardBackground(
        files({ layers: [layer("pulse")] }),
        anim({ src: "a", effect: "pulse", period: 30 }),
      );
      const invalid = issues.find((i) => i.code === "animation_invalid");
      expect(invalid?.level).toBe("error");
      expect(String(invalid?.params?.details)).toContain("period");
    });

    test("pulse min not below max", () => {
      const issues = checkCardBackground(
        files({ layers: [layer("pulse")] }),
        anim({ src: "a", effect: "pulse", min: 0.8, max: 0.5 }),
      );
      const invalid = issues.find((i) => i.code === "animation_invalid");
      expect(String(invalid?.params?.details)).toContain("min");
    });

    test("a mask animation isn't a layer set", () => {
      const issues = checkCardBackground(files(), {
        kind: "mask",
        mask: "m.png",
      });
      expect(codes(issues)).toContain("animation_not_layers");
    });

    test("the settings and the files disagree on the layers", () => {
      const issues = checkCardBackground(
        files({ layers: [layer("pulse"), layer("drift")] }),
        anim({ src: "a", effect: "pulse" }, { src: "b", effect: "shimmer" }),
      );
      expect(issues).toContainEqual({
        code: "layer_effect_mismatch",
        level: "error",
        layer: 1,
        params: { file: "drift", settings: "shimmer" },
      });
      const fewer = checkCardBackground(
        files({ layers: [layer("pulse"), layer("drift")] }),
        anim({ src: "a", effect: "pulse" }),
      );
      expect(fewer).toContainEqual({
        code: "layer_count_mismatch",
        level: "error",
        params: { files: 2, settings: 1 },
      });
    });
  });

  test("each layer has transparency (error)", () => {
    const solid = image(W, H, () => [10, 10, 10, 255]);
    const issues = checkCardBackground(
      files({ layers: [layer("pulse"), layer("flicker", solid)] }),
      anim({ src: "a", effect: "pulse" }, { src: "b", effect: "flicker" }),
    );
    expect(issues).toContainEqual({
      code: "layer_opaque",
      level: "error",
      layer: 1,
    });
  });

  test("whole set under about 600 KB (warning)", () => {
    const issues = checkCardBackground(
      files({
        base: { image: OPAQUE_BASE, type: "image/webp", bytes: 500_000 },
        layers: [layer("pulse", SMALL_RIGHT_LAYER, 200_000)],
      }),
      anim({ src: "a", effect: "pulse" }),
    );
    expect(issues).toContainEqual({
      code: "set_too_large",
      level: "warning",
      params: { bytes: 700_000, max: MAX_SET_BYTES },
    });
    const under = checkCardBackground(
      files({
        base: { image: OPAQUE_BASE, type: "image/webp", bytes: 400_000 },
        layers: [layer("pulse", SMALL_RIGHT_LAYER, 100_000)],
      }),
      anim({ src: "a", effect: "pulse" }),
    );
    expect(codes(under)).not.toContain("set_too_large");
  });

  test("animated area is about a third of the image or less (warning)", () => {
    // Right half covered: half the card animates.
    const half = image(W, H, (x) =>
      x >= W / 2 ? [60, 60, 60, 255] : [0, 0, 0, 0],
    );
    const issues = checkCardBackground(
      files({ layers: [layer("pulse", half)] }),
      anim({ src: "a", effect: "pulse" }),
    );
    const area = issues.find((i) => i.code === "animated_area");
    expect(area?.level).toBe("warning");
    expect(area?.params?.percent).toBe(50);

    // Two layers each covering a different sixth: the union is a third.
    const sixth = (from: number) =>
      image(W, H, (x) =>
        x >= from && x < from + W / 6 ? [60, 60, 60, 255] : [0, 0, 0, 0],
      );
    const third = checkCardBackground(
      files({
        layers: [
          layer("pulse", sixth(W / 2)),
          layer("pulse", sixth((5 * W) / 6)),
        ],
      }),
      anim({ src: "a", effect: "pulse" }, { src: "b", effect: "pulse" }),
    );
    expect(codes(third)).not.toContain("animated_area");
  });

  describe("something bright or fast in the left ~45%, under the name (warning)", () => {
    const leftBright = image(W, H, (x, y) =>
      x < 600 && y > 100 && y < 300 ? [255, 255, 255, 255] : [0, 0, 0, 0],
    );
    const leftDim = image(W, H, (x, y) =>
      x < 600 && y > 100 && y < 300 ? [40, 40, 60, 255] : [0, 0, 0, 0],
    );

    test("bright pixels under the name", () => {
      const issues = checkCardBackground(
        files({ layers: [layer("pulse", leftBright)] }),
        anim({ src: "a", effect: "pulse" }),
      );
      expect(issues).toContainEqual({
        code: "busy_under_name",
        level: "warning",
        layer: 0,
        params: { reason: "bright" },
      });
    });

    test("a flicker under the name, even a dim one", () => {
      const issues = checkCardBackground(
        files({ layers: [layer("flicker", leftDim)] }),
        anim({ src: "a", effect: "flicker" }),
      );
      expect(issues).toContainEqual({
        code: "busy_under_name",
        level: "warning",
        layer: 0,
        params: { reason: "fast" },
      });
    });

    test("a fast pulse under the name", () => {
      const fast = checkCardBackground(
        files({ layers: [layer("pulse", leftDim)] }),
        anim({ src: "a", effect: "pulse", period: 1 }),
      );
      expect(codes(fast)).toContain("busy_under_name");
      const slow = checkCardBackground(
        files({ layers: [layer("pulse", leftDim)] }),
        anim({ src: "a", effect: "pulse", period: 4 }),
      );
      expect(codes(slow)).not.toContain("busy_under_name");
    });

    test("a bright drift anywhere passes under the name", () => {
      const brightRight = image(W, H, (x, y) =>
        x > 2200 && x < 2600 && y > 100 && y < 300
          ? [255, 255, 255, 255]
          : [0, 0, 0, 0],
      );
      const drift = checkCardBackground(
        files({ layers: [layer("drift", brightRight)] }),
        anim({ src: "a", effect: "drift" }),
      );
      expect(codes(drift)).toContain("busy_under_name");
      const pulse = checkCardBackground(
        files({ layers: [layer("pulse", brightRight)] }),
        anim({ src: "a", effect: "pulse" }),
      );
      expect(codes(pulse)).not.toContain("busy_under_name");
    });
  });

  test("a drift layer's left and right edges join up (warning)", () => {
    // Bright on the left edge, empty on the right: it jumps each loop.
    const seam = image(W, H, (x) =>
      x < 50 ? [90, 90, 90, 255] : [0, 0, 0, 0],
    );
    const issues = checkCardBackground(
      files({ layers: [layer("drift", seam)] }),
      anim({ src: "a", effect: "drift" }),
    );
    expect(issues).toContainEqual({
      code: "drift_seam",
      level: "warning",
      layer: 0,
    });

    // A horizontal stripe: the same on both edges.
    const tiles = image(W, H, (_, y) =>
      y > 180 && y < 220 ? [90, 90, 90, 255] : [0, 0, 0, 0],
    );
    const ok = checkCardBackground(
      files({ layers: [layer("drift", tiles)] }),
      anim({ src: "a", effect: "drift" }),
    );
    expect(codes(ok)).not.toContain("drift_seam");

    // Pulse layers aren't tiled, so their edges don't matter.
    const pulse = checkCardBackground(
      files({ layers: [layer("pulse", seam)] }),
      anim({ src: "a", effect: "pulse" }),
    );
    expect(codes(pulse)).not.toContain("drift_seam");
  });

  test("errors come before warnings", () => {
    const issues = checkCardBackground(
      files({
        base: { image: image(10, 10), type: "image/png", bytes: 900_000 },
      }),
      undefined,
    );
    const levels = issues.map((i) => i.level);
    expect(levels).toEqual(
      [...levels].sort((a, b) => (a === b ? 0 : a === "error" ? -1 : 1)),
    );
    expect(levels).toContain("warning");
  });
});

// The shared fixtures pin the schema: the API keeps its own copy, and should
// run the same files (see the previewer plan's risks).
describe("card background fixtures", () => {
  const dir = path.join(__dirname, "testdata", "card-backgrounds");
  const fixtures = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      file: f,
      bg: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as {
        animation: { kind: string; layers?: { effect: string }[] };
      },
    }));

  test("there are fixtures", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  test.each(fixtures)("$file passes the game's schema", ({ bg }) => {
    expect(CardBackgroundAnimationSchema.safeParse(bg.animation).success).toBe(
      true,
    );
  });

  test.each(fixtures.filter((f) => f.bg.animation.kind === "layers"))(
    "$file's settings pass checkCardBackground with matching files",
    ({ bg }) => {
      const layers = (bg.animation.layers ?? []).map((l) =>
        layer(l.effect as "pulse"),
      );
      const issues = checkCardBackground(files({ layers }), bg.animation);
      expect(issues.filter((i) => i.level === "error")).toEqual([]);
    },
  );
});
