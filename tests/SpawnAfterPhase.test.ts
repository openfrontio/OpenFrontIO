import { Executor } from "../src/core/execution/ExecutionManager";
import { NoOpExecution } from "../src/core/execution/NoOpExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { PlayerInfo, PlayerType } from "../src/core/game/Game";
import { ClientID, GameID, StampedIntent } from "../src/core/Schemas";
import { setup } from "./util/Setup";

const gameID: GameID = "game_id";

function spawnIntent(clientID: ClientID, tile: number): StampedIntent {
  return { type: "spawn", tile, clientID } as StampedIntent;
}

// Regression guard for the "late spawn" exploit: a modified client that relays a
// { type: "spawn", tile } intent AFTER the spawn phase has ended must not place
// any territory. A client's only untrusted input is the intent, and every honest
// client turns that intent into an execution through Executor.createExec — so the
// authoritative gate lives there. The client-side guard in ClientGameRunner is UX
// only; a modified client skips it.
describe("Spawn intent after the spawn phase", () => {
  it("drops a spawn intent relayed after the phase ended", async () => {
    // The default setup ends the spawn phase immediately — the exact post-phase
    // state a late spawner exploits.
    const game = await setup("plains", { infiniteGold: true });
    const info = new PlayerInfo(
      "latecomer",
      PlayerType.Human,
      "late_client",
      "late_id",
    );
    game.addPlayer(info);
    const latecomer = game.player(info.id);

    expect(game.inSpawnPhase()).toBe(false);

    const executor = new Executor(game, gameID, "late_client");
    const exec = executor.createExec(
      spawnIntent("late_client" as ClientID, game.ref(40, 40)),
    );

    // The intent is neutralized at creation: no SpawnExecution is produced.
    expect(exec).toBeInstanceOf(NoOpExecution);
    expect(exec).not.toBeInstanceOf(SpawnExecution);

    // End-to-end: running it places nothing. (Before the fix this player
    // materialized ~52 tiles on the running map.)
    game.addExecution(exec);
    game.executeNextTick();
    game.executeNextTick();
    expect(latecomer.hasSpawned()).toBe(false);
    expect(latecomer.numTilesOwned()).toBe(0);
  });

  it("still honors a spawn intent during the spawn phase", async () => {
    // Keep the spawn phase ACTIVE (autoEndSpawnPhase = false) so the intent
    // arrives in-phase — the normal path that must keep working.
    const game = await setup(
      "plains",
      { infiniteGold: true },
      [],
      undefined,
      undefined,
      false,
    );
    const info = new PlayerInfo(
      "spawner",
      PlayerType.Human,
      "spawn_client",
      "spawn_id",
    );
    game.addPlayer(info);
    const spawner = game.player(info.id);

    expect(game.inSpawnPhase()).toBe(true);

    const executor = new Executor(game, gameID, "spawn_client");
    const exec = executor.createExec(
      spawnIntent("spawn_client" as ClientID, game.ref(40, 40)),
    );

    // In-phase, the intent produces a real spawn execution.
    expect(exec).toBeInstanceOf(SpawnExecution);

    game.addExecution(exec);
    game.executeNextTick();
    game.executeNextTick();
    expect(spawner.hasSpawned()).toBe(true);
    expect(spawner.numTilesOwned()).toBeGreaterThan(0);
  });
});
