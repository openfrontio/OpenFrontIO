// B2 — Situation model: phase, rival trend/trust, border threat, nation rules.
// Everything runs on a real game from tests/util/Setup.ts; the BotContext is a thin view over it (no mocks).
import { AttackExecution } from "../../src/core/execution/AttackExecution";
import { NationExecution } from "../../src/core/execution/NationExecution";
import { BotContext } from "../../src/core/execution/playbook/Context";
import { DEFAULT_PLAYBOOK, PlaybookParams } from "../../src/core/execution/playbook/Params";
import { NATION_RULES } from "../../src/core/execution/playbook/Rivals";
import { Situation, SituationQueries } from "../../src/core/execution/playbook/Situation";
import {
  Cell, Difficulty, Game, Nation, Player, PlayerInfo, PlayerType, UnitType,
} from "../../src/core/game/Game";
import { PseudoRandom } from "../../src/core/PseudoRandom";
import { setup } from "../util/Setup";
import { TestConfig } from "../util/TestConfig";
import { executeTicks } from "../util/utils";

/** A BotContext over a real game for `me`; send/boat are inert (this package only exposes data). */
function context(mg: Game, me: Player, params: Partial<PlaybookParams> = {}): { ctx: BotContext; q: SituationQueries; log: string[] } {
  const log: string[] = [];
  const ctx: BotContext = {
    mg, me, p: { ...DEFAULT_PLAYBOOK, ...params }, random: new PseudoRandom(1),
    sit: undefined as unknown as Situation, // set by read() below
    send: () => 0, boat: () => 0, log: (l) => log.push(l),
  };
  return { ctx, q: new SituationQueries(ctx), log };
}
/** The same picture PlaybookBotExecution.readSituation builds, minus the fields no B2 rule reads. */
function read(ctx: BotContext, q: SituationQueries): Situation {
  const me = ctx.me, troops = me.troops(), cap = q.cap(), t = ctx.mg.ticks();
  const nb = q.neighbours();
  const incoming = me.incomingAttacks().filter((a) => a.attacker().type() !== PlayerType.Bot);
  const reserve = troops * ctx.p.reserveShare;
  const sit: Situation = {
    tick: t, troops, cap, capShare: cap > 0 ? troops / cap : 0, reserve, spendable: Math.max(0, troops - reserve),
    gold: me.gold(), ...nb, incoming, incomingBots: 0, outgoing: me.outgoingAttacks(), tribeAttacks: 0, boats: 0,
    collapsed: [], expiring: [], hold: null, share: 0, threats: [], mode: "grow", phase: "opening", rival: new Map(),
  };
  ctx.sit = sit;
  q.enrich(sit);
  return sit;
}
function addPlayer(mg: Game, id: string, type: PlayerType): Player {
  mg.addPlayer(new PlayerInfo(id, type, null, id));
  return mg.player(id);
}
/** Gives `p` every land tile with x in [x0, x1) and y in [y0, y1). */
function fill(mg: Game, p: Player, x0: number, x1: number, y0 = 0, y1 = mg.height()): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const t = mg.ref(x, y); if (mg.isLand(t)) p.conquer(t); }
}

