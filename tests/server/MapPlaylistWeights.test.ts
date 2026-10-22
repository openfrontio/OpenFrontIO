import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MAP_WEIGHT, MapPlaylist } from "../../src/server/MapPlaylist";

vi.mock("../../src/server/MapLandTiles", () => ({
  getMapLandTiles: async () => 1_000_000,
}));

type Internals = {
  playlists: Record<string, GameMapType[]>;
  buildMapsList(type: string, weights: object, rand: PseudoRandom): string[];
};

function internals(playlist: MapPlaylist): Internals {
  return playlist as unknown as Internals;
}

describe("MapPlaylist weights", () => {
  const p = internals(new MapPlaylist());
  const count = (type: string, weights: object, seed = 1) =>
    p
      .buildMapsList(type, weights, new PseudoRandom(seed))
      .filter((m) => m === GameMapType.World).length;

  it("schedules a map by its weight for the queue", () => {
    expect(count("ffa", { [GameMapType.World]: { ffaWeight: 37 } })).toBe(37);
    expect(count("ffa", { [GameMapType.World]: { ffaWeight: 0 } })).toBe(0);
    expect(
      count("special", { [GameMapType.World]: { specialWeight: 3 } }),
    ).toBe(3);
  });

  it("gives a map or queue with no weight the default", () => {
    expect(count("ffa", {})).toBe(DEFAULT_MAP_WEIGHT);
    // A weight for another queue leaves ffa on the default.
    expect(count("ffa", { [GameMapType.World]: { teamWeight: 37 } })).toBe(
      DEFAULT_MAP_WEIGHT,
    );
  });

  it("rounds a fractional weight at random, averaging the weight", () => {
    const weights = { [GameMapType.World]: { ffaWeight: 2.3 } };
    let total = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const n = count("ffa", weights, seed);
      expect([2, 3]).toContain(n);
      total += n;
    }
    expect(total / 2000).toBeCloseTo(2.3, 1);
  });

  it("never empties a queue with a positive weight in it", () => {
    const weights = Object.fromEntries(
      Object.values(GameMapType).map((m) => [m, { ffaWeight: 0 }]),
    );
    weights[GameMapType.World] = { ffaWeight: 0.1 };
    for (let seed = 1; seed <= 50; seed++) {
      expect(p.buildMapsList("ffa", weights, new PseudoRandom(seed))).toEqual([
        GameMapType.World,
      ]);
    }
  });

  it("drops queued playlists when the weights change", async () => {
    const playlist = new MapPlaylist();
    await playlist.gameConfig("ffa");
    const q = internals(playlist);
    expect(q.playlists.ffa.length).toBeGreaterThan(0);

    playlist.setWeights({});
    expect(q.playlists.ffa.length).toBeGreaterThan(0);

    playlist.setWeights({ [GameMapType.World]: { ffaWeight: 0 } });
    expect(q.playlists.ffa).toEqual([]);
  });

  it("stops serving a map pulled to 0", async () => {
    const playlist = new MapPlaylist();
    playlist.setWeights({ [GameMapType.World]: { ffaWeight: 0 } });
    const queued = internals(playlist).playlists;
    const config = await playlist.gameConfig("ffa");
    expect(config.gameMap).not.toBe(GameMapType.World);
    expect(queued.ffa).not.toContain(GameMapType.World);
  });

  it("ignores weights that would empty a queue", async () => {
    const playlist = new MapPlaylist();
    const allZero = Object.fromEntries(
      Object.values(GameMapType).map((m) => [m, { ffaWeight: 0 }]),
    );
    playlist.setWeights(allZero);
    const config = await playlist.gameConfig("ffa");
    expect(config.gameMap).toBeDefined();
  });
});
