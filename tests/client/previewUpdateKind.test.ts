import type { CosmeticPreviewConfig } from "../../src/client/render/preview/CosmeticPreviewRenderer";
import { previewUpdateKind } from "../../src/client/render/preview/previewUpdateKind";

const trail = (
  colors: string[],
  extra: Record<string, unknown> = {},
): CosmeticPreviewConfig =>
  ({
    mode: "NUKE_MISSILE_TRAIL",
    effectAttributes: {
      type: "gradient",
      colors,
      colorSize: 3,
      movementSpeed: 2,
      ...extra,
    },
  }) as CosmeticPreviewConfig;

const blast = (maxRadius: number): CosmeticPreviewConfig =>
  ({
    mode: "NUKE_EXPLOSION",
    cosmeticUnitType: "Atom Bomb",
    explosionParams: {
      type: "shockwave",
      colors: [[1, 0, 0]],
      maxRadius,
      speed: 1,
      thickness: 4,
      transitionSpeed: 1,
    },
  }) as CosmeticPreviewConfig;

describe("previewUpdateKind", () => {
  it("reframes the first cosmetic, and any change of scene", () => {
    expect(previewUpdateKind(null, trail(["#fff"]))).toBe("reframe");
    expect(previewUpdateKind(trail(["#fff"]), blast(30))).toBe("reframe");
    expect(
      previewUpdateKind(blast(30), {
        ...blast(30),
        cosmeticUnitType: "Hydrogen Bomb",
      }),
    ).toBe("reframe");
    const building = {
      mode: "BUILDING",
      structureLevel: 2,
    } as CosmeticPreviewConfig;
    expect(
      previewUpdateKind(building, { ...building, structureLevel: 3 }),
    ).toBe("reframe");
  });

  it("updates a trail's colours and timings in place", () => {
    expect(previewUpdateKind(trail(["#fff"]), trail(["#f00", "#0f0"]))).toBe(
      "inPlace",
    );
    expect(
      previewUpdateKind(trail(["#fff"]), trail(["#fff"], { movementSpeed: 9 })),
    ).toBe("inPlace");
  });

  it("replays an explosion whose shape changed, and a salvo toggle", () => {
    expect(previewUpdateKind(blast(30), blast(60))).toBe("replay");
    expect(
      previewUpdateKind(blast(30), { ...blast(30), salvoMode: true }),
    ).toBe("replay");
  });

  it("keeps an unchanged explosion playing", () => {
    expect(previewUpdateKind(blast(30), blast(30))).toBe("inPlace");
  });

  it("updates a pattern or skin in place, keeping the camera", () => {
    const pattern = {
      mode: "SKIN",
      patternData: "AAA",
      effectColors: ["#fff", "#000"],
    } as CosmeticPreviewConfig;
    expect(
      previewUpdateKind(pattern, {
        ...pattern,
        effectColors: ["#f00", "#0f0"],
      }),
    ).toBe("inPlace");
  });
});
