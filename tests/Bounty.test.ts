import { BountyExecution } from "../src/core/execution/BountyExecution";
import { MarkDisconnectedExecution } from "../src/core/execution/MarkDisconnectedExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import {
  GameMode,
  PlayerInfo,
  PlayerType,
  type Execution,
  type GameUpdates,
  type Player,
} from "../src/core/game/Game";
import {
  GameUpdateType,
  type BountyCollectedUpdate,
  type BountyPlacedUpdate,
} from "../src/core/game/GameUpdates";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";

// Collects bounty updates from the GameUpdates maps returned by
// game.executeNextTick() across a run of ticks.
function runTicks(
  game: { executeNextTick(): GameUpdates },
  n: number,
): { placed: BountyPlacedUpdate[]; collected: BountyCollectedUpdate[] } {
  const placed: BountyPlacedUpdate[] = [];
  const collected: BountyCollectedUpdate[] = [];
  for (let i = 0; i < n; i++) {
    const updates = game.executeNextTick();
    placed.push(
      ...((updates[GameUpdateType.BountyPlacedEvent] ?? []) as BountyPlacedUpdate[]),
    );
    collected.push(
      ...((updates[GameUpdateType.BountyCollectedEvent] ?? []) as BountyCollectedUpdate[]),
    );
  }
  return { placed, collected };
}

