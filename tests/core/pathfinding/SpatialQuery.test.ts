import { describe, expect, it } from "vitest";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
} from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { SpatialQuery } from "../../../src/core/pathfinding/spatial/SpatialQuery";
import { createGame, L, W } from "./_fixtures";

// Spawns player and **expands territory** via getSpawnTiles (euclidean dist 4)
// Ref: src/core/execution/Util.ts
function addPlayer(game: Game, tile: TileRef): Player {
  const info = new PlayerInfo("test", PlayerType.Human, null, "test_id");
  game.addPlayer(info);
  game.addExecution(new SpawnExecution("game_id", info, tile));
  while (game.inSpawnPhase()) game.executeNextTick();
  return game.player(info.id);
}

describe("SpatialQuery", () => {
  describe("closestShore", () => {
    it("finds shore tile owned by player", () => {
      // prettier-ignore
      const game = createGame({
        width: 5, height: 5, grid: [
          W, W, W, W, W,
          W, L, L, L, W,
          W, L, L, L, W,
          W, L, L, L, W,
          W, W, W, W, W,
        ],
      });

      const spatial = new SpatialQuery(game);
      const player = addPlayer(game, game.ref(2, 2));

      // All land tiles owned by player because of spawn expansion
      const result = spatial.closestShore(player, game.ref(2, 2));

      expect(result).not.toBeNull();
      expect(game.isShore(result!)).toBe(true);
      expect(game.ownerID(result!)).toBe(player.smallID());
    });

    it("returns null when no shore within maxDist", () => {
      // prettier-ignore
      const game = createGame({
        width: 7, height: 7, grid: [
          W, W, W, W, W, W, W,
          W, L, L, L, L, L, W,
          W, L, L, L, L, L, W,
          W, L, L, L, L, L, W,
          W, L, L, L, L, L, W,
          W, L, L, L, L, L, W,
          W, W, W, W, W, W, W,
        ],
      });

      const spatial = new SpatialQuery(game);
      const player = addPlayer(game, game.ref(3, 3));

      // maxDist=1 from center (3,3) - shore is 2 tiles away
      const result = spatial.closestShore(player, game.ref(3, 3), 1);

      expect(result).toBeNull();
    });

    it("finds shore on player's island (two separate islands)", () => {
      // prettier-ignore
      const game = createGame({
        width: 8, height: 4, grid: [
          L, L, W, W, W, W, L, L,
          L, L, W, W, W, W, L, L,
          L, L, W, W, W, W, L, L,
          L, L, W, W, W, W, L, L,
        ],
      });

      const spatial = new SpatialQuery(game);
      const player = addPlayer(game, game.ref(0, 0));

      const result = spatial.closestShore(player, game.ref(0, 2));

      expect(result).not.toBeNull();
      expect(game.isShore(result!)).toBe(true);
      expect(game.ownerID(result!)).toBe(player.smallID());
      expect(game.x(result!)).toBeLessThanOrEqual(2);
    });

    it("finds shore even if no land path exists (two separate islands)", () => {
      // prettier-ignore
      const game = createGame({
        width: 8, height: 4, grid: [
          L, L, W, W, W, W, L, L,
          L, L, W, W, W, W, L, L,
          L, L, W, W, W, W, L, L,
          L, L, W, W, W, W, L, L,
        ],
      });

      const spatial = new SpatialQuery(game);
      const player = addPlayer(game, game.ref(0, 0));

      const result = spatial.closestShore(player, game.ref(7, 2));

      expect(result).not.toBeNull();
      expect(game.isShore(result!)).toBe(true);
      expect(game.ownerID(result!)).toBe(player.smallID());
      expect(game.x(result!)).toBeLessThanOrEqual(2);
    });

    it("finds shore for terra nullius when land is unclaimed", () => {
      // prettier-ignore
      const game = createGame({
        width: 5, height: 5, grid: [
          W, W, W, W, W,
          W, L, L, L, W,
          W, L, L, L, W,
          W, L, L, L, W,
          W, W, W, W, W,
        ],
      });

      const spatial = new SpatialQuery(game);
      const terraNullius = game.terraNullius();

      const result = spatial.closestShore(terraNullius, game.ref(2, 2));

      expect(result).not.toBeNull();
      expect(game.isShore(result!)).toBe(true);
    });
  });

  describe("closestShoreByWater", () => {
    it("returns null for terra nullius", () => {
      // prettier-ignore
      const game = createGame({
        width: 5, height: 5, grid: [
          W, W, W, W, W,
          W, L, L, L, W,
          W, L, L, L, W,
          W, L, L, L, W,
          W, W, W, W, W,
        ],
      });

      const spatial = new SpatialQuery(game);
      const terraNullius = game.terraNullius();

      const result = spatial.closestShoreByWater(terraNullius, game.ref(0, 0));

      expect(result).toBeNull();
    });

    it("returns null when target is on land", () => {
      // prettier-ignore
      const game = createGame({
        width: 5, height: 5, grid: [
          W, W, W, W, W,
          W, L, L, L, W,
          W, L, L, L, W,
          W, L, L, L, W,
          W, W, W, W, W,
        ],
      });

      const spatial = new SpatialQuery(game);
      const player = addPlayer(game, game.ref(2, 2));

      const result = spatial.closestShoreByWater(player, game.ref(2, 2));

      expect(result).toBeNull();
    });

    it("returns null when target is in disconnected water body", () => {
      // prettier-ignore
      const game = createGame({
        width: 14, height: 6, grid: [
          W, W, L, L, L, L, L, L, L, L, L, L, W, W,
          W, W, L, L, L, L, L, L, L, L, L, L, W, W,
          W, W, L, L, L, L, L, L, L, L, L, L, W, W,
          W, W, L, L, L, L, L, L, L, L, L, L, W, W,
          W, W, L, L, L, L, L, L, L, L, L, L, W, W,
          W, W, L, L, L, L, L, L, L, L, L, L, W, W,
        ],
      });

      const spatial = new SpatialQuery(game);
      const player = addPlayer(game, game.ref(3, 2));
      const result = spatial.closestShoreByWater(player, game.ref(13, 2));

      expect(result).toBeNull();
    });

    it("finds shore via long water path around island", () => {
      // prettier-ignore
      const game = createGame({
        width: 18, height: 14, grid: [
          W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W,
          W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W,
          W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W,
          W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W,
          W, W, W, W, L, L, L, L, L, L, L, L, L, L, W, W, W, W,
          W, W, W, W, L, L, L, L, L, L, L, L, L, L, W, W, W, W,
          W, W, W, W, L, L, L, L, L, L, L, L, L, L, W, W, W, W,
          W, W, W, W, L, L, L, L, L, L, L, L, L, L, W, W, W, W,
          W, W, W, W, L, L, L, L, L, L, L, L, L, L, W, W, W, W,
          W, W, W, W, L, L, L, L, L, L, L, L, L, L, W, W, W, W,
          W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W,
          W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W,
          W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W,
          W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, L,
        ],
      });

      const spatial = new SpatialQuery(game);
      const player = addPlayer(game, game.ref(4, 4));

      const target = game.ref(17, 13);
      const result = spatial.closestShoreByWater(player, target);

      expect(result).not.toBeNull();
      expect(game.isShore(result!)).toBe(true);
      expect(game.ownerID(result!)).toBe(player.smallID());
    });
  });
});
