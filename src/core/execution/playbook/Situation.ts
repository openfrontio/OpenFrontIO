// Situation: the per-tick picture every rule reads (built by PlaybookBotExecution.readSituation) and the
// stateless-ish queries about the map and our neighbours that several modules share.

import { Attack, Player, PlayerType, UnitType } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { BotContext } from "./Context";

/** One evaluated picture of the game per tick; every rule reads this instead of re-deriving state. */
export interface Situation {
  tick: number; troops: number; cap: number; capShare: number; reserve: number; spendable: number;
  gold: bigint; bots: Player[]; rivals: Player[]; friends: Player[]; wilderness: boolean;
  incoming: Attack[]; incomingBots: number; outgoing: Attack[]; tribeAttacks: number; boats: number;
  collapsed: Player[]; expiring: Player[]; hold: Player | null;
  share: number; threats: Player[]; mode: "grow" | "hold" | "push";
}

export class SituationQueries {
  constructor(private ctx: BotContext) {}

  // ---------------------------------------------------------------- helpers
  neighbours(): { bots: Player[]; rivals: Player[]; friends: Player[]; wilderness: boolean } {
    const bots: Player[] = [], rivals: Player[] = [], friends: Player[] = [];
    let wilderness = false;
    for (const n of this.ctx.me.nearby()) {
      if (!n.isPlayer()) { wilderness = true; continue; }
      if (n.type() === PlayerType.Bot) bots.push(n);
      else if (this.ctx.me.isFriendly(n)) friends.push(n);
      else rivals.push(n);
    }
    return { bots, rivals, friends, wilderness };
  }
  cap(): number {
    return this.ctx.mg.config().maxTroops(this.ctx.me);
  }
  outgoingTo(target: Player): Attack | undefined {
    return this.ctx.me.outgoingAttacks().find((a) => a.target() === target);
  }
  density(p: Player): number {
    return p.numTilesOwned() > 0 ? p.troops() / p.numTilesOwned() : 1e9;
  }

  // ---------------------------------------------------------------- annexation
  private annexCache = new Map<Player, { tick: number; ok: boolean }>();
  /** A neighbour we could annex by encirclement: no ocean coast, no map edge, and we already hold at least
   *  40 % of its border. Such a neighbour must never be an ally (an ally's cluster never flips). */
  annexable(p: Player): boolean {
    const c = this.annexCache.get(p);
    if (c && this.ctx.mg.ticks() - c.tick < 100) return c.ok;
    let ok = true, ours = 0, n = 0, i = 0;
    for (const t of p.borderTiles()) {
      if (this.ctx.mg.isOceanShore(t) || this.ctx.mg.isOnEdgeOfMap(t)) { ok = false; break; }
      if ((i++ % 3) !== 0) continue;
      n++;
      for (const nb of this.ctx.mg.neighbors(t)) { if (this.ctx.mg.owner(nb) === this.ctx.me) { ours++; break; } }
    }
    ok = ok && n > 0 && ours / n >= 0.4 && p.numTilesOwned() < this.ctx.me.numTilesOwned();
    this.annexCache.set(p, { tick: this.ctx.mg.ticks(), ok });
    if (ok && !(c && c.ok)) this.ctx.log(`t${this.ctx.mg.ticks()} ANNEX target ${p.name()} ${p.numTilesOwned()}t (${Math.round((100 * ours) / n)} % of its border is ours)`);
    return ok;
  }

  // ---------------------------------------------------------------- landmass and water
  landmassSize(limit: number): number {
    return this.landmassTiles(limit).size;
  }
  landmassTiles(limit: number): Set<TileRef> {
    const start = this.ctx.me.borderTiles().values().next().value as TileRef | undefined;
    const seen = new Set<TileRef>();
    if (start === undefined) return seen;
    seen.add(start);
    const stack = [start];
    while (stack.length > 0 && seen.size < limit) {
      const t = stack.pop()!;
      this.ctx.mg.forEachNeighbor(t, (n) => { if (!seen.has(n) && this.ctx.mg.isLand(n)) { seen.add(n); stack.push(n); } });
    }
    return seen;
  }

  /** True when no land path from `t` reaches our territory (flood fill capped at `cap` tiles). */
  acrossWater(t: TileRef, cap = 4000): boolean {
    const me = this.ctx.me;
    const seen = new Set<TileRef>([t]);
    const q: TileRef[] = [t];
    while (q.length > 0 && seen.size < cap) {
      const c = q.pop()!;
      if (this.ctx.mg.owner(c) === me) return false;
      for (const n of this.ctx.mg.neighbors(c)) { if (!this.ctx.mg.isLand(n) || seen.has(n)) continue; seen.add(n); q.push(n); }
    }
    return true;
  }

  // ---------------------------------------------------------------- defence posts
  postFacing(r: Player): boolean {
    const rid = r.smallID();
    for (const dp of this.ctx.me.units(UnitType.DefensePost)) {
      const near = this.ctx.mg.nearbyUnits(dp.tile(), 30, UnitType.DefensePost);
      void near;
      let touches = false;
      // cheap check: any tile of r within 30 manhattan of the post along a sampled ring
      const x = this.ctx.mg.x(dp.tile()), y = this.ctx.mg.y(dp.tile());
      for (let dy = -30; dy <= 30 && !touches; dy += 6) for (let dx = -30; dx <= 30; dx += 6) {
        if (!this.ctx.mg.isValidCoord(x + dx, y + dy)) continue;
        if (this.ctx.mg.ownerID(this.ctx.mg.ref(x + dx, y + dy)) === rid) { touches = true; break; }
      }
      if (touches) return true;
    }
    return false;
  }
}
