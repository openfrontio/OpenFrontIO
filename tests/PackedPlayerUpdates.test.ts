/**
 * The worker→main tick payload: per-tick numeric stat churn travels on the
 * transferable `packedPlayerUpdates` quad buffer (drained from GameImpl),
 * and `playerNameViewData` is attached only on ticks where the worker
 * recomputed name placements. See GameUpdateViewData in GameUpdates.ts.
 */
import { Executor } from "../src/core/execution/ExecutionManager";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import {
  GameUpdateType,
  GameUpdateViewData,
} from "../src/core/game/GameUpdates";
import { GameRunner } from "../src/core/GameRunner";
import { setup } from "./util/Setup";

const gameID = "game_id";

describe("packedPlayerUpdates (GameImpl drain)", () => {
  let game: Game;
  let alice: Player;

  beforeEach(async () => {
    game = await setup("plains", {});
    const aliceInfo = new PlayerInfo(
      "alice",
      PlayerType.Human,
      "alice_client",
      "alice_id",
    );
    game.addPlayer(aliceInfo);
    game.addExecution(new SpawnExecution(gameID, aliceInfo, game.ref(10, 10)));
    game.executeNextTick();
    game.executeNextTick();
    alice = game.player("alice_id");
    game.drainPackedPlayerUpdates(); // discard spawn-time churn
  });

  test("a stat change is drained as a [smallID, tiles, gold, troops] quad", () => {
    alice.addGold(500n);
    game.executeNextTick();
    const packed = game.drainPackedPlayerUpdates();
    expect(packed).not.toBeNull();
    // Find alice's quad (other players may have churned too).
    let quad: number[] | undefined;
    for (let i = 0; i + 3 < packed!.length; i += 4) {
      if (packed![i] === alice.smallID()) {
        quad = Array.from(packed!.subarray(i, i + 4));
      }
    }
    expect(quad).toEqual([
      alice.smallID(),
      alice.numTilesOwned(),
      Number(alice.gold()),
      alice.troops(),
    ]);
  });

  test("drain returns null when no stats changed and resets between drains", () => {
    alice.addGold(500n);
    game.executeNextTick();
    expect(game.drainPackedPlayerUpdates()).not.toBeNull();
    // Drained — a second drain without a tick has nothing.
    expect(game.drainPackedPlayerUpdates()).toBeNull();
  });
});

describe("GameRunner payload cadence", () => {
  let game: Game;
  let byTick: Map<number, GameUpdateViewData>;
  let tick: () => void;

  beforeEach(async () => {
    game = await setup(
      "plains",
      {},
      [],
      undefined,
      undefined,
      false, // keep the spawn phase under the test's control
    );
    const aliceInfo = new PlayerInfo(
      "alice",
      PlayerType.Human,
      "alice_client",
      "alice_id",
    );
    game.addPlayer(aliceInfo);
    game.addExecution(new SpawnExecution(gameID, aliceInfo, game.ref(10, 10)));
    byTick = new Map();
    const runner = new GameRunner(
      game,
      new Executor(game, gameID, "alice_client"),
      (gu) => {
        if (!("errMsg" in gu)) byTick.set(gu.tick, gu);
      },
    );
    // No runner.init(): no SpawnTimerExecution — the game stays in the spawn
    // phase until the test ends it manually.
    let turn = 0;
    tick = () => {
      runner.addTurn({ turnNumber: turn++, intents: [] });
      runner.executeNextTick();
    };
  });

  test("playerNameViewData is attached only on placement-rebuild ticks", () => {
    tick(); // 1
    tick(); // 2
    game.endSpawnPhase();
    for (let t = 3; t <= 61; t++) tick();

    // ticks < 3 always rebuild; every 30th tick rebuilds; everything else
    // omits the record. (The in-tick spawn-end rebuild also sets the flag,
    // but ending the spawn phase between ticks doesn't exercise it here.)
    expect(byTick.get(1)!.playerNameViewData).toBeDefined();
    expect(byTick.get(2)!.playerNameViewData).toBeDefined();
    expect(byTick.get(4)!.playerNameViewData).toBeUndefined();
    expect(byTick.get(29)!.playerNameViewData).toBeUndefined();
    expect(byTick.get(30)!.playerNameViewData).toBeDefined();
    expect(byTick.get(31)!.playerNameViewData).toBeUndefined();
    expect(byTick.get(60)!.playerNameViewData).toBeDefined();
  });

  test("stat churn arrives as packedPlayerUpdates quads on the view data", () => {
    tick(); // 1
    tick(); // 2
    game.endSpawnPhase();
    tick(); // 3 — flush spawn churn

    const alice = game.player("alice_id");
    alice.addGold(500n);
    tick(); // 4
    const gu = byTick.get(game.ticks())!;
    const packed = gu.packedPlayerUpdates;
    expect(packed).toBeDefined();
    expect(packed!.length % 4).toBe(0);
    let quad: number[] | undefined;
    for (let i = 0; i + 3 < packed!.length; i += 4) {
      if (packed![i] === alice.smallID()) {
        quad = Array.from(packed!.subarray(i, i + 4));
      }
    }
    expect(quad).toEqual([
      alice.smallID(),
      alice.numTilesOwned(),
      Number(alice.gold()),
      alice.troops(),
    ]);
    // And the object channel no longer carries the stat fields: alice must
    // not appear in this tick's PlayerUpdates for a gold-only change.
    const playerUpdates = gu.updates[GameUpdateType.Player];
    expect(playerUpdates.find((u) => u.id === "alice_id")).toBeUndefined();
  });
});
