import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import type { GameImpl } from "@openfront/engine/game/GameImpl";
import { playerInfo, setup } from "../../util/Setup";

describe("Game.structureVersion", () => {
  test("moves for rail structures and terrain only", async () => {
    const game = await setup("plains", {}, [
      playerInfo("player", PlayerType.Human),
    ]);
    const player = game.player("player")!;
    const start = game.structureVersion();

    // Units the rail network never connects leave it alone.
    const post = player.buildUnit(UnitType.DefensePost, game.ref(5, 5), {});
    expect(game.structureVersion()).toBe(start);

    const city = player.buildUnit(UnitType.City, game.ref(20, 20), {});
    expect(game.structureVersion()).toBe(start + 1);
    player.buildUnit(UnitType.Port, game.ref(30, 30), {});
    player.buildUnit(UnitType.Factory, game.ref(40, 40), {});
    expect(game.structureVersion()).toBe(start + 3);

    post.delete(false);
    expect(game.structureVersion()).toBe(start + 3);
    city.delete(false);
    expect(game.structureVersion()).toBe(start + 4);

    // Rail paths route around water, so terrain changes count too.
    (game as GameImpl).setWater(game.ref(60, 60));
    expect(game.structureVersion()).toBe(start + 5);
  });

  test("moves when a structure's construction state flips", async () => {
    const game = await setup("plains", {}, [
      playerInfo("player", PlayerType.Human),
    ]);
    const player = game.player("player")!;
    const city = player.buildUnit(UnitType.City, game.ref(20, 20), {});
    const post = player.buildUnit(UnitType.DefensePost, game.ref(5, 5), {});
    const start = game.structureVersion();

    // nearbyUnits hides structures under construction, so both the start and
    // the completion of construction change what a rail plan sees.
    city.setUnderConstruction(true);
    expect(game.structureVersion()).toBe(start + 1);
    city.setUnderConstruction(true);
    expect(game.structureVersion()).toBe(start + 1);
    city.setUnderConstruction(false);
    expect(game.structureVersion()).toBe(start + 2);

    post.setUnderConstruction(true);
    post.setUnderConstruction(false);
    expect(game.structureVersion()).toBe(start + 2);
  });

  test("moves when queued water conversions flush", async () => {
    const game = await setup("plains", { waterNukes: true }, [
      playerInfo("player", PlayerType.Human),
    ]);
    const start = game.structureVersion();

    // A tick with nothing queued leaves it alone.
    game.executeNextTick();
    expect(game.structureVersion()).toBe(start);

    // Queued conversions write the map inside WaterManager.tick, bypassing
    // setWater, so the flush itself must count.
    game.queueWaterConversion(game.ref(60, 60));
    expect(game.structureVersion()).toBe(start);
    game.executeNextTick();
    expect(game.structureVersion()).toBe(start + 1);
    expect(game.isWater(game.ref(60, 60))).toBe(true);
  });
});
