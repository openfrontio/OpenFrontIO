import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, it, vi } from "vitest";
import { MapPlaylist } from "../../src/server/MapPlaylist";

vi.mock("../../src/server/MapLandTiles", () => ({
  getMapLandTiles: async () => 1_000_000,
}));

type Internals = {
  playlists: Record<string, GameMapType[]>;
  buildMapsList(type: string, mode: undefined, overrides: object): string[];
};

function internals(playlist: MapPlaylist): Internals {
  return playlist as unknown as Internals;
}

describe("MapPlaylist weight overrides", () => {
  it("spreads an override over the build frequency", () => {
    const p = internals(new MapPlaylist());
    const count = (overrides: object) =>
      p
        .buildMapsList("ffa", undefined, overrides)
        .filter((m) => m === GameMapType.World).length;

    expect(count({ [GameMapType.World]: { ffaFrequency: 37 } })).toBe(37);
    expect(count({ [GameMapType.World]: { ffaFrequency: 0 } })).toBe(0);
    // A field for another queue leaves ffa on the build's value.
    expect(count({ [GameMapType.World]: { teamFrequency: 37 } })).toBe(
      count({}),
    );
  });

  it("scales the frequency by the queue's multiplier, override or not", () => {
    const p = internals(new MapPlaylist());
    const count = (type: string, overrides: object) =>
      p
        .buildMapsList(type, undefined, overrides)
        .filter((m) => m === GameMapType.World).length;

    const W = GameMapType.World;
    expect(count("ffa", { [W]: { ffaFrequency: 10, ffaMultiplier: 2 } })).toBe(
      20,
    );
    expect(
      count("ffa", { [W]: { ffaFrequency: 10, ffaMultiplier: 0.5 } }),
    ).toBe(5);
    // On the build's own frequency.
    expect(count("ffa", { [W]: { ffaMultiplier: 2 } })).toBe(
      2 * count("ffa", {}),
    );
    // A manual 0 still takes the map out.
    expect(count("ffa", { [W]: { ffaFrequency: 0, ffaMultiplier: 2 } })).toBe(
      0,
    );
    // Another queue's multiplier leaves this one alone.
    expect(count("ffa", { [W]: { ffaFrequency: 10, teamMultiplier: 2 } })).toBe(
      10,
    );
    expect(
      count("special", { [W]: { specialFrequency: 10, specialMultiplier: 2 } }),
    ).toBe(20);
  });

  it("rounds a fractional count up with probability equal to the fraction", () => {
    const p = internals(new MapPlaylist());
    const count = () =>
      p
        .buildMapsList("ffa", undefined, {
          [GameMapType.World]: { ffaFrequency: 5, ffaMultiplier: 1.3 },
        })
        .filter((m) => m === GameMapType.World).length;

    const random = vi.spyOn(Math, "random");
    try {
      random.mockReturnValue(0.49);
      expect(count()).toBe(7);
      random.mockReturnValue(0.51);
      expect(count()).toBe(6);
    } finally {
      random.mockRestore();
    }
  });

  it("drops queued playlists when the overrides change", async () => {
    const playlist = new MapPlaylist();
    await playlist.gameConfig("ffa");
    const p = internals(playlist);
    expect(p.playlists.ffa.length).toBeGreaterThan(0);

    playlist.setWeightOverrides({});
    expect(p.playlists.ffa.length).toBeGreaterThan(0);

    playlist.setWeightOverrides({ [GameMapType.World]: { ffaFrequency: 0 } });
    expect(p.playlists.ffa).toEqual([]);
  });

  it("stops serving a map pulled to 0", async () => {
    const playlist = new MapPlaylist();
    playlist.setWeightOverrides({ [GameMapType.World]: { ffaFrequency: 0 } });
    const queued = internals(playlist).playlists;
    const config = await playlist.gameConfig("ffa");
    expect(config.gameMap).not.toBe(GameMapType.World);
    expect(queued.ffa).not.toContain(GameMapType.World);
  });

  it("ignores overrides that would empty a queue", async () => {
    const playlist = new MapPlaylist();
    const allZero = Object.fromEntries(
      Object.values(GameMapType).map((m) => [m, { ffaFrequency: 0 }]),
    );
    playlist.setWeightOverrides(allZero);
    const config = await playlist.gameConfig("ffa");
    expect(config.gameMap).toBeDefined();
  });
});
