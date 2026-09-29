import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import {
  BREACH_LEVEL_COUNT,
  MAX_LAND_MAGNITUDE,
  risingSeaFloodQuota,
  risingSeaLevelSchedule,
  risingSeaReserveTiles,
} from "../game/RisingSeaLevel";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zInt, zTiles } from "../snapshot/SnapshotType";

/**
 * Rising sea level. After a grace period the sea floods the map from the coast
 * inward, low ground first, until (almost) all reachable land is under water.
 *
 * The order is a PRIORITY FLOOD. A land tile's breach level is the minimum, over
 * all sea→tile paths, of the highest elevation along that path, and tiles flood
 * in ascending breach level. That is coast-inward by construction, and it is what
 * produces INNER BASINS: low ground sitting behind a ridge of elevation 12 keeps
 * its feet dry until the waterline has climbed to 12, and then the whole basin
 * fills at once as the sea pours over the rim.
 *
 * Elevation is GameMap.magnitude (0-30 on land, 31 = impassable) and is never
 * rewritten during a game, so the flood order is a property of the terrain.
 * Because elevations are small integers the priority queue is a MONOTONE BUCKET
 * QUEUE (a "dial queue"): one FIFO per level, with a dial that only moves
 * forward. The insertion key max(currentLevel, magnitude(n)) is monotone
 * non-decreasing, so no tile is ever inserted below the dial — the queue is
 * exact with no re-insertion, no decrease-key, no heap and no floats.
 *
 * Deterministic: integer-only state, no PRNG. The seed scan is a raw ascending
 * index loop and neighbours are always enqueued in GameMap.neighbors4's fixed
 * order, so the pop order is fully determined by the terrain — no Map/Set
 * iteration order is ever observed.
 */

/** Impassable terrain is a wall the sea never crosses. */
function isFloodable(map: GameMap, tile: TileRef): boolean {
  return map.isLand(tile) && !map.isImpassable(tile);
}

/**
 * The bucket-queue priority flood, over a bare GameMap so it can be unit-tested
 * on hand-built terrain without a whole Game.
 */
export class SeaFloodFront {
  /** One FIFO per breach level, 0..30. */
  private buckets: TileRef[][] = Array.from(
    { length: BREACH_LEVEL_COUNT },
    () => [],
  );
  /**
   * Read cursor into the CURRENT level's bucket, so popping is O(1) without
   * shifting. Only the current level can have a consumed prefix — the dial
   * empties a bucket outright when it moves past it — and compact() drops that
   * prefix at the end of every batch, so the cursor is 0 at every tick boundary
   * (which is where snapshots are taken) and the queue has one canonical form.
   */
  private cursor = 0;
  /** The dial: every tile popped so far had breach level <= this. */
  private level = 0;
  /**
   * Tiles that have ever entered the queue. In-memory only, deliberately NOT
   * snapshotted. See rebuildEverQueued: it is
   * exactly reconstructible from the queued tiles, because the seed scan runs
   * once and the front is never re-seeded.
   */
  private everQueued: Uint8Array;
  private readonly nbuf: TileRef[] = [0, 0, 0, 0];

  constructor(private readonly map: GameMap) {
    this.everQueued = new Uint8Array(map.width() * map.height());
  }

  /**
   * Seeds the front from every floodable land tile touching water. Called
   * exactly once per game.
   *
   * Any water counts, not just ocean: inland lakes are legitimate sources, and
   * the water this mode itself creates is lake water anyway.
   *
   * The scan is a raw ascending tile-ref loop so the seed order — and therefore
   * the whole flood order — is a pure function of the terrain.
   */
  seed(): void {
    const w = this.map.width();
    const total = w * this.map.height();
    for (let tile = 0; tile < total; tile++) {
      if (!isFloodable(this.map, tile)) continue;
      const count = this.map.neighbors4(tile, this.nbuf);
      for (let i = 0; i < count; i++) {
        if (this.map.isWater(this.nbuf[i])) {
          this.push(tile);
          break;
        }
      }
    }
  }

