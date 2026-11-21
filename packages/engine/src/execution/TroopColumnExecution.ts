import { TileRef } from "@openfront/engine-api/game/GameMap";
import { MessageType, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  zInt,
  zNum,
  zPlayerRef,
  zRef,
  zTiles,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { AttackExecution } from "./AttackExecution";

// How far from the clicked tile a column may come out of allied land.
const LANDING_SEARCH_RADIUS = 30;
// Corridor search budget (tiles visited) and longest march allowed.
const MAX_SEARCH_TILES = 250_000;
const MAX_PATH_LENGTH = 600;
const TILES_PER_TICK = 2;
const RETREAT_KEEP = 0.75;

/**
 * Military access: troops march as a column through allied territory and
 * attack a third player from the allied side of its border (a bridgehead,
 * like a boat landing). The corridor must stay friendly the whole way; if an
 * alliance breaks or the land changes hands under the column, it turns back
 * and the troops come home with the retreat penalty.
 */
export class TroopColumnExecution implements Execution {
  private active = true;
  private mg: Game;
  private column: Unit | null = null;
  private path: TileRef[] = [];
  private index = 0;
  private targetID: string | null = null;

  constructor(
    private player: Player,
    private dst: TileRef,
    private troops: number | null,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.config().brokenfrontFeature("alliedTransit")) {
      this.active = false;
      return;
    }
    if (!mg.isValidRef(this.dst) || !mg.isLand(this.dst)) {
      this.active = false;
      return;
    }
    const target = mg.owner(this.dst);
    if (target === this.player) {
      this.active = false;
      return;
    }
    if (target.isPlayer()) {
      if (this.player.isFriendly(target) || !this.player.canAttackPlayer(target)) {
        this.active = false;
        return;
      }
      this.targetID = target.id();
    }

    const path = findTransitPath(mg, this.player, this.dst);
    if (path === null) {
      this.active = false;
      return;
    }
    const want =
      this.troops ?? mg.config().attackAmount(this.player, target);
    const troops = Math.floor(Math.min(want, this.player.troops()));
    if (troops <= 0) {
      this.active = false;
      return;
    }
    if (this.player.canBuild(UnitType.TroopColumn, path[0]) === false) {
      this.active = false;
      return;
    }
    this.path = path;
    this.column = this.player.buildUnit(UnitType.TroopColumn, path[0], {
      troops,
      targetTile: this.dst,
    });
    if (target.isPlayer()) {
      this.mg.displayIncomingUnit(
        this.column.id(),
        "events_display.troop_column_inbound",
        MessageType.NAVAL_INVASION_INBOUND,
        target.id(),
      );
    }
  }

  tick(ticks: number): void {
    const column = this.column;
    if (column === null || !column.isActive()) {
      // Recalled (cancel_boat) or destroyed.
      this.active = false;
      return;
    }
    for (let step = 0; step < TILES_PER_TICK; step++) {
      if (this.index >= this.path.length - 1) {
        this.arrive(column);
        return;
      }
      const next = this.path[this.index + 1];
      if (!this.isCorridor(next)) {
        this.turnBack(column);
        return;
      }
      this.index++;
      column.move(next);
    }
  }

  /** Whether the column may stand on `t`: own land or a friend's. */
  private isCorridor(t: TileRef): boolean {
    const owner = this.mg.owner(t);
    if (!owner.isPlayer()) return false;
    return owner === this.player || this.player.isFriendly(owner);
  }

  private turnBack(column: Unit): void {
    this.player.addTroops(Math.floor(column.troops() * RETREAT_KEEP));
    this.mg.displayMessage(
      "events_display.troop_column_turned_back",
      MessageType.ATTACK_CANCELLED,
      this.player.id(),
    );
    column.delete(false);
    this.active = false;
  }

  private arrive(column: Unit): void {
    const mg = this.mg;
    const here = column.tile();
    const troops = column.troops();
    column.delete(false);
    this.active = false;

    // Step out of the corridor onto the target's land next to it.
    let landing: TileRef | null = null;
    for (const n of mg.neighbors(here)) {
      if (!mg.isLand(n) || mg.isImpassable(n)) continue;
      const owner = mg.owner(n);
      const ownerID = owner.isPlayer() ? owner.id() : null;
      if (ownerID === this.targetID && owner !== this.player) {
        landing = n;
        break;
      }
    }
    const target = this.targetID === null ? null : mg.player(this.targetID);
    if (
      landing === null ||
      (target !== null && (this.player.isFriendly(target) || !target.isAlive()))
    ) {
      // Nothing left to attack here: the column simply rejoins the army.
      this.player.addTroops(troops);
      return;
    }
    this.player.conquer(landing);
    mg.addExecution(
      new AttackExecution(troops, this.player, this.targetID, landing, false),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return TroopColumnExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      player: w.player(this.player),
      dst: this.dst,
      troops: this.troops,
      column: w.unitOrNull(this.column),
      path: w.tiles(this.path),
      index: this.index,
      targetID: this.targetID,
    });
  }

  restoreSnapshot(s: TroopColumnState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.player = r.player(s.player);
    this.dst = s.dst;
    this.troops = s.troops;
    this.column = r.unitOrNull(s.column);
    this.path = Array.from(s.path);
    this.index = s.index;
    this.targetID = s.targetID;
  }
}

