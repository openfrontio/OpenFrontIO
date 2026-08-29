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
import { GameMapType } from "../../game/Game";
import { AllianceExtensionExecution } from "../alliance/AllianceExtensionExecution";
import { AllianceRequestExecution } from "../alliance/AllianceRequestExecution";
import { DonateTroopsExecution } from "../DonateTroopExecution";
import { AttackExecution } from "../AttackExecution";
import { ConstructionExecution } from "../ConstructionExecution";
import { TransportShipExecution } from "../TransportShipExecution";
import { UpgradeStructureExecution } from "../UpgradeStructureExecution";
import { MirvExecution } from "../MIRVExecution";
import { calculateTerritoryCenter, closestTile } from "../Util";

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
  reserveShare: number; // share of CURRENT troops kept at home by send()/boat() (nations keep 30–40 %); a share of cap froze the bot whenever troops were low
  tribeConcurrency: number; // tribe attacks at once below 60 % of cap (one more above)
  spawnInland: number; // tiles walked inland from the chosen shore
  retreatOnAllianceEnd: boolean;
  splitWatch: boolean; // reconnect a split territory: the owner of the gap becomes the war target
  econWar: boolean; // attack at 1.5× (after a bomb) when our cap is 2× the target's and gold is spare
  wholeWars: boolean; // a war wave is sent whole or not at all (never trimmed by the reserve)
  stickyWar: boolean; // one enemy to the end: the current war target is the only candidate while it lives and borders us
  postsBeforeCity2: boolean; // allow threat posts even while city 2 is unaffordable
  portWithoutPartnerTick: number; // first port on any ocean coast from this tick even with no partner (1e9 = never)
}

export const DEFAULT_PLAYBOOK: PlaybookParams = {
  expandContested: 0.2,
  expandFree: 0.1,
  expandEvery: 10,
  openingAllIn: false, // 30-game lab: 20%/10% clicks each second beat the all-in (24 vs 22 alive, 800k vs 705k tiles)
  openingKeep: 0.15,
  homeFloor: 0.25,
  botRatio: 1.67,
  botMaxShare: 0.5,
  botEarlyShare: 0.15,
  botClickCap: 0.3, // 30-game lab: ties the single click on land, one more survivor; matches the guide's click table
  botFollowUpTicks: 100,
  botsAfterWild: true, // 30-game lab A/B: equal survival, +16% land vs eating tribes as met (driven by a few games; 18/30 pairs identical)
  boatAtTick: 50,
  boatShare: 0.2,
  islandMaxTiles: 20000,
  fightAbove: 0.7,
  fightRatio: 1.67, // Josh: take any 1.67× push that keeps home troops healthy (was 2.0)
  fightNotBeforeTick: 1800,
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
  reserveShare: 0.3,
  tribeConcurrency: 1,
  spawnInland: 0, // 30-game lab: 8 tiles inland = 18/30 alive vs 27/30 on the shore (an inland circle can be surrounded; the coast cannot)
  retreatOnAllianceEnd: true,
  splitWatch: true,
  econWar: true,
  wholeWars: true,
  stickyWar: true,
  postsBeforeCity2: true, // 30-game lab: +8% land, same survival as blocking them
  portWithoutPartnerTick: 1500,
};

export class PlaybookBotExecution implements Execution {
  private active = true;
  private mg!: Game;
  private config!: Config;
  private random: PseudoRandom;
  private boatSent = false;
  private landmassChecked = false;
  private onSmallLandmass = false;
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

  // ---------------------------------------------------------------- situation, invariants, rules
  /** One evaluated picture of the game per tick; every rule reads this instead of re-deriving state. */
  private sit!: {
    tick: number; troops: number; cap: number; capShare: number; reserve: number; spendable: number;
    gold: bigint; bots: Player[]; rivals: Player[]; friends: Player[]; wilderness: boolean;
    incoming: Attack[]; incomingBots: number; outgoing: Attack[]; tribeAttacks: number; boats: number;
    collapsed: Player[]; expiring: Player[]; hold: Player | null;
  };
  private prevAllies = new Set<Player>();
  private prevIncoming = new Set<string>();
  private readSituation(): void {
    const me = this.player;
    const troops = me.troops(), cap = this.cap();
    const nb = this.neighbours();
    const incoming = me.incomingAttacks().filter((a) => a.attacker().type() !== PlayerType.Bot);
    const outgoing = me.outgoingAttacks();
    const reserve = troops * this.p.reserveShare;
    const t = this.mg.ticks();
    this.sit = {
      tick: t, troops, cap, capShare: cap > 0 ? troops / cap : 0, reserve, spendable: Math.max(0, troops - reserve),
      gold: me.gold(), ...nb,
      incoming, incomingBots: me.incomingAttacks().length - incoming.length, outgoing,
      tribeAttacks: outgoing.filter((a) => a.target().isPlayer() && (a.target() as Player).type() === PlayerType.Bot).length,
      boats: me.units(UnitType.TransportShip).length,
      collapsed: nb.rivals.filter((r) => this.collapsed(r)),
      expiring: me.alliances().filter((al) => al.expiresAt() - t < 450).map((al) => al.other(me)),
      hold: null,
    };
    // A Hard nation renews only if we look as strong as it at expiry: 45 s before an alliance with a stronger
    // neighbour lapses, the army stays home so the check sees all of it.
    this.sit.hold = this.sit.expiring.find((o) => o.type() === PlayerType.Nation && o.troops() > troops * 0.85) ?? null;
  }
  /** The one place troops leave home. Never below the reserve; returns what was actually sent (0 = nothing). */
  private send(targetID: string | null, n: number, why: string, min = 500, capFloor = 0): number {
    // capFloor: never leave home under this share of CAP — Hard nations betray an ally under 20 % of cap on sight
    if (this.sit.hold !== null && why !== "counter") { if (this.log.length < 200 && this.sit.tick % 300 === 0) this.log.push(`t${this.sit.tick} holding troops home: alliance with ${this.sit.hold.name()} about to lapse`); return 0; }
    const room = Math.floor(Math.min(this.sit.spendable, this.sit.troops - this.sit.cap * capFloor));
    const amount = Math.min(Math.floor(n), room);
    // a war goes whole or not at all: a 2× wave trimmed to 0.3× by the reserve is the worst attack in the game
    if (this.p.wholeWars && why === "war" && amount < n * 0.9) { if (this.log.length < 200) this.log.push(`t${this.sit.tick} war held: wants ${Math.round(n / 1000)}k, only ${Math.round(room / 1000)}k spare`); return 0; }
    if (amount < min) { if (room < min && this.log.length < 200 && this.sit.tick % 300 === 0) this.log.push(`t${this.sit.tick} held: ${why} wants ${Math.round(n / 1000)}k, ${Math.round(room / 1000)}k above reserve`); return 0; }
    this.mg.addExecution(new AttackExecution(amount, this.player, targetID));
    this.sit.spendable -= amount; this.sit.troops -= amount;
    return amount;
  }
  private boat(tile: TileRef, n: number, why: string): number {
    if (this.sit.hold !== null) return 0;
    const amount = Math.min(Math.floor(n), Math.floor(this.sit.spendable));
    if (amount < 500 || this.player.canBuild(UnitType.TransportShip, tile) === false) return 0;
    this.mg.addExecution(new TransportShipExecution(this.player, tile, amount));
    this.sit.spendable -= amount; this.sit.troops -= amount; this.sit.boats++;
    if (this.log.length < 200) this.log.push(`t${this.sit.tick} boat ${Math.round(amount / 1000)}k: ${why}`);
    return amount;
  }
  /** Things that happened since last tick. Reactions run before the regular rules. */
  private events(): void {
    const me = this.player;
    const allies = new Set(me.allies());
    for (const p of this.prevAllies) {
      if (allies.has(p) || !p.isAlive()) continue;
      this.onAllianceEnded(p);
    }
    this.prevAllies = allies;
    const inc = new Set(this.sit.incoming.map((a) => a.attacker().id()));
    for (const a of this.sit.incoming) {
      if (this.prevIncoming.has(a.attacker().id())) continue;
      if (this.log.length < 200) this.log.push(`t${this.sit.tick} INCOMING ${a.attacker().name()} ${Math.round(a.troops() / 1000)}k`);
    }
    this.prevIncoming = inc;
  }
  /** An alliance ended (expired or broken): bring the army home, mark the post, and treat them as the threat. */
  private onAllianceEnded(p: Player): void {
    const me = this.player;
    if (me.isFriendly(p)) return;
    if (this.log.length < 200) this.log.push(`t${this.sit.tick} ALLIANCE ENDED ${p.name()} ${Math.round(p.troops() / 1000)}k vs our ${Math.round(this.sit.troops / 1000)}k`);
    // if they are stronger, every tribe wave comes home now — the nation attacks within seconds of a lapse
    if (this.p.retreatOnAllianceEnd && p.troops() > this.sit.troops * 0.8) {
      for (const a of this.sit.outgoing) { const t = a.target(); if (t.isPlayer() && (t as Player).type() === PlayerType.Bot) me.orderRetreat(a.id()); }
    }
    this.postFailed.delete(p);
  }
  private rules: { name: string; every: number; run: () => void }[] = [
    { name: "split", every: 200, run: () => { if (this.p.splitWatch) this.watchSplit(); } },
    { name: "counter", every: 10, run: () => this.counterAttack() },
    { name: "retreats", every: 10, run: () => this.manageRetreats() },
    { name: "expand", every: 10, run: () => this.expand() },
    { name: "tribes", every: 10, run: () => this.harvestBots() },
    { name: "wars", every: 10, run: () => this.fight() },
    { name: "alliances", every: 300, run: () => { this.requestAlliances(); this.manageExpiries(); this.manageEmbargoes(); } },
    { name: "early boat", every: 20, run: () => { if (!this.boatSent && this.sit.tick >= this.p.boatAtTick) this.boatSent = this.earlyBoat() || this.sit.tick > this.p.boatAtTick + 600; } },
    { name: "tribe boats", every: 100, run: () => { if (this.sit.tick >= 300) this.huntBotsByBoat(); } },
    { name: "sea expansion", every: 100, run: () => { if (this.sit.tick >= 600) this.seaExpansion(); } },
    { name: "build", every: 10, run: () => { this.build(this.sit.tick); this.maybeBomb(this.sit.tick); } },
    { name: "mirv", every: 100, run: () => this.maybeMIRV() },
  ];

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
    this.readSituation();
    this.acceptAlliances();
    this.events();
    for (const r of this.rules) if (ticks % r.every === 0) r.run();
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

