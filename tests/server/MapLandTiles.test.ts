import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, it, vi } from "vitest";

const manifest = vi.hoisted(() => ({ json: "" }));

vi.mock("../../src/server/MapFiles", () => ({
  readMapFile: async () => Buffer.from(manifest.json),
}));

vi.mock("../../src/server/Logger", () => ({
  logger: { child: () => ({ error: vi.fn() }) },
}));

const { getMapLandTiles } = await import("../../src/server/MapLandTiles");

describe("getMapLandTiles", () => {
  it("falls back to 1M tiles without a valid land tile count", async () => {
    for (const map of [
      {},
      { num_land_tiles: "1000" },
      { num_land_tiles: -1 },
    ]) {
      manifest.json = JSON.stringify({ map });
      expect(await getMapLandTiles(GameMapType.Oceania)).toBe(1_000_000);
    }
  });

  it("reads and caches a valid count", async () => {
    manifest.json = JSON.stringify({ map: { num_land_tiles: 4_194_304 } });
    expect(await getMapLandTiles(GameMapType.TheBox)).toBe(4_194_304);
    manifest.json = "{}";
    expect(await getMapLandTiles(GameMapType.TheBox)).toBe(4_194_304);
  });
});
