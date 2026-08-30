// PlaybookBot: an AI player that follows the OpenFront Playbook rules.
// v2: expansion flow, bot harvesting, island boats, alliances, fighting by
// density with retreat, a gold-spending loop, and defense posts.
// Parameterised so a lab harness can tune the numbers.
//
// This file owns the loop (init/tick), the per-tick situation, the two ways troops leave home (send/boat),
// the event hooks, the rule table, and spawn picking. The rules themselves live in Situation.ts (queries),
// Military.ts, Economy.ts and Diplomacy.ts, all working on the shared BotContext.

import { Config } from "../../configuration/Config";
import {
  Execution,
  Game,
  Player,
  PlayerType,
  UnitType,
} from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { simpleHash } from "../../Util";
import { Difficulty, GameMapType } from "../../game/Game";
import { AttackExecution } from "../AttackExecution";
import { TransportShipExecution } from "../TransportShipExecution";
import { BotContext } from "./Context";
import { Diplomacy } from "./Diplomacy";
import { Economy } from "./Economy";
import { Military } from "./Military";
import { DEFAULT_PLAYBOOK, PlaybookParams } from "./Params";
import { Situation, SituationQueries } from "./Situation";

export { DEFAULT_PLAYBOOK } from "./Params";
export type { PlaybookParams } from "./Params";
export type { BotContext } from "./Context";
export type { Situation } from "./Situation";

export class PlaybookBotExecution implements Execution {
  private active = true;
  private mg!: Game;
  private config!: Config;
  private random: PseudoRandom;
  private boatSent = false;
  private landmassChecked = false;
  private onSmallLandmass = false;
  public log: string[] = [];
  public kills = 0;
  /** Bombs and MIRVs fired (kept by Military). */
  get bombs(): number {
    return this.military.bombs;
  }

  private ctx: BotContext;
  private q: SituationQueries;
  private military: Military;
  private economy: Economy;
  private diplomacy: Diplomacy;

