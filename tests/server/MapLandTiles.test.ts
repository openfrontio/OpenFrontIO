import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, it, vi } from "vitest";

const manifest = vi.hoisted(() => ({ json: "" }));

vi.mock("../../src/server/MapFiles", () => ({
  readMapFile: async () => Buffer.from(manifest.json),
}));

vi.mock("../../src/server/Logger", () => ({
  logger: { child: () => ({ error: vi.fn() }) },
}));

const { getMapLandTiles, readMapLandTiles } =
  await import("../../src/server/MapLandTiles");

describe("MapLandTiles", () => {
  it("rejects a manifest without a valid land tile count", async () => {
    for (const map of [
      {},
      { num_land_tiles: "1000" },
      { num_land_tiles: -1 },
    ]) {
      manifest.json = JSON.stringify({ map });
      await expect(readMapLandTiles(GameMapType.Oceania)).rejects.toThrow();
    }
  });

  it("falls back to 1M tiles only in getMapLandTiles", async () => {
    manifest.json = "{}";
    expect(await getMapLandTiles(GameMapType.Oceania)).toBe(1_000_000);
  });

  it("reads and caches a valid count", async () => {
    manifest.json = JSON.stringify({ map: { num_land_tiles: 4_194_304 } });
    expect(await readMapLandTiles(GameMapType.TheBox)).toBe(4_194_304);
    manifest.json = "{}";
    expect(await readMapLandTiles(GameMapType.TheBox)).toBe(4_194_304);
  });
});
