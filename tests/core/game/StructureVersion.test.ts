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
});