/**
 * The shortest corridor from `player`'s land, through land held by the
 * player or its friends, to a friendly tile on the border of whoever owns
 * `dst`, within LANDING_SEARCH_RADIUS of `dst`. A multi-source BFS from the
 * landing candidates (nearest to `dst` first) back toward the player's own
 * land, in a fixed neighbour order, so every client finds the same path.
 * Returns the path from the player's land to the landing tile, or null.
 */
export function findTransitPath(
  mg: Game,
  player: Player,
  dst: TileRef,
): TileRef[] | null {
  const target = mg.owner(dst);
  const targetSmallID = target.smallID();
  const mySmallID = player.smallID();
  const friendly = (t: TileRef): boolean => {
    const owner = mg.owner(t);
    return owner.isPlayer() && owner !== player && player.isFriendly(owner);
  };
  const corridor = (t: TileRef): boolean =>
    mg.isLand(t) &&
    !mg.isImpassable(t) &&
    (mg.ownerID(t) === mySmallID || friendly(t));

  // Landing candidates: friendly tiles touching the target's land near dst.
  const candidates: { t: TileRef; d: number }[] = [];
  const cx = mg.x(dst);
  const cy = mg.y(dst);
  for (
    let y = Math.max(0, cy - LANDING_SEARCH_RADIUS);
    y <= Math.min(mg.height() - 1, cy + LANDING_SEARCH_RADIUS);
    y++
  ) {
    for (
      let x = Math.max(0, cx - LANDING_SEARCH_RADIUS);
      x <= Math.min(mg.width() - 1, cx + LANDING_SEARCH_RADIUS);
      x++
    ) {
      const t = mg.ref(x, y);
      if (!mg.isLand(t) || mg.isImpassable(t) || !friendly(t)) continue;
      let touches = false;
      for (const n of mg.neighbors(t)) {
        if (mg.ownerID(n) === targetSmallID && mg.isLand(n)) {
          touches = true;
          break;
        }
      }
      if (touches) {
        candidates.push({ t, d: mg.manhattanDist(t, dst) });
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.d - b.d || a.t - b.t);

  // BFS from the landings back to the player's own land.
  const parent = new Map<TileRef, TileRef>();
  const depth = new Map<TileRef, number>();
  const queue: TileRef[] = [];
  for (const { t } of candidates) {
    parent.set(t, -1);
    depth.set(t, 0);
    queue.push(t);
  }
  let head = 0;
  let reached: TileRef | null = null;
  while (head < queue.length && parent.size < MAX_SEARCH_TILES) {
    const t = queue[head++];
    if (mg.ownerID(t) === mySmallID) {
      reached = t;
      break;
    }
    const d = depth.get(t)!;
    if (d >= MAX_PATH_LENGTH) continue;
    for (const n of mg.neighbors(t)) {
      if (parent.has(n) || !corridor(n)) continue;
      parent.set(n, t);
      depth.set(n, d + 1);
      queue.push(n);
    }
  }
  if (reached === null) return null;
  // Walking parents from our land leads straight to the landing tile.
  const path: TileRef[] = [];
  for (let t = reached; t !== -1; t = parent.get(t)!) {
    path.push(t);
  }
  return path;
}

const TroopColumnStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  player: zPlayerRef(),
  // Untrusted intent data until init validates it.
  dst: zInt(),
  troops: zNum().nullable(),
  column: zRef().nullable(),
  path: zTiles(),
  index: zInt(),
  targetID: z.string().nullable(),
});
type TroopColumnState = z.infer<typeof TroopColumnStateSchema>;

export const TroopColumnExecutionSnapshot = execSnapshotType({
  name: "TroopColumn",
  version: 1,
  schema: TroopColumnStateSchema,
  cls: () => TroopColumnExecution,
});
