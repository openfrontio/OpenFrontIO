// PlaybookBot: an AI player that follows the OpenFront Playbook rules.
// v2: expansion flow, bot harvesting, island boats, alliances, fighting by
// density with retreat, a gold-spending loop, and defense posts.
// Parameterised so a lab harness can tune the numbers.

import { Config } from "../../configuration/Config";
import {
  Attack,
  Execution,
  Game,
  Player,
  PlayerType,
  UnitType,
} from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { Unit } from "../../game/Game";
import { PseudoRandom } from "../../PseudoRandom";
import { simpleHash } from "../../Util";
import { AllianceExtensionExecution } from "../alliance/AllianceExtensionExecution";
import { AllianceRequestExecution } from "../alliance/AllianceRequestExecution";
import { DonateTroopsExecution } from "../DonateTroopExecution";
import { AttackExecution } from "../AttackExecution";
import { ConstructionExecution } from "../ConstructionExecution";
import { TransportShipExecution } from "../TransportShipExecution";
import { UpgradeStructureExecution } from "../UpgradeStructureExecution";
import { closestTile } from "../Util";

export interface PlaybookParams {
  expandContested: number; // share of home troops per click into empty land while a rival borders us
  expandFree: number; // same, when nobody can contest
  expandEvery: number; // ticks between clicks
  openingAllIn: boolean; // nation-style opening: every 5 s throw everything above openingKeep of cap into empty land
  openingKeep: number;
  homeFloor: number; // never expand/fight below this share of cap at home
  botRatio: number; // attack bots with this multiple of their troops
  botMaxShare: number; // max share of home troops per bot click
  botEarlyShare: number; // while free land remains, only eat a tribe if the click is at most this share of home troops (and we are plentiful)
  botsAfterWild: boolean; // wait for the wilderness to run out before harvesting tribes
  botClickCap: number; // guide rule: no single tribe click above this share of home; split into follow-up clicks instead
  botFollowUpTicks: number; // ticks between follow-up clicks on the same tribe (they merge into the running attack)
  boatAtTick: number;
  boatShare: number;
  islandMaxTiles: number;
  fightAbove: number; // start fighting rivals when troops exceed this share of cap
  fightRatio: number; // attack size as multiple of the target's whole army
  fightNotBeforeTick: number; // no wars with nations/humans before this tick
  fightMinCities: number; // ... or before this many cities
  fightMaxShare: number; // never commit more than this share of home troops to one target
  retreatBelowRatio: number; // retreat an attack whose troops fall below this × target troops
  capFullShare: number; // buy cap when troops exceed this share of cap
  citiesBeforePort: number;
  portMinPartnerDist: number;
  allianceEvery: number;
  portLevelBeforeSecond: number; // level the first port to this before a second port
  maxPortUnits: number; // beyond this, only port levels
  seaFullShips: number; // map-wide trade ships at which ports stop being bought
  railSpacing: number; // tiles between infill cities on a rail
  siloAtTick: number; // earliest silo
  bombEvery: number; // ticks between bombs
  bombReserve: number; // gold kept after buying a bomb
}

export const DEFAULT_PLAYBOOK: PlaybookParams = {
  expandContested: 0.2,
  expandFree: 0.1,
  expandEvery: 10,
  openingAllIn: true,
  openingKeep: 0.15,
  homeFloor: 0.25,
  botRatio: 1.67,
  botMaxShare: 0.5,
  botEarlyShare: 0.15,
  botClickCap: 1, // 1 = off (single click up to botMaxShare)
  botFollowUpTicks: 100,
  botsAfterWild: true, // 30-game lab A/B: equal survival, +16% land vs eating tribes as met (driven by a few games; 18/30 pairs identical)
  boatAtTick: 50,
  boatShare: 0.2,
  islandMaxTiles: 20000,
  fightAbove: 0.7,
  fightRatio: 2.0,
  fightNotBeforeTick: 3000,
  fightMinCities: 2,
  fightMaxShare: 0.6,
  retreatBelowRatio: 0.4,
  capFullShare: 0.6,
  citiesBeforePort: 1,
  portMinPartnerDist: 300,
  allianceEvery: 300,
  portLevelBeforeSecond: 3,
  maxPortUnits: 8,
  seaFullShips: 400,
  railSpacing: 16,
  siloAtTick: 6000,
  bombEvery: 300,
  bombReserve: 250_000,
};

export class PlaybookBotExecution implements Execution {
  private active = true;
  private mg!: Game;
  private config!: Config;
  private random: PseudoRandom;
  private lastAllianceTick = -1e9;
  private boatSent = false;
  private landmassChecked = false;
  private onSmallLandmass = false;
  private lastBuildTick = -1e9;
  private currentTarget: Player | null = null;
  private waves = new Map<Player, { want: number; sent: number; last: number }>();
  private sentAt = new Map<Player, number>();
  private blacklist = new Map<Player, number>();
  public log: string[] = [];
  public kills = 0;
  public bombs = 0;
  private lastBombTick = -1e9;
  private plannedTarget: Player | null = null; // ally whose alliance we let lapse on purpose
  private rail: { factory: Unit | null; anchor: Unit | null; infilled: number; extended: boolean; failed: number } = { factory: null, anchor: null, infilled: 0, extended: false, failed: 0 };

  constructor(
    private player: Player,
    private p: PlaybookParams = DEFAULT_PLAYBOOK,
  ) {
    this.random = new PseudoRandom(simpleHash(player.id()) + 7);
  }

