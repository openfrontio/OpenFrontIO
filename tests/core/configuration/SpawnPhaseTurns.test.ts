import { describe, expect, test } from "vitest";
import { GameType } from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";

// 10 ticks = 1 second of game time.
describe("numSpawnPhaseTurns", () => {
  test("multiplayer spawn phase lasts 20 seconds", async () => {
    const game = await setup("plains", { gameType: GameType.Public });
    expect(game.config().numSpawnPhaseTurns()).toBe(200);
  });

  test("random spawn shortens the spawn phase to 15 seconds", async () => {
    const game = await setup("plains", {
      gameType: GameType.Public,
      randomSpawn: true,
    });
    expect(game.config().numSpawnPhaseTurns()).toBe(150);
  });

  test("singleplayer spawn phase is 100 ticks regardless of random spawn", async () => {
    const game = await setup("plains", {
      gameType: GameType.Singleplayer,
      randomSpawn: true,
    });
    expect(game.config().numSpawnPhaseTurns()).toBe(100);
  });
});
