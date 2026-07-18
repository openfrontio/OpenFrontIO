import { describe, expect, it } from "vitest";
import { UpgradeStructureExecution } from "../../../src/core/execution/UpgradeStructureExecution";
import { GameImpl } from "../../../src/core/game/GameImpl";
import { UnitType } from "../../../src/core/game/Game";
import { TestConfig } from "../../util/TestConfig";

describe("UpgradeStructureExecution", () => {
  it("upgrades a structure the specified amount of times", () => {
    const game = new GameImpl(new TestConfig());
    const player = game.addPlayer({
      id: "player1",
      smallID: 1,
      colorIndex: 0,
    });

    const tile = game.ref(10, 10);
    player.addGold(10_000_000n);
    game.addUnit(UnitType.City, tile, player);
    const city = game.unit(tile)!;

    for (let i = 0; i < 25; i++) {
      game.executeNextTick();
    }

    expect(city.level()).toBe(1);

    const execution = new UpgradeStructureExecution(player, city.id(), 5);
    game.addExecution(execution);
    game.executeNextTick();

    expect(city.level()).toBe(6);
  });

  it("stops upgrading early if player cannot afford remaining amounts", () => {
    const game = new GameImpl(new TestConfig());
    const player = game.addPlayer({
      id: "player1",
      smallID: 1,
      colorIndex: 0,
    });

    const tile = game.ref(10, 10);
    player.addGold(125_000n + 250_000n + 250_000n);
    game.addUnit(UnitType.City, tile, player);
    const city = game.unit(tile)!;

    for (let i = 0; i < 25; i++) {
      game.executeNextTick();
    }

    expect(city.level()).toBe(1);

    const execution = new UpgradeStructureExecution(player, city.id(), 5);
    game.addExecution(execution);
    game.executeNextTick();

    expect(city.level()).toBe(3);
  });
});