describe("B2 situation: phase", () => {
  test("opening → consolidate → war → endgame on a scripted plains game", async () => {
    const mg = await setup("plains", { difficulty: Difficulty.Medium });
    const me = addPlayer(mg, "me", PlayerType.Human);
    const rival = addPlayer(mg, "rival", PlayerType.Human);
    fill(mg, me, 40, 60, 40, 60); // a block in the middle, wilderness all round
    me.setTroops(10_000); rival.setTroops(10_000);
    const { ctx, q, log } = context(mg, me);
    expect(read(ctx, q).phase).toBe("opening");
    expect(read(ctx, q).wilderness).toBe(true);

    // all land taken: no wilderness neighbour, no free tile on the landmass; troops well under fightAbove·cap
    fill(mg, me, 0, 50); fill(mg, rival, 50, mg.width());
    executeTicks(mg, 100); // the free-land scan is cached 100 ticks
    me.setTroops(1000); rival.setTroops(1000);
    let sit = read(ctx, q);
    expect(sit.wilderness).toBe(false);
    expect(sit.troops).toBeLessThan(sit.cap * ctx.p.fightAbove);
    expect(sit.phase).toBe("consolidate");

    // a war becomes affordable (fightNotBeforeTick has not passed, so the fightAbove·cap route is the one that fires)
    me.setTroops(Math.ceil(sit.cap * ctx.p.fightAbove) + 1);
    sit = read(ctx, q);
    expect(sit.phase).toBe("war");

    // the rival builds a silo while we are rank ≤ 3 (rank 1 or 2 here): endgame, after the 100-tick rank refresh
    rival.buildUnit(UnitType.MissileSilo, mg.ref(90, 50), {});
    executeTicks(mg, 100);
    me.setTroops(Math.ceil(q.cap() * ctx.p.fightAbove) + 1);
    expect(read(ctx, q).phase).toBe("endgame");

    // every transition was logged, in order
    const phases = log.filter((l) => l.includes(" phase ")).map((l) => l.replace(/^t\d+ phase /, ""));
    expect(phases).toEqual(["opening → consolidate", "consolidate → war", "war → endgame"]);
  });

  test("war when a rival's army is affordable at fightRatio, even below fightAbove", async () => {
    const mg = await setup("plains", { difficulty: Difficulty.Medium });
    const me = addPlayer(mg, "me", PlayerType.Human);
    const rival = addPlayer(mg, "rival", PlayerType.Human);
    fill(mg, me, 0, 50); fill(mg, rival, 50, mg.width());
    const { ctx, q } = context(mg, me, { fightNotBeforeTick: 0 });
    rival.setTroops(1000);
    me.setTroops(Math.ceil(q.cap() * ctx.p.fightAbove) - 5000);
    const sit = read(ctx, q);
    const spendable = sit.troops * (1 - ctx.p.reserveShare);
    expect(rival.troops() * ctx.p.fightRatio + 1000).toBeLessThanOrEqual(spendable * ctx.p.fightMaxShare);
    expect(sit.phase).toBe("war");
    // and not once the war becomes too dear
    rival.setTroops(sit.troops * 10);
    expect(read(ctx, q).phase).toBe("consolidate");
  });

  test("tick 15000 is an endgame floor regardless of the map", async () => {
    const mg = await setup("plains", { difficulty: Difficulty.Medium });
    const me = addPlayer(mg, "me", PlayerType.Human);
    fill(mg, me, 40, 60, 40, 60);
    const { ctx, q } = context(mg, me);
    expect(read(ctx, q).phase).toBe("opening");
    vi.spyOn(mg, "ticks").mockReturnValue(15000);
    expect(read(ctx, q).phase).toBe("endgame");
  });
});

