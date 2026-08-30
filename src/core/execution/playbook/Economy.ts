// Economy: gold spending (posts, SAMs, cities, ports, rail, silos, warships) and the tile pickers behind it.

import { Player, PlayerType, Unit, UnitType } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { ConstructionExecution } from "../ConstructionExecution";
import { UpgradeStructureExecution } from "../UpgradeStructureExecution";
import { closestTile } from "../Util";
import { BotContext } from "./Context";
import { Military } from "./Military";
import { SituationQueries } from "./Situation";

export class Economy {
  private rail: { factory: Unit | null; anchor: Unit | null; infilled: number; extended: boolean; failed: number } = { factory: null, anchor: null, infilled: 0, extended: false, failed: 0 };
  private lastSamTick = -1e9;
  private lastWarshipTick = -1e9;
  private postFailed_ = new Map<Player, number>();

  constructor(
    private ctx: BotContext,
    private q: SituationQueries,
    private military: Military,
  ) {}

  /** Rivals we failed to place a threat post against, by tick (cleared by Diplomacy.onAllianceEnded). */
  get postFailed(): Map<Player, number> {
    return this.postFailed_;
  }

  // ---------------------------------------------------------------- rail line (factory → anchor → infill)
  /** Returns true if it spent this pass. */
  buildRail(gold: bigint, cost: (u: UnitType) => bigint): boolean {
    const me = this.ctx.me;
    const R = this.rail;
    if (R.failed > 20) { if (this.ctx.mg.ticks() % 3000 === 0) R.failed = 0; else return false; } // try again every 5 min
    if (R.factory && !R.factory.isActive()) { R.factory = null; R.anchor = null; R.infilled = 0; }
    if (R.factory === null && this.pendingFactory !== null) {
      const u = this.ctx.mg.nearbyUnits(this.pendingFactory, 3, UnitType.Factory).find((x) => x.unit.owner() === me)?.unit;
      if (u) { R.factory = u; this.pendingFactory = null; } else if (this.ctx.mg.ticks() - this.pendingFactoryTick > 400) { this.pendingFactory = null; R.failed++; this.ctx.log(`t${this.ctx.mg.ticks()} rail factory never appeared`); } // a factory takes 10 s to build; 60 ticks was too short and bought a second factory every minute
      return false;
    }
    if (R.factory === null) {
      if (gold < cost(UnitType.Factory)) return false;
      const spot = this.railFactorySpot();
      if (spot === null) { R.failed++; if (R.failed % 5 === 1) this.ctx.log(`t${this.ctx.mg.ticks()} rail: no factory spot (${this.railDiag})`); return false; }
      if (this.tryBuild(UnitType.Factory, spot.factory)) { this.pendingAnchor = spot.anchor; this.pendingFactory = spot.factory; this.pendingFactoryTick = this.ctx.mg.ticks(); return true; }
      R.failed++; return false;
    }
    if (R.anchor === null && this.pendingAnchor !== null && this.pendingAnchorTick >= 0) {
      const u = this.ctx.mg.nearbyUnits(this.pendingAnchor, 3, UnitType.City).find((x) => x.unit.owner() === me)?.unit;
      if (u) { R.anchor = u; this.pendingAnchorTick = -1; } else if (this.ctx.mg.ticks() - this.pendingAnchorTick > 400) { this.pendingAnchorTick = -1; R.failed++; }
      return false;
    }
    if (R.anchor === null) {
      if (this.pendingAnchor === null) { R.failed++; return false; }
      const anchorOwner = this.ctx.mg.owner(this.pendingAnchor);
      if (anchorOwner !== me) { // allied city as anchor: nothing to build
        const u = this.ctx.mg.nearbyUnits(this.pendingAnchor, 2, UnitType.City)[0]?.unit; if (u) { R.anchor = u; return false; }
        R.failed++; return false;
      }
      if (gold < cost(UnitType.City)) return false;
      if (me.canBuild(UnitType.City, this.pendingAnchor) === false) { R.failed++; return false; }
      this.ctx.mg.addExecution(new ConstructionExecution(me, UnitType.City, this.pendingAnchor));
      this.pendingAnchorTick = this.ctx.mg.ticks();
      this.ctx.log(`t${this.ctx.mg.ticks()} rail anchor city`);
      return true;
    }
    // infill along the rails leaving the factory
    if (gold < cost(UnitType.City)) return false;
    const infill = this.railInfillTile();
    if (infill === null && R.failed < 1e9 && !this.ctx.mg.railNetwork().stationManager().findStation(R.factory)) { R.failed++; return false; }
    if (infill !== null) {
      this.ctx.mg.addExecution(new ConstructionExecution(me, UnitType.City, infill));
      R.infilled++;
      this.ctx.log(`t${this.ctx.mg.ticks()} rail infill city #${R.infilled}`);
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
  railInfillTile(): TileRef | null {
    const me = this.ctx.me;
    const R = this.rail;
    if (R.factory === null || !R.factory.isActive()) return null;
    const station = this.ctx.mg.railNetwork().stationManager().findStation(R.factory);
    if (!station) return null;
    for (const rr of station.getRailroads()) {
      const tiles = rr.tiles;
      const fromFactory = rr.from === station ? tiles : [...tiles].reverse();
      for (let i = this.ctx.p.railSpacing; i < fromFactory.length - this.ctx.p.railSpacing + 2; i += 2) {
        const t = fromFactory[i];
        if (this.ctx.mg.owner(t) !== me) continue;
        if (this.ctx.mg.hasUnitNearby(t, this.ctx.p.railSpacing - 1, UnitType.City) || this.ctx.mg.hasUnitNearby(t, this.ctx.p.railSpacing - 1, UnitType.Factory) || this.ctx.mg.hasUnitNearby(t, this.ctx.p.railSpacing - 1, UnitType.Port)) continue;
        if (me.canBuild(UnitType.City, t) === false) continue;
        return t;
      }
    }
    return null;
  }
  private firstPortTick = 1e9;
  private pendingAnchor: TileRef | null = null;
  private pendingAnchorTick = -1;
  private pendingFactory: TileRef | null = null;
  private pendingFactoryTick = 0;
  /** Factory spot + anchor 90–108 tiles away in a straight line over our land (or an ally's city within 110). */
  railFactorySpot(from?: TileRef): { factory: TileRef; anchor: TileRef } | null {
    const me = this.ctx.me;
    const starts = from ? [from] : this.sampleTerritory(40);
    let okStarts = 0, anchorsTried = 0;
    let best: { factory: TileRef; anchor: TileRef; score: number } | null = null;
    // allied cities in range are the best anchors (35k a stop)
    const allyCities = this.ctx.mg.players().filter((o) => o !== me && me.isFriendly(o)).flatMap((o) => o.units(UnitType.City));
    for (const f of starts) {
      if (me.canBuild(UnitType.Factory, f) === false) continue;
      okStarts++;
      for (const c of allyCities) {
        const d2 = this.ctx.mg.euclideanDistSquared(f, c.tile());
        if (d2 > 105 * 105 || d2 < 40 * 40) continue;
        const sc = 100 + Math.sqrt(d2);
        if (best === null || sc > best.score) best = { factory: f, anchor: c.tile(), score: sc };
      }
      if (best && best.score >= 100) continue;
      const fx = this.ctx.mg.x(f), fy = this.ctx.mg.y(f);
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        for (let dist = 104; dist >= 40; dist -= 8) { // a 40-tile line still fits two stations; small empires need short lines
          const x = Math.round(fx + Math.cos(ang) * dist), y = Math.round(fy + Math.sin(ang) * dist);
          if (!this.ctx.mg.isValidCoord(x, y)) continue;
          const t = this.ctx.mg.ref(x, y);
          if (this.ctx.mg.owner(t) !== me) continue;
          anchorsTried++;
          // the straight line must stay on our land (sampled)
          let ok = true;
          for (let k = 0.1; k < 1 && ok; k += 0.1) { const sx = Math.round(fx + (x - fx) * k), sy = Math.round(fy + (y - fy) * k); if (!this.ctx.mg.isValidCoord(sx, sy) || this.ctx.mg.owner(this.ctx.mg.ref(sx, sy)) !== me) ok = false; }
          if (!ok) continue;
          if (me.canBuild(UnitType.City, t) === false) continue;
          const [, db] = closestTile(this.ctx.mg, me.borderTiles(), t);
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
  cityUnitCap(): number {
    const me = this.ctx.me;
    let second = 0;
    for (const p of this.ctx.mg.players()) { if (p === me || !p.isAlive() || p.type() === PlayerType.Bot) continue; second = Math.max(second, p.unitCount(UnitType.City)); }
    return Math.max(9, Math.floor(second * 1.15));
  }
  rank(): number {
    const me = this.ctx.me;
    return this.ctx.mg.players().filter((p) => p.isAlive() && p.type() !== PlayerType.Bot && p.numTilesOwned() > me.numTilesOwned()).length + 1;
  }

  // ---------------------------------------------------------------- buildings
  build(ticks: number): void {
    const me = this.ctx.me;
    const cost = (u: UnitType) => this.ctx.mg.config().unitInfo(u).cost(this.ctx.mg, me);
    const gold = me.gold();
    const cities = me.unitsOwned(UnitType.City); // levels
    const cityUnits = me.units(UnitType.City);
    const ports = me.units(UnitType.Port);
    const portLevels = me.unitsOwned(UnitType.Port);
    const capFull = me.troops() > this.q.cap() * this.ctx.p.capFullShare;
    const { rivals, friends } = this.q.neighbours();
    const cityCapHit = cityUnits.length >= this.cityUnitCap();
    const myRank = ticks >= 9000 ? this.rank() : 99;
    // top three after 20:00: half of every gold pile is the MIRV fund — a crown without a MIRV loses to the first one fired
    // top three from 20:00: the whole MIRV price is reserved (it rises 15M with every launch on the map, so the first
    // launch is the cheap one); the economy keeps buying only while troops are under 40 % of cap
    const mirvPriceNow = this.ctx.mg.config().unitInfo(UnitType.MIRV).cost(this.ctx.mg, me);
    const mirvFund = ticks >= 12000 && myRank <= 3 && me.units(UnitType.MissileSilo).length > 0 && me.units(UnitType.MIRV).length === 0 && me.troops() >= this.q.cap() * 0.4 && mirvPriceNow <= 40_000_000n ? mirvPriceNow : 0n; // past 40M the MIRV is a hoard, not a plan
    const seaFull = this.ctx.mg.unitCount(UnitType.TradeShip) >= this.ctx.p.seaFullShips || ticks >= 15000; // guide: nothing bought after 25:00 pays back
    const upgrade = (u: Unit) => { this.ctx.mg.addExecution(new UpgradeStructureExecution(me, u.id())); this.ctx.log(`t${ticks} level ${u.type()} → ${u.level() + 1}`); };

    // 1. defence: a post where a non-bot attack lands, or facing a threat / a boxed-in nation about to betray
    const incoming = me.incomingAttacks().find((a) => a.attacker().type() !== PlayerType.Bot);
    if (incoming && gold >= cost(UnitType.DefensePost) && me.unitsOwned(UnitType.DefensePost) < 8) {
      const tile = this.defensePostTile(incoming.attacker());
      if (tile !== null && this.tryBuild(UnitType.DefensePost, tile)) return;
    }
    if (cityUnits.length >= 1 && ticks >= 900 && gold >= cost(UnitType.DefensePost) + (cityUnits.length < 2 && !this.ctx.p.postsBeforeCity2 ? cost(UnitType.City) : 0n) && me.unitsOwned(UnitType.DefensePost) < 6) { // a threat post never delays city 2; an actual incoming attack (above) still gets one
      // an ally whose alliance ends within 45 s counts as a threat: Hard nations attack the moment it lapses
      const expiring = me.alliances().filter((al) => al.expiresAt() - ticks < 450).map((al) => al.other(me)).filter((o) => friends.includes(o) && o.troops() >= me.troops() * 0.4);
      const threat = [...expiring, ...rivals].find((r) => ticks - (this.postFailed_.get(r) ?? -1e9) > 600 && (r.troops() >= me.troops() * 0.5 || expiring.includes(r) || (r.type() === PlayerType.Nation && me.troops() > r.troops() * 3)) && !this.q.postFacing(r));
      if (threat) { const tile = this.defensePostTile(threat); if (tile !== null && this.tryBuild(UnitType.DefensePost, tile)) return; this.postFailed_.set(threat, ticks); this.ctx.log(`t${ticks} post vs ${threat.name()} FAILED (${tile === null ? "no tile" : "canBuild"})`); }
      else if (ticks % 600 === 0) this.ctx.log(`t${ticks} no threat: rivals=${rivals.map((r) => r.name() + ":" + Math.round(r.troops() / 1000) + "k").join(",")} friends=${friends.length}`);
    }
    // 2. SAM once anyone unfriendly on the map has a silo, or once we are top three after 15:00 (the crown gets MIRVed);
    //    level 3 when leading; a second launcher when the city stack outgrows one umbrella
    const enemySilos = this.ctx.mg.players().some((o) => o !== me && !me.isFriendly(o) && o.type() !== PlayerType.Bot && o.units(UnitType.MissileSilo).length > 0);
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
          const far = this.sampleTerritory(30).find((t) => sams.every((sm) => this.ctx.mg.euclideanDistSquared(sm.tile(), t) > 60 * 60) && me.canBuild(UnitType.SAMLauncher, t) !== false);
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
    const partnerTile = cities >= this.ctx.p.citiesBeforePort ? this.portTile() : null;
    if (gold - mirvFund >= cost(UnitType.Port) && !(seaFull && portLevels >= 20)) {
      // first port: facing a partner if one exists; otherwise on any ocean coast from 2:30 — nations build ports by minute 3–5 and a port earns 7× base income once they do
      const firstTile = partnerTile ?? (cities >= 1 && ticks >= this.ctx.p.portWithoutPartnerTick ? this.oceanShoreTile() : null);
      if (ports.length === 0 && firstTile !== null && this.tryBuild(UnitType.Port, firstTile)) { this.firstPortTick = ticks; return; }
      if (ports.length > 0) {
        const bestPort = [...ports].sort((a, b) => b.level() - a.level())[0];
        const wantLevel = bestPort.level() < this.ctx.p.portLevelBeforeSecond || ports.length >= this.ctx.p.maxPortUnits || partnerTile === null;
        // level the port unless a city is affordable and troops are near cap (then the city comes first, below)
        if (wantLevel && me.canUpgradeUnit(bestPort) && (me.troops() < this.q.cap() * 0.8 || gold < cost(UnitType.City))) { upgrade(bestPort); return; }
        if (!wantLevel && partnerTile !== null && this.tryBuild(UnitType.Port, partnerTile)) return;
      }
    }
    // 5. rail line: landlocked, or an ally borders us, or the sea is full
    const deadPorts = ports.length > 0 && me.units(UnitType.TradeShip).length === 0 && ticks - this.firstPortTick > 900;
    const wantRail = cities >= 3 && ((ports.length === 0 && partnerTile === null && ticks >= 1500) || deadPorts || (friends.length > 0 && ticks >= 1800) || (ports.length > 0 && ticks >= 1800) || seaFull) && me.unitsOwned(UnitType.Factory) < 6;
    if (wantRail && this.buildRail(gold - mirvFund, cost)) return;
    if (!wantRail && cities >= 3 && ticks % 1200 < 10) this.ctx.log(`t${ticks} no rail wanted: ports=${ports.length} partner=${partnerTile !== null} friends=${friends.length} seaFull=${seaFull}`);
    // 6. silos, nation-style: the first at four city units or 10:00 (whichever comes first, once a port or factory pays),
    //    a second at twelve, a third at twenty; a level when a bomb target sat out of range
    const idleAtCap = capFull && me.troops() > this.q.cap() * 0.9 && me.outgoingAttacks().length === 0;
    const silos = me.units(UnitType.MissileSilo);
    const siloTarget = cityUnits.length >= 25 ? 3 : cityUnits.length >= 14 ? 2 : (ticks >= this.ctx.p.siloAtTick || idleAtCap) && (portLevels >= 1 || me.unitsOwned(UnitType.Factory) > 0 || idleAtCap) ? 1 : 0; // v8 (silo at 4 cities, SAM per 5, warships early) cost 36 % of land: the ratios wait for the economy
    const wantSilo = silos.length < siloTarget && ticks >= 3000;
    if (wantSilo && gold >= cost(UnitType.MissileSilo) + 400_000n) {
      const tile = silos.length === 0 ? this.interiorTile(UnitType.MissileSilo) : this.sampleTerritory(30).find((t) => silos.every((sl) => this.ctx.mg.euclideanDistSquared(sl.tile(), t) > 50 * 50) && me.canBuild(UnitType.MissileSilo, t) !== false) ?? null;
      if (tile !== null && this.tryBuild(UnitType.MissileSilo, tile)) return;
    }
    if (this.military.bombOutOfRange >= 3 && silos.length > 0 && gold - mirvFund >= cost(UnitType.MissileSilo) * 2n) {
      const low = silos.find((sl) => sl.level() < 4 && me.canUpgradeUnit(sl));
      if (low) { upgrade(low); this.military.bombOutOfRange = 0; return; }
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
    const atWar = (this.military.currentTarget !== null && this.military.currentTarget.isAlive() && !me.isFriendly(this.military.currentTarget)) || me.incomingAttacks().some((a) => a.attacker().type() !== PlayerType.Bot);
    const reserve = me.units(UnitType.MissileSilo).length > 0 && (atWar || idleAtCap) ? 1_000_000n : siloReserve;
    // 9. a warship per four ports when gold is spare: it sinks landing boats and guards the trade lanes
    const warships = me.units(UnitType.Warship);
    if (ports.length > 0 && ticks >= 9000 && warships.length < Math.ceil(ports.length / 6) && ticks - this.lastWarshipTick >= 600 && gold - reserve - mirvFund >= cost(UnitType.Warship) + 500_000n && !this.ctx.mg.config().isUnitDisabled(UnitType.Warship)) {
      const port = ports[warships.length % ports.length];
      for (let a = 0; a < 8; a++) {
        const x = this.ctx.mg.x(port.tile()) + Math.round(Math.cos((a / 8) * Math.PI * 2) * 20), y = this.ctx.mg.y(port.tile()) + Math.round(Math.sin((a / 8) * Math.PI * 2) * 20);
        if (!this.ctx.mg.isValidCoord(x, y)) continue;
        const t = this.ctx.mg.ref(x, y);
        if (!this.ctx.mg.isOcean(t) || me.canBuild(UnitType.Warship, t) === false) continue;
        this.ctx.mg.addExecution(new ConstructionExecution(me, UnitType.Warship, t));
        this.lastWarshipTick = ticks;
        this.ctx.log(`t${ticks} build Warship`);
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
  tryBuild(type: UnitType, tile: TileRef): boolean {
    if (this.ctx.me.canBuild(type, tile) === false) return false;
    this.ctx.mg.addExecution(new ConstructionExecution(this.ctx.me, type, tile));
    this.ctx.log(`t${this.ctx.mg.ticks()} build ${type}`);
    return true;
  }
  sampleTerritory(n: number): TileRef[] {
    const size = this.ctx.me.numTilesOwned();
    const arr: TileRef[] = [];
    if (size === 0) return arr;
    const step = Math.max(1, Math.floor(size / n));
    let i = 0;
    for (const t of this.ctx.me.tiles()) { if (i % step === 0) arr.push(t); i++; if (arr.length >= n) break; }
    return arr;
  }
  tileNear(center: TileRef, radius: number): TileRef | null {
    const cx = this.ctx.mg.x(center), cy = this.ctx.mg.y(center);
    let best: TileRef | null = null, bestD = 1e9;
    for (const t of this.sampleTerritory(120)) {
      const d = Math.abs(this.ctx.mg.x(t) - cx) + Math.abs(this.ctx.mg.y(t) - cy);
      if (d < 16 || d > radius) continue;
      if (d < bestD && this.ctx.me.canBuild(UnitType.Factory, t) !== false) { bestD = d; best = t; }
    }
    return best;
  }
  interiorTile(type: UnitType = UnitType.City): TileRef | null {
    const border = this.ctx.me.borderTiles();
    let best: TileRef | null = null, bestD = -1;
    for (const t of this.sampleTerritory(40)) {
      const [, d] = closestTile(this.ctx.mg, border, t);
      if (d > bestD && this.ctx.me.canBuild(type, t) !== false) { bestD = d; best = t; }
    }
    return best;
  }
  oceanShoreTile(): TileRef | null {
    const me = this.ctx.me;
    const shore = Array.from(me.borderTiles()).filter((t) => this.ctx.mg.isOceanShore(t));
    const step = Math.max(1, Math.floor(shore.length / 40));
    for (let i = 0; i < shore.length; i += step) { if (me.canBuild(UnitType.Port, shore[i]) !== false) return shore[i]; }
    return null;
  }
  portTile(): TileRef | null {
    const me = this.ctx.me;
    const shared = this.ctx.mg.sharedWaterComponents(me);
    const foreignPorts = this.ctx.mg.players().filter((p) => p !== me && p.type() !== PlayerType.Bot).flatMap((p) => p.units(UnitType.Port));
    if (foreignPorts.length === 0) return null;
    const shore = Array.from(me.borderTiles()).filter((t) => this.ctx.mg.isShore(t));
    if (shore.length === 0) return null;
    const step = Math.max(1, Math.floor(shore.length / 30));
    let best: TileRef | null = null, bestScore = 0;
    for (let i = 0; i < shore.length; i += step) {
      const t = shore[i];
      let comp: number | null = null;
      for (const nb of this.ctx.mg.neighbors(t)) {
        if (!this.ctx.mg.isWater(nb)) continue;
        const c = this.ctx.mg.getWaterComponent(nb);
        if (c !== null && (this.ctx.mg.isOcean(nb) || (shared !== null && shared.has(c)))) { comp = c; break; }
      }
      if (comp === null) continue;
      let score = 0;
      for (const fp of foreignPorts) {
        if (!this.ctx.mg.hasWaterComponent(fp.tile(), comp)) continue;
        const d = this.ctx.mg.manhattanDist(fp.tile(), t);
        if (d >= this.ctx.p.portMinPartnerDist) score += d < 800 ? 2 : 1;
      }
      if (score > bestScore && me.canBuild(UnitType.Port, t) !== false) { bestScore = score; best = t; }
    }
    return best;
  }
  defensePostTile(attacker: Player): TileRef | null {
    const me = this.ctx.me;
    const aid = attacker.smallID();
    const candidates: TileRef[] = [];
    for (const t of me.borderTiles()) {
      let touches = false;
      this.ctx.mg.forEachNeighbor(t, (n) => { if (this.ctx.mg.ownerID(n) === aid) touches = true; });
      if (touches) candidates.push(t);
      if (candidates.length > 80) break;
    }
    if (candidates.length === 0) return null;
    // contact midpoint, then step 6–12 tiles away from the attacker's side of the border
    const mid = candidates[Math.floor(candidates.length / 2)];
    const mx = this.ctx.mg.x(mid), my = this.ctx.mg.y(mid);
    let ax = 0, ay = 0, n = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      if (!this.ctx.mg.isValidCoord(mx + dx, my + dy)) continue;
      if (this.ctx.mg.ownerID(this.ctx.mg.ref(mx + dx, my + dy)) === aid) { ax += dx; ay += dy; n++; }
    }
    if (n === 0) return null;
    const len = Math.hypot(ax, ay) || 1;
    const ux = -ax / len, uy = -ay / len; // away from the attacker
    for (let d = 8; d <= 14; d += 2) {
      for (const [sx, sy] of [[0, 0], [uy, -ux], [-uy, ux]] as [number, number][]) {
        for (let side = 0; side <= 6; side += 3) {
          const x = Math.round(mx + ux * d + sx * side), y = Math.round(my + uy * d + sy * side);
          if (!this.ctx.mg.isValidCoord(x, y)) continue;
          const t = this.ctx.mg.ref(x, y);
          if (this.ctx.mg.owner(t) !== me || !this.ctx.mg.isLand(t)) continue;
          if (me.canBuild(UnitType.DefensePost, t) !== false) return t;
        }
      }
    }
    return me.canBuild(UnitType.DefensePost, mid) !== false ? mid : null;
  }
}
