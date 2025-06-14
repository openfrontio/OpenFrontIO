import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { AllianceExtensionExecution } from "../src/core/execution/alliance/AllianceExtensionExecution";
import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { AllianceRequestReplyExecution } from "../src/core/execution/alliance/AllianceRequestReplyExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";

let game: Game;
let player1: Player;
let player2: Player;
let spawn1: TileRef;
let spawn2: TileRef;

describe("AllianceExtensionExecution", () => {
  beforeEach(async () => {
    game = await setup("ocean_and_land", {
      infiniteGold: true,
      instantBuild: true,
      infiniteTroops: true,
    });

    const p1Info = new PlayerInfo(
      "us",
      "Player1",
      PlayerType.Human,
      null,
      "p1",
    );
    const p2Info = new PlayerInfo(
      "us",
      "Player2",
      PlayerType.Human,
      null,
      "p2",
    );

    game.addPlayer(p1Info);
    game.addPlayer(p2Info);

    spawn1 = game.ref(0, 10);
    spawn2 = game.ref(0, 15);

    game.addExecution(
      new SpawnExecution(game.player(p1Info.id).info(), spawn1),
      new SpawnExecution(game.player(p2Info.id).info(), spawn2),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player1 = game.player(p1Info.id);
    player2 = game.player(p2Info.id);

    game.addExecution(
      new PlayerExecution(player1),
      new PlayerExecution(player2),
    );
    game.executeNextTick();
  });

  test("Successfully extends existing alliance", () => {
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();
    game.executeNextTick();

    game.addExecution(
      new AllianceRequestReplyExecution(player1.id(), player2, true),
    );
    game.executeNextTick();
    game.executeNextTick();

    const allianceBefore = player1.allianceWith(player2);
    expect(allianceBefore).toBeTruthy();

    const expirationBefore =
      allianceBefore!.createdAt() + game.config().allianceDuration();

    game.addExecution(new AllianceExtensionExecution(player1, player2));
    game.executeNextTick();

    const allianceAfter = player1.allianceWith(player2);
    expect(allianceAfter).toBeTruthy();

    const expirationAfter =
      allianceAfter!.createdAt() + game.config().allianceDuration();

    expect(expirationAfter).toBeGreaterThan(expirationBefore);
  });

  test("Fails gracefully if no alliance exists", () => {
    game.addExecution(new AllianceExtensionExecution(player1, player2));
    game.executeNextTick();

    expect(player1.allianceWith(player2)).toBeFalsy();
  });
});
