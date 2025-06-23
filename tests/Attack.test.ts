import { AttackExecution } from "../src/core/execution/AttackExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { TransportShipExecution } from "../src/core/execution/TransportShipExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";
import { constructionExecution } from "./util/utils";

let game: Game;
let attacker: Player;
let defender: Player;
let defenderSpawn: TileRef;
let attackerSpawn: TileRef;

function sendBoat(target: TileRef, source: TileRef, troops: number) {
  game.addExecution(
    new TransportShipExecution(defender, null, target, troops, source),
  );
}

describe("Attack", () => {
  beforeEach(async () => {
    game = await setup("ocean_and_land", {
      infiniteGold: true,
      instantBuild: true,
      infiniteTroops: true,
    });
    const attackerInfo = new PlayerInfo(
      undefined,
      "us",
      "attacker dude",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    game.addPlayer(attackerInfo);
    const defenderInfo = new PlayerInfo(
      undefined,
      "us",
      "defender dude",
      PlayerType.Human,
      null,
      "defender_id",
    );
    game.addPlayer(defenderInfo);

    defenderSpawn = game.ref(0, 15);
    attackerSpawn = game.ref(0, 10);

    game.addExecution(
      new SpawnExecution(game.player(attackerInfo.id).info(), attackerSpawn),
      new SpawnExecution(game.player(defenderInfo.id).info(), defenderSpawn),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    attacker = game.player(attackerInfo.id);
    defender = game.player(defenderInfo.id);

    game.addExecution(
      new AttackExecution(100, defender, game.terraNullius().id()),
    );
    game.executeNextTick();
    while (defender.outgoingAttacks().length > 0) {
      game.executeNextTick();
    }

    (game.config() as TestConfig).setDefaultNukeSpeed(50);
  });

  test("Nuke reduce attacking troop counts", async () => {
    // Not building exactly spawn to it's better protected from attacks (but still
    // on defender territory)
    constructionExecution(game, defender, 1, 1, UnitType.MissileSilo);
    expect(defender.units(UnitType.MissileSilo)).toHaveLength(1);
    game.addExecution(new AttackExecution(100, attacker, defender.id()));
    constructionExecution(game, defender, 0, 15, UnitType.AtomBomb, 3);
    const nuke = defender.units(UnitType.AtomBomb)[0];
    expect(nuke.isActive()).toBe(true);

    expect(attacker.outgoingAttacks()).toHaveLength(1);
    expect(attacker.outgoingAttacks()[0].troops()).toBe(98);

    // Make the nuke go kaboom
    game.executeNextTick();
    expect(nuke.isActive()).toBe(false);
    expect(attacker.outgoingAttacks()[0].troops()).not.toBe(97);
    expect(attacker.outgoingAttacks()[0].troops()).toBeLessThan(90);
  });

  test("Nuke reduce attacking boat troop count", async () => {
    constructionExecution(game, defender, 1, 1, UnitType.MissileSilo);
    expect(defender.units(UnitType.MissileSilo)).toHaveLength(1);

    sendBoat(game.ref(15, 8), game.ref(10, 5), 100);

    constructionExecution(game, defender, 0, 15, UnitType.AtomBomb, 3);
    const nuke = defender.units(UnitType.AtomBomb)[0];
    expect(nuke.isActive()).toBe(true);

    const ship = defender.units(UnitType.TransportShip)[0];
    expect(ship.troops()).toBe(100);

    game.executeNextTick();

    expect(nuke.isActive()).toBe(false);
    expect(defender.units(UnitType.TransportShip)[0].troops()).toBeLessThan(90);
  });
});
