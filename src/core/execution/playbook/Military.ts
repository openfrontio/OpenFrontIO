// Military: expansion, tribe harvesting, counter-attacks, wars and retreats, boats, bombs, MIRV, split watch.

import { Player, PlayerType, UnitType } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { ConstructionExecution } from "../ConstructionExecution";
import { MirvExecution } from "../MIRVExecution";
import { calculateTerritoryCenter } from "../Util";
import { BotContext } from "./Context";
import { SituationQueries } from "./Situation";

export class Military {
  private currentTarget_: Player | null = null;
  private waves = new Map<Player, { want: number; sent: number; last: number }>();
  private sentAt = new Map<Player, number>();
  private blacklist = new Map<Player, number>();
  public bombs = 0;
  private lastBombTick = -1e9;
  private lastCounter = new Map<Player, number>();
  private embargoedAt_ = new Map<Player, number>();
  private bombed = new Map<TileRef, number>();
  private lastInvasionTick = -1e9;

  constructor(
    private ctx: BotContext,
    private q: SituationQueries,
    private plannedTarget: () => Player | null, // Diplomacy.plannedTarget
  ) {}

  /** The player we are at war with (read by Diplomacy and Economy). */
  get currentTarget(): Player | null {
    return this.currentTarget_;
  }
  /** Tick at which we embargoed a war target (read by Diplomacy.manageEmbargoes). */
  get embargoedAt(): Map<Player, number> {
    return this.embargoedAt_;
  }
  /** Consecutive bomb targets out of silo range (read and reset by Economy.build). */
  get bombOutOfRange(): number {
    return this.bombOutOfRange_;
  }
  set bombOutOfRange(n: number) {
    this.bombOutOfRange_ = n;
  }

