import {
  GameMapType,
  listedMaps,
  maps,
} from "@openfront/engine-api/game/GameTypes";
import { describe, expect, test } from "vitest";

describe("listedMaps", () => {
  test("leaves out the hidden tutorial map", () => {
    expect(maps.find((m) => m.type === GameMapType.Tutorial)?.hidden).toBe(
      true,
    );
    expect(listedMaps.some((m) => m.type === GameMapType.Tutorial)).toBe(false);
  });

  test("keeps every map that isn't hidden", () => {
    expect(listedMaps).toEqual(maps.filter((m) => m.hidden !== true));
    expect(listedMaps.length).toBe(maps.length - 1);
  });
});
