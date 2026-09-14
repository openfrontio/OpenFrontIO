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
function addPlayer(game: Game, tile: TileRef, id: string = "test"): Player {
  const info = new PlayerInfo(id, PlayerType.Human, null, `${id}_id`);
  game.addPlayer(info);
  game.addExecution(new SpawnExecution("game_id", info, tile));
  game.executeNextTick();
  game.executeNextTick();
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

  describe("closestReachableShore", () => {
    // Target island (cols 10-24, rows 1-16) with an interior lake
    // (cols 15-20, rows 6-11) enclosed by a thick land moat, so the lake is a
    // separate water component from the ocean. Attacker island on the left.
    function buildLakeMap(): Game {
      const width = 26;
      const height = 18;
      const grid: string[] = new Array(width * height).fill(W);
      const set = (x: number, y: number, v: string) =>
        (grid[y * width + x] = v);
      const inBox = (
        x: number,
        y: number,
        x0: number,
        x1: number,
        y0: number,
        y1: number,
      ) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (inBox(x, y, 1, 5, 6, 11)) set(x, y, L); // attacker island
          if (inBox(x, y, 10, 24, 1, 16)) set(x, y, L); // target island
          if (inBox(x, y, 15, 20, 6, 11)) set(x, y, W); // carve lake
        }
      }
      return createGame({ width, height, grid });
    }

    it("skips a lake-facing shore for one the attacker can reach by water", () => {
      const game = buildLakeMap();
      const attacker = addPlayer(game, game.ref(3, 8), "attacker");
      const target = addPlayer(game, game.ref(12, 3), "target");
      const spatial = new SpatialQuery(game);

      // Clicking target land next to the lake: the nearest owned shore is
      // lake-facing (unreachable), so the reachability-blind closestShore picks
      // a shore the attacker's ocean boats can never reach.
      const clickNearLake = game.ref(14, 8);
      const oldPick = spatial.closestShore(
        game.owner(clickNearLake),
        clickNearLake,
      );
      expect(oldPick).not.toBeNull();
      expect(spatial.closestShoreByWater(attacker, oldPick!)).toBeNull();

      // The reachability-aware pick must return a shore the attacker can reach.
      const result = spatial.closestReachableShore(
        target,
        attacker,
        clickNearLake,
      );
      expect(result).not.toBeNull();
      expect(game.isShore(result!)).toBe(true);
      expect(game.ownerID(result!)).toBe(target.smallID());
      expect(spatial.closestShoreByWater(attacker, result!)).not.toBeNull();
    });

    it("returns null when every target shore is in an unreachable water body", () => {
      // Land wall (cols 2-11) fully separates left water (cols 0-1) from right
      // water (cols 12-13): two disconnected seas.
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
      const attacker = addPlayer(game, game.ref(3, 2), "attacker"); // left sea
      const target = addPlayer(game, game.ref(10, 3), "target"); // right sea
      const spatial = new SpatialQuery(game);

      const result = spatial.closestReachableShore(
        target,
        attacker,
        game.ref(10, 3),
      );
      expect(result).toBeNull();
    });
  });
});