  // ---------------------------------------------------------------- reachability
  /** Record an attack we just sent; if it has vanished 2 ticks later the target wasn't really reachable. */
  noteSent(target: Player): void { this.sentAt.set(target, this.ctx.mg.ticks()); }
  reachable(target: Player): boolean {
    const bl = this.blacklist.get(target);
    if (bl !== undefined && this.ctx.mg.ticks() < bl) return false;
    const t0 = this.sentAt.get(target);
    if (t0 !== undefined && this.ctx.mg.ticks() - t0 >= 2 && this.ctx.mg.ticks() - t0 < 12 && !this.q.outgoingTo(target)) {
      this.blacklist.set(target, this.ctx.mg.ticks() + 600);
      this.sentAt.delete(target);
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- boats in the mid and late game
  private lastSeaTick = -1e9;
  /** Playbook: boats are the answer to a closed land border. Whenever a boat is free and either the land front is
   *  blocked or troops sit above 40 % of cap, send one to the best target across water: free shore first, then a
   *  neighbour we (or a MIRV) have just collapsed, then a weak player with no posts at 3×, then a tribe at 2×. */
  seaExpansion(): void {
    const me = this.ctx.me;
    if (this.ctx.sit.boats >= this.ctx.mg.config().boatMaxNumber()) return;
    if (this.ctx.mg.ticks() - this.lastSeaTick < 100) return;
    if (this.ctx.sit.wilderness && this.ctx.sit.capShare < 0.4) return; // land first while it is free and we are small
    if (this.ctx.sit.incoming.length > 0 && this.ctx.sit.capShare < 0.6) return; // under attack: the army stays
    const shore = Array.from(me.borderTiles()).filter((t) => this.ctx.mg.isOceanShore(t));
    if (shore.length === 0) return;
    const from = shore[Math.floor(shore.length / 2)];
    const fx = this.ctx.mg.x(from), fy = this.ctx.mg.y(from);
    const dist = (t: TileRef) => Math.abs(this.ctx.mg.x(t) - fx) + Math.abs(this.ctx.mg.y(t) - fy);
    const cands: { tile: TileRef; troops: number; score: number; what: string }[] = [];
    // (a) free shore across water: 15 % of home, worth the most per troop
    let seen = 0;
    for (let dy = -300; dy <= 300; dy += 8) for (let dx = -300; dx <= 300; dx += 8) {
      const x = fx + dx, y = fy + dy;
      if (!this.ctx.mg.isValidCoord(x, y)) continue;
      const t = this.ctx.mg.ref(x, y);
      if (!this.ctx.mg.isLand(t) || !this.ctx.mg.isOceanShore(t) || this.ctx.mg.hasOwner(t)) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < 30 || seen++ > 400) continue;
      cands.push({ tile: t, troops: Math.max(5000, Math.floor(this.ctx.sit.troops * 0.15)), score: 300 - d, what: "free shore" });
    }
    // (b) collapsed players (bombed, MIRVed): the follow-up; (c) weak players without posts; (d) tribes
    for (const o of this.ctx.mg.players()) {
      if (o === me || !o.isAlive() || me.isFriendly(o) || o.numTilesOwned() < 100) continue;
      const isBot = o.type() === PlayerType.Bot;
      const coll = !isBot && this.collapsed(o);
      const late = this.ctx.p.endgameV2 && this.ctx.mg.ticks() >= 9000;
      const weak = !isBot && ((o.troops() < this.ctx.sit.troops * 0.25 && o.units(UnitType.DefensePost).length === 0) || (late && o.troops() < this.ctx.sit.troops * 0.5));
      if (!isBot && !coll && !weak) continue;
      if (!isBot && !me.canAttackPlayer(o)) continue;
      const want = Math.ceil(o.troops() * (isBot ? 2 : 3)) + 2000;
      if (want > this.ctx.sit.spendable * 0.5) continue;
      let i = 0, bestT: TileRef | null = null, bestD = 1e9;
      for (const t of o.borderTiles()) { if ((i++ % 9) !== 0 || !this.ctx.mg.isOceanShore(t)) continue; const d = dist(t); if (d < bestD) { bestD = d; bestT = t; } }
      if (bestT === null || bestD > 500) continue;
      if (late && weak && bestD > 150 && o.troops() >= this.ctx.sit.troops * 0.25) continue; // the late-game jump is a short one
      const value = coll ? 600 : weak ? 400 : 250;
      cands.push({ tile: bestT, troops: want, score: value - bestD / 2 + (o.units(UnitType.City).length * 10), what: `${coll ? "collapsed " : weak ? "weak " : "tribe "}${o.name()} ${o.numTilesOwned()}t/${Math.round(o.troops() / 1000)}k` });
    }
    cands.sort((a, b) => b.score - a.score);
    for (const c of cands.slice(0, 10)) {
      if (c.troops > this.ctx.sit.spendable) continue;
      if (!this.q.acrossWater(c.tile)) continue;
      if (this.ctx.boat(c.tile, c.troops, `sea expansion → ${c.what}`) === 0) continue;
      this.lastSeaTick = this.ctx.mg.ticks();
      return;
    }
  }

  // ---------------------------------------------------------------- MIRV and the finish
  private lastMirvTick = -1e9;
  private lastWarTick = -1e9;
  private bombOutOfRange_ = 0;
  /** Playbook phase 6: a MIRV goes to (1) whoever has one in the air at us, (2) anyone over half the map,
   *  (3) from 25:00, the largest un-allied player above us when we are in the top three — launch first, then
   *  the collapse rule sends the army into the emptied land. */
  maybeMIRV(): void {
    const me = this.ctx.me;
    if (me.units(UnitType.MissileSilo).length === 0 || this.ctx.mg.config().isUnitDisabled(UnitType.MIRV)) return;
    if (this.ctx.mg.ticks() - this.lastMirvTick < 600) return;
    const cost = this.ctx.mg.config().unitInfo(UnitType.MIRV).cost(this.ctx.mg, me);
    if (me.gold() < cost) return;
    const total = this.ctx.mg.numLandTiles();
    const others = this.ctx.mg.players().filter((p) => p !== me && p.isAlive() && p.type() !== PlayerType.Bot && !me.isFriendly(p) && !me.isOnSameTeam(p));
    let target: Player | null = null, why = "";
    if (this.ctx.sit.mode !== "grow" && this.ctx.sit.threats.length > 0) { target = [...this.ctx.sit.threats].sort((a, b) => Number(b.gold() - a.gold()))[0]; why = `finish: ${this.ctx.sit.mode}, richest MIRV-capable rival`; }
    if (!target) for (const p of others) for (const m of p.units(UnitType.MIRV)) { const d = m.targetTile(); if (d && this.ctx.mg.hasOwner(d) && this.ctx.mg.owner(d) === me) { target = p; why = "counter"; } }
    if (!target) { const t = others.filter((p) => p.numTilesOwned() / total >= 0.5).sort((a, b) => b.numTilesOwned() - a.numTilesOwned())[0]; if (t) { target = t; why = "victory denial"; } }
    if (!target && this.ctx.mg.ticks() >= 12000) {
      const ranked = this.ctx.mg.players().filter((p) => p.isAlive() && p.type() !== PlayerType.Bot).sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
      const myRank = ranked.indexOf(me) + 1;
      if (myRank <= 3) { const t = others.filter((p) => p.numTilesOwned() > me.numTilesOwned() * 0.8).sort((a, b) => b.numTilesOwned() - a.numTilesOwned())[0]; if (t) { target = t; why = `crown (we are #${myRank})`; } }
    }
    if (!target) return;
    const center = calculateTerritoryCenter(this.ctx.mg, target);
    if (center === null || me.canBuild(UnitType.MIRV, center) === false) return;
    this.ctx.mg.addExecution(new MirvExecution(me, center));
    this.lastMirvTick = this.ctx.mg.ticks();
    this.bombs++;
    this.ctx.log(`t${this.ctx.mg.ticks()} MIRV ${target.name()} ${target.numTilesOwned()}t (${why})`);
  }

  // ---------------------------------------------------------------- territory integrity
  private splitOwner: Player | null = null;
  private splitTile: TileRef | null = null;
  private splitSince = -1;
  /** Every 20 s: is our land in one piece? If not, find who sits between the main body and the largest other piece.
   *  The engine hands a surrounded piece to the surrounding player, so a split is a countdown. */
  watchSplit(): void {
    const me = this.ctx.me;
    const tiles = me.tiles();
    if (tiles.size < 200) { this.splitOwner = null; return; }
    const seen = new Set<TileRef>();
    const clusters: TileRef[][] = [];
    for (const t of me.borderTiles()) {
      if (seen.has(t)) continue;
      const cl: TileRef[] = []; const q = [t]; seen.add(t);
      while (q.length > 0) { const c = q.pop()!; cl.push(c); for (const n of this.ctx.mg.neighbors(c)) { if (seen.has(n) || this.ctx.mg.owner(n) !== me) continue; seen.add(n); q.push(n); } }
      clusters.push(cl);
      if (clusters.length > 8) break;
    }
    if (clusters.length <= 1) { if (this.splitOwner !== null) this.ctx.log(`t${this.ctx.mg.ticks()} territory reconnected`); this.splitOwner = null; this.splitTile = null; return; }
    clusters.sort((a, b) => b.length - a.length);
    const main = clusters[0], other = clusters[1];
    // nearest pair of tiles between the two pieces (sampled), then the owner of the midpoint
    let best = 1e18, bt: TileRef | null = null, bo: TileRef | null = null;
    for (let i = 0; i < main.length; i += Math.max(1, Math.floor(main.length / 60))) for (let j = 0; j < other.length; j += Math.max(1, Math.floor(other.length / 60))) {
      const d = this.ctx.mg.euclideanDistSquared(main[i], other[j]); if (d < best) { best = d; bt = main[i]; bo = other[j]; }
    }
    if (bt === null || bo === null) return;
    const mx = Math.round((this.ctx.mg.x(bt) + this.ctx.mg.x(bo)) / 2), my = Math.round((this.ctx.mg.y(bt) + this.ctx.mg.y(bo)) / 2);
    const mid = this.ctx.mg.ref(mx, my);
    const owner = this.ctx.mg.owner(mid);
    const who = owner.isPlayer() ? (owner as Player) : null;
    if (this.splitSince < 0) this.splitSince = this.ctx.mg.ticks();
    if (who !== this.splitOwner) this.ctx.log(`t${this.ctx.mg.ticks()} SPLIT: ${clusters.length} pieces, second piece ${other.length}+ border tiles, gap ${Math.round(Math.sqrt(best))} tiles held by ${who ? who.name() : "nobody"}`);
    this.splitOwner = who && who !== me && !me.isFriendly(who) ? who : null;
    this.splitTile = this.ctx.mg.isLand(mid) && !this.ctx.mg.hasOwner(mid) ? mid : null;
  }

  // ---------------------------------------------------------------- expansion
  expand(): void {
    const me = this.ctx.me;
    const { rivals, wilderness } = this.q.neighbours();
    if (!wilderness) return;
    if (this.ctx.p.openingAllIn) {
      // nations' opening: every 5 s, everything above a small reserve goes into empty land
      if (this.ctx.mg.ticks() % 50 !== 0) return;
      const send = Math.floor(me.troops() - this.q.cap() * this.ctx.p.openingKeep);
      this.ctx.send(this.ctx.mg.terraNullius().id(), send, "all-in", 100);
      return;
    }
    // free land is the cheapest growth there is and unused troops come home: only the troop reserve applies, not the cap floor
    const ringing = [...this.ctx.sit.rivals, ...this.ctx.sit.bots, ...this.ctx.sit.friends].some((r) => this.q.annexable(r));
    const frac = rivals.length > 0 || ringing || this.splitTile !== null || this.ctx.sit.mode === "push" ? this.ctx.p.expandContested : this.ctx.p.expandFree;
    this.ctx.send(this.ctx.mg.terraNullius().id(), Math.floor(this.ctx.sit.troops * frac), "expand", 100);
  }

  // ---------------------------------------------------------------- bots
  harvestBots(): void {
    const me = this.ctx.me;
    const { bots, wilderness } = this.q.neighbours();
    if (bots.length === 0) return;
    bots.sort((a, b) => a.troops() - b.troops());
    const plentiful = me.troops() > this.q.cap() * this.ctx.p.fightAbove;
    // free land costs 16–24 a tile; a tribe costs its density plus the losses of the fight. Eat tribes
    // once the wilderness is gone, or earlier only when we are plentiful and the click is small.
    const early = wilderness && this.ctx.p.botsAfterWild;
    // invariant: one tribe at a time below 60 % of cap, two above — three at once is how the army disappears
    const maxConcurrent = this.ctx.p.tribeConcurrency + (this.ctx.sit.capShare > 0.6 ? 1 : 0);
    let active = this.ctx.sit.tribeAttacks;
    let clicks = 0;
    for (const bot of bots) {
      if (!me.canAttackPlayer(bot) || !this.reachable(bot)) continue;
      const want = Math.ceil(bot.troops() * this.ctx.p.botRatio) + 500;
      const running = this.q.outgoingTo(bot);
      if (running) {
        // follow-up click: the guide's two-click — a second wave 10 s later merges into the first
        const w = this.waves.get(bot);
        if (!w || w.sent >= w.want || this.ctx.mg.ticks() - w.last < this.ctx.p.botFollowUpTicks) continue;
        const send = this.ctx.send(bot.id(), Math.min(w.want - w.sent, Math.floor(this.ctx.sit.troops * this.ctx.p.botClickCap)), "tribe follow-up");
        if (send === 0) continue;
        w.sent += send; w.last = this.ctx.mg.ticks();
        continue;
      }
      if (active >= maxConcurrent) continue;
      const maxSend = Math.floor(this.ctx.sit.spendable * (early ? this.ctx.p.botEarlyShare : this.ctx.p.botMaxShare));
      if (want > maxSend) continue;
      const first = this.ctx.send(bot.id(), Math.min(want, Math.floor(this.ctx.sit.troops * this.ctx.p.botClickCap)), "tribe");
      if (first === 0) continue;
      active++;
      this.waves.set(bot, { want, sent: first, last: this.ctx.mg.ticks() });
      this.noteSent(bot);
      this.ctx.log(`t${this.ctx.mg.ticks()} bot ${bot.name()} ${bot.numTilesOwned()}t/${Math.round(bot.troops())} ← ${first}/${want}`);
      clicks++;
      if (!plentiful || clicks >= 2) return;
    }
  }

  /** Opposing attacks cancel troop-for-troop: answer a non-bot attack with a counter of the same size. */
  counterAttack(): void {
    const me = this.ctx.me;
    for (const inc of me.incomingAttacks()) {
      const a = inc.attacker();
      if (a.type() === PlayerType.Bot || me.isFriendly(a)) continue;
      if (this.q.outgoingTo(a)) continue;
      if (!me.canAttackPlayer(a) || !this.reachable(a)) continue;
      // a post makes defending 5× cheaper than cancelling; only cancel waves that would cost real land
      const big = inc.troops() > me.troops() * 0.15 || (!this.q.postFacing(a) && inc.troops() > me.troops() * 0.05);
      const last = this.lastCounter.get(a) ?? -1e9;
      if (!big || this.ctx.mg.ticks() - last < 300) continue;
      this.lastCounter.set(a, this.ctx.mg.ticks());
      const send = this.ctx.send(a.id(), Math.min(Math.ceil(inc.troops() * 1.05), Math.floor(this.ctx.sit.troops * 0.5)), "counter", 1000);
      if (send === 0) continue;
      this.noteSent(a);
      this.counters.add(a);
      this.ctx.log(`t${this.ctx.mg.ticks()} COUNTER ${a.name()} (${Math.round(inc.troops() / 1000)}k incoming) with ${Math.round(send / 1000)}k`);
    }
  }

  // ---------------------------------------------------------------- fighting rivals
  /** Playbook: a neighbour that has just been bombed or MIRVed is the best target on the map. Troops or land
   *  down by half inside 10 s marks it collapsed for the next 60 s. */
  collapsed(r: Player): boolean {
    const now = this.ctx.mg.ticks();
    const h = this.history.get(r);
    if (h && now - h.tick < 100) return now < h.collapsedUntil;
    const snap = { tick: now, troops: r.troops(), tiles: r.numTilesOwned(), collapsedUntil: h?.collapsedUntil ?? -1 };
    if (h && (r.troops() < h.troops * 0.5 || r.numTilesOwned() < h.tiles * 0.5)) { snap.collapsedUntil = now + 600; this.ctx.log(`t${now} ${r.name()} COLLAPSED ${Math.round(h.troops / 1000)}k→${Math.round(r.troops() / 1000)}k, ${h.tiles}→${r.numTilesOwned()} tiles`); }
    this.history.set(r, snap);
    return now < snap.collapsedUntil;
  }
  private history = new Map<Player, { tick: number; troops: number; tiles: number; collapsedUntil: number }>();

  fight(): void {
    const me = this.ctx.me;
    const cap = this.q.cap();
    const nb = this.q.neighbours();
    for (const r of nb.rivals) this.collapsed(r);
    const gapOwner = this.splitOwner && this.splitOwner.isAlive() && nb.rivals.includes(this.splitOwner) ? this.splitOwner : null;
    const threatHere = this.ctx.sit.mode === "hold" ? nb.rivals.find((r) => this.ctx.sit.threats.includes(r)) ?? null : null;
    const opportunity = (this.ctx.mg.ticks() >= 3000 && nb.rivals.some((r) => this.collapsed(r) && r.troops() < this.ctx.sit.troops * 0.5)) || gapOwner !== null || threatHere !== null;
    // crown, not survival: a war is on when we can afford 2× someone's whole army out of the spendable troops,
    // not only when troops reach 70 % of a cap that cities keep raising
    const affordable = this.ctx.mg.ticks() >= this.ctx.p.fightNotBeforeTick && nb.rivals.some((r) => r.troops() * this.ctx.p.fightRatio + 1000 <= this.ctx.sit.spendable * this.ctx.p.fightMaxShare);
    if (!affordable && !opportunity && me.troops() < cap * this.ctx.p.fightAbove) return; // a 1.67× push that keeps home healthy is always taken
    const atCapNow = me.troops() >= cap * 0.95;
    // invariant: one war at a time (two at cap); seven at once is how a 17M army evaporates
    const wars = this.ctx.sit.outgoing.filter((a) => a.target().isPlayer() && (a.target() as Player).type() !== PlayerType.Bot && !this.counters.has(a.target() as Player)).length;
    if (wars >= (this.ctx.mg.ticks() >= 15000 && atCapNow ? 2 : 1) && !opportunity) return;
    const early = !atCapNow && !opportunity && (this.ctx.mg.ticks() < this.ctx.p.fightNotBeforeTick || me.unitsOwned(UnitType.City) < this.ctx.p.fightMinCities);
    let { rivals } = nb;
    // before the 5-minute mark only clear prey: a neighbour we can hit with 2.5× its whole army
    if (early) rivals = rivals.filter((r) => r.troops() * 2.5 <= me.troops() * this.ctx.p.fightMaxShare && r.numTilesOwned() <= me.numTilesOwned());
    if (rivals.length === 0) return;
    if (this.currentTarget_ && (!this.currentTarget_.isAlive() || !rivals.includes(this.currentTarget_))) this.currentTarget_ = null;
    let candidates = rivals.filter((r) => me.canAttackPlayer(r) && !this.q.outgoingTo(r) && this.reachable(r));
    // one enemy at a time, to the end: nations nuke whoever attacks them, and eight half-wars make eight nuclear enemies.
    // The current target stays the only candidate while it lives, borders us, and was hit within the last three minutes.
    if (this.ctx.p.stickyWar && this.currentTarget_ && this.currentTarget_.isAlive() && rivals.includes(this.currentTarget_) && this.ctx.mg.ticks() - this.lastWarTick < 1800) {
      candidates = candidates.filter((r) => r === this.currentTarget_ || this.collapsed(r) || r === gapOwner || r === threatHere);
    }
    if (this.ctx.sit.mode === "hold") candidates = candidates.filter((r) => this.ctx.sit.threats.includes(r)); // the hold is spent removing whoever can fire
    if (candidates.length === 0) return;
    const atCap = me.troops() >= cap * 0.95;
    const endgame = this.ctx.mg.ticks() >= 15000 || this.ctx.sit.mode === "push"; // 25:00 or the push — land now is worth more than troops later
    // At cap every troop above the line is wasted growth, so commit more and accept a thinner edge.
    const maxSend = Math.floor(me.troops() * (atCap || endgame ? 0.7 : this.ctx.p.fightMaxShare));
    const minRatio = atCap || endgame ? 1.2 : this.ctx.p.fightRatio;
    const richer = (r: Player) => this.ctx.p.econWar && this.q.cap() >= this.ctx.mg.config().maxTroops(r) * 2 && this.ctx.sit.gold >= 1_000_000n; // we replace losses, they cannot
    const attackingUs = new Set(me.incomingAttacks().map((a) => a.attacker()));
    const score = (r: Player) => {
      const ratio = maxSend / Math.max(1, r.troops());
      if (this.collapsed(r) && r.troops() < this.ctx.sit.troops * 0.5) return ratio >= 1.5 ? 20 + ratio : -1; // bombed: go now at 1.5×, posts are gone
      if (r === gapOwner) return ratio >= 1.2 ? 30 + ratio : -1; // they are cutting our land in two: reconnect before the piece is handed over
      if (r === threatHere) return ratio >= 1.5 ? 25 + ratio : -1; // a MIRV-capable rival next door during the hold
      // at cap, a neighbour already attacking us is a fair fight at 1:1 — the counter-attack cancels its wave anyway
      if (ratio < (atCap && attackingUs.has(r) ? 1.0 : richer(r) ? Math.min(minRatio, 1.5) : minRatio)) return -1;
      // Playbook: never attack a big, thinly held empire — that is a troop sink. Prefer small and dense.
      if (ratio < 3 && r.numTilesOwned() > me.numTilesOwned() * 1.5 && this.q.density(r) < 40) return -1;
      const buildings = r.units(UnitType.City).length * 3 + r.units(UnitType.Port).length * 2 + r.units(UnitType.MissileSilo).length * 3;
      const posts = r.units(UnitType.DefensePost).length;
      if (posts > 0 && ratio < 1.5) return -1;
      const sizePenalty = r.numTilesOwned() / Math.max(1, me.numTilesOwned());
      // Playbook: hit players who are already being hit, traitors (half defence), and the ally we let lapse.
      const underFire = r.incomingAttacks().reduce((acc, a) => acc + a.troops(), 0) / Math.max(1, r.troops());
      const bonus = Math.min(underFire, 1) * 4 + (r.isTraitor() ? 2 : 0) + (r === this.plannedTarget() ? 4 : 0);
      return ratio * 2 + buildings + Math.min(this.q.density(r), 200) / 50 - posts * 3 - sizePenalty * 2 + bonus + (r === this.currentTarget_ ? 3 : 0);
    };
    let best: Player | null = null, bestS = 0;
    for (const r of candidates) { const sc = score(r); if (sc > bestS) { bestS = sc; best = r; } }
    if (best === null) {
      if (atCapNow && this.ctx.mg.ticks() % 1200 < this.ctx.p.expandEvery) this.ctx.log(`t${this.ctx.mg.ticks()} idle at cap: ${rivals.map((r) => `${r.name()} ${r.numTilesOwned()}t/${Math.round(r.troops() / 1000)}k d${Math.round(this.q.density(r))} p${r.units(UnitType.DefensePost).length} ${candidates.includes(r) ? "" : "(no)"}`).join("; ")}`);
      return;
    }
    const wantRaw = Math.min(Math.ceil(best.troops() * (richer(best) ? Math.min(this.ctx.p.fightRatio, 1.5) : this.ctx.p.fightRatio)) + 1000, maxSend);
    if (richer(best) && best !== this.currentTarget_ && me.units(UnitType.MissileSilo).length > 0 && this.ctx.mg.ticks() - this.lastBombTick > 100) { this.currentTarget_ = best; this.maybeBomb(this.ctx.mg.ticks()); } // open the war with a bomb on their cluster
    if (wantRaw < 1000) return;
    this.currentTarget_ = best;
    if (!me.hasEmbargoAgainst(best) && best.type() !== PlayerType.Nation) { me.addEmbargo(best, false); this.embargoedAt_.set(best, this.ctx.mg.ticks()); }
    const want = this.ctx.send(best.id(), wantRaw, "war", 1000, 0.3);
    if (want === 0) return;
    this.lastWarTick = this.ctx.mg.ticks();
    this.noteSent(best);
    this.ctx.log(`t${this.ctx.mg.ticks()} ATTACK ${best.name()} ${best.numTilesOwned()}t/${Math.round(best.troops() / 1000)}k ← ${Math.round(want / 1000)}k (${(want / Math.max(1, best.troops())).toFixed(2)}×)`);
  }

  private attackStart = new Map<string, { sent: number; targetTroops: number }>();
  private counters = new Set<Player>();
  manageRetreats(): void {
    const me = this.ctx.me;
    for (const a of me.outgoingAttacks()) {
      const t = a.target();
      if (!t.isPlayer() || t.type() === PlayerType.Bot) continue;
      if (a.retreating() || a.retreated()) continue;
      // a counter-attack exists to cancel a wave; once the wave is gone, bring the rest home rather than dying in their land
      if (this.counters.has(t) && t !== this.currentTarget_ && !me.incomingAttacks().some((x) => x.attacker() === t)) {
        me.orderRetreat(a.id());
        this.counters.delete(t);
        this.ctx.log(`t${this.ctx.mg.ticks()} counter done vs ${t.name()}, ${Math.round(a.troops() / 1000)}k coming home`);
        continue;
      }
      let st = this.attackStart.get(a.id());
      if (!st) { st = { sent: a.troops(), targetTroops: t.troops() }; this.attackStart.set(a.id(), st); }
      // Retreat only when we are losing: most of the wave is gone while the target has barely bled.
      const losing = a.troops() < st.sent * 0.2 && t.troops() > st.targetTroops * 0.7;
      const posts = t.units(UnitType.DefensePost).length > 0 && a.troops() < st.sent * 0.5 && t.troops() > st.targetTroops * 0.9;
      if (losing || posts) {
        this.ctx.me.orderRetreat(a.id());
        this.ctx.log(`t${this.ctx.mg.ticks()} retreat from ${t.name()} (${Math.round(a.troops() / 1000)}k left)`);
      }
    }
  }

  // ---------------------------------------------------------------- boats
  /** Playbook 0:05–0:10: one 20 % boat to a tribe across water (2× its troops) or, failing that, the nearest empty shore across water. */
  earlyBoat(): boolean {
    const me = this.ctx.me;
    if (me.unitCount(UnitType.TransportShip) >= this.ctx.mg.config().boatMaxNumber()) return false;
    const shore = Array.from(me.borderTiles()).filter((t) => this.ctx.mg.isShore(t));
    if (shore.length === 0) return false;
    const from = shore[Math.floor(shore.length / 2)];
    const fx = this.ctx.mg.x(from), fy = this.ctx.mg.y(from);
    const dist = (t: TileRef) => Math.abs(this.ctx.mg.x(t) - fx) + Math.abs(this.ctx.mg.y(t) - fy);
    const cands: { tile: TileRef; troops: number; d: number; what: string }[] = [];
    for (const bot of this.ctx.mg.players()) {
      if (bot.type() !== PlayerType.Bot || !bot.isAlive()) continue;
      const want = Math.ceil(bot.troops() * 2) + 500; // a beach landing costs more than a land attack: 2×, not 1.67×
      if (want > me.troops() * 0.4) continue;
      let i = 0, bestT: TileRef | null = null, bestD = 1e9;
      for (const t of bot.borderTiles()) { if ((i++ % 5) !== 0 || !this.ctx.mg.isShore(t)) continue; const d = dist(t); if (d < bestD) { bestD = d; bestT = t; } }
      if (bestT !== null && bestD <= 250) cands.push({ tile: bestT, troops: Math.max(want, Math.floor(me.troops() * this.ctx.p.boatShare)), d: bestD + 80, what: `tribe ${bot.name()}` }); // open shore preferred: free land, no losses; a tribe only when no empty coast is near
    }
    for (let dy = -200; dy <= 200; dy += 6) for (let dx = -200; dx <= 200; dx += 6) {
      const x = fx + dx, y = fy + dy;
      if (!this.ctx.mg.isValidCoord(x, y)) continue;
      const t = this.ctx.mg.ref(x, y);
      if (!this.ctx.mg.isLand(t) || !this.ctx.mg.isShore(t) || this.ctx.mg.hasOwner(t)) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d >= 30) cands.push({ tile: t, troops: Math.floor(me.troops() * this.ctx.p.boatShare), d, what: "empty shore" });
    }
    cands.sort((a, b) => a.d - b.d);
    for (const c of cands.slice(0, 16)) {
      if (c.troops < 500 || !this.q.acrossWater(c.tile)) continue;
      if (this.ctx.boat(c.tile, c.troops, `early boat → ${c.what}, ${c.d} tiles`) === 0) continue;
      return true;
    }
    return false;
  }