  init(mg: Game): void {
    this.mg = mg;
    this.config = mg.config();
  }
  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }

  tick(ticks: number): void {
    const me = this.player;
    if (!me.isAlive()) {
      this.active = false;
      return;
    }
    if (!this.landmassChecked && me.numTilesOwned() > 0) {
      this.landmassChecked = true;
      this.onSmallLandmass = this.landmassSize(this.p.islandMaxTiles + 1) <= this.p.islandMaxTiles;
    }
    this.acceptAlliances();
    if (ticks - this.lastAllianceTick >= this.p.allianceEvery) {
      this.lastAllianceTick = ticks;
      this.requestAlliances();
      this.manageExpiries();
      this.manageEmbargoes();
    }
    if (ticks % this.p.expandEvery === 0) {
      this.counterAttack();
      this.manageRetreats();
      this.expand();
      this.harvestBots();
      this.fight();
    }
    if (!this.boatSent && ticks >= this.p.boatAtTick && this.onSmallLandmass) {
      this.boatSent = this.sendBoat() || ticks > this.p.boatAtTick + 600;
    }
    if (ticks >= 300 && ticks % 100 === 0) this.huntBotsByBoat();
    if (ticks >= 1800 && ticks % 200 === 0) this.seaInvasion();
    if (ticks - this.lastBuildTick >= 10) {
      this.lastBuildTick = ticks;
      this.build(ticks);
      this.maybeBomb(ticks);
    }
  }

  // ---------------------------------------------------------------- helpers
  private neighbours(): { bots: Player[]; rivals: Player[]; friends: Player[]; wilderness: boolean } {
    const bots: Player[] = [], rivals: Player[] = [], friends: Player[] = [];
    let wilderness = false;
    for (const n of this.player.nearby()) {
      if (!n.isPlayer()) { wilderness = true; continue; }
      if (n.type() === PlayerType.Bot) bots.push(n);
      else if (this.player.isFriendly(n)) friends.push(n);
      else rivals.push(n);
    }
    return { bots, rivals, friends, wilderness };
  }
  private cap(): number {
    return this.config.maxTroops(this.player);
  }
  private outgoingTo(target: Player): Attack | undefined {
    return this.player.outgoingAttacks().find((a) => a.target() === target);
  }
  /** Record an attack we just sent; if it has vanished 2 ticks later the target wasn't really reachable. */
  private noteSent(target: Player): void { this.sentAt.set(target, this.mg.ticks()); }
  private reachable(target: Player): boolean {
    const bl = this.blacklist.get(target);
    if (bl !== undefined && this.mg.ticks() < bl) return false;
    const t0 = this.sentAt.get(target);
    if (t0 !== undefined && this.mg.ticks() - t0 >= 2 && this.mg.ticks() - t0 < 12 && !this.outgoingTo(target)) {
      this.blacklist.set(target, this.mg.ticks() + 600);
      this.sentAt.delete(target);
      return false;
    }
    return true;
  }
  private density(p: Player): number {
    return p.numTilesOwned() > 0 ? p.troops() / p.numTilesOwned() : 1e9;
  }

  // ---------------------------------------------------------------- expansion
  private expand(): void {
    const me = this.player;
    const { rivals, wilderness } = this.neighbours();
    if (!wilderness) return;
    if (this.p.openingAllIn) {
      // nations' opening: every 5 s, everything above a small reserve goes into empty land
      if (this.mg.ticks() % 50 !== 0) return;
      const send = Math.floor(me.troops() - this.cap() * this.p.openingKeep);
      if (send < 100) return;
      this.mg.addExecution(new AttackExecution(send, me, this.mg.terraNullius().id()));
      return;
    }
    if (me.troops() < this.cap() * this.p.homeFloor) return;
    const frac = rivals.length > 0 ? this.p.expandContested : this.p.expandFree;
    const send = Math.floor(me.troops() * frac);
    if (send < 100) return;
    this.mg.addExecution(new AttackExecution(send, me, this.mg.terraNullius().id()));
  }

  // ---------------------------------------------------------------- bots
  private harvestBots(): void {
    const me = this.player;
    const { bots, wilderness } = this.neighbours();
    if (bots.length === 0) return;
    bots.sort((a, b) => a.troops() - b.troops());
    const plentiful = me.troops() > this.cap() * this.p.fightAbove;
    // free land costs 16–24 a tile; a tribe costs its density plus the losses of the fight. Eat tribes
    // once the wilderness is gone, or earlier only when we are plentiful and the click is small.
    const early = wilderness && this.p.botsAfterWild;
    let clicks = 0;
    for (const bot of bots) {
      if (!me.canAttackPlayer(bot) || !this.reachable(bot)) continue;
      const want = Math.ceil(bot.troops() * this.p.botRatio) + 500;
      const running = this.outgoingTo(bot);
      if (running) {
        // follow-up click: the guide's two-click — a second wave 10 s later merges into the first
        const w = this.waves.get(bot);
        if (!w || w.sent >= w.want || this.mg.ticks() - w.last < this.p.botFollowUpTicks) continue;
        const send = Math.min(w.want - w.sent, Math.floor(me.troops() * this.p.botClickCap));
        if (send < 500) continue;
        this.mg.addExecution(new AttackExecution(send, me, bot.id()));
        w.sent += send; w.last = this.mg.ticks();
        continue;
      }
      const maxSend = Math.floor(me.troops() * (early ? this.p.botEarlyShare : this.p.botMaxShare));
      if (want > maxSend) continue;
      const first = Math.min(want, Math.floor(me.troops() * this.p.botClickCap));
      if (first < 500) continue;
      this.mg.addExecution(new AttackExecution(first, me, bot.id()));
      this.waves.set(bot, { want, sent: first, last: this.mg.ticks() });
      this.noteSent(bot);
      if (this.log.length < 200) this.log.push(`t${this.mg.ticks()} bot ${bot.name()} ${bot.numTilesOwned()}t/${Math.round(bot.troops())} ← ${first}/${want}`);
      clicks++;
      if (!plentiful || clicks >= 2) return;
    }
  }

  /** Opposing attacks cancel troop-for-troop: answer a non-bot attack with a counter of the same size. */
  private counterAttack(): void {
    const me = this.player;
    for (const inc of me.incomingAttacks()) {
      const a = inc.attacker();
      if (a.type() === PlayerType.Bot || me.isFriendly(a)) continue;
      if (this.outgoingTo(a)) continue;
      if (!me.canAttackPlayer(a) || !this.reachable(a)) continue;
      // a post makes defending 5× cheaper than cancelling; only cancel waves that would cost real land
      const big = inc.troops() > me.troops() * 0.15 || (!this.postFacing(a) && inc.troops() > me.troops() * 0.05);
      const last = this.lastCounter.get(a) ?? -1e9;
      if (!big || this.mg.ticks() - last < 300) continue;
      this.lastCounter.set(a, this.mg.ticks());
      const send = Math.min(Math.ceil(inc.troops() * 1.05), Math.floor(me.troops() * 0.5));
      if (send < 1000) continue;
      this.mg.addExecution(new AttackExecution(send, me, a.id()));
      this.noteSent(a);
      this.counters.add(a);
      if (this.log.length < 200) this.log.push(`t${this.mg.ticks()} COUNTER ${a.name()} (${Math.round(inc.troops() / 1000)}k incoming) with ${Math.round(send / 1000)}k`);
    }
  }

  // ---------------------------------------------------------------- fighting rivals
  private fight(): void {
    const me = this.player;
    const cap = this.cap();
    if (me.troops() < cap * this.p.fightAbove) return;
    const atCapNow = me.troops() >= cap * 0.95;
    const early = !atCapNow && (this.mg.ticks() < this.p.fightNotBeforeTick || me.unitsOwned(UnitType.City) < this.p.fightMinCities);
    let { rivals } = this.neighbours();
    // before the 5-minute mark only clear prey: a neighbour we can hit with 2.5× its whole army
    if (early) rivals = rivals.filter((r) => r.troops() * 2.5 <= me.troops() * this.p.fightMaxShare && r.numTilesOwned() <= me.numTilesOwned());
    if (rivals.length === 0) return;
    if (this.currentTarget && (!this.currentTarget.isAlive() || !rivals.includes(this.currentTarget))) this.currentTarget = null;
    const candidates = rivals.filter((r) => me.canAttackPlayer(r) && !this.outgoingTo(r) && this.reachable(r));
    if (candidates.length === 0) return;
    const atCap = me.troops() >= cap * 0.95;
    // At cap every troop above the line is wasted growth, so commit more and accept a thinner edge.
    const maxSend = Math.floor(me.troops() * (atCap ? 0.7 : this.p.fightMaxShare));
    const minRatio = atCap ? 1.2 : this.p.fightRatio;
    const attackingUs = new Set(me.incomingAttacks().map((a) => a.attacker()));
    const score = (r: Player) => {
      const ratio = maxSend / Math.max(1, r.troops());
      // at cap, a neighbour already attacking us is a fair fight at 1:1 — the counter-attack cancels its wave anyway
      if (ratio < (atCap && attackingUs.has(r) ? 1.0 : minRatio)) return -1;
      // Playbook: never attack a big, thinly held empire — that is a troop sink. Prefer small and dense.
      if (ratio < 3 && r.numTilesOwned() > me.numTilesOwned() * 1.5 && this.density(r) < 40) return -1;
      const buildings = r.units(UnitType.City).length * 3 + r.units(UnitType.Port).length * 2 + r.units(UnitType.MissileSilo).length * 3;
      const posts = r.units(UnitType.DefensePost).length;
      if (posts > 0 && ratio < 1.5) return -1;
      const sizePenalty = r.numTilesOwned() / Math.max(1, me.numTilesOwned());
      // Playbook: hit players who are already being hit, traitors (half defence), and the ally we let lapse.
      const underFire = r.incomingAttacks().reduce((acc, a) => acc + a.troops(), 0) / Math.max(1, r.troops());
      const bonus = Math.min(underFire, 1) * 4 + (r.isTraitor() ? 2 : 0) + (r === this.plannedTarget ? 4 : 0);
      return ratio * 2 + buildings + Math.min(this.density(r), 200) / 50 - posts * 3 - sizePenalty * 2 + bonus + (r === this.currentTarget ? 3 : 0);
    };
    let best: Player | null = null, bestS = 0;
    for (const r of candidates) { const sc = score(r); if (sc > bestS) { bestS = sc; best = r; } }
    if (best === null) {
      if (atCapNow && this.mg.ticks() % 1200 < this.p.expandEvery && this.log.length < 200) this.log.push(`t${this.mg.ticks()} idle at cap: ${rivals.map((r) => `${r.name()} ${r.numTilesOwned()}t/${Math.round(r.troops() / 1000)}k d${Math.round(this.density(r))} p${r.units(UnitType.DefensePost).length} ${candidates.includes(r) ? "" : "(no)"}`).join("; ")}`);
      return;
    }
    const want = Math.min(Math.ceil(best.troops() * this.p.fightRatio) + 1000, maxSend);
    if (want < 1000) return;
    this.currentTarget = best;
    if (!me.hasEmbargoAgainst(best) && best.type() !== PlayerType.Nation) { me.addEmbargo(best, false); this.embargoedAt.set(best, this.mg.ticks()); }
    this.mg.addExecution(new AttackExecution(want, me, best.id()));
    this.noteSent(best);
    if (this.log.length < 200) this.log.push(`t${this.mg.ticks()} ATTACK ${best.name()} ${best.numTilesOwned()}t/${Math.round(best.troops() / 1000)}k ← ${Math.round(want / 1000)}k (${(want / Math.max(1, best.troops())).toFixed(2)}×)`);
  }

  private attackStart = new Map<string, { sent: number; targetTroops: number }>();
  private counters = new Set<Player>();
  private manageRetreats(): void {
    const me = this.player;
    for (const a of me.outgoingAttacks()) {
      const t = a.target();
      if (!t.isPlayer() || t.type() === PlayerType.Bot) continue;
      if (a.retreating() || a.retreated()) continue;
      // a counter-attack exists to cancel a wave; once the wave is gone, bring the rest home rather than dying in their land
      if (this.counters.has(t) && t !== this.currentTarget && !me.incomingAttacks().some((x) => x.attacker() === t)) {
        me.orderRetreat(a.id());
        this.counters.delete(t);
        if (this.log.length < 200) this.log.push(`t${this.mg.ticks()} counter done vs ${t.name()}, ${Math.round(a.troops() / 1000)}k coming home`);
        continue;
      }
      let st = this.attackStart.get(a.id());
      if (!st) { st = { sent: a.troops(), targetTroops: t.troops() }; this.attackStart.set(a.id(), st); }
      // Retreat only when we are losing: most of the wave is gone while the target has barely bled.
      const losing = a.troops() < st.sent * 0.2 && t.troops() > st.targetTroops * 0.7;
      const posts = t.units(UnitType.DefensePost).length > 0 && a.troops() < st.sent * 0.5 && t.troops() > st.targetTroops * 0.9;
      if (losing || posts) {
        this.player.orderRetreat(a.id());
        if (this.log.length < 200) this.log.push(`t${this.mg.ticks()} retreat from ${t.name()} (${Math.round(a.troops() / 1000)}k left)`);
      }
    }
  }

  // ---------------------------------------------------------------- boats
  private landmassSize(limit: number): number {
    return this.landmassTiles(limit).size;
  }
  private landmassTiles(limit: number): Set<TileRef> {
    const start = this.player.borderTiles().values().next().value as TileRef | undefined;
    const seen = new Set<TileRef>();
    if (start === undefined) return seen;
    seen.add(start);
    const stack = [start];
    while (stack.length > 0 && seen.size < limit) {
      const t = stack.pop()!;
      this.mg.forEachNeighbor(t, (n) => { if (!seen.has(n) && this.mg.isLand(n)) { seen.add(n); stack.push(n); } });
    }
    return seen;
  }
  private sendBoat(): boolean {
    const me = this.player;
    if (me.unitCount(UnitType.TransportShip) >= this.config.boatMaxNumber()) return false;
    const border = Array.from(me.borderTiles()).filter((t) => this.mg.isShore(t));
    if (border.length === 0) return false;
    const from = border[this.random.nextInt(0, border.length)];
    const fx = this.mg.x(from), fy = this.mg.y(from);
    const mine = this.landmassTiles(this.p.islandMaxTiles + 1);
    let best: TileRef | null = null, bestD = 1e9;
    for (let dy = -200; dy <= 200; dy += 6) for (let dx = -200; dx <= 200; dx += 6) {
      const x = fx + dx, y = fy + dy;
      if (!this.mg.isValidCoord(x, y)) continue;
      const t = this.mg.ref(x, y);
      if (!this.mg.isLand(t) || !this.mg.isShore(t) || this.mg.hasOwner(t) || mine.has(t)) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d >= 30 && d < bestD) { bestD = d; best = t; }
    }
    if (best === null) return false;
    const troops = Math.floor(me.troops() * this.p.boatShare);
    if (troops < 500 || me.canBuild(UnitType.TransportShip, best) === false) return false;
    this.mg.addExecution(new TransportShipExecution(me, best, troops));
    this.log.push(`t${this.mg.ticks()} boat ${troops} troops, ${bestD} tiles`);
    return true;
  }

  /** No bots on our borders: boat to the nearest bot within reach, with 1.67× its troops. */
  private huntBotsByBoat(): void {
    const me = this.player;
    if (this.neighbours().bots.length > 0) return;
    if (me.unitCount(UnitType.TransportShip) >= this.config.boatMaxNumber()) return;
    if (me.troops() < this.cap() * 0.4) return;
    const shore = Array.from(me.borderTiles()).filter((t) => this.mg.isShore(t));
    if (shore.length === 0) return;
    const from = shore[Math.floor(shore.length / 2)];
    const fx = this.mg.x(from), fy = this.mg.y(from);
    let best: TileRef | null = null, bestBot: Player | null = null, bestD = 1e9;
    for (const bot of this.mg.players()) {
      if (bot.type() !== PlayerType.Bot || !bot.isAlive() || bot.numTilesOwned() < 100) continue;
      const want = Math.ceil(bot.troops() * this.p.botRatio) + 500;
      if (want > me.troops() * 0.3) continue;
      // sample its border for a shore tile
      let i = 0;
      for (const t of bot.borderTiles()) {
        if ((i++ % 7) !== 0) continue;
        if (!this.mg.isShore(t)) continue;
        const d = Math.abs(this.mg.x(t) - fx) + Math.abs(this.mg.y(t) - fy);
        if (d < bestD && d <= 350) { bestD = d; best = t; bestBot = bot; }
      }
    }
    if (best === null || bestBot === null) return;
    if (me.canBuild(UnitType.TransportShip, best) === false) return;
    const troops = Math.ceil(bestBot.troops() * this.p.botRatio) + 500;
    this.mg.addExecution(new TransportShipExecution(me, best, troops));
    if (this.log.length < 200) this.log.push(`t${this.mg.ticks()} BOAT to bot ${bestBot.name()} ${bestBot.numTilesOwned()}t/${Math.round(bestBot.troops())} with ${troops}, ${bestD} tiles`);
  }

  /** Boxed in at cap with nothing to fight on land: land a big boat on the weakest unfriendly player within reach. */
  private seaInvasion(): void {
    const me = this.player;
    if (me.troops() < this.cap() * 0.9) return;
    if (this.mg.ticks() - this.lastInvasionTick < 1800) return;
    if (me.units(UnitType.TransportShip).length > 0) return; // one landing at a time
    if (me.outgoingAttacks().length > 0 || me.incomingAttacks().some((a) => a.attacker().type() !== PlayerType.Bot)) return;
    const nb = this.neighbours();
    // only when genuinely boxed in: no empty land, no bots, and no neighbour we could fight on land
    if (nb.wilderness || nb.bots.length > 0) return;
    if (nb.rivals.some((r) => r.troops() < me.troops() * 0.5)) return;
    if (nb.rivals.some((r) => r.troops() > me.troops() * 0.6)) return; // a strong hostile neighbour: the army stays home
    const shore = Array.from(me.borderTiles()).filter((t) => this.mg.isShore(t));
    if (shore.length === 0) return;
    const from = shore[Math.floor(shore.length / 2)];
    const fx = this.mg.x(from), fy = this.mg.y(from);
    const { rivals } = this.neighbours();
    let best: { tile: TileRef; p: Player; d: number; score: number } | null = null;
    for (const o of this.mg.players()) {
      if (o === me || !o.isAlive() || me.isFriendly(o) || o.type() === PlayerType.Bot || rivals.includes(o)) continue;
      if (o.troops() > me.troops() * 0.25 || o.numTilesOwned() < 300) continue;
      let i = 0;
      for (const t of o.borderTiles()) {
        if ((i++ % 9) !== 0 || !this.mg.isShore(t)) continue;
        const d = Math.abs(this.mg.x(t) - fx) + Math.abs(this.mg.y(t) - fy);
        if (d > 500) continue;
        const score = this.density(o) / 10 + o.units(UnitType.City).length * 2 - d / 100 - o.units(UnitType.DefensePost).length * 2;
        if (best === null || score > best.score) best = { tile: t, p: o, d, score };
      }
    }
    if (best === null || me.canBuild(UnitType.TransportShip, best.tile) === false) return;
    const troops = Math.min(Math.floor(me.troops() * 0.3), Math.ceil(best.p.troops() * 2.5) + 5000);
    if (troops < 20000) return;
    this.lastInvasionTick = this.mg.ticks();
    this.mg.addExecution(new TransportShipExecution(me, best.tile, troops));
    if (this.log.length < 200) this.log.push(`t${this.mg.ticks()} INVADE ${best.p.name()} ${best.p.numTilesOwned()}t/${Math.round(best.p.troops() / 1000)}k by sea with ${Math.round(troops / 1000)}k, ${best.d} tiles`);
  }

  // ---------------------------------------------------------------- alliances
  private acceptAlliances(): void {
    for (const req of this.player.incomingAllianceRequests()) {
      const r = req.requestor();
      if (r.type() === PlayerType.Bot) continue;
      if (r === this.currentTarget || r === this.plannedTarget) continue;
      if (this.isPrey(r)) continue;
      req.accept();
    }
  }
  /** A weaker neighbour is food: with two or more neighbours we keep the weakest one unallied so the army has somewhere to go. */
  private isPrey(o: Player): boolean {
    const me = this.player;
    // Nations on Hard attack unallied neighbours early; an alliance is a shield first and a meal only later.
    if (this.mg.ticks() < 600) return false;
    if (o.troops() < me.troops() * 0.5 && this.mg.ticks() >= 1200) return true;
    // the single weakest neighbour stays unallied only if we can take it right now (2× its army within our share)
    const all = [...this.neighbours().rivals, ...this.neighbours().friends];
    if (all.length < 3) return false;
    const weakest = all.reduce((a, b) => (b.troops() < a.troops() ? b : a));
    return o === weakest && o.troops() * 2 < me.troops() * this.p.fightMaxShare;
  }
  private requestAlliances(): void {
    const me = this.player;
    const { rivals } = this.neighbours();
    rivals.sort((a, b) => b.troops() - a.troops());
    for (const o of rivals) {
      if (o === this.currentTarget || o === this.plannedTarget) continue;
      if (this.isPrey(o)) continue;
      if (!me.canSendAllianceRequest(o)) continue;
      this.mg.addExecution(new AllianceRequestExecution(me, o.id()));
    }
  }

  /** 30 s before an alliance ends: renew it unless the ally has become prey we can take, in which case let it lapse and queue the attack. */
  private manageExpiries(): void {
    const me = this.player;
    const offset = this.config.allianceExtensionPromptOffset();
    for (const al of me.alliances()) {
      const other = al.other(me);
      const left = al.expiresAt() - this.mg.ticks();
      if (left > offset || left < 0) continue;
      const { rivals, friends } = this.neighbours();
      const prey = friends.includes(other) && other.troops() < me.troops() * 0.4 && me.troops() > this.cap() * this.p.fightAbove && rivals.length <= 1;
      // A Hard nation renews only if we are as strong as it, a threat to it, or on friendly terms.
      // A gift of 1/7 of its cap makes it friendly (+50): cheap insurance when we are the weaker side.
      if (!prey && other.type() === PlayerType.Nation && me.troops() < other.troops() * 0.9 && me.canDonateTroops(other)) {
        const gift = Math.ceil(this.config.maxTroops(other) / 7) + 1000;
        if (gift < me.troops() * 0.3 && gift <= this.config.maxTroops(other) - other.troops()) {
          this.mg.addExecution(new DonateTroopsExecution(me, other.id(), gift));
          if (this.log.length < 200) this.log.push(`t${this.mg.ticks()} gift ${Math.round(gift / 1000)}k troops to ${other.name()} before renewal`);
        }
      }
      if (prey) {
        this.plannedTarget = other;
        if (this.log.length < 200) this.log.push(`t${this.mg.ticks()} let alliance with ${other.name()} lapse (${Math.round(other.troops() / 1000)}k vs our ${Math.round(me.troops() / 1000)}k)`);
        continue;
      }
      this.mg.addExecution(new AllianceExtensionExecution(me, other.id()));
    }
    if (this.plannedTarget && (me.isFriendly(this.plannedTarget) === false && !this.plannedTarget.isAlive())) this.plannedTarget = null;
  }
  /** Trade feeds whoever you trade with: embargo anyone attacking us or targeted by us; lift it when we ally. */
  private manageEmbargoes(): void {
    const me = this.player;
    // Embargoes cost 20 relation with nations, so they are reserved for the player we are actually at war with.
    for (const e of me.getEmbargoes()) {
      const atWarWith = e.target === this.currentTarget && this.outgoingTo(e.target) !== undefined;
      if (me.isFriendly(e.target) || !e.target.isAlive() || (!atWarWith && this.mg.ticks() - (this.embargoedAt.get(e.target) ?? 0) > 1200)) me.stopEmbargo(e.target);
    }
  }

  // ---------------------------------------------------------------- nukes
  private maybeBomb(ticks: number): void {
    const me = this.player;
    if (me.units(UnitType.MissileSilo).length === 0) return;
    if (ticks - this.lastBombTick < this.p.bombEvery) return;
    const atomCost = this.config.unitInfo(UnitType.AtomBomb).cost(this.mg, me);
    const hCost = this.config.unitInfo(UnitType.HydrogenBomb).cost(this.mg, me);
    const gold = me.gold();
    // targets: whoever we fight or who fights us; else the neighbour with the most buildings that is not allied
    const enemies = new Set<Player>();
    if (this.currentTarget && this.currentTarget.isAlive() && !me.isFriendly(this.currentTarget)) enemies.add(this.currentTarget);
    for (const inc of me.incomingAttacks()) { const a = inc.attacker(); if (a.type() !== PlayerType.Bot && !me.isFriendly(a)) enemies.add(a); }
    if (enemies.size === 0 && me.troops() > this.cap() * 0.9 && me.outgoingAttacks().length === 0) {
      // idle at cap: open a war — bomb the neighbour with the most buildings we could then take at 1.2×
      const { rivals } = this.neighbours();
      const pick = rivals.filter((r) => me.canAttackPlayer(r) && r.troops() * 1.2 < me.troops() * this.p.fightMaxShare).sort((a, b) => b.units(UnitType.City).length - a.units(UnitType.City).length)[0];
      if (pick) { enemies.add(pick); this.currentTarget = pick; }
    }
    if (enemies.size === 0) return;
    let best: { tile: TileRef; value: number; type: UnitType } | null = null;
    for (const enemy of enemies) {
      const structures = enemy.units([UnitType.City, UnitType.Port, UnitType.Factory, UnitType.MissileSilo, UnitType.SAMLauncher, UnitType.DefensePost]);
      const sams = enemy.units(UnitType.SAMLauncher);
      for (const u of structures) {
        const tile = u.tile();
        if ((this.bombed.get(tile) ?? 0) >= 1) continue;
        // never inside a SAM umbrella (the SAM always hits), never near our own or allied land
        if (sams.some((s) => this.mg.euclideanDistSquared(s.tile(), tile) <= (this.config.samRange(s.level()) + 5) ** 2)) continue;
        if (!this.clearOfFriends(tile, 32)) continue;
        for (const type of [UnitType.HydrogenBomb, UnitType.AtomBomb]) {
          const cost = type === UnitType.HydrogenBomb ? hCost : atomCost;
          if (gold < cost + BigInt(this.p.bombReserve)) continue;
          if (type === UnitType.HydrogenBomb && (!this.clearOfFriends(tile, 105) || enemy.numTilesOwned() < 8000)) continue;
          const r = this.config.nukeMagnitudes(type).outer;
          let value = 0;
          for (const o of structures) if (this.mg.euclideanDistSquared(o.tile(), tile) <= r * r) value += (o.type() === UnitType.City ? 3 : o.type() === UnitType.MissileSilo || o.type() === UnitType.SAMLauncher ? 4 : 2) * o.level();
          const perGold = value / Number(cost / 100_000n);
          if (value >= 4 && (best === null || perGold > best.value)) best = { tile, value: perGold, type };
        }
      }
    }
    if (best === null) return;
    if (me.canBuild(best.type, best.tile) === false) return;
    this.mg.addExecution(new ConstructionExecution(me, best.type, best.tile));
    this.lastBombTick = ticks;
    this.bombed.set(best.tile, (this.bombed.get(best.tile) ?? 0) + 1);
    this.bombs++;
    if (this.log.length < 200) this.log.push(`t${ticks} BOMB ${best.type} at ${this.mg.x(best.tile)},${this.mg.y(best.tile)}`);
  }
  private clearOfFriends(tile: TileRef, r: number): boolean {
    const x = this.mg.x(tile), y = this.mg.y(tile);
    for (let dy = -r; dy <= r; dy += 8) for (let dx = -r; dx <= r; dx += 8) {
      if (dx * dx + dy * dy > r * r || !this.mg.isValidCoord(x + dx, y + dy)) continue;
      const o = this.mg.owner(this.mg.ref(x + dx, y + dy));
      if (o.isPlayer() && (o === this.player || this.player.isFriendly(o))) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- rail line (factory → anchor → infill)
  /** Returns true if it spent this pass. */
  private buildRail(gold: bigint, cost: (u: UnitType) => bigint): boolean {
    const me = this.player;
    const R = this.rail;
    if (R.failed > 20) return false;
    if (R.factory && !R.factory.isActive()) { R.factory = null; R.anchor = null; R.infilled = 0; }
    if (R.factory === null && this.pendingFactory !== null) {
      const u = this.mg.nearbyUnits(this.pendingFactory, 3, UnitType.Factory).find((x) => x.unit.owner() === me)?.unit;
      if (u) { R.factory = u; this.pendingFactory = null; } else if (this.mg.ticks() - this.pendingFactoryTick > 60) { this.pendingFactory = null; R.failed++; }
      return false;
    }
    if (R.factory === null) {
      if (gold < cost(UnitType.Factory)) return false;
      const spot = this.railFactorySpot();
      if (spot === null) { R.failed++; return false; }
      if (this.tryBuild(UnitType.Factory, spot.factory)) { this.pendingAnchor = spot.anchor; this.pendingFactory = spot.factory; this.pendingFactoryTick = this.mg.ticks(); return true; }
      R.failed++; return false;
    }
    if (R.anchor === null && this.pendingAnchor !== null && this.pendingAnchorTick >= 0) {
      const u = this.mg.nearbyUnits(this.pendingAnchor, 3, UnitType.City).find((x) => x.unit.owner() === me)?.unit;
      if (u) { R.anchor = u; this.pendingAnchorTick = -1; } else if (this.mg.ticks() - this.pendingAnchorTick > 60) { this.pendingAnchorTick = -1; R.failed++; }
      return false;
    }
    if (R.anchor === null) {
      if (this.pendingAnchor === null) { R.failed++; return false; }
      const anchorOwner = this.mg.owner(this.pendingAnchor);
      if (anchorOwner !== me) { // allied city as anchor: nothing to build
        const u = this.mg.nearbyUnits(this.pendingAnchor, 2, UnitType.City)[0]?.unit; if (u) { R.anchor = u; return false; }
        R.failed++; return false;
      }
      if (gold < cost(UnitType.City)) return false;
      if (me.canBuild(UnitType.City, this.pendingAnchor) === false) { R.failed++; return false; }
      this.mg.addExecution(new ConstructionExecution(me, UnitType.City, this.pendingAnchor));
      this.pendingAnchorTick = this.mg.ticks();
      if (this.log.length < 200) this.log.push(`t${this.mg.ticks()} rail anchor city`);
      return true;
    }
    // infill along the rails leaving the factory
    if (gold < cost(UnitType.City)) return false;
    const station = this.mg.railNetwork().stationManager().findStation(R.factory);
    if (!station) { R.failed++; return false; }
    for (const rr of station.getRailroads()) {
      const tiles = rr.tiles;
      const fromFactory = rr.from === station ? tiles : [...tiles].reverse();
      for (let i = this.p.railSpacing; i < fromFactory.length - this.p.railSpacing + 2; i += 2) {
        const t = fromFactory[i];
        if (this.mg.owner(t) !== me) continue;
        if (this.mg.hasUnitNearby(t, this.p.railSpacing - 1, UnitType.City) || this.mg.hasUnitNearby(t, this.p.railSpacing - 1, UnitType.Factory) || this.mg.hasUnitNearby(t, this.p.railSpacing - 1, UnitType.Port)) continue;
        if (me.canBuild(UnitType.City, t) === false) continue;
        this.mg.addExecution(new ConstructionExecution(me, UnitType.City, t));
        R.infilled++;
        if (this.log.length < 200) this.log.push(`t${this.mg.ticks()} rail infill city #${R.infilled}`);
        return true;
      }
    }
    // line full: extend once with a second factory beyond the anchor
    if (!R.extended && R.infilled >= 3 && gold >= cost(UnitType.Factory) && R.anchor) {
      const t = this.tileNear(R.anchor.tile(), 30);
      if (t !== null && this.tryBuild(UnitType.Factory, t)) { R.extended = true; return true; }
    }
    return false;
  }
  private firstPortTick = 1e9;
  private lastCounter = new Map<Player, number>();
  private postFailed = new Map<Player, number>();
  private embargoedAt = new Map<Player, number>();
  private bombed = new Map<TileRef, number>();
  private lastInvasionTick = -1e9;
  private pendingAnchor: TileRef | null = null;
  private pendingAnchorTick = -1;
  private pendingFactory: TileRef | null = null;
  private pendingFactoryTick = 0;
  /** Factory spot + anchor 90–108 tiles away in a straight line over our land (or an ally's city within 110). */
  private railFactorySpot(from?: TileRef): { factory: TileRef; anchor: TileRef } | null {
    const me = this.player;
    const starts = from ? [from] : this.sampleTerritory(40);
    let best: { factory: TileRef; anchor: TileRef; score: number } | null = null;
    // allied cities in range are the best anchors (35k a stop)
    const allyCities = this.mg.players().filter((o) => o !== me && me.isFriendly(o)).flatMap((o) => o.units(UnitType.City));
    for (const f of starts) {
      if (me.canBuild(UnitType.Factory, f) === false) continue;
      for (const c of allyCities) {
        const d2 = this.mg.euclideanDistSquared(f, c.tile());
        if (d2 > 105 * 105 || d2 < 40 * 40) continue;
        const sc = 100 + Math.sqrt(d2);
        if (best === null || sc > best.score) best = { factory: f, anchor: c.tile(), score: sc };
      }
      if (best && best.score >= 100) continue;
      const fx = this.mg.x(f), fy = this.mg.y(f);
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        for (let dist = 104; dist >= 80; dist -= 8) {
          const x = Math.round(fx + Math.cos(ang) * dist), y = Math.round(fy + Math.sin(ang) * dist);
          if (!this.mg.isValidCoord(x, y)) continue;
          const t = this.mg.ref(x, y);
          if (this.mg.owner(t) !== me) continue;
          // the straight line must stay on our land (sampled)
          let ok = true;
          for (let k = 0.1; k < 1 && ok; k += 0.1) { const sx = Math.round(fx + (x - fx) * k), sy = Math.round(fy + (y - fy) * k); if (!this.mg.isValidCoord(sx, sy) || this.mg.owner(this.mg.ref(sx, sy)) !== me) ok = false; }
          if (!ok) continue;
          if (me.canBuild(UnitType.City, t) === false) continue;
          const [, db] = closestTile(this.mg, me.borderTiles(), t);
          const sc = dist / 10 + Math.min(db, 30) / 3;
          if (best === null || sc > best.score) best = { factory: f, anchor: t, score: sc };
          break;
        }
      }
    }
    return best ? { factory: best.factory, anchor: best.anchor } : null;
  }

  // ---------------------------------------------------------------- buildings
  private build(ticks: number): void {
    const me = this.player;
    const cost = (u: UnitType) => this.config.unitInfo(u).cost(this.mg, me);
    const gold = me.gold();
    const cities = me.unitsOwned(UnitType.City); // levels
    const cityUnits = me.units(UnitType.City);
    const ports = me.units(UnitType.Port);
    const portLevels = me.unitsOwned(UnitType.Port);
    const capFull = me.troops() > this.cap() * this.p.capFullShare;
    const { rivals, friends } = this.neighbours();
    const seaFull = this.mg.unitCount(UnitType.TradeShip) >= this.p.seaFullShips;
    const upgrade = (u: Unit) => { this.mg.addExecution(new UpgradeStructureExecution(me, u.id())); if (this.log.length < 200) this.log.push(`t${ticks} level ${u.type()} → ${u.level() + 1}`); };

    // 1. defence: a post where a non-bot attack lands, or facing a threat / a boxed-in nation about to betray
    const incoming = me.incomingAttacks().find((a) => a.attacker().type() !== PlayerType.Bot);
    if (incoming && gold >= cost(UnitType.DefensePost) && me.unitsOwned(UnitType.DefensePost) < 8) {
      const tile = this.defensePostTile(incoming.attacker());
      if (tile !== null && this.tryBuild(UnitType.DefensePost, tile)) return;
    }
    if (cityUnits.length >= 1 && ticks >= 900 && gold >= cost(UnitType.DefensePost) && me.unitsOwned(UnitType.DefensePost) < 6) {
      // an ally whose alliance ends within 45 s counts as a threat: Hard nations attack the moment it lapses
      const expiring = me.alliances().filter((al) => al.expiresAt() - ticks < 450).map((al) => al.other(me)).filter((o) => friends.includes(o) && o.troops() >= me.troops() * 0.4);
      const threat = [...expiring, ...rivals].find((r) => ticks - (this.postFailed.get(r) ?? -1e9) > 600 && (r.troops() >= me.troops() * 0.5 || expiring.includes(r) || (r.type() === PlayerType.Nation && me.troops() > r.troops() * 3)) && !this.postFacing(r));
      if (threat) { const tile = this.defensePostTile(threat); if (tile !== null && this.tryBuild(UnitType.DefensePost, tile)) return; this.postFailed.set(threat, ticks); if (this.log.length < 200) this.log.push(`t${ticks} post vs ${threat.name()} FAILED (${tile === null ? "no tile" : "canBuild"})`); }
      else if (ticks % 600 === 0 && this.log.length < 200) this.log.push(`t${ticks} no threat: rivals=${rivals.map((r) => r.name() + ":" + Math.round(r.troops() / 1000) + "k").join(",")} friends=${friends.length}`);
    }
    // 2. SAM once anyone unfriendly on the map has a silo and we have something to protect
    const enemySilos = this.mg.players().some((o) => o !== me && !me.isFriendly(o) && o.type() !== PlayerType.Bot && o.units(UnitType.MissileSilo).length > 0);
    const sams = me.units(UnitType.SAMLauncher);
    if (enemySilos && cities >= 3 && gold >= cost(UnitType.SAMLauncher)) {
      if (sams.length === 0) { const tile = this.interiorTile(UnitType.SAMLauncher); if (tile !== null && this.tryBuild(UnitType.SAMLauncher, tile)) return; }
      else if (sams[0].level() < 2 && me.canUpgradeUnit(sams[0]) && (capFull || gold >= cost(UnitType.SAMLauncher) * 2n)) { upgrade(sams[0]); return; }
    }
    // 3. first three city levels
    if (cities < 3 && gold >= cost(UnitType.City)) {
      const tile = this.interiorTile(UnitType.City);
      if (tile !== null && this.tryBuild(UnitType.City, tile)) return;
    }
    // 4. ports: first port when a partner exists; level the best one to 3 before a second; never past the unit cap or on a full sea
    const partnerTile = cities >= this.p.citiesBeforePort ? this.portTile() : null;
    if (gold >= cost(UnitType.Port) && !(seaFull && portLevels >= 20)) {
      if (ports.length === 0 && partnerTile !== null && this.tryBuild(UnitType.Port, partnerTile)) { this.firstPortTick = ticks; return; }
      if (ports.length > 0) {
        const bestPort = [...ports].sort((a, b) => b.level() - a.level())[0];
        const wantLevel = bestPort.level() < this.p.portLevelBeforeSecond || ports.length >= this.p.maxPortUnits || partnerTile === null;
        if (wantLevel && me.canUpgradeUnit(bestPort) && me.troops() < this.cap() * 0.8) { upgrade(bestPort); return; }
        if (!wantLevel && partnerTile !== null && this.tryBuild(UnitType.Port, partnerTile)) return;
      }
    }
    // 5. rail line: landlocked, or an ally borders us, or the sea is full
    const deadPorts = ports.length > 0 && me.units(UnitType.TradeShip).length === 0 && ticks - this.firstPortTick > 900;
    const wantRail = cities >= 3 && ((ports.length === 0 && partnerTile === null && ticks >= 1500) || deadPorts || (friends.length > 0 && ticks >= 3000) || seaFull) && me.unitsOwned(UnitType.Factory) < 6;
    if (wantRail && this.buildRail(gold, cost)) return;
    // 6. silo when rich enough not to stall the economy, and there is someone to bomb
    const idleAtCap = capFull && me.troops() > this.cap() * 0.9 && me.outgoingAttacks().length === 0;
    const wantSilo = ticks >= this.p.siloAtTick && cities >= 3 && (portLevels >= 3 || me.unitsOwned(UnitType.Factory) > 0 || idleAtCap) && me.units(UnitType.MissileSilo).length === 0 && (rivals.some((r) => r.units(UnitType.City).length >= 2) || idleAtCap);
    if (wantSilo && gold >= cost(UnitType.MissileSilo) + 400_000n) {
      const tile = this.interiorTile(UnitType.MissileSilo);
      if (tile !== null && this.tryBuild(UnitType.MissileSilo, tile)) return;
    }
    // 7. troop cap when full — unless we are saving for a silo
    const siloReserve = wantSilo ? cost(UnitType.MissileSilo) + 400_000n : 0n;
    if (capFull && gold - siloReserve >= cost(UnitType.City)) {
      const city = cityUnits.find((c) => me.canUpgradeUnit(c));
      if (city) { upgrade(city); return; }
      const tile = this.interiorTile(UnitType.City);
      if (tile !== null && this.tryBuild(UnitType.City, tile)) return;
    }
    // 8. spare gold: keep a bomb fund once we own a silo, otherwise a city level. Never hoard.
    const atWar = (this.currentTarget !== null && this.currentTarget.isAlive() && !me.isFriendly(this.currentTarget)) || me.incomingAttacks().some((a) => a.attacker().type() !== PlayerType.Bot);
    const reserve = me.units(UnitType.MissileSilo).length > 0 && (atWar || idleAtCap) ? 1_000_000n : siloReserve;
    if (gold - reserve >= cost(UnitType.City)) {
      const city = cityUnits.find((c) => me.canUpgradeUnit(c));
      if (city) { upgrade(city); return; }
      const tile = this.interiorTile(UnitType.City);
      if (tile !== null && this.tryBuild(UnitType.City, tile)) return;
    }
  }
  private tryBuild(type: UnitType, tile: TileRef): boolean {
    if (this.player.canBuild(type, tile) === false) return false;
    this.mg.addExecution(new ConstructionExecution(this.player, type, tile));
    if (this.log.length < 200) this.log.push(`t${this.mg.ticks()} build ${type}`);
    return true;
  }
  private sampleTerritory(n: number): TileRef[] {
    const size = this.player.numTilesOwned();
    const arr: TileRef[] = [];
    if (size === 0) return arr;
    const step = Math.max(1, Math.floor(size / n));
    let i = 0;
    for (const t of this.player.tiles()) { if (i % step === 0) arr.push(t); i++; if (arr.length >= n) break; }
    return arr;
  }
  private tileNear(center: TileRef, radius: number): TileRef | null {
    const cx = this.mg.x(center), cy = this.mg.y(center);
    let best: TileRef | null = null, bestD = 1e9;
    for (const t of this.sampleTerritory(120)) {
      const d = Math.abs(this.mg.x(t) - cx) + Math.abs(this.mg.y(t) - cy);
      if (d < 16 || d > radius) continue;
      if (d < bestD && this.player.canBuild(UnitType.Factory, t) !== false) { bestD = d; best = t; }
    }
    return best;
  }
  private interiorTile(type: UnitType = UnitType.City): TileRef | null {
    const border = this.player.borderTiles();
    let best: TileRef | null = null, bestD = -1;
    for (const t of this.sampleTerritory(40)) {
      const [, d] = closestTile(this.mg, border, t);
      if (d > bestD && this.player.canBuild(type, t) !== false) { bestD = d; best = t; }
    }
    return best;
  }
  private portTile(): TileRef | null {
    const me = this.player;
    const shared = this.mg.sharedWaterComponents(me);
    const foreignPorts = this.mg.players().filter((p) => p !== me && p.type() !== PlayerType.Bot).flatMap((p) => p.units(UnitType.Port));
    if (foreignPorts.length === 0) return null;
    const shore = Array.from(me.borderTiles()).filter((t) => this.mg.isShore(t));
    if (shore.length === 0) return null;
    const step = Math.max(1, Math.floor(shore.length / 30));
    let best: TileRef | null = null, bestScore = 0;
    for (let i = 0; i < shore.length; i += step) {
      const t = shore[i];
      let comp: number | null = null;
      for (const nb of this.mg.neighbors(t)) {
        if (!this.mg.isWater(nb)) continue;
        const c = this.mg.getWaterComponent(nb);
        if (c !== null && (this.mg.isOcean(nb) || (shared !== null && shared.has(c)))) { comp = c; break; }
      }
      if (comp === null) continue;
      let score = 0;
      for (const fp of foreignPorts) {
        if (!this.mg.hasWaterComponent(fp.tile(), comp)) continue;
        const d = this.mg.manhattanDist(fp.tile(), t);
        if (d >= this.p.portMinPartnerDist) score += d < 800 ? 2 : 1;
      }
      if (score > bestScore && me.canBuild(UnitType.Port, t) !== false) { bestScore = score; best = t; }
    }
    return best;
  }
  private postFacing(r: Player): boolean {
    const rid = r.smallID();
    for (const dp of this.player.units(UnitType.DefensePost)) {
      const near = this.mg.nearbyUnits(dp.tile(), 30, UnitType.DefensePost);
      void near;
      let touches = false;
      // cheap check: any tile of r within 30 manhattan of the post along a sampled ring
      const x = this.mg.x(dp.tile()), y = this.mg.y(dp.tile());
      for (let dy = -30; dy <= 30 && !touches; dy += 6) for (let dx = -30; dx <= 30; dx += 6) {
        if (!this.mg.isValidCoord(x + dx, y + dy)) continue;
        if (this.mg.ownerID(this.mg.ref(x + dx, y + dy)) === rid) { touches = true; break; }
      }
      if (touches) return true;
    }
    return false;
  }
  private defensePostTile(attacker: Player): TileRef | null {
    const me = this.player;
    const aid = attacker.smallID();
    const candidates: TileRef[] = [];
    for (const t of me.borderTiles()) {
      let touches = false;
      this.mg.forEachNeighbor(t, (n) => { if (this.mg.ownerID(n) === aid) touches = true; });
      if (touches) candidates.push(t);
      if (candidates.length > 80) break;
    }
    if (candidates.length === 0) return null;
    // contact midpoint, then step 6–12 tiles away from the attacker's side of the border
    const mid = candidates[Math.floor(candidates.length / 2)];
    const mx = this.mg.x(mid), my = this.mg.y(mid);
    let ax = 0, ay = 0, n = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      if (!this.mg.isValidCoord(mx + dx, my + dy)) continue;
      if (this.mg.ownerID(this.mg.ref(mx + dx, my + dy)) === aid) { ax += dx; ay += dy; n++; }
    }
    if (n === 0) return null;
    const len = Math.hypot(ax, ay) || 1;
    const ux = -ax / len, uy = -ay / len; // away from the attacker
    for (let d = 8; d <= 14; d += 2) {
      for (const [sx, sy] of [[0, 0], [uy, -ux], [-uy, ux]] as [number, number][]) {
        for (let side = 0; side <= 6; side += 3) {
          const x = Math.round(mx + ux * d + sx * side), y = Math.round(my + uy * d + sy * side);
          if (!this.mg.isValidCoord(x, y)) continue;
          const t = this.mg.ref(x, y);
          if (this.mg.owner(t) !== me || !this.mg.isLand(t)) continue;
          if (me.canBuild(UnitType.DefensePost, t) !== false) return t;
        }
      }
    }
    return me.canBuild(UnitType.DefensePost, mid) !== false ? mid : null;
  }

  owner(): Player {
    return this.player;
  }
}