describe("Bounty market", () => {
  it("should pool a bounty and expose bountyTotal", async () => {
    const gameID: GameID = "game_id";
    const game = await setup("ocean_and_land", {
      infiniteGold: false,
      bountiesEnabled: true,
    });

    const placerInfo = new PlayerInfo("placer", PlayerType.Human, null, "p1");
    const targetInfo = new PlayerInfo("target", PlayerType.Human, null, "p2");
    game.addPlayer(placerInfo);
    game.addPlayer(targetInfo);
    const placer = game.player(placerInfo.id);
    const target = game.player(targetInfo.id);

    game.addExecution(
      new SpawnExecution(gameID, placerInfo, game.ref(2, 4)),
      new SpawnExecution(gameID, targetInfo, game.ref(2, 8)),
    );
    game.executeNextTick();

    placer.addGold(10_000n);
    const placerGoldBefore = placer.gold();
    game.addExecution(new BountyExecution(placer, targetInfo.id, 5_000));
    const { placed } = runTicks(game, 2);

    expect(game.bountyTotal(target)).toBe(5_000n);
    // Gold left the placer's balance (passive worker income may offset a
    // little, but the net must be a real debit of ~5k).
    expect(placer.gold()).toBeLessThan(placerGoldBefore - 4_000n);

    expect(placed.length).toBe(1);
    expect(placed[0].placerId).toBe(placer.id());
    expect(placed[0].targetId).toBe(target.id());
    expect(placed[0].amount).toBe(5_000n);
    expect(placed[0].totalPool).toBe(5_000n);
  });

  it("should merge contributions from multiple placers", async () => {
    const gameID: GameID = "game_id";
    const game = await setup("ocean_and_land", {
      infiniteGold: false,
      bountiesEnabled: true,
    });

    const aInfo = new PlayerInfo("a", PlayerType.Human, null, "a");
    const bInfo = new PlayerInfo("b", PlayerType.Human, null, "b");
    const targetInfo = new PlayerInfo("target", PlayerType.Human, null, "t");
    game.addPlayer(aInfo);
    game.addPlayer(bInfo);
    game.addPlayer(targetInfo);
    const a = game.player(aInfo.id);
    const b = game.player(bInfo.id);
    const target = game.player(targetInfo.id);

    game.addExecution(
      new SpawnExecution(gameID, aInfo, game.ref(2, 4)),
      new SpawnExecution(gameID, bInfo, game.ref(2, 6)),
      new SpawnExecution(gameID, targetInfo, game.ref(2, 8)),
    );
    game.executeNextTick();

    a.addGold(20_000n);
    b.addGold(20_000n);
    game.addExecution(new BountyExecution(a, targetInfo.id, 5_000));
    game.executeNextTick();
    game.executeNextTick();
    game.addExecution(new BountyExecution(b, targetInfo.id, 7_000));
    game.executeNextTick();
    game.executeNextTick();

    expect(game.bountyTotal(target)).toBe(12_000n);
  });

  it("should reject self-bounties, disabled config, and sub-minimum amounts", async () => {
    const gameID: GameID = "game_id";
    const game = await setup("ocean_and_land", {
      infiniteGold: false,
      bountiesEnabled: true,
    });

    const p1Info = new PlayerInfo("p1", PlayerType.Human, null, "p1");
    const p2Info = new PlayerInfo("p2", PlayerType.Human, null, "p2");
    game.addPlayer(p1Info);
    game.addPlayer(p2Info);
    const p1 = game.player(p1Info.id);
    const p2 = game.player(p2Info.id);

    game.addExecution(
      new SpawnExecution(gameID, p1Info, game.ref(2, 4)),
      new SpawnExecution(gameID, p2Info, game.ref(2, 8)),
    );
    game.executeNextTick();

    p1.addGold(50_000n);

    // Self-bounty rejected by canPlaceBounty gate.
    game.addExecution(new BountyExecution(p1, p1Info.id, 5_000));
    game.executeNextTick();
    game.executeNextTick();
    expect(game.bountyTotal(p1)).toBe(0n);

    // Sub-minimum amounts warn and do not pool.
    game.addExecution(new BountyExecution(p1, p2Info.id, 100));
    game.executeNextTick();
    game.executeNextTick();
    expect(game.bountyTotal(p2)).toBe(0n);
  });

  it("should be disabled when bountiesEnabled is false", async () => {
    const gameID: GameID = "game_id";
    const game = await setup("ocean_and_land", {
      infiniteGold: false,
      bountiesEnabled: false,
    });

    const p1Info = new PlayerInfo("p1", PlayerType.Human, null, "p1");
    const p2Info = new PlayerInfo("p2", PlayerType.Human, null, "p2");
    game.addPlayer(p1Info);
    game.addPlayer(p2Info);
    const p1 = game.player(p1Info.id);
    const p2 = game.player(p2Info.id);

    game.addExecution(
      new SpawnExecution(gameID, p1Info, game.ref(2, 4)),
      new SpawnExecution(gameID, p2Info, game.ref(2, 8)),
    );
    game.executeNextTick();

    p1.addGold(10_000n);
    game.addExecution(new BountyExecution(p1, p2Info.id, 5_000));
    game.executeNextTick();
    game.executeNextTick();

    expect(game.bountyTotal(p2)).toBe(0n);
  });

  it("should pay the pool to the conqueror on the killing blow", async () => {
    const gameID: GameID = "game_id";
    const game = await setup("ocean_and_land", {
      infiniteGold: false,
      bountiesEnabled: true,
    });

    const placerInfo = new PlayerInfo("placer", PlayerType.Human, null, "p1");
    const killerInfo = new PlayerInfo("killer", PlayerType.Human, null, "k");
    const victimInfo = new PlayerInfo("victim", PlayerType.Human, null, "v");
    game.addPlayer(placerInfo);
    game.addPlayer(killerInfo);
    game.addPlayer(victimInfo);
    const placer = game.player(placerInfo.id);
    const killer = game.player(killerInfo.id);
    const victim = game.player(victimInfo.id);

    game.addExecution(
      new SpawnExecution(gameID, placerInfo, game.ref(2, 4)),
      new SpawnExecution(gameID, killerInfo, game.ref(2, 6)),
      new SpawnExecution(gameID, victimInfo, game.ref(2, 8)),
    );
    game.executeNextTick();

    placer.addGold(10_000n);
    game.addExecution(new BountyExecution(placer, victimInfo.id, 5_000));
    runTicks(game, 2);
    expect(game.bountyTotal(victim)).toBe(5_000n);

    // The killing blow: conquerPlayer is the single choke-point both attack
    // and encirclement deaths route through. Call it MID-TICK via a tiny
    // execution wrapper — GameImpl resets the per-tick update buffer at the
    // start of executeNextTick, so updates emitted between ticks (direct
    // calls) would be wiped. Real callers (AttackExecution etc.) only ever
    // invoke it mid-tick, so this mirrors production.
    class ConquerOnce implements Execution {
      private done = false;
      constructor(private killer: Player, private victim: Player) {}
      init(): void {}
      tick(): void {
        if (this.done) return;
        this.done = true;
        game.conquerPlayer(this.killer, this.victim);
      }
      isActive(): boolean {
        return !this.done;
      }
      activeDuringSpawnPhase(): boolean {
        return true;
      }
    }
    const killerGoldBefore = killer.gold();
    game.addExecution(new ConquerOnce(killer, victim));
    // First tick inits the wrapper execution; the second runs its tick,
    // which is where the conquest (and the bounty payout) happens.
    const { collected } = runTicks(game, 2);

    expect(game.bountyTotal(victim)).toBe(0n);
    expect(killer.gold()).toBeGreaterThanOrEqual(killerGoldBefore + 5_000n);

    expect(collected.length).toBe(1);
    expect(collected[0].collectorId).toBe(killer.id());
    expect(collected[0].targetId).toBe(victim.id());
    expect(collected[0].amount).toBe(5_000n);
  });

  it("should refund contributors when the target dies with no conqueror", async () => {
    const gameID: GameID = "game_id";
    const game = await setup("ocean_and_land", {
      infiniteGold: false,
      bountiesEnabled: true,
    });

    const placerInfo = new PlayerInfo("placer", PlayerType.Human, null, "p1");
    const targetInfo = new PlayerInfo("target", PlayerType.Human, null, "p2");
    game.addPlayer(placerInfo);
    game.addPlayer(targetInfo);
    const placer = game.player(placerInfo.id);
    const target = game.player(targetInfo.id);

    game.addExecution(
      new SpawnExecution(gameID, placerInfo, game.ref(2, 4)),
      new SpawnExecution(gameID, targetInfo, game.ref(2, 8)),
    );
    game.executeNextTick();

    placer.addGold(10_000n);
    game.addExecution(new BountyExecution(placer, targetInfo.id, 5_000));
    game.executeNextTick();
    game.executeNextTick();
    expect(game.bountyTotal(target)).toBe(5_000n);

    const placerGoldBefore = placer.gold();
    game.refundBounties(target);
    expect(game.bountyTotal(target)).toBe(0n);
    expect(placer.gold()).toBe(placerGoldBefore + 5_000n);

    // Second refund is a no-op (pool was drained).
    game.refundBounties(target);
    expect(placer.gold()).toBe(placerGoldBefore + 5_000n);
  });

  it("should enforce the per-target placement cooldown", async () => {
    const gameID: GameID = "game_id";
    const game = await setup("ocean_and_land", {
      infiniteGold: false,
      bountiesEnabled: true,
    });

    const p1Info = new PlayerInfo("p1", PlayerType.Human, null, "p1");
    const p2Info = new PlayerInfo("p2", PlayerType.Human, null, "p2");
    game.addPlayer(p1Info);
    game.addPlayer(p2Info);
    const p1 = game.player(p1Info.id);
    const p2 = game.player(p2Info.id);

    game.addExecution(
      new SpawnExecution(gameID, p1Info, game.ref(2, 4)),
      new SpawnExecution(gameID, p2Info, game.ref(2, 8)),
    );
    game.executeNextTick();

    p1.addGold(100_000n);
    game.addExecution(new BountyExecution(p1, p2Info.id, 5_000));
    game.executeNextTick();
    game.executeNextTick();
    expect(game.bountyTotal(p2)).toBe(5_000n);

    // Immediately placing again is blocked by the cooldown (50*10 ticks).
    game.addExecution(new BountyExecution(p1, p2Info.id, 5_000));
    game.executeNextTick();
    game.executeNextTick();
    expect(game.bountyTotal(p2)).toBe(5_000n);

    // Different target is not blocked by the first placement.
    const p3Info = new PlayerInfo("p3", PlayerType.Human, null, "p3");
    game.addPlayer(p3Info);
    game.addExecution(new SpawnExecution(gameID, p3Info, game.ref(2, 10)));
    game.executeNextTick();
    const p3 = game.player(p3Info.id);
    game.addExecution(new BountyExecution(p1, p3Info.id, 5_000));
    game.executeNextTick();
    game.executeNextTick();
    expect(game.bountyTotal(p3)).toBe(5_000n);
  });

  it("should reject bounties on teammates", async () => {
    const gameID: GameID = "game_id";
    // Team mode with both humans pinned to team slot 0 -> same team, so
    // isOnSameTeam is true and the bounty gate must reject. Humans must be
    // passed to setup() itself: team assignment happens at addPlayers() time
    // during game construction, not for post-hoc addPlayer() calls.
    const t1Info = new PlayerInfo(
      "t1",
      PlayerType.Human,
      "t1",
      "t1",
      false,
      null,
      [],
      0,
    );
    const t2Info = new PlayerInfo(
      "t2",
      PlayerType.Human,
      "t2",
      "t2",
      false,
      null,
      [],
      0,
    );
    const game = await setup(
      "ocean_and_land",
      {
        infiniteGold: false,
        bountiesEnabled: true,
        gameMode: GameMode.Team,
        playerTeams: 2,
      },
      [t1Info, t2Info],
    );

    const t1 = game.player(t1Info.id);
    const t2 = game.player(t2Info.id);

    game.addExecution(
      new SpawnExecution(gameID, t1Info, game.ref(2, 4)),
      new SpawnExecution(gameID, t2Info, game.ref(2, 6)),
    );
    game.executeNextTick();

    t1.addGold(10_000n);
    expect(t1.isOnSameTeam(t2)).toBe(true);
    expect(game.canPlaceBounty(t1, t2)).toBe(false);

    // And the execution itself no-ops.
    game.addExecution(new BountyExecution(t1, t2Info.id, 5_000));
    game.executeNextTick();
    game.executeNextTick();
    expect(game.bountyTotal(t2)).toBe(0n);
  });

  it("should reject bounties on disconnected players", async () => {
    const gameID: GameID = "game_id";
    const game = await setup("ocean_and_land", {
      infiniteGold: false,
      bountiesEnabled: true,
    });

    const p1Info = new PlayerInfo("p1", PlayerType.Human, null, "p1");
    const p2Info = new PlayerInfo("p2", PlayerType.Human, null, "p2");
    game.addPlayer(p1Info);
    game.addPlayer(p2Info);
    const p1 = game.player(p1Info.id);
    const p2 = game.player(p2Info.id);

    game.addExecution(
      new SpawnExecution(gameID, p1Info, game.ref(2, 4)),
      new SpawnExecution(gameID, p2Info, game.ref(2, 6)),
    );
    // Two ticks: spawn lands on the second (SpawnExecution inits on tick 1,
    // tiles materialize after). Asserting earlier sees 0-tile players.
    game.executeNextTick();
    game.executeNextTick();
    expect(p1.isAlive()).toBe(true);
    expect(p2.isAlive()).toBe(true);

    // Sanity: gate passes while the target is connected.
    p1.addGold(10_000n);
    expect(game.canPlaceBounty(p1, p2)).toBe(true);

    // Disconnect the target: a bounty on them would be free money for
    // whoever reaches them first, so the gate must refuse.
    game.addExecution(new MarkDisconnectedExecution(p2, true));
    game.executeNextTick();
    expect(p2.isDisconnected()).toBe(true);
    expect(game.canPlaceBounty(p1, p2)).toBe(false);

    game.addExecution(new BountyExecution(p1, p2Info.id, 5_000));
    game.executeNextTick();
    game.executeNextTick();
    expect(game.bountyTotal(p2)).toBe(0n);
  });
});
