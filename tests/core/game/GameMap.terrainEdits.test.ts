import { GameMapImpl } from "@openfront/engine-lib/game/GameMapImpl";
import { describe, expect, it } from "vitest";

const LAND = 1 << 7;

describe("GameMap terrain edit log", () => {
  it("records each edited tile once, in first-edit order, with its original byte", () => {
    const terrain = new Uint8Array(16);
    terrain[3] = LAND | 5;
    terrain[9] = 7;
    const map = new GameMapImpl(4, 4, terrain, 1);

    expect(map.editedTerrainTiles()).toEqual(new Uint32Array(0));
    expect(map.isTerrainEdited(9)).toBe(false);

    map.setMagnitude(9, 12);
    map.setWater(3);
    map.setMagnitude(9, 20);
    map.setOcean(3);

    expect(map.editedTerrainTiles()).toEqual(Uint32Array.of(9, 3));
    expect(map.isTerrainEdited(9)).toBe(true);
    expect(map.isTerrainEdited(3)).toBe(true);
    expect(map.isTerrainEdited(4)).toBe(false);

    const snap = map.snapshot();
    expect(snap.editTiles).toEqual(Uint32Array.of(9, 3));
    expect(snap.editOriginal).toEqual(Uint8Array.of(7, LAND | 5));
    expect(snap.editCurrent).toEqual(
      Uint8Array.of(map.terrainByte(9), map.terrainByte(3)),
    );
  });

  it("restores a snapshot onto a fresh map and keeps the map-file hash", () => {
    const fresh = () => {
      const terrain = new Uint8Array(64 * 64);
      for (let i = 0; i < terrain.length; i += 3) terrain[i] = LAND | (i % 30);
      return new GameMapImpl(64, 64, terrain, Math.ceil(terrain.length / 3));
    };
    const map = fresh();
    const pristineHash = map.snapshot().pristineHash;
    // Enough edits to grow the log past its first allocation.
    for (let tile = 0; tile < 64 * 64; tile += 3) map.setWater(tile);
    for (let tile = 1; tile < 64 * 64; tile += 3) map.setMagnitude(tile, 9);
    const snap = map.snapshot();
    expect(snap.pristineHash).toBe(pristineHash);

    const restored = fresh();
    restored.restoreSnapshot(snap);
    for (let tile = 0; tile < 64 * 64; tile++) {
      expect(restored.terrainByte(tile)).toBe(map.terrainByte(tile));
    }
    expect(restored.snapshot()).toEqual(snap);
  });

  // A Map or Set holds at most 2^24 entries; the largest maps have more
  // tiles than that, and water nukes can edit most of them.
  it("logs more than 2^24 edited tiles", () => {
    const width = 4200;
    const height = 4200;
    const numTiles = width * height;
    expect(numTiles).toBeGreaterThan(2 ** 24);
    const map = new GameMapImpl(width, height, new Uint8Array(numTiles), 0);

    for (let tile = 0; tile < numTiles; tile++) map.setMagnitude(tile, 31);

    const edited = map.editedTerrainTiles();
    expect(edited.length).toBe(numTiles);
    expect(edited[0]).toBe(0);
    expect(edited[numTiles - 1]).toBe(numTiles - 1);
    expect(map.isTerrainEdited(numTiles - 1)).toBe(true);
    expect(map.snapshot().editTiles.length).toBe(numTiles);
  });
});