  sendBoat(): boolean {
    const me = this.ctx.me;
    if (me.unitCount(UnitType.TransportShip) >= this.ctx.mg.config().boatMaxNumber()) return false;
    const border = Array.from(me.borderTiles()).filter((t) => this.ctx.mg.isShore(t));
    if (border.length === 0) return false;
    const from = border[this.ctx.random.nextInt(0, border.length)];
    const fx = this.ctx.mg.x(from), fy = this.ctx.mg.y(from);
    const mine = this.q.landmassTiles(this.ctx.p.islandMaxTiles + 1);
    let best: TileRef | null = null, bestD = 1e9;
    for (let dy = -200; dy <= 200; dy += 6) for (let dx = -200; dx <= 200; dx += 6) {
      const x = fx + dx, y = fy + dy;
      if (!this.ctx.mg.isValidCoord(x, y)) continue;
      const t = this.ctx.mg.ref(x, y);
      if (!this.ctx.mg.isLand(t) || !this.ctx.mg.isShore(t) || this.ctx.mg.hasOwner(t) || mine.has(t)) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d >= 30 && d < bestD) { bestD = d; best = t; }
    }
    if (best === null) return false;
    return this.ctx.boat(best, Math.floor(this.ctx.sit.troops * this.ctx.p.boatShare), `island boat, ${bestD} tiles`) > 0;
  }

  /** No bots on our borders: boat to the nearest bot within reach, with 1.67× its troops. */
  private boatedAt = new Map<Player, number>();
  huntBotsByBoat(): void {
    const me = this.ctx.me;
    if (this.q.neighbours().bots.length > 0) return;
    if (me.units(UnitType.TransportShip).length > 0) return; // one landing at a time; a second boat to the same beach is the 'boat that takes no land'
    if (me.troops() < this.q.cap() * 0.4) return;
    const shore = Array.from(me.borderTiles()).filter((t) => this.ctx.mg.isShore(t));
    if (shore.length === 0) return;
    const from = shore[Math.floor(shore.length / 2)];
    const fx = this.ctx.mg.x(from), fy = this.ctx.mg.y(from);
    let best: TileRef | null = null, bestBot: Player | null = null, bestD = 1e9;
    for (const bot of this.ctx.mg.players()) {
      if (bot.type() !== PlayerType.Bot || !bot.isAlive() || bot.numTilesOwned() < 100) continue;
      if (this.ctx.mg.ticks() - (this.boatedAt.get(bot) ?? -1e9) < 900) continue;
      const want = Math.ceil(bot.troops() * 2) + 500;
      if (want > me.troops() * 0.3) continue;
      // sample its border for a shore tile
      let i = 0;
      for (const t of bot.borderTiles()) {
        if ((i++ % 7) !== 0) continue;
        if (!this.ctx.mg.isShore(t)) continue;
        const d = Math.abs(this.ctx.mg.x(t) - fx) + Math.abs(this.ctx.mg.y(t) - fy);
        if (d < bestD && d <= 350) { bestD = d; best = t; bestBot = bot; }
      }
    }
    if (best === null || bestBot === null) return;
    if (!this.q.acrossWater(best)) return; // reachable by land: that is a land attack, not a boat
    const troops = Math.ceil(bestBot.troops() * 2) + 500;
    if (troops > this.ctx.sit.spendable) return;
    if (this.ctx.boat(best, troops, `to tribe ${bestBot.name()} ${bestBot.numTilesOwned()}t/${Math.round(bestBot.troops() / 1000)}k, ${bestD} tiles`) === 0) return;
    this.boatedAt.set(bestBot, this.ctx.mg.ticks());
  }

  /** Boxed in at cap with nothing to fight on land: land a big boat on the weakest unfriendly player within reach. */
  seaInvasion(): void {
    const me = this.ctx.me;
    if (me.troops() < this.q.cap() * 0.9) return;
    if (this.ctx.mg.ticks() - this.lastInvasionTick < 1800) return;
    if (me.units(UnitType.TransportShip).length > 0) return; // one landing at a time
    if (me.outgoingAttacks().length > 0 || me.incomingAttacks().some((a) => a.attacker().type() !== PlayerType.Bot)) return;
    const nb = this.q.neighbours();
    // only when genuinely boxed in: no empty land, no bots, and no neighbour we could fight on land
    if (nb.wilderness || nb.bots.length > 0) return;
    if (nb.rivals.some((r) => r.troops() < me.troops() * 0.5)) return;
    if (nb.rivals.some((r) => r.troops() > me.troops() * 0.6)) return; // a strong hostile neighbour: the army stays home
    const shore = Array.from(me.borderTiles()).filter((t) => this.ctx.mg.isShore(t));
    if (shore.length === 0) return;
    const from = shore[Math.floor(shore.length / 2)];
    const fx = this.ctx.mg.x(from), fy = this.ctx.mg.y(from);
    const { rivals } = this.q.neighbours();
    let best: { tile: TileRef; p: Player; d: number; score: number } | null = null;
    for (const o of this.ctx.mg.players()) {
      if (o === me || !o.isAlive() || me.isFriendly(o) || o.type() === PlayerType.Bot || rivals.includes(o)) continue;
      if (o.troops() > me.troops() * 0.25 || o.numTilesOwned() < 300 || o.units(UnitType.DefensePost).length > 0) continue;
      let i = 0;
      for (const t of o.borderTiles()) {
        if ((i++ % 9) !== 0 || !this.ctx.mg.isShore(t)) continue;
        const d = Math.abs(this.ctx.mg.x(t) - fx) + Math.abs(this.ctx.mg.y(t) - fy);
        if (d > 500) continue;
        const score = this.q.density(o) / 10 + o.units(UnitType.City).length * 2 - d / 100 - o.units(UnitType.DefensePost).length * 2;
        if (best === null || score > best.score) best = { tile: t, p: o, d, score };
      }
    }
    if (best === null) return;
    const troops = Math.min(Math.floor(this.ctx.sit.spendable * 0.5), Math.floor(this.ctx.sit.troops - this.ctx.sit.cap * 0.3), Math.ceil(best.p.troops() * 3) + 5000);
    if (troops < 20000 || troops < best.p.troops() * 3) return; // a landing under 3× is the boat that takes no land
    if (this.ctx.boat(best.tile, troops, `INVADE ${best.p.name()} ${best.p.numTilesOwned()}t/${Math.round(best.p.troops() / 1000)}k, ${best.d} tiles`) === 0) return;
    this.lastInvasionTick = this.ctx.mg.ticks();
  }

  // ---------------------------------------------------------------- nukes
  maybeBomb(ticks: number): void {
    const me = this.ctx.me;
    if (me.units(UnitType.MissileSilo).length === 0) return;
    if (ticks - this.lastBombTick < this.ctx.p.bombEvery) return;
    const atomCost = this.ctx.mg.config().unitInfo(UnitType.AtomBomb).cost(this.ctx.mg, me);
    const hCost = this.ctx.mg.config().unitInfo(UnitType.HydrogenBomb).cost(this.ctx.mg, me);
    const gold = me.gold();
    // targets: whoever we fight or who fights us; else the neighbour with the most buildings that is not allied
    const enemies = new Set<Player>();
    if (this.currentTarget_ && this.currentTarget_.isAlive() && !me.isFriendly(this.currentTarget_)) enemies.add(this.currentTarget_);
    for (const inc of me.incomingAttacks()) { const a = inc.attacker(); if (a.type() !== PlayerType.Bot && !me.isFriendly(a) && inc.troops() > me.troops() * 0.05) enemies.add(a); }
    const plannedTarget = this.plannedTarget();
    if (plannedTarget && plannedTarget.isAlive() && !me.isFriendly(plannedTarget)) enemies.add(plannedTarget);
    for (const r of this.ctx.sit.collapsed) if (!me.isFriendly(r)) enemies.add(r);
    if (this.ctx.sit.share >= 0.5) for (const r of this.ctx.sit.threats) if (me.canAttackPlayer(r) || this.q.neighbours().rivals.includes(r)) enemies.add(r); // whoever could fire at the crown
    const mirvPrice = this.ctx.mg.config().unitInfo(UnitType.MIRV).cost(this.ctx.mg, me);
    const rich = this.ctx.p.endgameV2 && ticks >= 9000 && gold >= 8_000_000n && (gold < mirvPrice || me.units(UnitType.MIRV).length > 0);
    if (rich && enemies.size === 0) {
      // gold that can never reach the MIRV price is spent on hydrogen bombs at the strongest un-allied neighbour
      const { rivals } = this.q.neighbours();
      const pick = rivals.filter((r) => me.canAttackPlayer(r)).sort((a, b) => b.numTilesOwned() - a.numTilesOwned())[0];
      if (pick) { enemies.add(pick); if (!this.currentTarget_ || !this.currentTarget_.isAlive()) this.currentTarget_ = pick; }
    }
    if (enemies.size === 0 && me.troops() > this.q.cap() * 0.9 && me.outgoingAttacks().length === 0) {
      // idle at cap: open a war — bomb the neighbour with the most buildings we could then take at 1.2×
      const { rivals } = this.q.neighbours();
      const pick = rivals.filter((r) => me.canAttackPlayer(r) && r.troops() * 1.2 < me.troops() * this.ctx.p.fightMaxShare).sort((a, b) => b.units(UnitType.City).length - a.units(UnitType.City).length)[0];
      if (pick) { enemies.add(pick); this.currentTarget_ = pick; }
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
        if (sams.some((s) => this.ctx.mg.euclideanDistSquared(s.tile(), tile) <= (this.ctx.mg.config().samRange(s.level()) + 5) ** 2)) continue;
        if (!this.clearOfFriends(tile, 32)) continue;
        for (const type of [UnitType.HydrogenBomb, UnitType.AtomBomb]) {
          const cost = type === UnitType.HydrogenBomb ? hCost : atomCost;
          if (gold < cost + BigInt(rich ? 2_000_000 : this.ctx.p.bombReserve)) continue;
          if (type === UnitType.HydrogenBomb && (!this.clearOfFriends(tile, 105) || enemy.numTilesOwned() < (rich ? 3000 : 8000))) continue;
          const r = this.ctx.mg.config().nukeMagnitudes(type).outer;
          let value = 0;
          for (const o of structures) if (this.ctx.mg.euclideanDistSquared(o.tile(), tile) <= r * r) value += (o.type() === UnitType.City ? 3 : o.type() === UnitType.MissileSilo || o.type() === UnitType.SAMLauncher ? 4 : 2) * o.level();
          const perGold = value / Number(cost / 100_000n);
          if (value >= 4 && (best === null || perGold > best.value)) best = { tile, value: perGold, type };
        }
      }
    }
    if (best === null) return;
    if (me.canBuild(best.type, best.tile) === false) { this.bombOutOfRange_++; return; }
    this.bombOutOfRange_ = 0;
    this.ctx.mg.addExecution(new ConstructionExecution(me, best.type, best.tile));
    this.lastBombTick = ticks;
    this.bombed.set(best.tile, (this.bombed.get(best.tile) ?? 0) + 1);
    this.bombs++;
    this.ctx.log(`t${ticks} BOMB ${best.type} at ${this.ctx.mg.x(best.tile)},${this.ctx.mg.y(best.tile)}`);
  }
  clearOfFriends(tile: TileRef, r: number): boolean {
    const x = this.ctx.mg.x(tile), y = this.ctx.mg.y(tile);
    for (let dy = -r; dy <= r; dy += 8) for (let dx = -r; dx <= r; dx += 8) {
      if (dx * dx + dy * dy > r * r || !this.ctx.mg.isValidCoord(x + dx, y + dy)) continue;
      const o = this.ctx.mg.owner(this.ctx.mg.ref(x + dx, y + dy));
      if (o.isPlayer() && (o === this.ctx.me || this.ctx.me.isFriendly(o))) return false;
    }
    return true;
  }
}
