/**
 * The worker→main tick payload: per-tick numeric stat churn travels on the
 * transferable `packedPlayerUpdates` quad buffer (drained from GameImpl),
 * and `playerNameViewData` is attached only on ticks where the worker
 * recomputed name placements. See GameUpdateViewData in GameUpdates.ts.
 */
import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
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

  test("snapshotViewData emits full state and subsequent tick retains partial updates", () => {
    tick(); // 1
    tick(); // 2
    game.endSpawnPhase();
    tick(); // 3

    const alice = game.player("alice_id");
    const city = alice.buildUnit(UnitType.City, game.ref(10, 10), {});

    const bobInfo = new PlayerInfo(
      "bob",
      PlayerType.Human,
      "bob_client",
      "bob_id",
    );
    game.addPlayer(bobInfo);
    expect(game.player("bob_id").isAlive()).toBe(false);

    const runner = new GameRunner(
      game,
      new Executor(game, gameID, "alice_client"),
      (gu) => {
        if (!("errMsg" in gu)) byTick.set(gu.tick, gu);
      },
    );

    const snapshotView = runner.snapshotViewData();
    expect(snapshotView.updates[GameUpdateType.Player].length).toBeGreaterThan(
      0,
    );
    const alicePu = snapshotView.updates[GameUpdateType.Player].find(
      (p) => p.id === "alice_id",
    );
    expect(alicePu).toBeDefined();
    expect(alicePu!.name).toBe("alice");
    expect(alicePu!.smallID).toBe(alice.smallID());

    const bobPu = snapshotView.updates[GameUpdateType.Player].find(
      (p) => p.id === "bob_id",
    );
    expect(bobPu).toBeDefined();
    expect(bobPu!.name).toBe("bob");
    expect(bobPu!.isAlive).toBe(false);

    const cityUu = snapshotView.updates[GameUpdateType.Unit].find(
      (u) => u.id === city.id(),
    );
    expect(cityUu).toBeDefined();
    expect(cityUu!.unitType).toBe(UnitType.City);

    // On the subsequent tick, no non-churn fields changed, so partial updates are retained
    alice.addGold(500n);
    runner.addTurn({ turnNumber: game.ticks(), intents: [] });
    runner.executeNextTick();

    const nextGu = byTick.get(game.ticks())!;
    const nextPlayerUpdates = nextGu.updates[GameUpdateType.Player];
    // Alice's static fields are omitted in partial update diff
    expect(nextPlayerUpdates.find((u) => u.id === "alice_id")).toBeUndefined();
  });
});
