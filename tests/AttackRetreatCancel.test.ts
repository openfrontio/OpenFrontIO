import { AttackExecution } from "../src/core/execution/AttackExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";

const gameID: GameID = "game_id";

describe("Attack retreat cancelled externally", () => {
  let game: Game;
  let attacker: Player;
  let defender: Player;

  beforeEach(async () => {
    game = await setup("ocean_and_land", {
      infiniteGold: true,
      infiniteTroops: true,
    });
    const attackerInfo = new PlayerInfo(
      "attacker",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    const defenderInfo = new PlayerInfo(
      "defender",
      PlayerType.Human,
      null,
      "defender_id",
    );
    game.addPlayer(attackerInfo);
    game.addPlayer(defenderInfo);

    game.addExecution(
      new SpawnExecution(
        gameID,
        game.player(attackerInfo.id).info(),
        game.ref(0, 10),
      ),
      new SpawnExecution(
        gameID,
        game.player(defenderInfo.id).info(),
        game.ref(0, 15),
      ),
    );
    game.executeNextTick();
    game.executeNextTick();

    attacker = game.player(attackerInfo.id);
    defender = game.player(defenderInfo.id);
  });

  test("deactivates when attack is deleted during retreat delay", () => {
    const attackExec = new AttackExecution(100, attacker, defender.id());
    game.addExecution(attackExec);
    game.executeNextTick();

    expect(attacker.outgoingAttacks()).toHaveLength(1);
    const attack = attacker.outgoingAttacks()[0];
    expect(attackExec.isActive()).toBe(true);

    // Simulate RetreatExecution.orderRetreat during the cancel delay.
    attack.orderRetreat();
    expect(attack.retreating()).toBe(true);
    expect(attack.isActive()).toBe(true);

    // External cancel (e.g. opposing attack merge) deletes the attack mid-retreat.
    attack.delete();
    expect(attack.isActive()).toBe(false);
    expect(attack.retreating()).toBe(true);

    game.executeNextTick();
    expect(attackExec.isActive()).toBe(false);
  });
});
