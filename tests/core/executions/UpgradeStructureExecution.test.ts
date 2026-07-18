import { describe, expect, it } from "vitest";
import { UpgradeStructureExecution } from "../../../src/core/execution/UpgradeStructureExecution";
import { GameType, PlayerInfo, PlayerType, UnitType } from "../../../src/core/game/Game";
import type { TileRef } from "../../../src/core/game/GameMap";
import { setup } from "../../util/Setup";

describe("UpgradeStructureExecution", () => {
  it("upgrades a structure the specified amount of times", async () => {
    const game = await setup("ocean_and_land", { gameType: GameType.Singleplayer, instantBuild: true }, [], undefined, undefined, false);
    const playerInfo = new PlayerInfo("player1", PlayerType.Human, null, "player1_id");
    game.addPlayer(playerInfo);
    const player = game.player("player1_id")!;

    let landTile: TileRef | undefined = undefined;
    for (let y = 0; y < game.map().height(); y++) {
      for (let x = 0; x < game.map().width(); x++) {
        const t = game.ref(x, y);
        if (game.isLand(t)) {
          landTile = t;
          break;
        }
      }
      if (landTile !== undefined) break;
    }

    player.conquer(landTile!);
    const city = player.buildUnit(UnitType.City, landTile!, {});
    
    game.endSpawnPhase();
    
    player.addGold(10_000_000n);

    expect(city.level()).toBe(1);

    const execution = new UpgradeStructureExecution(player, city.id(), 5);
    game.addExecution(execution);
    game.executeNextTick();

    expect(city.level()).toBe(6);
  });

  it("stops upgrading early if player cannot afford remaining amounts", async () => {
    const game = await setup("ocean_and_land", { gameType: GameType.Singleplayer, instantBuild: true }, [], undefined, undefined, false);
    const playerInfo = new PlayerInfo("player1", PlayerType.Human, null, "player1_id");
    game.addPlayer(playerInfo);
    const player = game.player("player1_id")!;

    let landTile: TileRef | undefined = undefined;
    for (let y = 0; y < game.map().height(); y++) {
      for (let x = 0; x < game.map().width(); x++) {
        const t = game.ref(x, y);
        if (game.isLand(t)) {
          landTile = t;
          break;
        }
      }
      if (landTile !== undefined) break;
    }

    player.conquer(landTile!);
    const city = player.buildUnit(UnitType.City, landTile!, {});
    
    game.endSpawnPhase();
    
    player.addGold(750_000n);

    expect(city.level()).toBe(1);

    const execution = new UpgradeStructureExecution(player, city.id(), 5);
    game.addExecution(execution);
    game.executeNextTick();

    expect(city.level()).toBe(3);
  });
});