  // ---------------------------------------------------------------- boats in the mid and late game
  private lastSeaTick = -1e9;
  /** Playbook: boats are the answer to a closed land border. Whenever a boat is free and either the land front is
   *  blocked or troops sit above 40 % of cap, send one to the best target across water: free shore first, then a
   *  neighbour we (or a MIRV) have just collapsed, then a weak player with no posts at 3×, then a tribe at 2×. */
  private seaExpansion(): void {
    const me = this.player;
    if (this.sit.boats >= this.config.boatMaxNumber()) return;
    if (this.mg.ticks() - this.lastSeaTick < 100) return;
    if (this.sit.wilderness && this.sit.capShare < 0.4) return; // land first while it is free and we are small
    if (this.sit.incoming.length > 0 && this.sit.capShare < 0.6) return; // under attack: the army stays
    const shore = Array.from(me.borderTiles()).filter((t) => this.mg.isOceanShore(t));
    if (shore.length === 0) return;
    const from = shore[Math.floor(shore.length / 2)];
    const fx = this.mg.x(from), fy = this.mg.y(from);
    const dist = (t: TileRef) => Math.abs(this.mg.x(t) - fx) + Math.abs(this.mg.y(t) - fy);
    const cands: { tile: TileRef; troops: number; score: number; what: string }[] = [];
    // (a) free shore across water: 15 % of home, worth the most per troop
    let seen = 0;
    for (let dy = -300; dy <= 300; dy += 8) for (let dx = -300; dx <= 300; dx += 8) {
      const x = fx + dx, y = fy + dy;
      if (!this.mg.isValidCoord(x, y)) continue;
      const t = this.mg.ref(x, y);
      if (!this.mg.isLand(t) || !this.mg.isOceanShore(t) || this.mg.hasOwner(t)) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < 30 || seen++ > 400) continue;
      cands.push({ tile: t, troops: Math.max(5000, Math.floor(this.sit.troops * 0.15)), score: 300 - d, what: "free shore" });
    }
    // (b) collapsed players (bombed, MIRVed): the follow-up; (c) weak players without posts; (d) tribes
    for (const o of this.mg.players()) {
      if (o === me || !o.isAlive() || me.isFriendly(o) || o.numTilesOwned() < 100) continue;
      const isBot = o.type() === PlayerType.Bot;
      const coll = !isBot && this.collapsed(o);
      const weak = !isBot && o.troops() < this.sit.troops * 0.25 && o.units(UnitType.DefensePost).length === 0;
      if (!isBot && !coll && !weak) continue;
      if (!isBot && !me.canAttackPlayer(o)) continue;
      const want = Math.ceil(o.troops() * (isBot ? 2 : 3)) + 2000;
      if (want > this.sit.spendable * 0.5) continue;
      let i = 0, bestT: TileRef | null = null, bestD = 1e9;
      for (const t of o.borderTiles()) { if ((i++ % 9) !== 0 || !this.mg.isOceanShore(t)) continue; const d = dist(t); if (d < bestD) { bestD = d; bestT = t; } }
      if (bestT === null || bestD > 500) continue;
      const value = coll ? 600 : weak ? 400 : 250;
      cands.push({ tile: bestT, troops: want, score: value - bestD / 2 + (o.units(UnitType.City).length * 10), what: `${coll ? "collapsed " : weak ? "weak " : "tribe "}${o.name()} ${o.numTilesOwned()}t/${Math.round(o.troops() / 1000)}k` });
    }
    cands.sort((a, b) => b.score - a.score);
    for (const c of cands.slice(0, 10)) {
      if (c.troops > this.sit.spendable) continue;
      if (!this.acrossWater(c.tile)) continue;
      if (this.boat(c.tile, c.troops, `sea expansion → ${c.what}`) === 0) continue;
      this.lastSeaTick = this.mg.ticks();
      return;
    }
  }

  // ---------------------------------------------------------------- MIRV and the finish
  private lastMirvTick = -1e9;
  private lastSamTick = -1e9;
  private lastWarTick = -1e9;
  private bombOutOfRange = 0;
  private lastWarshipTick = -1e9;
  /** Playbook phase 6: a MIRV goes to (1) whoever has one in the air at us, (2) anyone over half the map,
   *  (3) from 25:00, the largest un-allied player above us when we are in the top three — launch first, then
   *  the collapse rule sends the army into the emptied land. */
  private maybeMIRV(): void {
    const me = this.player;
    if (me.units(UnitType.MissileSilo).length === 0 || this.mg.config().isUnitDisabled(UnitType.MIRV)) return;
    if (this.mg.ticks() - this.lastMirvTick < 600) return;
    const cost = this.config.unitInfo(UnitType.MIRV).cost(this.mg, me);
    if (me.gold() < cost) return;
    const total = this.mg.numLandTiles();
    const others = this.mg.players().filter((p) => p !== me && p.isAlive() && p.type() !== PlayerType.Bot && !me.isFriendly(p) && !me.isOnSameTeam(p));
    let target: Player | null = null, why = "";
    for (const p of others) for (const m of p.units(UnitType.MIRV)) { const d = m.targetTile(); if (d && this.mg.hasOwner(d) && this.mg.owner(d) === me) { target = p; why = "counter"; } }
    if (!target) { const t = others.filter((p) => p.numTilesOwned() / total >= 0.5).sort((a, b) => b.numTilesOwned() - a.numTilesOwned())[0]; if (t) { target = t; why = "victory denial"; } }
    if (!target && this.mg.ticks() >= 12000) {
      const ranked = this.mg.players().filter((p) => p.isAlive() && p.type() !== PlayerType.Bot).sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
      const myRank = ranked.indexOf(me) + 1;
      if (myRank <= 3) { const t = others.filter((p) => p.numTilesOwned() > me.numTilesOwned() * 0.8).sort((a, b) => b.numTilesOwned() - a.numTilesOwned())[0]; if (t) { target = t; why = `crown (we are #${myRank})`; } }
    }
    if (!target) return;
    const center = calculateTerritoryCenter(this.mg, target);
    if (center === null || me.canBuild(UnitType.MIRV, center) === false) return;
    this.mg.addExecution(new MirvExecution(me, center));
    this.lastMirvTick = this.mg.ticks();
    this.bombs++;
    if (this.log.length < 200) this.log.push(`t${this.mg.ticks()} MIRV ${target.name()} ${target.numTilesOwned()}t (${why})`);
  }

  // ---------------------------------------------------------------- territory integrity
  private splitOwner: Player | null = null;
  private splitTile: TileRef | null = null;
  private splitSince = -1;
  /** Every 20 s: is our land in one piece? If not, find who sits between the main body and the largest other piece.
   *  The engine hands a surrounded piece to the surrounding player, so a split is a countdown. */
  private watchSplit(): void {
    const me = this.player;
    const tiles = me.tiles();
    if (tiles.size < 200) { this.splitOwner = null; return; }
    const seen = new Set<TileRef>();
    const clusters: TileRef[][] = [];
    for (const t of me.borderTiles()) {
      if (seen.has(t)) continue;
      const cl: TileRef[] = []; const q = [t]; seen.add(t);
      while (q.length > 0) { const c = q.pop()!; cl.push(c); for (const n of this.mg.neighbors(c)) { if (seen.has(n) || this.mg.owner(n) !== me) continue; seen.add(n); q.push(n); } }
      clusters.push(cl);
      if (clusters.length > 8) break;
    }
    if (clusters.length <= 1) { if (this.splitOwner !== null && this.log.length < 200) this.log.push(`t${this.mg.ticks()} territory reconnected`); this.splitOwner = null; this.splitTile = null; return; }
    clusters.sort((a, b) => b.length - a.length);
    const main = clusters[0], other = clusters[1];
    // nearest pair of tiles between the two pieces (sampled), then the owner of the midpoint
    let best = 1e18, bt: TileRef | null = null, bo: TileRef | null = null;
    for (let i = 0; i < main.length; i += Math.max(1, Math.floor(main.length / 60))) for (let j = 0; j < other.length; j += Math.max(1, Math.floor(other.length / 60))) {
      const d = this.mg.euclideanDistSquared(main[i], other[j]); if (d < best) { best = d; bt = main[i]; bo = other[j]; }
    }
    if (bt === null || bo === null) return;
    const mx = Math.round((this.mg.x(bt) + this.mg.x(bo)) / 2), my = Math.round((this.mg.y(bt) + this.mg.y(bo)) / 2);
    const mid = this.mg.ref(mx, my);
    const owner = this.mg.owner(mid);
    const who = owner.isPlayer() ? (owner as Player) : null;
    if (this.splitSince < 0) this.splitSince = this.mg.ticks();
    if (who !== this.splitOwner && this.log.length < 200) this.log.push(`t${this.mg.ticks()} SPLIT: ${clusters.length} pieces, second piece ${other.length}+ border tiles, gap ${Math.round(Math.sqrt(best))} tiles held by ${who ? who.name() : "nobody"}`);
    this.splitOwner = who && who !== me && !me.isFriendly(who) ? who : null;
    this.splitTile = this.mg.isLand(mid) && !this.mg.hasOwner(mid) ? mid : null;
  }

  // ---------------------------------------------------------------- annexation
  private annexCache = new Map<Player, { tick: number; ok: boolean }>();
  /** A neighbour we could annex by encirclement: no ocean coast, no map edge, and we already hold at least
   *  40 % of its border. Such a neighbour must never be an ally (an ally's cluster never flips). */
  private annexable(p: Player): boolean {
    const c = this.annexCache.get(p);
    if (c && this.mg.ticks() - c.tick < 100) return c.ok;
    let ok = true, ours = 0, n = 0, i = 0;
    for (const t of p.borderTiles()) {
      if (this.mg.isOceanShore(t) || this.mg.isOnEdgeOfMap(t)) { ok = false; break; }
      if ((i++ % 3) !== 0) continue;
      n++;
      for (const nb of this.mg.neighbors(t)) { if (this.mg.owner(nb) === this.player) { ours++; break; } }
    }
    ok = ok && n > 0 && ours / n >= 0.4 && p.numTilesOwned() < this.player.numTilesOwned();
    this.annexCache.set(p, { tick: this.mg.ticks(), ok });
    if (ok && !(c && c.ok) && this.log.length < 200) this.log.push(`t${this.mg.ticks()} ANNEX target ${p.name()} ${p.numTilesOwned()}t (${Math.round((100 * ours) / n)} % of its border is ours)`);
    return ok;
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
      this.send(this.mg.terraNullius().id(), send, "all-in", 100);
      return;
    }
    // free land is the cheapest growth there is and unused troops come home: only the troop reserve applies, not the cap floor
    const ringing = [...this.sit.rivals, ...this.sit.bots, ...this.sit.friends].some((r) => this.annexable(r));
    const frac = rivals.length > 0 || ringing || this.splitTile !== null ? this.p.expandContested : this.p.expandFree;
    this.send(this.mg.terraNullius().id(), Math.floor(this.sit.troops * frac), "expand", 100);
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
    // invariant: one tribe at a time below 60 % of cap, two above — three at once is how the army disappears
    const maxConcurrent = this.p.tribeConcurrency + (this.sit.capShare > 0.6 ? 1 : 0);
    let active = this.sit.tribeAttacks;
    let clicks = 0;
    for (const bot of bots) {
      if (!me.canAttackPlayer(bot) || !this.reachable(bot)) continue;
      const want = Math.ceil(bot.troops() * this.p.botRatio) + 500;
      const running = this.outgoingTo(bot);
      if (running) {
        // follow-up click: the guide's two-click — a second wave 10 s later merges into the first
        const w = this.waves.get(bot);
        if (!w || w.sent >= w.want || this.mg.ticks() - w.last < this.p.botFollowUpTicks) continue;
        const send = this.send(bot.id(), Math.min(w.want - w.sent, Math.floor(this.sit.troops * this.p.botClickCap)), "tribe follow-up");
        if (send === 0) continue;
        w.sent += send; w.last = this.mg.ticks();
        continue;
      }
      if (active >= maxConcurrent) continue;
      const maxSend = Math.floor(this.sit.spendable * (early ? this.p.botEarlyShare : this.p.botMaxShare));
      if (want > maxSend) continue;
      const first = this.send(bot.id(), Math.min(want, Math.floor(this.sit.troops * this.p.botClickCap)), "tribe");
      if (first === 0) continue;
      active++;
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
      const send = this.send(a.id(), Math.min(Math.ceil(inc.troops() * 1.05), Math.floor(this.sit.troops * 0.5)), "counter", 1000);
      if (send === 0) continue;
      this.noteSent(a);
      this.counters.add(a);
      if (this.log.length < 200) this.log.push(`t${this.mg.ticks()} COUNTER ${a.name()} (${Math.round(inc.troops() / 1000)}k incoming) with ${Math.round(send / 1000)}k`);
    }
  }

  // ---------------------------------------------------------------- fighting rivals
  /** Playbook: a neighbour that has just been bombed or MIRVed is the best target on the map. Troops or land
   *  down by half inside 10 s marks it collapsed for the next 60 s. */
  private collapsed(r: Player): boolean {
    const now = this.mg.ticks();
    const h = this.history.get(r);
    if (h && now - h.tick < 100) return now < h.collapsedUntil;
    const snap = { tick: now, troops: r.troops(), tiles: r.numTilesOwned(), collapsedUntil: h?.collapsedUntil ?? -1 };
    if (h && (r.troops() < h.troops * 0.5 || r.numTilesOwned() < h.tiles * 0.5)) { snap.collapsedUntil = now + 600; if (this.log.length < 200) this.log.push(`t${now} ${r.name()} COLLAPSED ${Math.round(h.troops / 1000)}k→${Math.round(r.troops() / 1000)}k, ${h.tiles}→${r.numTilesOwned()} tiles`); }
    this.history.set(r, snap);
    return now < snap.collapsedUntil;
  }
  private history = new Map<Player, { tick: number; troops: number; tiles: number; collapsedUntil: number }>();

  private fight(): void {
    const me = this.player;
    const cap = this.cap();
    const nb = this.neighbours();
    for (const r of nb.rivals) this.collapsed(r);
    const gapOwner = this.splitOwner && this.splitOwner.isAlive() && nb.rivals.includes(this.splitOwner) ? this.splitOwner : null;
    const opportunity = (this.mg.ticks() >= 3000 && nb.rivals.some((r) => this.collapsed(r) && r.troops() < this.sit.troops * 0.5)) || gapOwner !== null;
    // crown, not survival: a war is on when we can afford 2× someone's whole army out of the spendable troops,
    // not only when troops reach 70 % of a cap that cities keep raising
    const affordable = this.mg.ticks() >= this.p.fightNotBeforeTick && nb.rivals.some((r) => r.troops() * this.p.fightRatio + 1000 <= this.sit.spendable * this.p.fightMaxShare);
    if (!affordable && !opportunity && me.troops() < cap * this.p.fightAbove) return; // a 1.67× push that keeps home healthy is always taken
    const atCapNow = me.troops() >= cap * 0.95;
    // invariant: one war at a time (two at cap); seven at once is how a 17M army evaporates
    const wars = this.sit.outgoing.filter((a) => a.target().isPlayer() && (a.target() as Player).type() !== PlayerType.Bot && !this.counters.has(a.target() as Player)).length;
    if (wars >= (this.mg.ticks() >= 15000 && atCapNow ? 2 : 1) && !opportunity) return;
    const early = !atCapNow && !opportunity && (this.mg.ticks() < this.p.fightNotBeforeTick || me.unitsOwned(UnitType.City) < this.p.fightMinCities);
    let { rivals } = nb;
    // before the 5-minute mark only clear prey: a neighbour we can hit with 2.5× its whole army
    if (early) rivals = rivals.filter((r) => r.troops() * 2.5 <= me.troops() * this.p.fightMaxShare && r.numTilesOwned() <= me.numTilesOwned());
    if (rivals.length === 0) return;
    if (this.currentTarget && (!this.currentTarget.isAlive() || !rivals.includes(this.currentTarget))) this.currentTarget = null;
    let candidates = rivals.filter((r) => me.canAttackPlayer(r) && !this.outgoingTo(r) && this.reachable(r));
    // one enemy at a time, to the end: nations nuke whoever attacks them, and eight half-wars make eight nuclear enemies.
    // The current target stays the only candidate while it lives, borders us, and was hit within the last three minutes.
    if (this.p.stickyWar && this.currentTarget && this.currentTarget.isAlive() && rivals.includes(this.currentTarget) && this.mg.ticks() - this.lastWarTick < 1800) {
      candidates = candidates.filter((r) => r === this.currentTarget || this.collapsed(r) || r === gapOwner);
    }
    if (candidates.length === 0) return;
    const atCap = me.troops() >= cap * 0.95;
    const endgame = this.mg.ticks() >= 15000; // 25:00 — the finish: land now is worth more than troops later
    // At cap every troop above the line is wasted growth, so commit more and accept a thinner edge.
    const maxSend = Math.floor(me.troops() * (atCap || endgame ? 0.7 : this.p.fightMaxShare));
    const minRatio = atCap || endgame ? 1.2 : this.p.fightRatio;
    const richer = (r: Player) => this.p.econWar && this.cap() >= this.config.maxTroops(r) * 2 && this.sit.gold >= 1_000_000n; // we replace losses, they cannot
    const attackingUs = new Set(me.incomingAttacks().map((a) => a.attacker()));
    const score = (r: Player) => {
      const ratio = maxSend / Math.max(1, r.troops());
      if (this.collapsed(r) && r.troops() < this.sit.troops * 0.5) return ratio >= 1.5 ? 20 + ratio : -1; // bombed: go now at 1.5×, posts are gone
      if (r === gapOwner) return ratio >= 1.2 ? 30 + ratio : -1; // they are cutting our land in two: reconnect before the piece is handed over
      // at cap, a neighbour already attacking us is a fair fight at 1:1 — the counter-attack cancels its wave anyway
      if (ratio < (atCap && attackingUs.has(r) ? 1.0 : richer(r) ? Math.min(minRatio, 1.5) : minRatio)) return -1;
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
    const wantRaw = Math.min(Math.ceil(best.troops() * (richer(best) ? Math.min(this.p.fightRatio, 1.5) : this.p.fightRatio)) + 1000, maxSend);
    if (richer(best) && best !== this.currentTarget && me.units(UnitType.MissileSilo).length > 0 && this.mg.ticks() - this.lastBombTick > 100) { this.currentTarget = best; this.maybeBomb(this.mg.ticks()); } // open the war with a bomb on their cluster
    if (wantRaw < 1000) return;
    this.currentTarget = best;
    if (!me.hasEmbargoAgainst(best) && best.type() !== PlayerType.Nation) { me.addEmbargo(best, false); this.embargoedAt.set(best, this.mg.ticks()); }
    const want = this.send(best.id(), wantRaw, "war", 1000, 0.3);
    if (want === 0) return;
    this.lastWarTick = this.mg.ticks();
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
  /** Phase 0 of the playbook: score every shore tile. Coast required; enough land around; no nation within
   *  `veto` tiles (relaxed in stages); nations near cost points, tribes near earn them; an edge at your back
   *  helps; other humans on the spot hurt. `prefer` keeps the search inside a region (lab use). */
  static pickSpawn(game: Game, prefer?: [number, number], exclude: [number, number][] = []): TileRef | null {
    const nations: TileRef[] = [], tribes: TileRef[] = [], humans: TileRef[] = [];
    for (const p of game.players()) {
      const t = p.spawnTile();
      if (t === undefined) continue;
      if (p.type() === PlayerType.Nation) nations.push(t); else if (p.type() === PlayerType.Bot) tribes.push(t); else humans.push(t);
    }
    const W = game.width(), H = game.height();
    const isWorld = game.config().gameConfig().gameMap === GameMapType.World;
    const stages: [number, number][] = prefer ? [[110, 250], [88, 300], [66, 350], [50, 400]] : [[110, 1e9], [80, 1e9], [50, 1e9]];
    const step = prefer ? 3 : 4;
    for (const [veto, radius] of stages) {
      let best: TileRef | null = null, bestS = -1e9;
      for (let y = 30; y < H - 30; y += step) {
        if (isWorld && y > H * 0.88) break; // Antarctica: no nations, no trade partners, no game
        for (let x = 30; x < W - 30; x += step) {
          if (prefer && Math.hypot(x - prefer[0], y - prefer[1]) > radius) continue;
          if (exclude.some(([ex, ey]) => Math.hypot(x - ex, y - ey) < 120)) continue; // lab: distinct spawns per batch
          const t = game.ref(x, y);
          if (!game.isLand(t) || !game.isOceanShore(t) || game.hasOwner(t)) continue; // an ocean coast, not a lake: lakes have no trade partners and no un-annexable border
          let land = 0;
          for (let dy = -15; dy <= 15; dy += 5) for (let dx = -15; dx <= 15; dx += 5) { if (game.isValidCoord(x + dx, y + dy) && game.isLand(game.ref(x + dx, y + dy))) land++; }
          if (land < 22) continue; // a straight coast is about half land within 15 tiles
          let score = 0, near = 0, ok = true;
          for (const n of nations) { const d = Math.abs(game.x(n) - x) + Math.abs(game.y(n) - y); if (d < veto) { ok = false; break; } if (d < 200) near += 4; else if (d < 300) near += 1; }
          if (!ok) continue;
          score -= Math.min(near, 12);
          for (const b of tribes) { const d = Math.abs(game.x(b) - x) + Math.abs(game.y(b) - y); if (d < 150) score += 3; else if (d < 250) score += 1; }
          for (const h of humans) { const d = Math.abs(game.x(h) - x) + Math.abs(game.y(h) - y); if (d < 150) score -= 3; }
          if (Math.min(x, y, W - x, H - y) < 80) score += 2;
          let room = 0; for (let dy = -50; dy <= 50; dy += 10) for (let dx = -50; dx <= 50; dx += 10) { if (game.isValidCoord(x + dx, y + dy)) { const r = game.ref(x + dx, y + dy); if (game.isLand(r) && !game.hasOwner(r)) room++; } }
          score += room / 20; // free land within 50 tiles: a pocket between two nations has little
          let left = false, right = false, up = false, down = false;
          for (const n of nations) { const d = Math.abs(game.x(n) - x) + Math.abs(game.y(n) - y); if (d > 260) continue; if (game.x(n) < x - 60) left = true; if (game.x(n) > x + 60) right = true; if (game.y(n) < y - 60) up = true; if (game.y(n) > y + 60) down = true; }
          if ((left && right) || (up && down)) score -= 5; // sandwiched
          if (prefer) score -= Math.hypot(x - prefer[0], y - prefer[1]) / 60;
          if (score > bestS) { bestS = score; best = t; }
        }
      }
      if (best !== null) { PlaybookBotExecution.lastSpawnDiag = `tick ${game.ticks()} nations=${nations.length} tribes=${tribes.length} humans=${humans.length} stage veto=${veto} score=${bestS.toFixed(1)} at ${game.x(best)},${game.y(best)}`; return PlaybookBotExecution.inland(game, best, DEFAULT_PLAYBOOK.spawnInland); }
    }
    PlaybookBotExecution.lastSpawnDiag = `no spawn: nations=${nations.length}`;
    return null;
  }
  static lastSpawnDiag = "";
  /** Walk `d` tiles away from the sea in the direction with the most land, so the spawn circle is not half water. */
  private static inland(game: Game, shore: TileRef, d: number): TileRef {
    const sx = game.x(shore), sy = game.y(shore);
    let best = shore, bestLand = -1;
    for (let a = 0; a < 16; a++) {
      const x = Math.round(sx + Math.cos((a / 16) * Math.PI * 2) * d), y = Math.round(sy + Math.sin((a / 16) * Math.PI * 2) * d);
      if (!game.isValidCoord(x, y)) continue;
      const t = game.ref(x, y);
      if (!game.isLand(t) || game.hasOwner(t)) continue;
      let land = 0;
      for (let dy = -6; dy <= 6; dy += 3) for (let dx = -6; dx <= 6; dx += 3) { if (game.isValidCoord(x + dx, y + dy) && game.isLand(game.ref(x + dx, y + dy))) land++; }
      if (land > bestLand) { bestLand = land; best = t; }
    }
    return best;
  }

  /** True when no land path from `t` reaches our territory (flood fill capped at `cap` tiles). */
  private acrossWater(t: TileRef, cap = 4000): boolean {
    const me = this.player;
    const seen = new Set<TileRef>([t]);
    const q: TileRef[] = [t];
    while (q.length > 0 && seen.size < cap) {
      const c = q.pop()!;
      if (this.mg.owner(c) === me) return false;
      for (const n of this.mg.neighbors(c)) { if (!this.mg.isLand(n) || seen.has(n)) continue; seen.add(n); q.push(n); }
    }
    return true;
  }

  /** Playbook 0:05–0:10: one 20 % boat to a tribe across water (2× its troops) or, failing that, the nearest empty shore across water. */
  private earlyBoat(): boolean {
    const me = this.player;
    if (me.unitCount(UnitType.TransportShip) >= this.config.boatMaxNumber()) return false;
    const shore = Array.from(me.borderTiles()).filter((t) => this.mg.isShore(t));
    if (shore.length === 0) return false;
    const from = shore[Math.floor(shore.length / 2)];
    const fx = this.mg.x(from), fy = this.mg.y(from);
    const dist = (t: TileRef) => Math.abs(this.mg.x(t) - fx) + Math.abs(this.mg.y(t) - fy);
    const cands: { tile: TileRef; troops: number; d: number; what: string }[] = [];
    for (const bot of this.mg.players()) {
      if (bot.type() !== PlayerType.Bot || !bot.isAlive()) continue;
      const want = Math.ceil(bot.troops() * 2) + 500; // a beach landing costs more than a land attack: 2×, not 1.67×
      if (want > me.troops() * 0.4) continue;
      let i = 0, bestT: TileRef | null = null, bestD = 1e9;
      for (const t of bot.borderTiles()) { if ((i++ % 5) !== 0 || !this.mg.isShore(t)) continue; const d = dist(t); if (d < bestD) { bestD = d; bestT = t; } }
      if (bestT !== null && bestD <= 250) cands.push({ tile: bestT, troops: Math.max(want, Math.floor(me.troops() * this.p.boatShare)), d: bestD + 80, what: `tribe ${bot.name()}` }); // open shore preferred: free land, no losses; a tribe only when no empty coast is near
    }
    for (let dy = -200; dy <= 200; dy += 6) for (let dx = -200; dx <= 200; dx += 6) {
      const x = fx + dx, y = fy + dy;
      if (!this.mg.isValidCoord(x, y)) continue;
      const t = this.mg.ref(x, y);
      if (!this.mg.isLand(t) || !this.mg.isShore(t) || this.mg.hasOwner(t)) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d >= 30) cands.push({ tile: t, troops: Math.floor(me.troops() * this.p.boatShare), d, what: "empty shore" });
    }
    cands.sort((a, b) => a.d - b.d);
    for (const c of cands.slice(0, 16)) {
      if (c.troops < 500 || !this.acrossWater(c.tile)) continue;
      if (this.boat(c.tile, c.troops, `early boat → ${c.what}, ${c.d} tiles`) === 0) continue;
      return true;
    }
    return false;
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
    return this.boat(best, Math.floor(this.sit.troops * this.p.boatShare), `island boat, ${bestD} tiles`) > 0;
  }

  /** No bots on our borders: boat to the nearest bot within reach, with 1.67× its troops. */
  private boatedAt = new Map<Player, number>();
  private huntBotsByBoat(): void {
    const me = this.player;
    if (this.neighbours().bots.length > 0) return;
    if (me.units(UnitType.TransportShip).length > 0) return; // one landing at a time; a second boat to the same beach is the 'boat that takes no land'
    if (me.troops() < this.cap() * 0.4) return;
    const shore = Array.from(me.borderTiles()).filter((t) => this.mg.isShore(t));
    if (shore.length === 0) return;
    const from = shore[Math.floor(shore.length / 2)];
    const fx = this.mg.x(from), fy = this.mg.y(from);
    let best: TileRef | null = null, bestBot: Player | null = null, bestD = 1e9;
    for (const bot of this.mg.players()) {
      if (bot.type() !== PlayerType.Bot || !bot.isAlive() || bot.numTilesOwned() < 100) continue;
      if (this.mg.ticks() - (this.boatedAt.get(bot) ?? -1e9) < 900) continue;
      const want = Math.ceil(bot.troops() * 2) + 500;
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
    if (!this.acrossWater(best)) return; // reachable by land: that is a land attack, not a boat
    const troops = Math.ceil(bestBot.troops() * 2) + 500;
    if (troops > this.sit.spendable) return;
    if (this.boat(best, troops, `to tribe ${bestBot.name()} ${bestBot.numTilesOwned()}t/${Math.round(bestBot.troops() / 1000)}k, ${bestD} tiles`) === 0) return;
    this.boatedAt.set(bestBot, this.mg.ticks());
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
      if (o.troops() > me.troops() * 0.25 || o.numTilesOwned() < 300 || o.units(UnitType.DefensePost).length > 0) continue;
      let i = 0;
      for (const t of o.borderTiles()) {
        if ((i++ % 9) !== 0 || !this.mg.isShore(t)) continue;
        const d = Math.abs(this.mg.x(t) - fx) + Math.abs(this.mg.y(t) - fy);
        if (d > 500) continue;
        const score = this.density(o) / 10 + o.units(UnitType.City).length * 2 - d / 100 - o.units(UnitType.DefensePost).length * 2;
        if (best === null || score > best.score) best = { tile: t, p: o, d, score };
      }
    }
    if (best === null) return;
    const troops = Math.min(Math.floor(this.sit.spendable * 0.5), Math.floor(this.sit.troops - this.sit.cap * 0.3), Math.ceil(best.p.troops() * 3) + 5000);
    if (troops < 20000 || troops < best.p.troops() * 3) return; // a landing under 3× is the boat that takes no land
    if (this.boat(best.tile, troops, `INVADE ${best.p.name()} ${best.p.numTilesOwned()}t/${Math.round(best.p.troops() / 1000)}k, ${best.d} tiles`) === 0) return;
    this.lastInvasionTick = this.mg.ticks();
  }

  // ---------------------------------------------------------------- alliances
  private acceptAlliances(): void {
    for (const req of this.player.incomingAllianceRequests()) {
      const r = req.requestor();
      if (r.type() === PlayerType.Bot) continue;
      if (r === this.currentTarget || r === this.plannedTarget) continue;
      if (this.isPrey(r) || this.annexable(r)) continue;
      req.accept();
    }
  }
  /** A weaker neighbour is food: with two or more neighbours we keep the weakest one unallied so the army has somewhere to go. */
  private isPrey(o: Player): boolean {
    const me = this.player;
    // Crown, not survival: the single weakest neighbour is never allied when we can take it (2× its army within our
    // share), from 30 s on — an alliance made at 1:00 otherwise locks the whole mid game until 11:00.
    if (this.mg.ticks() < 300) return false;
    if (o.troops() < me.troops() * 0.5 && this.mg.ticks() >= 1200) return true;
    const all = [...this.neighbours().rivals, ...this.neighbours().friends].filter((p) => p.type() !== PlayerType.Bot);
    if (all.length < 2) return false;
    const weakest = all.reduce((a, b) => (b.troops() < a.troops() ? b : a));
    return o === weakest && o.troops() * 2 < me.troops() * this.p.fightMaxShare && o.numTilesOwned() <= me.numTilesOwned() * 1.5;
  }

  private requestAlliances(): void {
    const me = this.player;
    const { rivals } = this.neighbours();
    rivals.sort((a, b) => b.troops() - a.troops());
    for (const o of rivals) {
      if (o === this.currentTarget || o === this.plannedTarget) continue;
      if (this.isPrey(o) || this.annexable(o)) continue; // an ally can never be annexed
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
      const prey = (friends.includes(other) && other.troops() < me.troops() * 0.4 && me.troops() > this.cap() * this.p.fightAbove && rivals.length <= 1) || this.annexable(other);
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
    for (const inc of me.incomingAttacks()) { const a = inc.attacker(); if (a.type() !== PlayerType.Bot && !me.isFriendly(a) && inc.troops() > me.troops() * 0.05) enemies.add(a); }
    if (this.plannedTarget && this.plannedTarget.isAlive() && !me.isFriendly(this.plannedTarget)) enemies.add(this.plannedTarget);
    for (const r of this.sit.collapsed) if (!me.isFriendly(r)) enemies.add(r);
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
    if (me.canBuild(best.type, best.tile) === false) { this.bombOutOfRange++; return; }
    this.bombOutOfRange = 0;
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
    if (R.failed > 20) { if (this.mg.ticks() % 3000 === 0) R.failed = 0; else return false; } // try again every 5 min
    if (R.factory && !R.factory.isActive()) { R.factory = null; R.anchor = null; R.infilled = 0; }
    if (R.factory === null && this.pendingFactory !== null) {
      const u = this.mg.nearbyUnits(this.pendingFactory, 3, UnitType.Factory).find((x) => x.unit.owner() === me)?.unit;
      if (u) { R.factory = u; this.pendingFactory = null; } else if (this.mg.ticks() - this.pendingFactoryTick > 400) { this.pendingFactory = null; R.failed++; if (this.log.length < 200) this.log.push(`t${this.mg.ticks()} rail factory never appeared`); } // a factory takes 10 s to build; 60 ticks was too short and bought a second factory every minute
      return false;
    }
    if (R.factory === null) {
      if (gold < cost(UnitType.Factory)) return false;
      const spot = this.railFactorySpot();
      if (spot === null) { R.failed++; if (this.log.length < 200 && R.failed % 5 === 1) this.log.push(`t${this.mg.ticks()} rail: no factory spot (${this.railDiag})`); return false; }
      if (this.tryBuild(UnitType.Factory, spot.factory)) { this.pendingAnchor = spot.anchor; this.pendingFactory = spot.factory; this.pendingFactoryTick = this.mg.ticks(); return true; }
      R.failed++; return false;
    }
    if (R.anchor === null && this.pendingAnchor !== null && this.pendingAnchorTick >= 0) {
      const u = this.mg.nearbyUnits(this.pendingAnchor, 3, UnitType.City).find((x) => x.unit.owner() === me)?.unit;
      if (u) { R.anchor = u; this.pendingAnchorTick = -1; } else if (this.mg.ticks() - this.pendingAnchorTick > 400) { this.pendingAnchorTick = -1; R.failed++; }
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
    const infill = this.railInfillTile();
    if (infill === null && R.failed < 1e9 && !this.mg.railNetwork().stationManager().findStation(R.factory)) { R.failed++; return false; }
    if (infill !== null) {
      this.mg.addExecution(new ConstructionExecution(me, UnitType.City, infill));
      R.infilled++;
      if (this.log.length < 200) this.log.push(`t${this.mg.ticks()} rail infill city #${R.infilled}`);
      return true;
    }
    // line full: extend once with a second factory beyond the anchor
    if (!R.extended && R.infilled >= 3 && gold >= cost(UnitType.Factory) && R.anchor) {
      const t = this.tileNear(R.anchor.tile(), 30);
      if (t !== null && this.tryBuild(UnitType.Factory, t)) { R.extended = true; return true; }
    }
    return false;
  }
  /** Next free spot for a city on the rails leaving our factory (the guide's snapped line), or null. */
  private railInfillTile(): TileRef | null {
    const me = this.player;
    const R = this.rail;
    if (R.factory === null || !R.factory.isActive()) return null;
    const station = this.mg.railNetwork().stationManager().findStation(R.factory);
    if (!station) return null;
    for (const rr of station.getRailroads()) {
      const tiles = rr.tiles;
      const fromFactory = rr.from === station ? tiles : [...tiles].reverse();
      for (let i = this.p.railSpacing; i < fromFactory.length - this.p.railSpacing + 2; i += 2) {
        const t = fromFactory[i];
        if (this.mg.owner(t) !== me) continue;
        if (this.mg.hasUnitNearby(t, this.p.railSpacing - 1, UnitType.City) || this.mg.hasUnitNearby(t, this.p.railSpacing - 1, UnitType.Factory) || this.mg.hasUnitNearby(t, this.p.railSpacing - 1, UnitType.Port)) continue;
        if (me.canBuild(UnitType.City, t) === false) continue;
        return t;
      }
    }
    return null;
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
    let okStarts = 0, anchorsTried = 0;
    let best: { factory: TileRef; anchor: TileRef; score: number } | null = null;
    // allied cities in range are the best anchors (35k a stop)
    const allyCities = this.mg.players().filter((o) => o !== me && me.isFriendly(o)).flatMap((o) => o.units(UnitType.City));
    for (const f of starts) {
      if (me.canBuild(UnitType.Factory, f) === false) continue;
      okStarts++;
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
        for (let dist = 104; dist >= 40; dist -= 8) { // a 40-tile line still fits two stations; small empires need short lines
          const x = Math.round(fx + Math.cos(ang) * dist), y = Math.round(fy + Math.sin(ang) * dist);
          if (!this.mg.isValidCoord(x, y)) continue;
          const t = this.mg.ref(x, y);
          if (this.mg.owner(t) !== me) continue;
          anchorsTried++;
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
    this.railDiag = `starts=${starts.length} canBuild=${okStarts} anchorsOnOurLand=${anchorsTried}`;
    return best ? { factory: best.factory, anchor: best.anchor } : null;
  }
  private railDiag = "";

  /** Nations MIRV the city leader once it has >10 city units and 1.25× (Hard) / 1.5× (Medium) the runner-up's count.
   *  Stay under that line: past it, cap comes from city levels, which the rule does not count. */
  private cityUnitCap(): number {
    const me = this.player;
    let second = 0;
    for (const p of this.mg.players()) { if (p === me || !p.isAlive() || p.type() === PlayerType.Bot) continue; second = Math.max(second, p.unitCount(UnitType.City)); }
    return Math.max(9, Math.floor(second * 1.15));
  }
  private rank(): number {
    const me = this.player;
    return this.mg.players().filter((p) => p.isAlive() && p.type() !== PlayerType.Bot && p.numTilesOwned() > me.numTilesOwned()).length + 1;
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
    const cityCapHit = cityUnits.length >= this.cityUnitCap();
    const myRank = ticks >= 9000 ? this.rank() : 99;
    // top three after 20:00: half of every gold pile is the MIRV fund — a crown without a MIRV loses to the first one fired
    // top three from 20:00: the whole MIRV price is reserved (it rises 15M with every launch on the map, so the first
    // launch is the cheap one); the economy keeps buying only while troops are under 40 % of cap
    const mirvFund = ticks >= 12000 && myRank <= 3 && me.units(UnitType.MissileSilo).length > 0 && me.units(UnitType.MIRV).length === 0 && me.troops() >= this.cap() * 0.4 ? this.config.unitInfo(UnitType.MIRV).cost(this.mg, me) : 0n;
    const seaFull = this.mg.unitCount(UnitType.TradeShip) >= this.p.seaFullShips || ticks >= 15000; // guide: nothing bought after 25:00 pays back
    const upgrade = (u: Unit) => { this.mg.addExecution(new UpgradeStructureExecution(me, u.id())); if (this.log.length < 200) this.log.push(`t${ticks} level ${u.type()} → ${u.level() + 1}`); };

    // 1. defence: a post where a non-bot attack lands, or facing a threat / a boxed-in nation about to betray
    const incoming = me.incomingAttacks().find((a) => a.attacker().type() !== PlayerType.Bot);
    if (incoming && gold >= cost(UnitType.DefensePost) && me.unitsOwned(UnitType.DefensePost) < 8) {
      const tile = this.defensePostTile(incoming.attacker());
      if (tile !== null && this.tryBuild(UnitType.DefensePost, tile)) return;
    }
    if (cityUnits.length >= 1 && ticks >= 900 && gold >= cost(UnitType.DefensePost) + (cityUnits.length < 2 && !this.p.postsBeforeCity2 ? cost(UnitType.City) : 0n) && me.unitsOwned(UnitType.DefensePost) < 6) { // a threat post never delays city 2; an actual incoming attack (above) still gets one
      // an ally whose alliance ends within 45 s counts as a threat: Hard nations attack the moment it lapses
      const expiring = me.alliances().filter((al) => al.expiresAt() - ticks < 450).map((al) => al.other(me)).filter((o) => friends.includes(o) && o.troops() >= me.troops() * 0.4);
      const threat = [...expiring, ...rivals].find((r) => ticks - (this.postFailed.get(r) ?? -1e9) > 600 && (r.troops() >= me.troops() * 0.5 || expiring.includes(r) || (r.type() === PlayerType.Nation && me.troops() > r.troops() * 3)) && !this.postFacing(r));
      if (threat) { const tile = this.defensePostTile(threat); if (tile !== null && this.tryBuild(UnitType.DefensePost, tile)) return; this.postFailed.set(threat, ticks); if (this.log.length < 200) this.log.push(`t${ticks} post vs ${threat.name()} FAILED (${tile === null ? "no tile" : "canBuild"})`); }
      else if (ticks % 600 === 0 && this.log.length < 200) this.log.push(`t${ticks} no threat: rivals=${rivals.map((r) => r.name() + ":" + Math.round(r.troops() / 1000) + "k").join(",")} friends=${friends.length}`);
    }
    // 2. SAM once anyone unfriendly on the map has a silo, or once we are top three after 15:00 (the crown gets MIRVed);
    //    level 3 when leading; a second launcher when the city stack outgrows one umbrella
    const enemySilos = this.mg.players().some((o) => o !== me && !me.isFriendly(o) && o.type() !== PlayerType.Bot && o.units(UnitType.MissileSilo).length > 0);
    const sams = me.units(UnitType.SAMLauncher);
    const samTarget = enemySilos || ticks >= 7200 || myRank <= 3 ? Math.max(1, Math.ceil(cityUnits.length / 8)) : 0; // nations: 0.25 per city on Hard; the bot can afford 1 per 8
    const wantSam = sams.length < samTarget || myRank <= 3;
    if (wantSam && gold >= cost(UnitType.SAMLauncher) && ticks - this.lastSamTick >= 400) { // a launcher takes 30 s to build; don't order another meanwhile
      if (sams.length === 0) { const tile = this.interiorTile(UnitType.SAMLauncher); if (tile !== null && this.tryBuild(UnitType.SAMLauncher, tile)) { this.lastSamTick = ticks; return; } }
      else {
        const targetLevel = myRank === 1 ? 3 : 2;
        const low = sams.find((sm) => sm.level() < targetLevel && me.canUpgradeUnit(sm));
        if (low && (capFull || gold >= cost(UnitType.SAMLauncher) * 2n)) { upgrade(low); return; }
        if (sams.length < samTarget && gold >= cost(UnitType.SAMLauncher) + 500_000n) {
          const far = this.sampleTerritory(30).find((t) => sams.every((sm) => this.mg.euclideanDistSquared(sm.tile(), t) > 60 * 60) && me.canBuild(UnitType.SAMLauncher, t) !== false);
          if (far !== undefined && this.tryBuild(UnitType.SAMLauncher, far)) { this.lastSamTick = ticks; return; }
        }
      }
    }
    // 3. first three city levels
    if (cities < 3 && gold >= cost(UnitType.City)) {
      const tile = this.railInfillTile() ?? this.interiorTile(UnitType.City);
      if (tile !== null && this.tryBuild(UnitType.City, tile)) return;
    }
    // 4. ports: first port when a partner exists; level the best one to 3 before a second; never past the unit cap or on a full sea
    const partnerTile = cities >= this.p.citiesBeforePort ? this.portTile() : null;
    if (gold - mirvFund >= cost(UnitType.Port) && !(seaFull && portLevels >= 20)) {
      // first port: facing a partner if one exists; otherwise on any ocean coast from 2:30 — nations build ports by minute 3–5 and a port earns 7× base income once they do
      const firstTile = partnerTile ?? (cities >= 1 && ticks >= this.p.portWithoutPartnerTick ? this.oceanShoreTile() : null);
      if (ports.length === 0 && firstTile !== null && this.tryBuild(UnitType.Port, firstTile)) { this.firstPortTick = ticks; return; }
      if (ports.length > 0) {
        const bestPort = [...ports].sort((a, b) => b.level() - a.level())[0];
        const wantLevel = bestPort.level() < this.p.portLevelBeforeSecond || ports.length >= this.p.maxPortUnits || partnerTile === null;
        // level the port unless a city is affordable and troops are near cap (then the city comes first, below)
        if (wantLevel && me.canUpgradeUnit(bestPort) && (me.troops() < this.cap() * 0.8 || gold < cost(UnitType.City))) { upgrade(bestPort); return; }
        if (!wantLevel && partnerTile !== null && this.tryBuild(UnitType.Port, partnerTile)) return;
      }
    }
    // 5. rail line: landlocked, or an ally borders us, or the sea is full
    const deadPorts = ports.length > 0 && me.units(UnitType.TradeShip).length === 0 && ticks - this.firstPortTick > 900;
    const wantRail = cities >= 3 && ((ports.length === 0 && partnerTile === null && ticks >= 1500) || deadPorts || (friends.length > 0 && ticks >= 1800) || (ports.length > 0 && ticks >= 1800) || seaFull) && me.unitsOwned(UnitType.Factory) < 6;
    if (wantRail && this.buildRail(gold - mirvFund, cost)) return;
    if (!wantRail && cities >= 3 && ticks % 1200 < 10 && this.log.length < 200) this.log.push(`t${ticks} no rail wanted: ports=${ports.length} partner=${partnerTile !== null} friends=${friends.length} seaFull=${seaFull}`);
    // 6. silos, nation-style: the first at four city units or 10:00 (whichever comes first, once a port or factory pays),
    //    a second at twelve, a third at twenty; a level when a bomb target sat out of range
    const idleAtCap = capFull && me.troops() > this.cap() * 0.9 && me.outgoingAttacks().length === 0;
    const silos = me.units(UnitType.MissileSilo);
    const siloTarget = cityUnits.length >= 25 ? 3 : cityUnits.length >= 14 ? 2 : (ticks >= this.p.siloAtTick || idleAtCap) && (portLevels >= 1 || me.unitsOwned(UnitType.Factory) > 0 || idleAtCap) ? 1 : 0; // v8 (silo at 4 cities, SAM per 5, warships early) cost 36 % of land: the ratios wait for the economy
    const wantSilo = silos.length < siloTarget && ticks >= 3000;
    if (wantSilo && gold >= cost(UnitType.MissileSilo) + 400_000n) {
      const tile = silos.length === 0 ? this.interiorTile(UnitType.MissileSilo) : this.sampleTerritory(30).find((t) => silos.every((sl) => this.mg.euclideanDistSquared(sl.tile(), t) > 50 * 50) && me.canBuild(UnitType.MissileSilo, t) !== false) ?? null;
      if (tile !== null && this.tryBuild(UnitType.MissileSilo, tile)) return;
    }
    if (this.bombOutOfRange >= 3 && silos.length > 0 && gold - mirvFund >= cost(UnitType.MissileSilo) * 2n) {
      const low = silos.find((sl) => sl.level() < 4 && me.canUpgradeUnit(sl));
      if (low) { upgrade(low); this.bombOutOfRange = 0; return; }
    }
    // 7. troop cap when full — unless we are saving for a silo
    const siloReserve = wantSilo ? cost(UnitType.MissileSilo) + 400_000n : 0n;
    if (capFull && gold - siloReserve - mirvFund >= cost(UnitType.City)) {
      const rt = cityCapHit ? null : this.railInfillTile();
      if (rt !== null && this.tryBuild(UnitType.City, rt)) { this.rail.infilled++; return; }
      const city = cityUnits.find((c) => me.canUpgradeUnit(c));
      if (city) { upgrade(city); return; }
      const tile = cityCapHit ? null : this.interiorTile(UnitType.City);
      if (tile !== null && this.tryBuild(UnitType.City, tile)) return;
    }
    // 8. spare gold: keep a bomb fund once we own a silo, otherwise a city level. Never hoard.
    const atWar = (this.currentTarget !== null && this.currentTarget.isAlive() && !me.isFriendly(this.currentTarget)) || me.incomingAttacks().some((a) => a.attacker().type() !== PlayerType.Bot);
    const reserve = me.units(UnitType.MissileSilo).length > 0 && (atWar || idleAtCap) ? 1_000_000n : siloReserve;
    // 9. a warship per four ports when gold is spare: it sinks landing boats and guards the trade lanes
    const warships = me.units(UnitType.Warship);
    if (ports.length > 0 && ticks >= 9000 && warships.length < Math.ceil(ports.length / 6) && ticks - this.lastWarshipTick >= 600 && gold - reserve - mirvFund >= cost(UnitType.Warship) + 500_000n && !this.config.isUnitDisabled(UnitType.Warship)) {
      const port = ports[warships.length % ports.length];
      for (let a = 0; a < 8; a++) {
        const x = this.mg.x(port.tile()) + Math.round(Math.cos((a / 8) * Math.PI * 2) * 20), y = this.mg.y(port.tile()) + Math.round(Math.sin((a / 8) * Math.PI * 2) * 20);
        if (!this.mg.isValidCoord(x, y)) continue;
        const t = this.mg.ref(x, y);
        if (!this.mg.isOcean(t) || me.canBuild(UnitType.Warship, t) === false) continue;
        this.mg.addExecution(new ConstructionExecution(me, UnitType.Warship, t));
        this.lastWarshipTick = ticks;
        if (this.log.length < 200) this.log.push(`t${ticks} build Warship`);
        return;
      }
    }
    if (gold - reserve - mirvFund >= cost(UnitType.City)) {
      const rt = cityCapHit ? null : this.railInfillTile();
      if (rt !== null && this.tryBuild(UnitType.City, rt)) { this.rail.infilled++; return; }
      const city = cityUnits.find((c) => me.canUpgradeUnit(c));
      if (city) { upgrade(city); return; }
      const tile = cityCapHit ? null : this.interiorTile(UnitType.City);
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
  private oceanShoreTile(): TileRef | null {
    const me = this.player;
    const shore = Array.from(me.borderTiles()).filter((t) => this.mg.isOceanShore(t));
    const step = Math.max(1, Math.floor(shore.length / 40));
    for (let i = 0; i < shore.length; i += step) { if (me.canBuild(UnitType.Port, shore[i]) !== false) return shore[i]; }
    return null;
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