  constructor(
    private player: Player,
    private p: PlaybookParams = DEFAULT_PLAYBOOK,
  ) {
    this.random = new PseudoRandom(simpleHash(player.id()) + 7);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const bot = this;
    this.ctx = {
      get mg() { return bot.mg; },
      get me() { return bot.player; },
      get p() { return bot.p; },
      get sit() { return bot.sit; },
      get random() { return bot.random; },
      send: (targetID, n, why, min, capFloor) => bot.send(targetID, n, why, min, capFloor),
      boat: (tile, n, why) => bot.boat(tile, n, why),
      log: (line) => { if (bot.log.length < 2000) bot.log.push(line); },
    };
    this.q = new SituationQueries(this.ctx);
    this.military = new Military(this.ctx, this.q, () => this.diplomacy.plannedTarget);
    this.economy = new Economy(this.ctx, this.q, this.military);
    this.diplomacy = new Diplomacy(this.ctx, this.q, this.military, this.economy);
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
  private sit!: Situation;
  private lastMode: "grow" | "hold" | "push" = "grow";
  private prevAllies = new Set<Player>();
  private prevIncoming = new Set<string>();
  private readSituation(): void {
    const me = this.player;
    const troops = me.troops(), cap = this.q.cap();
    const nb = this.q.neighbours();
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
      collapsed: nb.rivals.filter((r) => this.military.collapsed(r)),
      expiring: me.alliances().filter((al) => al.expiresAt() - t < 450).map((al) => al.other(me)),
      hold: null,
      share: 0, threats: [], mode: "grow",
    };
    // the finish: nations MIRV anyone over 65 % of the map on Medium (55 % Hard), allies included. Under that line
    // while a rival can still fire; remove the rivals; then push for the win.
    this.sit.share = me.numTilesOwned() / Math.max(1, this.mg.numLandTiles());
    const diff = this.mg.config().gameConfig().difficulty;
    const denial = diff === Difficulty.Easy ? 0.75 : diff === Difficulty.Medium ? 0.65 : diff === Difficulty.Hard ? 0.55 : 0.5;
    this.sit.threats = this.mg.players().filter((p) => p !== me && p.isAlive() && p.type() !== PlayerType.Bot && !me.isOnSameTeam(p) && p.units(UnitType.MissileSilo).length > 0 && (p.gold() >= 20_000_000n || p.units(UnitType.MIRV).length > 0));
    if (this.p.finishRule && this.sit.share >= denial - 0.03) this.sit.mode = this.sit.threats.length > 0 ? "hold" : "push";
    else if (this.p.finishRule && this.sit.share >= 0.45 && this.sit.threats.length === 0) this.sit.mode = "push";
    if (this.sit.mode !== this.lastMode) { if (this.log.length < 2000) this.log.push(`t${t} FINISH mode ${this.lastMode} → ${this.sit.mode}: share ${(this.sit.share * 100).toFixed(0)} %, ${this.sit.threats.length} MIRV-capable rivals${this.sit.threats.length ? " (" + this.sit.threats.map((x) => x.name()).join(", ") + ")" : ""}`); this.lastMode = this.sit.mode; }
    // A Hard nation renews only if we look as strong as it at expiry: 45 s before an alliance with a stronger
    // neighbour lapses, the army stays home so the check sees all of it.
    this.sit.hold = this.sit.expiring.find((o) => o.type() === PlayerType.Nation && o.troops() > troops * 0.85) ?? null;
  }
  /** The one place troops leave home. Never below the reserve; returns what was actually sent (0 = nothing). */
  private send(targetID: string | null, n: number, why: string, min = 500, capFloor = 0): number {
    // capFloor: never leave home under this share of CAP — Hard nations betray an ally under 20 % of cap on sight
    if (this.sit.mode === "hold" && why !== "counter" && why !== "war") return 0; // holding under the line: no more land until the MIRV-capable rivals are gone
    if (this.sit.hold !== null && why !== "counter") { if (this.log.length < 2000 && this.sit.tick % 300 === 0) this.log.push(`t${this.sit.tick} holding troops home: alliance with ${this.sit.hold.name()} about to lapse`); return 0; }
    const room = Math.floor(Math.min(this.sit.spendable, this.sit.troops - this.sit.cap * capFloor));
    const amount = Math.min(Math.floor(n), room);
    // a war goes whole or not at all: a 2× wave trimmed to 0.3× by the reserve is the worst attack in the game
    if (this.p.wholeWars && why === "war" && amount < n * 0.9) { if (this.log.length < 2000) this.log.push(`t${this.sit.tick} war held: wants ${Math.round(n / 1000)}k, only ${Math.round(room / 1000)}k spare`); return 0; }
    if (amount < min) { if (room < min && this.log.length < 2000 && this.sit.tick % 300 === 0) this.log.push(`t${this.sit.tick} held: ${why} wants ${Math.round(n / 1000)}k, ${Math.round(room / 1000)}k above reserve`); return 0; }
    this.mg.addExecution(new AttackExecution(amount, this.player, targetID));
    this.sit.spendable -= amount; this.sit.troops -= amount;
    return amount;
  }
  private boat(tile: TileRef, n: number, why: string): number {
    if (this.sit.hold !== null || (this.sit.mode === "hold" && !why.includes("collapsed"))) return 0;
    const amount = Math.min(Math.floor(n), Math.floor(this.sit.spendable));
    if (amount < 500 || this.player.canBuild(UnitType.TransportShip, tile) === false) return 0;
    this.mg.addExecution(new TransportShipExecution(this.player, tile, amount));
    this.sit.spendable -= amount; this.sit.troops -= amount; this.sit.boats++;
    if (this.log.length < 2000) this.log.push(`t${this.sit.tick} boat ${Math.round(amount / 1000)}k: ${why}`);
    return amount;
  }
  /** Things that happened since last tick. Reactions run before the regular rules. */
  private events(): void {
    const me = this.player;
    const allies = new Set(me.allies());
    for (const p of this.prevAllies) {
      if (allies.has(p) || !p.isAlive()) continue;
      this.diplomacy.onAllianceEnded(p);
    }
    this.prevAllies = allies;
    const inc = new Set(this.sit.incoming.map((a) => a.attacker().id()));
    for (const a of this.sit.incoming) {
      if (this.prevIncoming.has(a.attacker().id())) continue;
      if (this.log.length < 2000) this.log.push(`t${this.sit.tick} INCOMING ${a.attacker().name()} ${Math.round(a.troops() / 1000)}k`);
    }
    this.prevIncoming = inc;
  }
  private rules: { name: string; every: number; run: () => void }[] = [
    { name: "split", every: 200, run: () => { if (this.p.splitWatch) this.military.watchSplit(); } },
    { name: "counter", every: 10, run: () => this.military.counterAttack() },
    { name: "retreats", every: 10, run: () => this.military.manageRetreats() },
    { name: "expand", every: 10, run: () => this.military.expand() },
    { name: "tribes", every: 10, run: () => this.military.harvestBots() },
    { name: "wars", every: 10, run: () => this.military.fight() },
    { name: "alliances", every: 300, run: () => { this.diplomacy.requestAlliances(); this.diplomacy.manageExpiries(); this.diplomacy.manageEmbargoes(); } },
    { name: "early boat", every: 20, run: () => { if (!this.boatSent && this.sit.tick >= this.p.boatAtTick) this.boatSent = this.military.earlyBoat() || this.sit.tick > this.p.boatAtTick + 600; } },
    { name: "tribe boats", every: 100, run: () => { if (this.sit.tick >= 300) this.military.huntBotsByBoat(); } },
    { name: "sea expansion", every: 100, run: () => { if (this.sit.tick >= 600) this.military.seaExpansion(); } },
    { name: "build", every: 10, run: () => { this.economy.build(this.sit.tick); this.military.maybeBomb(this.sit.tick); } },
    { name: "mirv", every: 100, run: () => this.military.maybeMIRV() },
  ];

