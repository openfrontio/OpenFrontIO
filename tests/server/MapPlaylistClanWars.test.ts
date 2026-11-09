import {
  GameMapSize,
  GameMapType,
  GameMode,
  RankedType,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfigSchema } from "@openfront/engine-api/Schemas";
import { describe, expect, it } from "vitest";
import { MapPlaylist } from "../../src/server/MapPlaylist";

const SMALL_MAPS = [
  GameMapType.Australia,
  GameMapType.Iceland,
  GameMapType.Asia,
  GameMapType.EuropeClassic,
];
const LARGE_MAPS = [
  GameMapType.Europe,
  GameMapType.Asia,
  GameMapType.Africa,
  GameMapType.NorthAmerica,
  GameMapType.SouthAmerica,
  GameMapType.Australia,
];

describe("MapPlaylist clan wars config", () => {
  it("is a ranked team game sized to the assignment", () => {
    const config = new MapPlaylist().getClanWarsConfig(3, 9);

    expect(GameConfigSchema.safeParse(config).success).toBe(true);
    expect(config).toMatchObject({
      rankedType: RankedType.ClanWars,
      gameMode: GameMode.Team,
      playerTeams: 3,
      maxPlayers: 9,
      gameMapSize: GameMapSize.Normal,
      nations: "disabled",
    });
    // The clan tags are the point of the mode.
    expect(config.disableClanTags).toBeUndefined();
  });

  it("plays a small match on the ranked 2v2 maps and a large one on a continent", () => {
    const playlist = new MapPlaylist();
    for (let i = 0; i < 20; i++) {
      expect(SMALL_MAPS).toContain(playlist.getClanWarsConfig(2, 6).gameMap);
      expect(LARGE_MAPS).toContain(playlist.getClanWarsConfig(2, 8).gameMap);
    }
  });
});
