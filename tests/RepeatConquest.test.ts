import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";

const gameID: GameID = "game_id";

describe("Repeat conquest guard", () => {
  let game: Game;
  let conqueror: Player;
  let victim: Player;

  beforeEach(async () => {
    game = await setup("ocean_and_land");
    const conquerorInfo = new PlayerInfo(
      "conqueror",
      PlayerType.Human,
      "conqueror_client",
      "conqueror",
    );
    const victimInfo = new PlayerInfo(
      "victim",
      PlayerType.Human,
      "victim_client",
      "victim",
    );
    game.addPlayer(conquerorInfo);
    game.addPlayer(victimInfo);
    game.addExecution(
      new SpawnExecution(gameID, conquerorInfo, game.ref(0, 10)),
    );
    conqueror = game.player(conquerorInfo.id);
    victim = game.player(victimInfo.id);
    victim.addGold(1000n);
    // Record an attack so the gold transfer is not skipped for humans.
    game.stats().attack(victim, game.terraNullius(), 100);
  });

  test("conquerPlayer only transfers gold and records a kill once", () => {
    const goldBefore = conqueror.gold();
    game.conquerPlayer(conqueror, victim);
    expect(conqueror.gold()).toBe(goldBefore + 500n);
    expect(victim.gold()).toBe(0n);
    expect(game.hasConqueredPlayer(victim.id())).toBe(true);

    const killsAfterFirst =
      game.stats().getPlayerStats(conqueror)?.kills?.length ?? 0;
    expect(killsAfterFirst).toBe(1);

    // Second call must be a no-op (island-survivor / <100-tile path).
    victim.addGold(2000n);
    game.conquerPlayer(conqueror, victim);
    expect(conqueror.gold()).toBe(goldBefore + 500n);
    expect(victim.gold()).toBe(2000n);
    expect(game.stats().getPlayerStats(conqueror)?.kills?.length ?? 0).toBe(1);
  });
});