  tick(ticks: number): void {
    const me = this.player;
    if (!me.isAlive()) {
      this.active = false;
      return;
    }
    if (!this.landmassChecked && me.numTilesOwned() > 0) {
      this.landmassChecked = true;
      this.onSmallLandmass = this.q.landmassSize(this.p.islandMaxTiles + 1) <= this.p.islandMaxTiles;
    }
    this.readSituation();
    this.diplomacy.acceptAlliances();
    this.events();
    for (const r of this.rules) if (ticks % r.every === 0) r.run();
  }

  // ---------------------------------------------------------------- spawn
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
      const cands: [number, TileRef][] = [];
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
          let n300 = 0;
          for (const n of nations) { const d = Math.abs(game.x(n) - x) + Math.abs(game.y(n) - y); if (d < veto) { ok = false; break; } if (d < 200) near += 4; else if (d < 300) near += 1; if (d < 300) n300++; }
          if (!ok) continue;
          score -= Math.min(near, 12);
          // 67-spawn regression (Medium, 20 min): 12+ nations within 300 halves median land (33k vs 59k), 20+ is a
          // 2k-tile pocket (Oman, Balkans). The capped `near` term cannot see past 12.
          if (n300 >= 20) continue;
          if (n300 >= 16) score -= 8; else if (n300 >= 12) score -= 4;
          for (const b of tribes) { const d = Math.abs(game.x(b) - x) + Math.abs(game.y(b) - y); if (d < 150) score += 3; else if (d < 250) score += 1; }
          for (const h of humans) { const d = Math.abs(game.x(h) - x) + Math.abs(game.y(h) - y); if (d < 150) score -= 3; }
          if (Math.min(x, y, W - x, H - y) < 80) score += 2;
          let room = 0; for (let dy = -50; dy <= 50; dy += 10) for (let dx = -50; dx <= 50; dx += 10) { if (game.isValidCoord(x + dx, y + dy)) { const r = game.ref(x + dx, y + dy); if (game.isLand(r) && !game.hasOwner(r)) room++; } }
          score += room / 20; // free land within 50 tiles: a pocket between two nations has little
          let left = false, right = false, up = false, down = false;
          for (const n of nations) { const d = Math.abs(game.x(n) - x) + Math.abs(game.y(n) - y); if (d > 260) continue; if (game.x(n) < x - 60) left = true; if (game.x(n) > x + 60) right = true; if (game.y(n) < y - 60) up = true; if (game.y(n) > y + 60) down = true; }
          if ((left && right) || (up && down)) score -= 5; // sandwiched (67-spawn regression: no measurable effect either way; kept for continuity)
          if (prefer) score -= Math.hypot(x - prefer[0], y - prefer[1]) / 60;
          if (score > bestS) { bestS = score; best = t; }
          if (DEFAULT_PLAYBOOK.spawnBasin) cands.push([score, t]);
        }
      }
      if (best !== null && DEFAULT_PLAYBOOK.spawnBasin) {
        // second pass: the cheap score cannot tell an isthmus or island from open country. For the best 60
        // candidates, flood-fill unowned land reachable within 120 tiles. 67-spawn regression (Medium, 20 min):
        // basin < 3k = 15k median land vs 64k (vetoed), < 6k = 33k (-6). Steps, not a slope: a slope (pk1) never reordered the top.
        cands.sort((a, b) => b[0] - a[0]);
        bestS = -1e9; best = null;
        for (const [s0, t] of cands.slice(0, 60)) {
          const basin = PlaybookBotExecution.basin(game, t, 120, 12000);
          if (basin < 3000) continue;
          const s1 = s0 - (basin < 6000 ? 6 : 0);
          if (s1 > bestS) { bestS = s1; best = t; }
        }
      }
      if (best !== null) { PlaybookBotExecution.lastSpawnDiag = `tick ${game.ticks()} nations=${nations.length} tribes=${tribes.length} humans=${humans.length} stage veto=${veto} score=${bestS.toFixed(1)} at ${game.x(best)},${game.y(best)}`; return PlaybookBotExecution.inland(game, best, DEFAULT_PLAYBOOK.spawnInland); }
    }
    PlaybookBotExecution.lastSpawnDiag = `no spawn: nations=${nations.length}`;
    return null;
  }
  static lastSpawnDiag = "";
  /** Unowned land tiles reachable from `t` over unowned land within `radius` (manhattan), capped at `cap`. */
  static basin(game: Game, t: TileRef, radius: number, cap: number): number {
    const seen = new Set<TileRef>([t]);
    const q: TileRef[] = [t];
    let i = 0;
    while (i < q.length && seen.size < cap) {
      const c = q[i++];
      for (const n of game.neighbors(c)) {
        if (seen.has(n) || !game.isLand(n) || game.hasOwner(n) || game.manhattanDist(n, t) > radius) continue;
        seen.add(n); q.push(n);
      }
    }
    return seen.size;
  }
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
  owner(): Player {
    return this.player;
  }
}
