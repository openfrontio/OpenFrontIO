import { AllianceRequestExecution } from "src/core/execution/alliance/AllianceRequestExecution";
import { SpawnExecution } from "src/core/execution/SpawnExecution";
import { TransportShipExecution } from "src/core/execution/TransportShipExecution";
import { GameUpdateType } from "src/core/game/GameUpdates";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";

let game: Game;
const gameID: GameID = "game_id";
let player1: Player;
let player2: Player;

function addPlayer(name: string, x: number, y: number): Player {
  const info = new PlayerInfo(name, PlayerType.Human, null, name);
  game.addPlayer(info);
  game.addExecution(new SpawnExecution(gameID, info, game.ref(x, y)));
  return game.player(info.id);
}

describe("Alliance acceptance retreats in-flight transport ships", () => {
  beforeEach(async () => {
    game = await setup("ocean_and_land", {
      infiniteGold: true,
      instantBuild: true,
      infiniteTroops: true,
    });

    // Players on opposite sides of the water
    player1 = addPlayer("p1", 7, 0);
    player2 = addPlayer("p2", 7, 15);

    const maxTicks = 1000;
    let ticks = 0;
    while (game.inSpawnPhase()) {
      if (++ticks > maxTicks) throw new Error("Spawn phase did not end");
      game.executeNextTick();
    }
  });

  test("accepting alliance causes in-flight boats to retreat", () => {
    // Player 1 sends a boat toward Player 2's territory
    game.addExecution(
      new TransportShipExecution(player1, game.ref(7, 15), 100),
    );
    game.executeNextTick(); // init: spawns transport ship

    expect(player1.units(UnitType.TransportShip)).toHaveLength(1);
    const boat = player1.units(UnitType.TransportShip)[0];
    expect(boat.retreating()).toBe(false);

    // Form alliance: player1 requests, player2 counter-requests (auto-accepts)
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick(); // creates request
    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    game.executeNextTick(); // counter-request auto-accepts

    expect(player1.isAlliedWith(player2)).toBe(true);

    // Boat should now be retreating
    expect(boat.retreating()).toBe(true);
  });

  test("accepting alliance only retreats boats targeting the new ally", () => {
    // Player 1 sends a boat toward Player 2's territory
    game.addExecution(new TransportShipExecution(player1, game.ref(7, 15), 50));
    game.executeNextTick(); // init: spawns transport ship heading to player2

    const boatToAlly = player1.units(UnitType.TransportShip)[0];
    expect(boatToAlly).toBeDefined();
    expect(boatToAlly.retreating()).toBe(false);

    // Manually build a transport ship for player1 on a water tile,
    // targeting player1's OWN territory (not the new ally)
    const ownTile = player1.units(UnitType.TransportShip)[0].tile();
    const boatToSelf = player1.buildUnit(UnitType.TransportShip, ownTile, {
      troops: 50,
      targetTile: game.ref(7, 0), // player1's own territory
    });

    expect(player1.units(UnitType.TransportShip)).toHaveLength(2);

    // Form alliance between player1 and player2
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick(); // creates request
    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    game.executeNextTick(); // counter-request auto-accepts

    expect(player1.isAlliedWith(player2)).toBe(true);

    // Boat heading to the new ally should retreat
    expect(boatToAlly.retreating()).toBe(true);
    // Boat heading to own territory should NOT retreat
    expect(boatToSelf.retreating()).toBe(false);
  });

  test("accepting alliance displays a retreat display message", () => {
    game.addExecution(
      new TransportShipExecution(player1, game.ref(7, 15), 100),
    );
    game.executeNextTick(); // init

    expect(player1.units(UnitType.TransportShip)).toHaveLength(1);

    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick(); // creates request
    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    const updates = game.executeNextTick(); // counter-request auto-accepts

    expect(player1.isAlliedWith(player2)).toBe(true);

    const messages =
      updates[GameUpdateType.DisplayEvent]?.map((e) => e.message) ?? [];

    expect(
      messages.some(
        (m) =>
          m === "events_display.alliance_boats_retreated_outgoing" ||
          m === "events_display.alliance_boats_retreated_incoming",
      ),
    ).toBe(true);
  });

  test("boats from both players retreat when alliance accepted", () => {
    // Player 1 sends a boat toward Player 2
    game.addExecution(new TransportShipExecution(player1, game.ref(7, 15), 50));
    // Player 2 sends a boat toward Player 1
    game.addExecution(new TransportShipExecution(player2, game.ref(7, 0), 50));
    game.executeNextTick(); // init: spawns both transport ships

    expect(player1.units(UnitType.TransportShip)).toHaveLength(1);
    expect(player2.units(UnitType.TransportShip)).toHaveLength(1);

    // Form alliance
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick(); // creates request
    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    game.executeNextTick(); // counter-request auto-accepts

    expect(player1.isAlliedWith(player2)).toBe(true);

    // Both boats should be retreating
    expect(player1.units(UnitType.TransportShip)[0].retreating()).toBe(true);
    expect(player2.units(UnitType.TransportShip)[0].retreating()).toBe(true);
  });
});
