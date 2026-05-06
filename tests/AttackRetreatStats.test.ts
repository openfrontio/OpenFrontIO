import { AttackExecution } from "../src/core/execution/AttackExecution";
import { RetreatExecution } from "../src/core/execution/RetreatExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";

let game: Game;
const gameID: GameID = "game_id";
let player1: Player;
let player2: Player;

describe("AttackRetreatStats", () => {
  beforeEach(async () => {
    game = await setup("plains", {}, [
      new PlayerInfo("player1", PlayerType.Human, "player1", "player1"),
      new PlayerInfo("player2", PlayerType.Human, "player2", "player2"),
    ]);

    player1 = game.player("player1");
    player2 = game.player("player2");

    game.addExecution(
      new SpawnExecution(gameID, player1.info(), game.ref(50, 50)),
    );
    game.addExecution(
      new SpawnExecution(gameID, player2.info(), game.ref(50, 55)),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
  });

  test("should call attackCancel when attack is retreated", () => {
    // Attack terraNullius so the attack doesn't end quickly from troop loss
    const attackCancelSpy = vi.spyOn(game.stats(), "attackCancel");

    game.addExecution(
      new AttackExecution(player1.troops(), player1, game.terraNullius().id()),
    );

    // Execute one tick so the attack is initialized
    game.executeNextTick();

    const attacks = player1.outgoingAttacks();
    expect(attacks.length).toBeGreaterThan(0);
    const attackId = attacks[0].id();

    // Add retreat execution immediately
    game.addExecution(new RetreatExecution(player1, attackId));

    // Execute ticks until the attack finishes retreating (cancelDelay=20 + a few more)
    for (let i = 0; i < 50; i++) {
      game.executeNextTick();
    }

    // Verify attackCancel was called (retreat stats recorded)
    expect(attackCancelSpy).toHaveBeenCalled();
    expect(attackCancelSpy).toHaveBeenCalledWith(
      player1,
      expect.anything(),
      expect.any(Number),
    );
  });

  test("should NOT call attackCancel when attack completes without retreat", () => {
    expect(player1.sharesBorderWith(player2)).toBeTruthy();

    const attackCancelSpy = vi.spyOn(game.stats(), "attackCancel");

    // Start a full-troop attack against the other player (no retreat)
    game.addExecution(
      new AttackExecution(player1.troops(), player1, player2.id()),
    );

    // Execute until attack completes
    let maxTicks = 5000;
    while (player1.outgoingAttacks().length > 0 && maxTicks > 0) {
      game.executeNextTick();
      maxTicks--;
    }

    // Verify attackCancel was NOT called
    expect(attackCancelSpy).not.toHaveBeenCalled();
  });
});