  private push(tile: TileRef): void {
    if (this.everQueued[tile] === 1) return;
    this.everQueued[tile] = 1;
    // Monotone: a tile below the dial is queued at the dial, which is the
    // breach level it actually has (the sea already reached its neighbour).
    const key = Math.max(this.level, this.map.magnitude(tile));
    this.buckets[key].push(tile);
  }

  /** True once no land is reachable any more (the front is walled in or done). */
  isEmpty(): boolean {
    // The dial runs one past the last bucket when the front drains, so start at
    // it rather than indexing with it.
    for (let l = this.level; l < BREACH_LEVEL_COUNT; l++) {
      const from = l === this.level ? this.cursor : 0;
      if (from < this.buckets[l].length) return false;
    }
    return true;
  }

  /** The elevation the waterline has climbed to. */
  waterline(): number {
    return this.level;
  }

  /**
   * Pops the next tile in breach order and enqueues its floodable neighbours,
   * or null when nothing is reachable. The dial only ever moves forward, so the
   * total cost over a game is O(land), not O(land * levels).
   */
  pop(): TileRef | null {
    while (this.level < BREACH_LEVEL_COUNT) {
      const bucket = this.buckets[this.level];
      if (this.cursor < bucket.length) {
        const tile = bucket[this.cursor++];
        const count = this.map.neighbors4(tile, this.nbuf);
        for (let i = 0; i < count; i++) {
          const n = this.nbuf[i];
          if (isFloodable(this.map, n)) this.push(n);
        }
        return tile;
      }
      // Drained: release the bucket's memory and advance the dial.
      this.buckets[this.level] = [];
      this.cursor = 0;
      this.level++;
    }
    return null;
  }

  /**
   * Drops the consumed prefix of the current bucket. Called at the end of every
   * batch so the queue is in its one canonical form whenever a snapshot can be
   * taken — otherwise a live front with a half-consumed bucket and a front
   * restored from it would hold the same tiles in different arrays.
   */
  compact(): void {
    // A drained front leaves the dial one past the last bucket, but it also
    // leaves the cursor at 0, so the dial is never used to index here.
    if (this.cursor === 0) return;
    this.buckets[this.level] = this.buckets[this.level].slice(this.cursor);
    this.cursor = 0;
  }

  /**
   * Puts a tile back at the dial, to be taken again. Used when a conversion did
   * not land (see RisingSeaLevelExecution.flush).
   *
   * The tile is already past the dial's level, so queueing it AT the dial keeps
   * the queue monotone and takes it back at the next opportunity rather than at
   * the end of the flood.
   */
  requeue(tile: TileRef): void {
    this.everQueued[tile] = 1;
    // A drained front leaves the dial one past the last bucket. Pull it back so
    // the tile is reachable again; that cannot break monotonicity, because every
    // bucket is empty by the time the dial gets there.
    if (this.level > MAX_LAND_MAGNITUDE) this.level = MAX_LAND_MAGNITUDE;
    this.buckets[this.level].push(tile);
  }

  /** The queue's tiles per level. Must be called on a compacted front. */
  queuedBuckets(): TileRef[][] {
    return this.buckets;
  }

  /** Restores the queue from a compacted snapshot. */
  restore(buckets: TileRef[][], level: number, alsoQueued: Iterable<TileRef>) {
    this.buckets = buckets.map((b) => [...b]);
    this.cursor = 0;
    this.level = level;
    this.rebuildEverQueued(alsoQueued);
  }

  /**
   * `everQueued` is not stored in the snapshot; it is rebuilt from the queue.
   *
   * That is exact because of one invariant: a tile is only ever REACHED as a
   * neighbour of a popped tile, and every neighbour of every popped tile has
   * already been pushed. So each tile is in exactly one of three states —
   * already flooded (water, so isFloodable rejects it and the flag is never
   * consulted), currently queued (restored below), or not yet reached (the flag
   * must be 0, and it is). The invariant holds only because seeding happens
   * exactly once and the front is never re-seeded from the live coastline.
   *
   * A deliberate consequence: water made by a water nuke does NOT become a new
   * flood source. Re-seeding from the live coastline would both break this
   * reconstruction and hand players an exploit — one bomb on a basin rim would
   * drown a whole empire ahead of schedule.
   */
  private rebuildEverQueued(alsoQueued: Iterable<TileRef>): void {
    this.everQueued.fill(0);
    for (const bucket of this.buckets) {
      for (const tile of bucket) this.everQueued[tile] = 1;
    }
    for (const tile of alsoQueued) this.everQueued[tile] = 1;
  }
}

