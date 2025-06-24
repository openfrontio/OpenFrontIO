import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { AllianceRequestReplyExecution } from "../src/core/execution/alliance/AllianceRequestReplyExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";

let game: Game;
let player1: Player;
let player2: Player;
let player3: Player;
let player1Spawn: TileRef;
let player2Spawn: TileRef;
let player3Spawn: TileRef;

describe("Alliance", () => {
  beforeEach(async () => {
    game = await setup("ocean_and_land", {
      infiniteGold: true,
      instantBuild: true,
      infiniteTroops: true,
    });
    const player1Info = new PlayerInfo(
      undefined,
      "us",
      "player 1 dude",
      PlayerType.Human,
      null,
      "p1_id",
    );
    game.addPlayer(player1Info);
    const player2Info = new PlayerInfo(
      undefined,
      "us",
      "player 2 dude",
      PlayerType.Human,
      null,
      "p2_id",
    );
    game.addPlayer(player2Info);
    const player3Info = new PlayerInfo(
      undefined,
      "us",
      "player 3 dude",
      PlayerType.Human,
      null,
      "p3_id",
    );
    game.addPlayer(player3Info);

    player1Spawn = game.ref(0, 15);
    player2Spawn = game.ref(0, 10);
    player3Spawn = game.ref(0, 5);

    game.addExecution(
      new SpawnExecution(game.player(player1Info.id).info(), player1Spawn),
      new SpawnExecution(game.player(player2Info.id).info(), player2Spawn),
      new SpawnExecution(game.player(player3Info.id).info(), player3Spawn),
    );

    const currentTick = game.ticks();
    for (
      let i = currentTick;
      i <= currentTick + game.config().numSpawnPhaseTurns() &&
      game.inSpawnPhase();
      i++
    ) {
      game.executeNextTick();
    }
    expect(game.inSpawnPhase()).toBe(false);

    player1 = game.player(player1Info.id);
    player2 = game.player(player2Info.id);
    player3 = game.player(player3Info.id);

    game.addExecution(
      new PlayerExecution(player1),
      new PlayerExecution(player2),
      new PlayerExecution(player3),
    );

    game.executeNextTick();
  });

  test("Player can send an alliance request", async () => {
    const player1Request = new AllianceRequestExecution(player1, player2.id());
    game.addExecution(player1Request);
    // Finish tick execution to add execution.
    game.executeNextTick();
    // Execute a tick to let execution resolve.
    game.executeNextTick();

    expect(player1.outgoingAllianceRequests().length).toBe(1);
    expect(player2.incomingAllianceRequests().length).toBe(1);
  });

  test("Player can accept a alliance request, resulting in an alliance", async () => {
    const player1Request = new AllianceRequestExecution(player1, player2.id());
    game.addExecution(player1Request);
    // Finish tick execution to add execution.
    game.executeNextTick();
    // Execute a tick to let execution resolve.
    game.executeNextTick();

    expect(player1.outgoingAllianceRequests().length).toBe(1);
    expect(player2.incomingAllianceRequests().length).toBe(1);

    game.addExecution(
      new AllianceRequestReplyExecution(player1.id(), player2, true),
    );
    // Finish tick execution to add execution.
    game.executeNextTick();
    // Execute a tick to let execution resolve.
    game.executeNextTick();

    expect(player1.outgoingAllianceRequests().length).toBe(0);
    expect(player2.incomingAllianceRequests().length).toBe(0);
    expect(player1.alliances().length).toBe(1);
    expect(player2.alliances().length).toBe(1);
  });

  test("Alliance expires after configured duration", async () => {
    const player1Request = new AllianceRequestExecution(player1, player2.id());
    game.addExecution(player1Request);
    // Finish tick execution to add execution.
    game.executeNextTick();
    // Execute a tick to let execution resolve.
    game.executeNextTick();
    game.addExecution(
      new AllianceRequestReplyExecution(player1.id(), player2, true),
    );
    // Finish tick execution to add execution.
    game.executeNextTick();
    // Execute a tick to let execution resolve.
    game.executeNextTick();

    const currentTick = game.ticks();
    for (
      let i = currentTick;
      i <= currentTick + game.config().allianceDuration();
      i++
    ) {
      game.executeNextTick();
    }

    // alliance should be expired now.
    expect(player1.alliances().length).toBe(0);
    expect(player2.alliances().length).toBe(0);
  });

  test("Player can deny a alliance request", async () => {
    const player1Request = new AllianceRequestExecution(player1, player2.id());
    game.addExecution(player1Request);
    // Finish tick execution to add execution.
    game.executeNextTick();
    // Execute a tick to let execution resolve.
    game.executeNextTick();

    expect(player1.outgoingAllianceRequests().length).toBe(1);
    expect(player2.incomingAllianceRequests().length).toBe(1);

    game.addExecution(
      new AllianceRequestReplyExecution(player1.id(), player2, false),
    );
    // Finish tick execution to add execution.
    game.executeNextTick();
    // Execute a tick to let execution resolve.
    game.executeNextTick();

    expect(player1.outgoingAllianceRequests().length).toBe(0);
    expect(player2.incomingAllianceRequests().length).toBe(0);
    expect(player1.alliances().length).toBe(0);
    expect(player2.alliances().length).toBe(0);
  });

  test("Coalition formation (multiple alliances)", async () => {
    game.addExecution(
      new AllianceRequestExecution(player1, player2.id()),
      new AllianceRequestExecution(player1, player3.id()),
    );
    // Finish tick execution to add execution.
    game.executeNextTick();
    // Execute a tick to let execution resolve.
    game.executeNextTick();

    game.addExecution(
      new AllianceRequestReplyExecution(player1.id(), player2, true),
    );
    game.addExecution(
      new AllianceRequestReplyExecution(player1.id(), player3, true),
    );
    // Finish tick execution to add execution.
    game.executeNextTick();
    // Execute a tick to let execution resolve.
    game.executeNextTick();

    expect(player1.alliances().length).toBe(2);
    expect(player1.allies().length).toBe(2);
    // Player 2 and 3 are only allied with 1, and not each other.
    expect(player2.allies().length).toBe(1);
    expect(player3.allies().length).toBe(1);
  });
});
