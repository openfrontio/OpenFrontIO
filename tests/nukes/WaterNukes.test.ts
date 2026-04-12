import { NukeExecution } from "../../src/core/execution/NukeExecution";
import { SpawnExecution } from "../../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { TileRef } from "../../src/core/game/GameMap";
import { GameID } from "../../src/core/Schemas";
import { setup } from "../util/Setup";
import { constructionExecution } from "../util/utils";

const gameID: GameID = "game_id";

function launchNukeAt(game: Game, player: Player, target: TileRef): void {
  game.addExecution(new NukeExecution(UnitType.AtomBomb, player, target, null));
  // init + build
  game.executeNextTick();
  game.executeNextTick();
}

function tickUntilNukeLands(game: Game, maxTicks = 50): void {
  for (let i = 0; i < maxTicks; i++) {
    game.executeNextTick();
  }
}

describe("Water Nukes", () => {
  let game: Game;
  let player: Player;

  describe("when waterNukes is enabled", () => {
    beforeEach(async () => {
      game = await setup("plains", {
        infiniteGold: true,
        instantBuild: true,
        waterNukes: true,
      });
      const info = new PlayerInfo("p", PlayerType.Human, null, "p");
      game.addPlayer(info);
      game.addExecution(new SpawnExecution(gameID, info, game.ref(1, 1)));
      while (game.inSpawnPhase()) game.executeNextTick();
      player = game.player(info.id);

      // Build a missile silo
      constructionExecution(game, player, 1, 1, UnitType.MissileSilo);
    });

    test("nuke converts land tiles to water instead of fallout", () => {
      const target = game.ref(10, 10);
      // Confirm target is land before nuke
      expect(game.isLand(target)).toBe(true);

      launchNukeAt(game, player, target);
      tickUntilNukeLands(game);

      // Target should now be water, not land
      expect(game.isLand(target)).toBe(false);
      expect(game.isWater(target)).toBe(true);
      // Should NOT have fallout
      expect(game.hasFallout(target)).toBe(false);
    });

    test("converted tiles get shoreline bits updated", () => {
      const target = game.ref(10, 10);
      launchNukeAt(game, player, target);
      tickUntilNukeLands(game);

      // With nukeMagnitudes { inner: 1, outer: 1 }, the target and its
      // cardinal neighbors (dist² <= 1) are all converted to water.
      // Shoreline tiles are the land tiles just outside the blast radius.
      const x = game.x(target);
      const y = game.y(target);

      // 2 tiles away should still be land and now be shoreline
      const outerNeighbors: TileRef[] = [];
      if (game.isValidCoord(x - 2, y)) outerNeighbors.push(game.ref(x - 2, y));
      if (game.isValidCoord(x + 2, y)) outerNeighbors.push(game.ref(x + 2, y));
      if (game.isValidCoord(x, y - 2)) outerNeighbors.push(game.ref(x, y - 2));
      if (game.isValidCoord(x, y + 2)) outerNeighbors.push(game.ref(x, y + 2));

      for (const n of outerNeighbors) {
        expect(game.isLand(n)).toBe(true);
        expect(game.isShoreline(n)).toBe(true);
      }
    });

    test("queueWaterConversion skips tiles conquered before flush", () => {
      // Pick an unowned land tile and queue it for water conversion directly
      const target = game.ref(10, 10);
      expect(game.isLand(target)).toBe(true);
      expect(game.hasOwner(target)).toBe(false);

      // Queue the tile for water conversion (simulates nuke queueing)
      game.queueWaterConversion(target);

      // Another actor conquers the tile before the tick flushes the queue
      player.conquer(target);
      expect(game.hasOwner(target)).toBe(true);

      // Flush: the pending conversion should be skipped because the tile is now owned
      game.executeNextTick();

      // Tile should remain land and owned
      expect(game.isLand(target)).toBe(true);
      expect(game.hasOwner(target)).toBe(true);
      expect(game.isWater(target)).toBe(false);
    });

    test("waterGraphVersion increments after water conversion", async () => {
      // Need a game with nav mesh enabled for graph rebuilds
      const navGame = await setup("plains", {
        infiniteGold: true,
        instantBuild: true,
        waterNukes: true,
        disableNavMesh: false,
      });
      const info2 = new PlayerInfo("p2", PlayerType.Human, null, "p2");
      navGame.addPlayer(info2);
      navGame.addExecution(
        new SpawnExecution(gameID, info2, navGame.ref(1, 1)),
      );
      while (navGame.inSpawnPhase()) navGame.executeNextTick();
      const player2 = navGame.player(info2.id);
      constructionExecution(navGame, player2, 1, 1, UnitType.MissileSilo);

      const versionBefore = navGame.waterGraphVersion();

      // Launch multiple nukes in a cluster to ensure enough tiles convert
      // for at least one minimap tile to flip (need >= 3 of 4 source tiles)
      const target = navGame.ref(50, 50);
      navGame.addExecution(
        new NukeExecution(UnitType.AtomBomb, player2, target, null),
      );
      // Tick enough for nuke to land + graph rebuild throttle (20 ticks)
      for (let i = 0; i < 80; i++) navGame.executeNextTick();

      expect(navGame.waterGraphVersion()).toBeGreaterThan(versionBefore);
    });
  });

  describe("when waterNukes is disabled (default)", () => {
    beforeEach(async () => {
      game = await setup("plains", {
        infiniteGold: true,
        instantBuild: true,
        waterNukes: false,
      });
      const info = new PlayerInfo("p", PlayerType.Human, null, "p");
      game.addPlayer(info);
      game.addExecution(new SpawnExecution(gameID, info, game.ref(1, 1)));
      while (game.inSpawnPhase()) game.executeNextTick();
      player = game.player(info.id);

      constructionExecution(game, player, 1, 1, UnitType.MissileSilo);
    });

    test("nuke applies fallout instead of converting to water", () => {
      const target = game.ref(10, 10);
      expect(game.isLand(target)).toBe(true);

      launchNukeAt(game, player, target);
      tickUntilNukeLands(game);

      // Should remain land with fallout
      expect(game.isLand(target)).toBe(true);
      expect(game.hasFallout(target)).toBe(true);
    });

    test("waterGraphVersion does not change", () => {
      const versionBefore = game.waterGraphVersion();
      const target = game.ref(10, 10);

      launchNukeAt(game, player, target);
      tickUntilNukeLands(game);

      expect(game.waterGraphVersion()).toBe(versionBefore);
    });
  });

  describe("updateTile terrain byte round-trip", () => {
    test("terrain byte is packed and unpacked correctly", async () => {
      game = await setup("plains", {
        infiniteGold: true,
        instantBuild: true,
        waterNukes: true,
      });
      const info = new PlayerInfo("p", PlayerType.Human, null, "p");
      game.addPlayer(info);
      game.addExecution(new SpawnExecution(gameID, info, game.ref(1, 1)));
      while (game.inSpawnPhase()) game.executeNextTick();
      player = game.player(info.id);
      constructionExecution(game, player, 1, 1, UnitType.MissileSilo);

      const target = game.ref(10, 10);
      const terrainBefore = game.terrainByte(target);
      expect(game.isLand(target)).toBe(true);

      launchNukeAt(game, player, target);
      tickUntilNukeLands(game);

      const terrainAfter = game.terrainByte(target);
      // Terrain should have changed (was land, now water)
      expect(terrainAfter).not.toBe(terrainBefore);
      expect(game.isWater(target)).toBe(true);
    });
  });
});
