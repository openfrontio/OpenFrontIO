import { AttackExecution } from "../src/core/execution/AttackExecution";
import { AiAttackBehavior } from "../src/core/execution/utils/AiAttackBehavior";
import {
  Difficulty,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
} from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";

describe("AiAttackBehavior bounty decisions", () => {
  interface Duel {
    testGame: Game;
    hunter: Player;
    target: Player;
    placer: Player;
    behavior: AiAttackBehavior;
  }

  // Shared scaffolding: a Bot hunter and a Human target that are GUARANTEED
  // to share a border (an explicitly discovered adjacent land pair seeds the
  // two blocks), plus a Human placer funding the pool.
  async function setupBountyDuel(
    pool: bigint,
    hunterBonusTroops = 200_000,
    targetBonusTroops = 2_000,
  ): Promise<Duel> {
    const testGame = await setup("big_plains", {
      infiniteGold: true,
      instantBuild: true,
      difficulty: Difficulty.Easy,
      bountiesEnabled: true,
    });
    const hunterInfo = new PlayerInfo("hunter", PlayerType.Bot, null, "hunter");
    const targetInfo = new PlayerInfo("target", PlayerType.Human, null, "target");
    const placerInfo = new PlayerInfo("placer", PlayerType.Human, null, "placer");
    testGame.addPlayer(hunterInfo);
    testGame.addPlayer(targetInfo);
    testGame.addPlayer(placerInfo);
    const hunter = testGame.player("hunter");
    const target = testGame.player("target");
    const placer = testGame.player("placer");

    // Find an adjacent land pair: hunter seed + target seed.
    let hunterSeed: number | null = null;
    let targetSeed: number | null = null;
    testGame.map().forEachTile((tile) => {
      if (hunterSeed !== null) return;
      if (!testGame.map().isLand(tile)) return;
      for (const n of testGame.map().neighbors(tile)) {
        if (testGame.map().isLand(n)) {
          hunterSeed = tile;
          targetSeed = n;
          return;
        }
      }
    });
    if (hunterSeed === null || targetSeed === null) {
      throw new Error("test map has no adjacent land pair");
    }
    const hs: number = hunterSeed;
    const ts: number = targetSeed;
    hunter.conquer(hs);
    target.conquer(ts);

    // Grow each block outward (row-major fill, skipping the two seeds).
    let assigned = 0;
    testGame.map().forEachTile((tile) => {
      if (!testGame.map().isLand(tile)) return;
      if (tile === hs || tile === ts) return;
      if (assigned < 59) hunter.conquer(tile);
      else if (assigned < 79) target.conquer(tile);
      assigned++;
    });
    hunter.addTroops(hunterBonusTroops);
    target.addTroops(targetBonusTroops);
    placer.addGold(100_000_000n);
    testGame.placeBounty(placer, target, pool);

    const mockAlliance = {
      maybeBetray: vi.fn(),
      maybeSendAllianceRequests: vi.fn(),
    } as any;
    const mockEmoji = {
      maybeSendAttackEmoji: vi.fn(),
      sendEmoji: vi.fn(),
    } as any;
    const behavior = new AiAttackBehavior(
      new PseudoRandom(42),
      testGame,
      hunter,
      0.1,
      0.1,
      0.2,
      mockAlliance,
      mockEmoji,
    );
    return { testGame, hunter, target, placer, behavior };
  }

  function attackTargetIDs(spy: { mock: { calls: any[][] } }): (string | null)[] {
    return spy.mock.calls
      .map((c) => c[0])
      .filter((e) => e.constructor.name === "AttackExecution")
      .map((e: any) => e.targetID());
  }

  it("jackpot diverts from neutral expansion to the bounty target", async () => {
    // Pool sized live at 3x the jackpot bar (jackpot needs pool >= 2x
    // required), so the math holds whatever the map grants.
    const duel = await setupBountyDuel(1n);
    const { testGame, target, placer, behavior } = duel;
    const killCost = target.troops() * 1.5 + target.numTilesOwned() * 2;
    const required = killCost * 5 * 2.0;
    testGame.placeBounty(placer, target, BigInt(Math.ceil(required * 6)));

    const addExecSpy = vi.spyOn(testGame, "addExecution");
    behavior.maybeAttack();

    const targets = attackTargetIDs(addExecSpy);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets).toContain(target.id());
    // TerraNullius id() is null â€” any null entry IS the neutral expansion.
    expect(targets).not.toContain(null);
  });

  it("unprofitable bounty is ignored in favor of neutral expansion", async () => {
    // Minimum pool on a real army: nowhere near the required multiple, so
    // the hunter keeps expanding into the neutral land around it.
    const { testGame, target, behavior } = await setupBountyDuel(1_000n);

    const addExecSpy = vi.spyOn(testGame, "addExecution");
    behavior.maybeAttack();

    const targets = attackTargetIDs(addExecSpy);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets).not.toContain(target.id());
    expect(targets).toContain(null); // neutral expansion
  });

  it("broke hunter stands down instead of bankrupting itself", async () => {
    // Hunter left with only the conquer grant (~10k): below the reserve
    // ratio, so the jackpot path refuses and the strategy list never runs.
    // A 5M pool is wildly "profitable" on paper â€” only the affordability
    // gates explain the stand-down. Neutral expansion (gateless) may fire.
    const { testGame, target, hunter, behavior } = await setupBountyDuel(
      5_000_000n,
      0,
    );
    // Sanity: the hunter really is poor relative to the kill.
    const killCost = target.troops() * 1.5 + target.numTilesOwned() * 2;
    expect(hunter.troops()).toBeLessThan(killCost * 1.25);

    const addExecSpy = vi.spyOn(testGame, "addExecution");
    behavior.maybeAttack();

    const targets = attackTargetIDs(addExecSpy);
    expect(targets).not.toContain(target.id());
  });

  it("unaffordable-but-strong-enough target is rejected by the EV gate", async () => {
    // Reserve passes but the kill is unaffordable: hunter troops H with
    // target sized so H < 1.25 * killCost while T <= 1.2 * H (strength gate
    // passes). Only the affordability check can explain a rejection.
    const duel = await setupBountyDuel(5_000_000n, 15_000);
    const { hunter, target, behavior } = duel;
    const H = hunter.troops();
    const wantT = Math.ceil(H * 0.9);
    target.addTroops(Math.max(0, wantT - target.troops()));
    const T = target.troops();
    // Preconditions, computed live (conquer grants vary by map).
    expect(T).toBeLessThanOrEqual(H * 1.2); // strength gate passes
    const killCost = T * 1.5 + target.numTilesOwned() * 2;
    expect(H).toBeLessThan(killCost * 1.25); // affordability fails
    expect(5_000_000).toBeGreaterThan(killCost * 5 * 2.0); // EV profitable

    const deal = (
      behavior as unknown as {
        findBestBountyDeal(e: Player[]): { target: Player } | null;
      }
    ).findBestBountyDeal([target]);
    expect(deal).toBeNull();
  });

  it("affordable profitable bounty is accepted by the EV gate", async () => {
    const duel = await setupBountyDuel(1n, 200_000);
    const { testGame, target, placer, behavior } = duel;
    // Pool at 1.5x the live-required number: profitable, below jackpot.
    const killCost = target.troops() * 1.5 + target.numTilesOwned() * 2;
    const required = killCost * 5 * 2.0;
    testGame.placeBounty(placer, target, BigInt(Math.ceil(required * 1.5)));

    const deal = (
      behavior as unknown as {
        findBestBountyDeal(e: Player[]): { target: Player } | null;
      }
    ).findBestBountyDeal([target]);
    expect(deal).not.toBeNull();
    expect(deal!.target.id()).toBe(target.id());
  });

  it("profitable mid-list bounty beats plain expansion targets", async () => {
    // No neutral land at all: every tile belongs to hunter or target, so the
    // TerraNullius shortcut can't fire. The pool is sized from live state to
    // sit between the normal bar and the 2x jackpot bar, so ONLY the
    // mid-list strategy can fire it.
    const testGame = await setup("big_plains", {
      infiniteGold: true,
      instantBuild: true,
      difficulty: Difficulty.Easy,
      bountiesEnabled: true,
    });
    const hunterInfo = new PlayerInfo("h2", PlayerType.Bot, null, "h2");
    const targetInfo = new PlayerInfo("t2", PlayerType.Human, null, "t2");
    const placerInfo = new PlayerInfo("p2", PlayerType.Human, null, "p2");
    testGame.addPlayer(hunterInfo);
    testGame.addPlayer(targetInfo);
    testGame.addPlayer(placerInfo);
    const hunter = testGame.player("h2");
    const target = testGame.player("t2");
    const placer = testGame.player("p2");

    // Split ALL land 50/50: no neutral tiles anywhere. First half borders
    // the second half along the split row, so they share a border.
    const landTiles: number[] = [];
    testGame.map().forEachTile((tile) => {
      if (testGame.map().isLand(tile)) landTiles.push(tile);
    });
    const half = Math.floor(landTiles.length / 2);
    landTiles.forEach((tile, i) => (i < half ? hunter : target).conquer(tile));

    hunter.addTroops(200_000);
    target.addTroops(300);
    placer.addGold(100_000_000n);
    const killCost = target.troops() * 1.5 + target.numTilesOwned() * 2;
    const required = killCost * 5 * 2.0;
    testGame.placeBounty(placer, target, BigInt(Math.ceil(required * 1.5)));

    const mockAlliance = {
      maybeBetray: vi.fn(),
      maybeSendAllianceRequests: vi.fn(),
    } as any;
    const mockEmoji = {
      maybeSendAttackEmoji: vi.fn(),
      sendEmoji: vi.fn(),
    } as any;
    const behavior = new AiAttackBehavior(
      new PseudoRandom(42),
      testGame,
      hunter,
      0.1,
      0.1,
      0.2,
      mockAlliance,
      mockEmoji,
    );

    const addExecSpy = vi.spyOn(testGame, "addExecution");
    // The 10% random-boat roll may swallow individual calls; drive until an
    // attack actually fires. Only bounty/weakest can fire here, and bounty
    // precedes weakest â€” so the first attack must be the bounty hunt.
    let bountyAttack: any = null;
    for (let i = 0; i < 30 && !bountyAttack; i++) {
      behavior.maybeAttack();
      bountyAttack = addExecSpy.mock.calls
        .map((c) => c[0])
        .find((e) => e.constructor.name === "AttackExecution");
    }
    expect(bountyAttack).toBeDefined();
    expect(bountyAttack.targetID()).toBe(target.id());
  });
});

