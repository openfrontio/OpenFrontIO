import { ConstructionExecution } from "../../src/core/execution/ConstructionExecution";
import { SpawnExecution } from "../../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { GameID } from "../../src/core/Schemas";
import { setup } from "../util/Setup";

describe("Nuke targeting with alliances and hierarchy", () => {
  let game: Game;
  let overlord: Player;
  let attacker: Player;
  let sibling: Player;
  let descendant: Player;
  let tempAlly: Player;
  const gameID: GameID = "game_id";

  beforeEach(async () => {
    game = await setup("plains", {
      infiniteGold: true,
      instantBuild: true,
      enableVassals: true,
    });

    const overlordInfo = new PlayerInfo("O", PlayerType.Human, null, "O");
    const attackerInfo = new PlayerInfo("A", PlayerType.Human, null, "A");
    const siblingInfo = new PlayerInfo("S", PlayerType.Human, null, "S");
    const descendantInfo = new PlayerInfo("D", PlayerType.Human, null, "D");
    const tempAllyInfo = new PlayerInfo("T", PlayerType.Human, null, "T");

    game.addPlayer(overlordInfo);
    game.addPlayer(attackerInfo);
    game.addPlayer(siblingInfo);
    game.addPlayer(descendantInfo);
    game.addPlayer(tempAllyInfo);

    const overlordTile = game.ref(5, 5);
    const attackerTile = game.ref(10, 10);
    const siblingTile = game.ref(15, 10);
    const descendantTile = game.ref(12, 15);
    const tempAllyTile = game.ref(20, 20);

    game.addExecution(new SpawnExecution(gameID, overlordInfo, overlordTile));
    game.addExecution(new SpawnExecution(gameID, attackerInfo, attackerTile));
    game.addExecution(new SpawnExecution(gameID, siblingInfo, siblingTile));
    game.addExecution(new SpawnExecution(gameID, descendantInfo, descendantTile));
    game.addExecution(new SpawnExecution(gameID, tempAllyInfo, tempAllyTile));

    while (game.inSpawnPhase()) game.executeNextTick();

    overlord = game.player(overlordInfo.id);
    attacker = game.player(attackerInfo.id);
    sibling = game.player(siblingInfo.id);
    descendant = game.player(descendantInfo.id);
    tempAlly = game.player(tempAllyInfo.id);

    overlord.conquer(overlordTile);
    attacker.conquer(attackerTile);
    sibling.conquer(siblingTile);
    descendant.conquer(descendantTile);
    tempAlly.conquer(tempAllyTile);

    // Establish hierarchy: O -> A, O -> S, A -> D
    expect(game.vassalize(attacker, overlord)).toBeTruthy();
    expect(game.vassalize(sibling, overlord)).toBeTruthy();
    expect(game.vassalize(descendant, attacker)).toBeTruthy();

    // Create a temporary alliance between attacker and temp ally.
    const allianceRequest = attacker.createAllianceRequest(tempAlly);
    expect(allianceRequest).not.toBeNull();
    allianceRequest?.accept();
    expect(attacker.isAlliedWith(tempAlly)).toBe(true);

    // Give attacker a ready missile silo.
    game.addExecution(
      new ConstructionExecution(attacker, UnitType.MissileSilo, attackerTile),
    );
    game.executeNextTick();
    game.executeNextTick();
    expect(attacker.units(UnitType.MissileSilo)).toHaveLength(1);
  });

  test("can nuke temp allies and hierarchy descendants but not siblings or overlords", () => {
    const tempAllyTile = tempAlly.tiles().values().next().value as number;
    const descendantTile = descendant.tiles().values().next().value as number;
    const siblingTile = sibling.tiles().values().next().value as number;
    const overlordTile = overlord.tiles().values().next().value as number;

    expect(attacker.canBuild(UnitType.AtomBomb, tempAllyTile)).not.toBe(
      false,
    );
    expect(attacker.canBuild(UnitType.AtomBomb, descendantTile)).not.toBe(
      false,
    );
    expect(attacker.canBuild(UnitType.AtomBomb, siblingTile)).toBe(false);
    expect(attacker.canBuild(UnitType.AtomBomb, overlordTile)).toBe(false);
  });
});
