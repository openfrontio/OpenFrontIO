import { describe, expect, it } from "vitest";
import { MAX_TRAIL_COLORS } from "../src/client/render/gl/utils/ColorUtils";
import {
  EFFECT_ENTRY_FLOATS,
  packEffectEntry,
  parseEffectColors,
} from "../src/client/render/gl/utils/EffectPalette";

const row = (entry: Float32Array, r: number) =>
  Array.from(entry.subarray(r * 4, r * 4 + 4));

describe("EffectPalette", () => {
  it("parses catalog colors to 0..1 RGB, dropping bad ones and capping at the row count", () => {
    expect(parseEffectColors(["#ff0000", "nope", "#0000ff"])).toEqual([
      [1, 0, 0],
      [0, 0, 1],
    ]);
    const many = Array.from({ length: MAX_TRAIL_COLORS + 3 }, () => "#ffffff");
    expect(parseEffectColors(many)).toHaveLength(MAX_TRAIL_COLORS);
  });

  it("packs a gradient: colors per row, [count, 0, colorSize, movementSpeed] in alpha", () => {
    const entry = new Float32Array(EFFECT_ENTRY_FLOATS);
    packEffectEntry(
      {
        type: "gradient",
        colors: ["#ff0000", "#00ff00"],
        colorSize: 6,
        movementSpeed: 20,
      },
      entry,
    );
    expect(row(entry, 0)).toEqual([1, 0, 0, 2]);
    expect(row(entry, 1)).toEqual([0, 1, 0, 0]);
    expect(row(entry, 2)).toEqual([0, 0, 0, 6]);
    expect(row(entry, 3)).toEqual([0, 0, 0, 20]);
    for (let r = 4; r < MAX_TRAIL_COLORS; r++) {
      expect(row(entry, r)).toEqual([0, 0, 0, 0]);
    }
  });

  it("packs transition and spiral style ids with their scalar", () => {
    const entry = new Float32Array(EFFECT_ENTRY_FLOATS);
    packEffectEntry(
      { type: "transition", colors: ["#ffffff"], frequency: 5 },
      entry,
    );
    expect(row(entry, 0)).toEqual([1, 1, 1, 1]);
    expect(row(entry, 1)[3]).toBe(1);
    expect(row(entry, 2)[3]).toBe(5);
    expect(row(entry, 3)[3]).toBe(0);

    packEffectEntry(
      {
        type: "spiral",
        colors: ["#000000"],
        radius: 3,
        strands: 2,
        rotationSpeed: 7,
      },
      entry,
    );
    expect(row(entry, 1)[3]).toBe(2);
    expect(row(entry, 2)[3]).toBe(7);
  });

  it("overwrites every float, so a reused scratch entry carries nothing over", () => {
    const entry = new Float32Array(EFFECT_ENTRY_FLOATS).fill(9);
    packEffectEntry(
      { type: "transition", colors: ["#ffffff"], frequency: 1 },
      entry,
    );
    expect(entry.some((v) => v === 9)).toBe(false);
  });
});