/** Counts the land the flood can actually reach, without mutating anything. */
function censusReachable(map: GameMap): number {
  const front = new SeaFloodFront(map);
  front.seed();
  let total = 0;
  while (front.pop() !== null) total++;
  return total;
}

export class RisingSeaLevelExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private front: SeaFloodFront | null = null;
  /** Land the flood can reach at all — our own census, see init(). */
  private reachableTotal = 0;
  private floodedCount = 0;
  /**
   * Tiles handed to the water queue whose conversion has not been confirmed yet.
   * WaterManager flushes at the END of the tick and silently refuses a tile that
   * gained an owner in the meantime, so confirmation has to wait a tick.
   */
  private pending: TileRef[] = [];

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.config().risingSeaLevelConfig().enabled) {
      this.active = false;
      return;
    }
    const front = new SeaFloodFront(mg.map());
    front.seed();
    this.front = front;
    // Maps with no water at all (there are some) have no seed, so nothing can
    // ever flood. Bail out rather than counting down to a flood that never comes.
    if (front.isEmpty()) {
      this.active = false;
      return;
    }
    // Our OWN census, not numLandTiles(): that counts land the flood can never
    // reach (walled in behind impassable terrain) and is also decremented by
    // water nukes, either of which would make the deadline drift.
    this.reachableTotal = censusReachable(mg.map());
  }

  tick(ticks: number): void {
    if (this.mg === null) throw new Error("Not initialized");
    if (!this.active || this.front === null) return;
    // Once per second. Deliberately NOT every tick: WaterManager skips its
    // water-graph rebuild on any tick that converted land (so the two CPU spikes
    // never coincide), so flooding every tick would starve the rebuild forever
    // and leave boats routing on a frozen graph. This leaves 9 ticks in 10 free.
    if (ticks % 10 !== 0) return;
    const mg = this.mg;

    const cfg = mg.config().risingSeaLevelConfig();
    const schedule = risingSeaLevelSchedule(cfg.speed);
    const elapsed = mg.elapsedGameSeconds();
    // Dry grace window: the early game is unaffected. It has to outlast the
    // spawn phase and spawn immunity, because flooding is environmental and
    // immunity offers no protection against it.
    if (elapsed < schedule.graceSeconds) return;

    this.flush();

    const reserve = risingSeaReserveTiles(this.reachableTotal);
    const remaining = this.reachableTotal - this.floodedCount;
    // Stop with a small reserve of land still dry: numLandTiles() === 0
    // degenerates the sim (AttackExecution divides by it), and the reserve is
    // also what guarantees termination — the win threshold is a share of the
    // shrinking remainder, so a side wins well before the last tile.
    if (remaining <= reserve) {
      this.active = false;
      return;
    }

    const quota = risingSeaFloodQuota(
      remaining - reserve,
      elapsed - schedule.graceSeconds,
      schedule.submergeSeconds,
    );
    let exhausted = false;
    for (let i = 0; i < quota; i++) {
      const tile = this.front.pop();
      if (tile === null) {
        exhausted = true;
        break;
      }
      this.submerge(mg, tile);
    }
    // Leaves the queue in its one canonical form before the tick ends, so a
    // snapshot taken now and a front restored from it are indistinguishable.
    this.front.compact();
    // An exhausted front means nothing more is reachable — every route inland is
    // walled off by impassable terrain — even though land remains. Tracked apart
    // from the reserve check above so the quota cannot spin forever on such a
    // map. Tiles still in flight keep the execution alive for one more second:
    // the next flush may hand one of them back to the front.
    if (exhausted && this.pending.length === 0) this.active = false;
  }

  /**
   * Converts one tile. Owned land floods too: the owner loses it first, then it
   * goes under. The ORDER is load-bearing — floodTile throws on an owned tile,
   * and relinquish throws on unowned land and on water.
   *
   * No attacker is involved, so this is environmental: it credits no kill and no
   * captured gold. Anything built on the tile is removed by PlayerExecution,
   * which already deletes structures standing on land its owner no longer holds.
   */
  private submerge(mg: Game, tile: TileRef): void {
    const owner = mg.owner(tile);
    if (owner.isPlayer()) (owner as Player).relinquish(tile);
    mg.floodTile(tile);
    this.pending.push(tile);
  }

  /**
   * Confirms last second's conversions, and retries the ones that did not land.
   *
   * WaterManager refuses to convert a tile that gained an owner between queueing
   * and flushing, and a relinquished tile is terra nullius — a perfectly normal
   * attack target, with AttackExecution running in the same tick. Without this
   * retry a player could permanently save land from the sea by attacking along
   * the waterline, leaving a dry hole that our own tally could not see.
   */
  private flush(): void {
    if (this.pending.length === 0) return;
    const mg = this.mg!;
    const retry = this.pending;
    this.pending = [];
    for (const tile of retry) {
      if (mg.isWater(tile)) {
        this.floodedCount++;
        continue;
      }
      // Still land: it was conquered out from under the conversion (or is
      // impassable, in which case it was never reachable and requeueing it is
      // harmless — pop() would not have yielded it). Take it again.
      this.front!.requeue(tile);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  /** Elevation the waterline has climbed to; for the HUD. */
  waterline(): number {
    return this.front?.waterline() ?? 0;
  }

  /** Reachable land already under water; for the HUD. */
  flooded(): number {
    return this.floodedCount;
  }

  /** Total land the flood can reach; for the HUD. */
  reachable(): number {
    return this.reachableTotal;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return RisingSeaLevelExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
      // Only the tiles still queued — the front is compacted at the end of every
      // batch, so this never carries the flood's history.
      buckets: (this.front?.queuedBuckets() ?? []).map((b) => w.tiles(b)),
      level: this.front?.waterline() ?? 0,
      pending: w.tiles(this.pending),
      reachableTotal: this.reachableTotal,
      floodedCount: this.floodedCount,
    });
  }

  restoreSnapshot(s: RisingSeaLevelState, r: SnapshotReader): void {
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.reachableTotal = s.reachableTotal;
    this.floodedCount = s.floodedCount;
    this.pending = Array.from(s.pending);
    if (s.buckets.length === 0) {
      this.front = null;
      return;
    }
    const front = new SeaFloodFront(r.game.map());
    front.restore(
      s.buckets.map((b) => Array.from(b)),
      s.level,
      this.pending,
    );
    this.front = front;
  }
}

const RisingSeaLevelStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  /**
   * Queued tiles per breach level, index = level. Either one array per level or
   * none at all (the execution was snapshotted before init seeded the front);
   * anything else would index past the buckets when the flood resumes.
   */
  buckets: z
    .array(zTiles())
    .refine(
      (b) => b.length === 0 || b.length === BREACH_LEVEL_COUNT,
      `expected 0 or ${BREACH_LEVEL_COUNT} breach-level buckets`,
    ),
  /** The dial position: the elevation the waterline has reached. */
  level: zInt().min(0).max(BREACH_LEVEL_COUNT),
  pending: zTiles(),
  reachableTotal: zInt().nonnegative(),
  floodedCount: zInt().nonnegative(),
});
type RisingSeaLevelState = z.infer<typeof RisingSeaLevelStateSchema>;

export const RisingSeaLevelExecutionSnapshot = execSnapshotType({
  name: "RisingSeaLevel",
  version: 1,
  schema: RisingSeaLevelStateSchema,
  cls: () => RisingSeaLevelExecution,
});