describe("B2 situation: rivals", () => {
  test("borderTiles and bsr on a two-player split of the plains", async () => {
    const mg = await setup("plains");
    const me = addPlayer(mg, "me", PlayerType.Human);
    const rival = addPlayer(mg, "rival", PlayerType.Human);
    fill(mg, me, 0, 50); fill(mg, rival, 50, mg.width());
    me.setTroops(1000); rival.setTroops(2000);
    const { ctx, q } = context(mg, me);
    const view = read(ctx, q).rival.get(rival)!;
    // count independently: our border tiles with a neighbour owned by the rival
    let facing = 0;
    for (const t of me.borderTiles()) if (mg.neighbors(t).some((n) => mg.owner(n) === rival)) facing++;
    expect(facing).toBeGreaterThan(0);
    expect(view.borderTiles).toBe(facing);
    // their whole border is the front we share, so the ratio is their troops over ours
    expect(rival.borderTiles().size).toBe(facing);
    expect(view.bsr).toBeCloseTo(2000 / 1000, 5);
    // a rival with a second front counts only the share facing us
    const third = addPlayer(mg, "third", PlayerType.Human);
    fill(mg, third, 75, mg.width());
    const v2 = read(ctx, q).rival.get(rival)!;
    expect(v2.borderTiles).toBe(facing); // unchanged: still cached from the first sample at the same tick
    executeTicks(mg, 50);
    const v3 = read(ctx, q).rival.get(rival)!;
    const share = facing / rival.borderTiles().size;
    expect(share).toBeLessThan(1);
    expect(v3.bsr).toBeCloseTo((rival.troops() * share) / me.troops(), 5);
    // humans never trigger the nation rules
    expect(v3.nationCanAttack).toBe(false);
    expect(v3.nationWouldSend).toBe(0);
  });

  test("troopsDelta / tilesDelta follow the ring buffer", async () => {
    const mg = await setup("plains");
    const me = addPlayer(mg, "me", PlayerType.Human);
    const rival = addPlayer(mg, "rival", PlayerType.Human);
    fill(mg, me, 0, 50); fill(mg, rival, 50, mg.width());
    me.setTroops(1000);
    const { ctx, q } = context(mg, me);
    rival.setTroops(1000);
    expect(read(ctx, q).rival.get(rival)!.troopsDelta).toBe(0); // one sample: no trend yet
    for (let i = 1; i <= 8; i++) { executeTicks(mg, 50); rival.setTroops(1000 + i * 500); read(ctx, q); }
    // 8 samples span 350 ticks; oldest sample was taken at t=50 (1500), newest at t=400 (5000): 3500/350·100
    const v = read(ctx, q).rival.get(rival)!;
    expect(v.troopsDelta).toBeCloseTo(1000, 5);
    expect(v.tilesDelta).toBe(0);
  });

  test("trust falls on a broken alliance, on an attack, and rises on a natural expiry", async () => {
    const mg = await setup("plains");
    const me = addPlayer(mg, "me", PlayerType.Human);
    const rival = addPlayer(mg, "rival", PlayerType.Human);
    fill(mg, me, 0, 50); fill(mg, rival, 50, mg.width());
    me.setTroops(1000); rival.setTroops(1000);
    const { ctx, q, log } = context(mg, me);
    expect(read(ctx, q).rival.get(rival)!.trust).toBe(0.5);
    me.createAllianceRequest(rival)!.accept();
    expect(me.isAlliedWith(rival)).toBe(true);
    read(ctx, q); // records the alliance's expiry
    rival.breakAlliance(rival.allianceWith(me)!);
    expect(me.isAlliedWith(rival)).toBe(false);
    q.rivals.onAllianceEnded(rival); // what PlaybookBotExecution.events() calls; `broken` is derived from the expiry
    const broken = read(ctx, q).rival.get(rival)!.trust;
    expect(broken).toBeLessThan(0.5);
    expect(log.some((l) => l.includes("broke the alliance early"))).toBe(true);
    // a natural expiry is a good sign
    q.rivals.onAllianceEnded(rival, false);
    expect(q.rivals.trust(rival)).toBeCloseTo(broken + 0.1, 5);
    // an attack on us is charged once per attack, not once per tick
    const before = q.rivals.trust(rival);
    mg.addExecution(new AttackExecution(200, rival, me.id()));
    executeTicks(mg, 2);
    expect(me.incomingAttacks().length).toBe(1);
    read(ctx, q); read(ctx, q);
    expect(q.rivals.trust(rival)).toBeCloseTo(before - 0.2, 5);
    // a refused request
    me.createAllianceRequest(rival)!;
    read(ctx, q);
    const pendingTrust = q.rivals.trust(rival);
    rival.incomingAllianceRequests()[0].reject();
    read(ctx, q);
    expect(q.rivals.trust(rival)).toBeCloseTo(pendingTrust - 0.1, 5);
  });
});

