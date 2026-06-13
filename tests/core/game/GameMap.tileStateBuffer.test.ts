import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../../src/core/game/GameMap";

describe("GameMap.tileStateBuffer", () => {
  it("returns a Uint16Array sized to width * height", () => {
    const map = new GameMapImpl(10, 8, new Uint8Array(10 * 8), 0);
    const buf = map.tileStateBuffer();
    expect(buf).toBeInstanceOf(Uint16Array);
    expect(buf.length).toBe(80);
  });

  it("returns a live reference — updateTile() mutates the same buffer", () => {
    const map = new GameMapImpl(4, 4, new Uint8Array(16), 0);
    const buf = map.tileStateBuffer();
    // Writes go through updateTile (packed uint32: high 16 bits = terrain byte, low 16 = state).
    map.updateTile(5, 0x00abcd);
    expect(buf[5]).toBe(0xabcd);
  });

  it("returns the same array on every call (zero-copy)", () => {
    const map = new GameMapImpl(4, 4, new Uint8Array(16), 0);
    expect(map.tileStateBuffer()).toBe(map.tileStateBuffer());
  });

  it("reflects ownerID writes in the low 12 bits of each cell", () => {
    const map = new GameMapImpl(4, 4, new Uint8Array(16), 0);
    map.setOwnerID(7, 0x123);
    expect(map.tileStateBuffer()[7] & 0xfff).toBe(0x123);
  });
});
