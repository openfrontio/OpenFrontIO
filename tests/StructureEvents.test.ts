import { vi } from "vitest";
import {
  Game,
  MessageType,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

describe("StructureEvents Tests", () => {
  let game: Game;
  let player1: Player;
  let player2: Player;

  beforeEach(async () => {
    game = await setup("plains", {
      infiniteGold: true,
      instantBuild: true,
      infiniteTroops: true,
    });

    const player1Info = new PlayerInfo(
      "Player1",
      PlayerType.Human,
      null,
      "Player1",
    );
    const player2Info = new PlayerInfo(
      "Player2",
      PlayerType.Human,
      null,
      "Player2",
    );

    game.addPlayer(player1Info);
    game.addPlayer(player2Info);

    player1 = game.player(player1Info.id);
    player2 = game.player(player2Info.id);

    // conquer some tiles for players
    player1.conquer(game.ref(0, 10));
    player2.conquer(game.ref(0, 15));
  });

  test("Capturing a structure emits captured and lost messages", () => {
    const tile = Array.from(player1.tiles())[0];
    const structure = player1.buildUnit(UnitType.City, tile, {});

    const displayMessageSpy = vi.spyOn(game, "displayMessage");

    // capture the structure
    structure.setOwner(player2);

    // verify messages
    expect(displayMessageSpy).toHaveBeenCalledWith(
      "events_display.unit_captured",
      MessageType.CAPTURED_ENEMY_UNIT,
      player2.id(),
      undefined,
      { unit: UnitType.City, name: player1.displayName() },
      structure.id(),
    );

    expect(displayMessageSpy).toHaveBeenCalledWith(
      "events_display.unit_lost",
      MessageType.UNIT_DESTROYED,
      player1.id(),
      undefined,
      { unit: UnitType.City, name: player2.displayName() },
      structure.id(),
    );

    displayMessageSpy.mockRestore();
  });

  test("Destroying a structure emits unit_destroyed message", () => {
    const tile = Array.from(player1.tiles())[0];
    const structure = player1.buildUnit(UnitType.City, tile, {});

    const displayMessageSpy = vi.spyOn(game, "displayMessage");

    // delete the structure
    structure.delete();

    // verify message
    expect(displayMessageSpy).toHaveBeenCalledWith(
      "events_display.unit_destroyed",
      MessageType.UNIT_DESTROYED,
      player1.id(),
      undefined,
      { unit: UnitType.City },
      structure.id(),
    );

    displayMessageSpy.mockRestore();
  });
});
