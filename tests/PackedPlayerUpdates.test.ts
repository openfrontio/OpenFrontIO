/**
 * The worker→main tick payload: per-tick numeric stat churn travels on the
 * transferable `packedPlayerUpdates` quad buffer (drained from GameImpl),
 * and `playerNameViewData` is attached only on ticks where the worker
 * recomputed name placements. See GameUpdateViewData in GameUpdates.ts.
 */
import { GameType, PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import {
  GameUpdateType,
  GameUpdateViewData,
} from "@openfront/engine-api/game/GameUpdates";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
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

  test("a stat change is drained as a [smallID, tiles, gold, troops, goldEarned] quint", () => {
    alice.addGold(500n);
    game.executeNextTick();
    const packed = game.drainPackedPlayerUpdates();
    expect(packed).not.toBeNull();
    // Find alice's quint (other players may have churned too).
    let quad: number[] | undefined;
    for (let i = 0; i + 4 < packed!.length; i += 5) {
      if (packed![i] === alice.smallID()) {
        quad = Array.from(packed!.subarray(i, i + 5));
      }
    }
    expect(quad).toEqual([
      alice.smallID(),
      alice.numTilesOwned(),
      Number(alice.gold()),
      alice.troops(),
      Number(alice.goldEarned()),
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
    game.endSpawnPhase();
    for (let t = 1; t <= 61; t++) tick();

    // ticks < 3 always rebuild; every 30th tick rebuilds; everything else
    // omits the record. (The in-tick spawn-end rebuild also sets the flag,
    // but ending the spawn phase between ticks doesn't exercise it here.)
    expect(byTick.get(1)!.playerNameViewData).toBeDefined();
    expect(byTick.get(2)!.playerNameViewData).toBeDefined();
    expect(byTick.get(3)!.playerNameViewData).toBeUndefined();
    expect(byTick.get(4)!.playerNameViewData).toBeUndefined();
    expect(byTick.get(29)!.playerNameViewData).toBeUndefined();
    expect(byTick.get(30)!.playerNameViewData).toBeDefined();
    expect(byTick.get(31)!.playerNameViewData).toBeUndefined();
    expect(byTick.get(60)!.playerNameViewData).toBeDefined();
  });

  test("stat churn arrives as packedPlayerUpdates quints on the view data", () => {
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
    expect(packed!.length % 5).toBe(0);
    let quad: number[] | undefined;
    for (let i = 0; i + 4 < packed!.length; i += 5) {
      if (packed![i] === alice.smallID()) {
        quad = Array.from(packed!.subarray(i, i + 5));
      }
    }
    expect(quad).toEqual([
      alice.smallID(),
      alice.numTilesOwned(),
      Number(alice.gold()),
      alice.troops(),
      Number(alice.goldEarned()),
    ]);
    // And the object channel no longer carries the stat fields: alice must
    // not appear in this tick's PlayerUpdates for a gold-only change.
    const playerUpdates = gu.updates[GameUpdateType.Player];
    expect(playerUpdates.find((u) => u.id === "alice_id")).toBeUndefined();
  });

  test("playerNameViewData in spawn phase is dirty-checked on spawn tile changes", () => {
    // In multiplayer/public mode, selecting a spawn tile does not immediately end spawn phase
    game.config().gameConfig().gameType = GameType.Public;

    // Tick 1: Alice has no spawn tile set yet
    tick();
    expect(byTick.get(1)!.playerNameViewData).toBeUndefined();

    // Alice selects a spawn tile during spawn phase
    const alice = game.allPlayers().find((p) => p.id() === "alice_id")!;
    alice.setSpawnTile(game.ref(10, 10));
    tick(); // 2
    expect(byTick.get(2)!.playerNameViewData).toBeDefined();
    expect(byTick.get(2)!.playerNameViewData!["alice_id"]).toBeDefined();

    // Tick 3: spawn tile has not changed, remains in spawn phase
    tick(); // 3
    expect(byTick.get(3)!.playerNameViewData).toBeUndefined();

    // Alice changes spawn tile
    alice.setSpawnTile(game.ref(12, 12));
    tick(); // 4
    expect(byTick.get(4)!.playerNameViewData).toBeDefined();
    expect(byTick.get(4)!.playerNameViewData!["alice_id"]).toBeDefined();

    // Tick 5: spawn tile unchanged
    tick(); // 5
    expect(byTick.get(5)!.playerNameViewData).toBeUndefined();
  });

  test("playerNameViewData prunes eliminated players on rebuild", () => {
    const bobInfo = new PlayerInfo(
      "bob",
      PlayerType.Human,
      "bob_client",
      "bob_id",
    );
    game.addPlayer(bobInfo);
    game.addExecution(new SpawnExecution(gameID, bobInfo, game.ref(25, 25)));

    game.endSpawnPhase();
    tick(); // tick 1
    tick(); // tick 2
    expect(byTick.get(2)!.playerNameViewData).toBeDefined();
    expect(byTick.get(2)!.playerNameViewData!["alice_id"]).toBeDefined();
    expect(byTick.get(2)!.playerNameViewData!["bob_id"]).toBeDefined();

    // Relinquish all of alice's tiles so alice is eliminated (isAlive() === false)
    const alice = game.player("alice_id");
    for (const tile of [...alice.tiles()]) {
      alice.relinquish(tile);
    }
    expect(alice.isAlive()).toBe(false);

    // Tick 30: periodic active-game check triggers rebuild
    for (let t = 3; t <= 30; t++) tick();
    expect(byTick.get(30)!.playerNameViewData).toBeDefined();
    expect(byTick.get(30)!.playerNameViewData!["alice_id"]).toBeUndefined();
    expect(byTick.get(30)!.playerNameViewData!["bob_id"]).toBeDefined();
  });

  test("playerNameViewData is rebuilt when spawn phase ends during a tick", () => {
    game.config().gameConfig().gameType = GameType.Public;

    // Alice selects a spawn tile during spawn phase
    const alice = game.allPlayers().find((p) => p.id() === "alice_id")!;
    alice.setSpawnTile(game.ref(10, 10));
    tick(); // tick 1: in spawn phase, Alice's spawn tile dirty-check triggers placement
    expect(byTick.get(1)!.playerNameViewData).toBeDefined();
    expect(byTick.get(1)!.playerNameViewData!["alice_id"]).toBeDefined();

    // Queue execution to end spawn phase during active tick
    let active = true;
    game.addExecution({
      init: () => {},
      tick: () => {
        game.endSpawnPhase();
        active = false;
      },
      isActive: () => active,
      activeDuringSpawnPhase: () => true,
      snapshot: () => ({} as never),
    });
    tick(); // tick 2: execution inits, Alice tile unchanged in spawn phase -> undefined
    expect(byTick.get(2)!.playerNameViewData).toBeUndefined();

    tick(); // tick 3: execution ticks, ending spawn phase -> spawnJustEnded triggers rebuild
    expect(byTick.get(3)!.playerNameViewData).toBeDefined();

    // Tick 4: active game tick (not < 3 and not % 30 === 0)
    tick(); // tick 4
    expect(byTick.get(4)!.playerNameViewData).toBeUndefined();
  });
});
