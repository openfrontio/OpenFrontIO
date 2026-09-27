import { GameID } from "../../../src/core/Schemas";
import { AttackExecution } from "../../../src/core/execution/AttackExecution";
import { NationExecution } from "../../../src/core/execution/NationExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import { TribeExecution } from "../../../src/core/execution/TribeExecution";
//import { TransportShipExecution } from "../../../src/core/execution/TransportShipExecution";
import { AllianceRequestExecution } from "../../../src/core/execution/alliance/AllianceRequestExecution";
import {
  Game,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
} from "../../../src/core/game/Game";
import { GameImpl } from "../../../src/core/game/GameImpl";
import { TileRef } from "../../../src/core/game/GameMap";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";
import { setup } from "../../util/Setup";

const gameID: GameID = "game_id";
let game: Game;
let attacker: Player;
let defender: Player;
let defenderSpawn: TileRef;
let attackerSpawn: TileRef;

describe("GameImpl", () => {
  beforeEach(async () => {
    game = await setup("ocean_and_land", {
      infiniteGold: true,
      instantBuild: true,
      infiniteTroops: true,
    });
    const attackerInfo = new PlayerInfo(
      "attacker dude",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    game.addPlayer(attackerInfo);
    const defenderInfo = new PlayerInfo(
      "defender dude",
      PlayerType.Human,
      null,
      "defender_id",
    );
    game.addPlayer(defenderInfo);

    defenderSpawn = game.ref(0, 15);
    attackerSpawn = game.ref(0, 14);

    game.addExecution(
      new SpawnExecution(
        gameID,
        game.player(attackerInfo.id).info(),
        attackerSpawn,
      ),
      new SpawnExecution(
        gameID,
        game.player(defenderInfo.id).info(),
        defenderSpawn,
      ),
    );

    attacker = game.player(attackerInfo.id);
    defender = game.player(defenderInfo.id);
  });

  test("Don't become traitor when betraying inactive player", async () => {
    vi.spyOn(attacker, "canSendAllianceRequest").mockReturnValue(true);
    vi.spyOn(defender, "canSendAllianceRequest").mockReturnValue(true);
    game.addExecution(new AllianceRequestExecution(attacker, defender.id()));
    game.executeNextTick();

    game.addExecution(new AllianceRequestExecution(defender, attacker.id()));
    game.executeNextTick();

    expect(attacker.allianceWith(defender)).toBeTruthy();
    expect(defender.allianceWith(attacker)).toBeTruthy();

    //Defender is marked disconnected
    defender.markDisconnected(true);

    game.executeNextTick();
    game.executeNextTick();

    // STEP 1: First betray (manually break alliance)
    const alliance = attacker.allianceWith(defender);
    expect(alliance).toBeTruthy();
    attacker.breakAlliance(alliance!);

    // STEP 2: Then attack after betrayal
    game.addExecution(new AttackExecution(100, attacker, defender.id()));

    do {
      game.executeNextTick();
    } while (attacker.outgoingAttacks().length > 0);

    expect(attacker.isTraitor()).toBe(false);
    expect(attacker.allianceWith(defender)).toBeFalsy();
  });

  test("Do become traitor when betraying active player", async () => {
    vi.spyOn(attacker, "canSendAllianceRequest").mockReturnValue(true);
    vi.spyOn(defender, "canSendAllianceRequest").mockReturnValue(true);
    game.addExecution(new AllianceRequestExecution(attacker, defender.id()));
    game.executeNextTick();

    game.addExecution(new AllianceRequestExecution(defender, attacker.id()));
    game.executeNextTick();

    expect(attacker.allianceWith(defender)).toBeTruthy();
    expect(defender.allianceWith(attacker)).toBeTruthy();

    //Defender is NOT marked disconnected

    game.executeNextTick();
    game.executeNextTick();

    // First betray (manually break alliance)
    const alliance = attacker.allianceWith(defender);
    expect(alliance).toBeTruthy();
    attacker.breakAlliance(alliance!);

    game.executeNextTick();

    game.addExecution(new AttackExecution(100, attacker, defender.id()));

    do {
      game.executeNextTick();
    } while (attacker.outgoingAttacks().length > 0);

    expect(attacker.isTraitor()).toBe(true);
    expect(attacker.allianceWith(defender)).toBeFalsy();
  });

  test("Singleplayer late human spawn gets spawn immunity", async () => {
    const singleplayerGame = await setup(
      "plains",
      {
        gameType: GameType.Singleplayer,
      },
      [],
      undefined,
      undefined,
      false,
    );
    (singleplayerGame.config() as any).setSpawnImmunityDuration(100);

    const pastSpawnCountdown =
      singleplayerGame.config().numSpawnPhaseTurns() + 20;
    for (let i = 0; i < pastSpawnCountdown; i++) {
      singleplayerGame.executeNextTick();
    }

    const lateHumanInfo = new PlayerInfo(
      "late human",
      PlayerType.Human,
      "late_client_id",
      "late_player_id",
    );

    singleplayerGame.addExecution(
      new SpawnExecution(gameID, lateHumanInfo, singleplayerGame.ref(5, 5)),
    );

    // First tick initializes the execution, second tick applies the spawn.
    singleplayerGame.executeNextTick();
    const spawnUpdates = singleplayerGame.executeNextTick();

    expect(singleplayerGame.player(lateHumanInfo.id).hasSpawned()).toBe(true);
    expect(spawnUpdates[GameUpdateType.SpawnPhaseEnd]).toHaveLength(1);
    expect(singleplayerGame.isSpawnImmunityActive()).toBe(true);
  });

  test("convertHumanToNation converts human player to nation bot and adds NationExecution", () => {
    expect(defender.type()).toBe(PlayerType.Human);
    const nationExec = game.convertHumanToNation(defender, gameID);

    expect(nationExec).toBeInstanceOf(NationExecution);
    expect(defender.type()).toBe(PlayerType.Nation);
    expect(defender.clientID()).toBeNull();
    expect(defender.isLobbyCreator()).toBe(false);

    // Verify executions list includes the new NationExecution
    expect(game.executions()).toContain(nationExec);

    // Verify registry updates
    const nationEntry = game
      .nations()
      .find((n) => n.playerInfo.id === defender.id());
    expect(nationEntry).toBeDefined();
    expect(nationEntry?.playerInfo.playerType).toBe(PlayerType.Nation);

    // Verify player info lookup reflects the bot
    const info = (game as GameImpl).findPlayerInfo(defender.id());
    expect(info?.playerType).toBe(PlayerType.Nation);
  });

  test("takeoverPlayer converts bot to human, assigns clientID, updates registries and removes bot executions", () => {
    // Convert defender to nation first
    const nationExec = game.convertHumanToNation(defender, gameID);
    expect(game.executions()).toContain(nationExec);
    expect(defender.type()).toBe(PlayerType.Nation);

    // Also add a TribeExecution to verify tribe executions are removed as well
    const tribeExec = new TribeExecution(defender);
    game.addExecution(tribeExec);
    expect(game.executions()).toContain(tribeExec);

    // Now takeover defender with a new client ID
    game.takeoverPlayer(defender, "new_client_123");

    expect(defender.type()).toBe(PlayerType.Human);
    expect(defender.clientID()).toBe("new_client_123");
    expect(defender.info().clientID).toBe("new_client_123");
    expect(defender.info().playerType).toBe(PlayerType.Human);

    // Verify AI executions were removed
    expect(game.executions()).not.toContain(nationExec);
    expect(game.executions()).not.toContain(tribeExec);

    // Verify nations registry no longer includes the taken-over player
    expect(
      game.nations().find((n) => n.playerInfo.id === defender.id()),
    ).toBeUndefined();

    // Verify player info lookup reflects human
    const info = (game as GameImpl).findPlayerInfo(defender.id());
    expect(info?.playerType).toBe(PlayerType.Human);
    expect(info?.clientID).toBe("new_client_123");
  });

  test("takeoverPlayer rebinds existing human player to new client ID", () => {
    expect(attacker.type()).toBe(PlayerType.Human);
    game.takeoverPlayer(attacker.id(), "attacker_new_client");

    expect(attacker.clientID()).toBe("attacker_new_client");
    expect(attacker.info().clientID).toBe("attacker_new_client");
    expect(attacker.type()).toBe(PlayerType.Human);
  });
});