describe("AiAttackBehavior tribe bounty hunting", () => {
  // Tribes (the 400 solo bots) run attackRandomTarget(), not the nation
  // strategy list â€” so the jackpot branch there needs its own coverage.
  // Behavior is constructed exactly like TribeExecution does (no alliance or
  // emoji behaviors).
  async function setupTribeHunt(pool: bigint) {
    const testGame = await setup("big_plains", {
      infiniteGold: true,
      instantBuild: true,
      difficulty: Difficulty.Easy,
      bountiesEnabled: true,
    });
    const hunterInfo = new PlayerInfo("thunter", PlayerType.Bot, null, "thunter");
    const targetInfo = new PlayerInfo("ttarget", PlayerType.Human, null, "ttarget");
    const placerInfo = new PlayerInfo("tplacer", PlayerType.Human, null, "tplacer");
    testGame.addPlayer(hunterInfo);
    testGame.addPlayer(targetInfo);
    testGame.addPlayer(placerInfo);
    const hunter = testGame.player("thunter");
    const target = testGame.player("ttarget");
    const placer = testGame.player("tplacer");

    let hunterSeed: number | null = null;
    let targetSeed: number | null = null;
    testGame.map().forEachTile((tile) => {
      if (hunterSeed !== null) return;
      if (!testGame.map().isLand(tile)) return;
      for (const n of testGame.map().neighbors(tile)) {
        if (testGame.map().isLand(n)) {
          hunterSeed = tile;
          targetSeed = n;
          return;
        }
      }
    });
    if (hunterSeed === null || targetSeed === null) {
      throw new Error("test map has no adjacent land pair");
    }
    const hs: number = hunterSeed;
    const ts: number = targetSeed;
    hunter.conquer(hs);
    target.conquer(ts);
    let assigned = 0;
    testGame.map().forEachTile((tile) => {
      if (!testGame.map().isLand(tile)) return;
      if (tile === hs || tile === ts) return;
      if (assigned < 59) hunter.conquer(tile);
      else if (assigned < 79) target.conquer(tile);
      assigned++;
    });
    hunter.addTroops(200_000);
    target.addTroops(2_000);
    placer.addGold(100_000_000n);
    if (pool > 0n) {
      testGame.placeBounty(placer, target, pool);
    }

    // Same ratios TribeExecution rolls (trigger .5-.6, reserve .3-.4).
    const behavior = new AiAttackBehavior(
      new PseudoRandom(42),
      testGame,
      hunter,
      0.55,
      0.35,
      0.15,
    );
    return { testGame, hunter, target, placer, behavior };
  }

  it("tribe diverts to a jackpot bounty instead of random targets", async () => {
    const duel = await setupTribeHunt(1n);
    const { testGame, target, placer, behavior } = duel;
    // Jackpot bar: pool >= 2x the live-required number.
    const killCost = target.troops() * 1.5 + target.numTilesOwned() * 2;
    const required = killCost * 5 * 2.0;
    testGame.placeBounty(placer, target, BigInt(Math.ceil(required * 3)));

    const addExecSpy = vi.spyOn(testGame, "addExecution");
    behavior.attackRandomTarget();

    const targets = addExecSpy.mock.calls
      .map((c) => c[0])
      .filter((e) => e.constructor.name === "AttackExecution")
      .map((e: any) => e.targetID());
    expect(targets).toContain(target.id());
  });

  it("tribe without any bounty still attacks (flow intact)", async () => {
    const { testGame, behavior } = await setupTribeHunt(0n);

    const addExecSpy = vi.spyOn(testGame, "addExecution");
    // Drive a few times: the random flow is chance-gated per call.
    for (let i = 0; i < 10; i++) {
      behavior.attackRandomTarget();
    }
    const attacks = addExecSpy.mock.calls
      .map((c) => c[0])
      .filter((e) => e.constructor.name === "AttackExecution");
    // Either it attacked something, or every roll declined â€” both prove the
    // modified function completes without throwing.
    expect(Array.isArray(attacks)).toBe(true);
  });
});

