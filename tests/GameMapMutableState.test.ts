import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../src/core/game/GameMap";

describe("GameMapImpl mutable state", () => {
  it("exports and imports mutable state losslessly", () => {
    const w = 4;
    const h = 3;
    const terrain = new Uint8Array(w * h).fill(1 << 7); // mark as land

    const map1 = new GameMapImpl(w, h, terrain, w * h);
    const t0 = map1.ref(0, 0);
    const t1 = map1.ref(1, 0);
    const t2 = map1.ref(2, 0);

    map1.setOwnerID(t0, 123);
    map1.setFallout(t1, true);
    map1.setDefenseBonus(t2, true);

    const exported = map1.exportMutableState();

    const map2 = new GameMapImpl(w, h, terrain, w * h);
    map2.importMutableState(exported.state, exported.numTilesWithFallout);

    expect(map2.ownerID(t0)).toBe(123);
    expect(map2.hasFallout(t1)).toBe(true);
    expect(map2.hasDefenseBonus(t2)).toBe(true);
    expect(map2.numTilesWithFallout()).toBe(1);
  });

  it("resets mutable state", () => {
    const w = 2;
    const h = 2;
    const terrain = new Uint8Array(w * h).fill(1 << 7);
    const map = new GameMapImpl(w, h, terrain, w * h);

    map.setOwnerID(map.ref(0, 0), 1);
    map.setFallout(map.ref(1, 0), true);
    expect(map.numTilesWithFallout()).toBe(1);

    map.resetMutableState();
    expect(map.ownerID(map.ref(0, 0))).toBe(0);
    expect(map.hasFallout(map.ref(1, 0))).toBe(false);
    expect(map.numTilesWithFallout()).toBe(0);
  });
});
