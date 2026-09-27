import { afterEach, describe, expect, it, vi } from "vitest";
import { GameMapType, GameMode } from "../../src/core/game/Game";
import { MapPlaylist } from "../../src/server/MapPlaylist";

const land = vi.hoisted(() => ({ tiles: 0 }));

vi.mock("../../src/server/MapLandTiles", () => ({
  getMapLandTiles: async () => land.tiles,
}));

type PlaylistInternals = {
  lobbyMaxPlayers(
    map: GameMapType,
    mode: GameMode,
    isCompactMap?: boolean,
  ): Promise<number>;
  getCrowdedMaxPlayers(
    map: GameMapType,
    isCompact: boolean,
  ): Promise<number | undefined>;
};

const playlist = () => new MapPlaylist() as unknown as PlaylistInternals;

describe("MapPlaylist lobby sizes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not cap large maps at 125 players", async () => {
    // The Box: 4,194,304 land tiles -> tiers 210/160/105.
    land.tiles = 4_194_304;
    const random = vi.spyOn(Math, "random");
    const sizes: number[] = [];
    for (const r of [0.1, 0.4, 0.9]) {
      random.mockReturnValue(r);
      sizes.push(
        await playlist().lobbyMaxPlayers(GameMapType.TheBox, GameMode.FFA),
      );
    }
    expect(sizes).toEqual([210, 160, 105]);

    random.mockReturnValue(0.9);
    expect(
      await playlist().lobbyMaxPlayers(GameMapType.TheBox, GameMode.Team),
    ).toBe(158);
  });

  it("keeps the crowded modifier at 125 / 60 players on small maps", async () => {
    land.tiles = 1_000_000;
    expect(
      await playlist().getCrowdedMaxPlayers(GameMapType.World, false),
    ).toBe(125);
    expect(await playlist().getCrowdedMaxPlayers(GameMapType.World, true)).toBe(
      60,
    );
  });
});