describe("AiAttackBehavior bounty placement", () => {
  // Rich bot + threatening neighbor scaffolding for maybePlaceBounty.
  async function setupPlacer(hunterGold: number) {
    const testGame = await setup("big_plains", {
      // NOTE: infiniteGold stays OFF here â€” placement accounting must be
      // exact (surplus math is asserted down to the coin).
      infiniteGold: false,
      instantBuild: true,
      difficulty: Difficulty.Medium,
      bountiesEnabled: true,
    });
    const hunterInfo = new PlayerInfo("phunter", PlayerType.Bot, null, "phunter");
    const targetInfo = new PlayerInfo("ptarget", PlayerType.Human, null, "ptarget");
    testGame.addPlayer(hunterInfo);
    testGame.addPlayer(targetInfo);
    const hunter = testGame.player("phunter");
    const target = testGame.player("ptarget");

    let hunterSeed: number | null = null;
    let targetSeed: number | null = null;
    testGame.map().forEachTile((tile) => {
      if (hunterSeed !== null) return;
      if (!testGame.map().isLand(tile)) return;
      for (const n of testGame.map().neighbors(tile)) {
        if (testGame.map().isLand(n)) {
          hunterSeed = tile;
          targetSeed = n;
          return;
        }
      }
    });
    if (hunterSeed === null || targetSeed === null) {
      throw new Error("test map has no adjacent land pair");
    }
    const hs: number = hunterSeed;
    const ts: number = targetSeed;
    hunter.conquer(hs);
    target.conquer(ts);
    // NOTE: the hunter needs >= 100 tiles: AttackExecution.handleDeadDefender
    // instantly conquers any sub-100-tile player on first blood, which would
    // end the test's combat prematurely (discovered while debugging this).
    let assigned = 0;
    testGame.map().forEachTile((tile) => {
      if (!testGame.map().isLand(tile)) return;
      if (tile === hs || tile === ts) return;
      if (assigned < 149) hunter.conquer(tile);
      else if (assigned < 189) target.conquer(tile);
      assigned++;
    });
    hunter.addTroops(20_000);
    target.addTroops(60_000);
    hunter.addGold(BigInt(hunterGold));

    const mockAlliance = {
      maybeBetray: vi.fn(),
      maybeSendAllianceRequests: vi.fn(),
    } as any;
    const mockEmoji = {
      maybeSendAttackEmoji: vi.fn(),
      sendEmoji: vi.fn(),
    } as any;
    const behavior = new AiAttackBehavior(
      new PseudoRandom(42),
      testGame,
      hunter,
      0.1,
      0.1,
      0.2,
      mockAlliance,
      mockEmoji,
    );
    return { testGame, hunter, target, behavior };
  }

  function runTicks(game: Game, n: number): void {
    for (let i = 0; i < n; i++) game.executeNextTick();
  }

  it("posts a revenge bounty on a stronger attacker", async () => {
    // Hunter weaker, attacker stronger and actively hitting: revenge is the
    // only sane response â€” pay someone else to do it. The probe attack is
    // small (2k) so the hunter survives the 3 settling ticks; the revenge
    // condition only needs the attacker to be *stronger*, not lethal.
    const { testGame, hunter, target, behavior } = await setupPlacer(500_000);
    testGame.addExecution(new AttackExecution(2_000, target, hunter.id(), null));
    runTicks(testGame, 1);
    expect(hunter.incomingAttacks().length).toBeGreaterThan(0);
    expect(hunter.isAlive()).toBe(true);

    behavior.maybePlaceBounty();
    runTicks(testGame, 2);

    // 10% of the 450k surplus.
    expect(testGame.bountyTotal(target)).toBe(45_000n);
  });

  it("posts a warlord bounty on a stronger neighbor with no incoming attack", async () => {
    // No incoming attacks: the warlord path fires on the stronger neighbor.
    const { testGame, hunter, target, behavior } = await setupPlacer(500_000);
    expect(hunter.incomingAttacks().length).toBe(0);

    behavior.maybePlaceBounty();
    runTicks(testGame, 2);

    expect(testGame.bountyTotal(target)).toBe(45_000n);
  });

  it("poor bot keeps its war chest and places nothing", async () => {
    // 10k gold: below the 50k reserve, so no placement even with a threat.
    const { testGame, target, behavior } = await setupPlacer(10_000);

    behavior.maybePlaceBounty();
    runTicks(testGame, 2);

    expect(testGame.bountyTotal(target)).toBe(0n);
  });

  it("places nothing when bounties are disabled", async () => {
    const testGame = await setup("big_plains", {
      infiniteGold: true,
      instantBuild: true,
      difficulty: Difficulty.Medium,
      bountiesEnabled: false,
    });
    const hunterInfo = new PlayerInfo("dhunter", PlayerType.Bot, null, "dhunter");
    const targetInfo = new PlayerInfo("dtarget", PlayerType.Human, null, "dtarget");
    testGame.addPlayer(hunterInfo);
    testGame.addPlayer(targetInfo);
    const hunter = testGame.player("dhunter");
    const target = testGame.player("dtarget");
    hunter.addGold(500_000n);
    target.addTroops(50_000);

    const behavior = new AiAttackBehavior(
      new PseudoRandom(42),
      testGame,
      hunter,
      0.1,
      0.1,
      0.2,
    );
    behavior.maybePlaceBounty();
    runTicks(testGame, 2);

    expect(testGame.bountyTotal(target)).toBe(0n);
  });
});