describe("B2 situation: nation rules agree with a real NationExecution", () => {
  /** Hard FFA on big_plains: a real nation on the right half, us on the left. Returns after the nation's behaviours
   *  are initialised and its opening TerraNullius attack has settled, with the map fully split. */
  async function hardNation(ourTroops: number, theirTroops: number) {
    const mg = await setup("big_plains", { difficulty: Difficulty.Hard }, [], undefined, TestConfig, false);
    const me = addPlayer(mg, "me", PlayerType.Human);
    const info = new PlayerInfo("nation", PlayerType.Nation, null, "nation");
    const nation = new Nation(new Cell(150, 100), info);
    const exec = new NationExecution("b2", nation);
    mg.addExecution(exec);
    for (let i = 0; i < 20 && !(mg.hasPlayer("nation") && mg.player("nation").hasSpawned()); i++) mg.executeNextTick();
    const them = mg.player("nation");
    expect(them.hasSpawned()).toBe(true);
    mg.endSpawnPhase();
    fill(mg, me, 0, 100); fill(mg, them, 100, mg.width());
    executeTicks(mg, 3); // behaviours initialise and the forced TerraNullius attack (no TN left) resolves
    me.setTroops(ourTroops); them.setTroops(theirTroops);
    for (const a of them.outgoingAttacks()) them.orderRetreat(a.id());
    executeTicks(mg, 1);
    me.setTroops(ourTroops); them.setTroops(theirTroops);
    expect(them.outgoingAttacks().length).toBe(0);
    return { mg, me, them };
  }
  /** Runs 200 ticks pinning both armies, records the first attack the nation lands on us and our prediction before it. */
  function run(mg: Game, me: Player, them: Player, ourTroops: number, theirTroops: number) {
    const { ctx, q } = context(mg, me);
    let predictedCan = false, predictedSend = 0, attacked: number | null = null, when = -1;
    for (let i = 0; i < 200; i++) {
      me.setTroops(ourTroops); them.setTroops(theirTroops);
      const v = read(ctx, q).rival.get(them)!;
      predictedCan = v.nationCanAttack; predictedSend = v.nationWouldSend;
      mg.executeNextTick();
      const inc = me.incomingAttacks().find((a) => a.attacker() === them);
      if (inc) { attacked = inc.troops(); when = i; break; }
    }
    return { predictedCan, predictedSend, attacked, when, q };
  }

  test("we are above its send cap: it cannot attack and does not", async () => {
    const theirs = 800_000, ours = 1_400_000; // Hard retains 75 % of our army: cap = 800k − 1.05M < 0
    const { mg, me, them } = await hardNation(ours, theirs);
    expect(mg.config().maxTroops(them) * NATION_RULES.reserveRatio[1]).toBeLessThan(theirs); // reserve ratio is not the blocker
    const r = run(mg, me, them, ours, theirs);
    expect(r.predictedCan).toBe(false);
    expect(r.predictedSend).toBe(0);
    expect(r.q.rivals.troopSendCap(them)).toBe(0);
    expect(r.attacked).toBeNull();
  });

  test("we are below its send cap: it can attack and does, with the troops the rules allow", async () => {
    const theirs = 800_000, ours = 400_000;
    const { mg, me, them } = await hardNation(ours, theirs);
    const r = run(mg, me, them, ours, theirs);
    expect(r.predictedCan).toBe(true);
    expect(r.attacked).not.toBeNull();
    // cap = 800k − ceil(0.75 × 400k) = 500k; troops = 800k − max × reserveRatio, reserveRatio ∈ [0.30, 0.40]
    const max = mg.config().maxTroops(them);
    const cap = theirs - Math.ceil(ours * NATION_RULES.retain[Difficulty.Hard]!);
    const upper = Math.min(theirs - max * NATION_RULES.reserveRatio[0], cap);
    const lower = Math.min(theirs - max * NATION_RULES.reserveRatio[1], cap);
    expect(r.predictedSend).toBeCloseTo(upper, 3);
    expect(r.attacked!).toBeLessThanOrEqual(upper + 1);
    expect(r.attacked!).toBeGreaterThanOrEqual(lower * 0.98); // a tick of losses at most
  });
});
