import { Game } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { TrainStation } from "../game/TrainStation";
import { AStarRail } from "./algorithms/AStar.Rail";
import { AStarWater } from "./algorithms/AStar.Water";
import { AirPathFinder } from "./PathFinder.Air";
import {
  ParabolaOptions,
  ParabolaUniversalPathFinder,
} from "./PathFinder.Parabola";
import { StationPathFinder } from "./PathFinder.Station";
import { PathFinderBuilder } from "./PathFinderBuilder";
import { PathFinderStepper, StepperConfig } from "./PathFinderStepper";
import { ComponentCheckTransformer } from "./transformers/ComponentCheckTransformer";
import { MiniMapTransformer } from "./transformers/MiniMapTransformer";
import { ShoreCoercingTransformer } from "./transformers/ShoreCoercingTransformer";
import { SmoothingWaterTransformer } from "./transformers/SmoothingWaterTransformer";
import {
  PathFinder,
  PathResult,
  PathStatus,
  SteppingPathFinder,
} from "./types";

/**
 * Pathfinders that work with GameMap - usable in both simulation and UI layers
 */
export class UniversalPathFinding {
  static Parabola(
    gameMap: GameMap,
    options?: ParabolaOptions,
  ): ParabolaUniversalPathFinder {
    return new ParabolaUniversalPathFinder(gameMap, options);
  }
}

// Shared water-pathfinder chain cache. The transformer chain wraps the
// already-shared AStarWaterHierarchical (owned by WaterManager) and holds the
// only large per-ship allocation we had — SmoothingWaterTransformer's bounded
// A* scratch. Sharing the chain across all callers cuts ~500 KB per ship.
// Single-threaded worker + stamp-based scratch invalidation makes sharing safe.
const _waterChainCache = new WeakMap<
  Game,
  { version: number; chain: PathFinder<TileRef>; memo: WaterPathMemo }
>();

function buildWaterChain(game: Game): PathFinder<TileRef> {
  const hpa = game.miniWaterHPA();
  const graph = game.miniWaterGraph();
  const miniMap = game.miniMap();

  if (!hpa || !graph || graph.nodeCount < 100) {
    const simple = new AStarWater(miniMap);
    return PathFinderBuilder.create(simple)
      .wrap((pf) => new ShoreCoercingTransformer(pf, miniMap))
      .wrap((pf) => new MiniMapTransformer(pf, game.map(), miniMap))
      .build();
  }

  const componentCheckFn = (t: TileRef) => graph.getComponentId(t);
  return PathFinderBuilder.create(hpa)
    .wrap((pf) => new ComponentCheckTransformer(pf, componentCheckFn))
    .wrap((pf) => new SmoothingWaterTransformer(pf, miniMap))
    .wrap((pf) => new ShoreCoercingTransformer(pf, miniMap))
    .wrap((pf) => new MiniMapTransformer(pf, game.map(), miniMap))
    .build();
}

/**
 * Memo of single-source water paths in front of the shared chain. The chain reads
 * terrain only (nothing in the transformers or the HPA graph looks at owners or
 * units), so a (from, to) query always has the same answer for one graph
 * version — and the memo lives and dies with the chain, which is rebuilt per
 * waterGraphVersion. Trade ships between the same two ports asked the full
 * pipeline again for every voyage. LRU with a byte budget: ~64 % of a
 * 170-minute game's queries hit at this size, and the store stays small enough
 * for the client worker, where the sim also runs. Callers get their own copy.
 */
class WaterPathMemo implements PathFinder<TileRef> {
  private static readonly MAX_BYTES = 24_000_000;
  private readonly paths = new Map<number, Uint32Array | null>();
  private liveBytes = 0;
  constructor(
    private readonly inner: PathFinder<TileRef>,
    private readonly numTiles: number,
  ) {}
  findPath(from: TileRef | TileRef[], to: TileRef): TileRef[] | null {
    if (typeof from !== "number") return this.inner.findPath(from, to);
    const key = from * this.numTiles + to;
    const hit = this.paths.get(key);
    if (hit !== undefined) {
      // LRU: re-insert so the hot pairs (near ports are drawn most often) outlive the cold ones
      this.paths.delete(key);
      this.paths.set(key, hit);
      return hit === null ? null : Array.from(hit);
    }
    const path = this.inner.findPath(from, to);
    const stored = path === null ? null : Uint32Array.from(path);
    this.liveBytes += stored === null ? 16 : stored.byteLength;
    this.paths.set(key, stored);
    while (this.liveBytes > WaterPathMemo.MAX_BYTES) {
      const oldestKey = this.paths.keys().next().value!;
      const oldest = this.paths.get(oldestKey);
      this.paths.delete(oldestKey);
      this.liveBytes -=
        oldest === null || oldest === undefined ? 16 : oldest.byteLength;
    }
    return path;
  }
}

/**
 * @param memoized - answer through the per-game WaterPathMemo. Opt-in for the
 *   callers whose queries repeat (trade ships: port tile to port tile); a warship
 *   hunting a moving ship asks a new (from, to) every tick and would only flush it.
 */
function sharedWaterChain(game: Game, memoized = false): PathFinder<TileRef> {
  const version = game.waterGraphVersion();
  let cached = _waterChainCache.get(game);
  if (!cached || cached.version !== version) {
    const chain = buildWaterChain(game);
    cached = {
      version,
      chain,
      memo: new WaterPathMemo(chain, game.map().width() * game.map().height()),
    };
    _waterChainCache.set(game, cached);
  }
  return memoized ? cached.memo : cached.chain;
}

/**
 * Pathfinders that require Game - simulation layer only
 */
export class PathFinding {
  static Water(game: Game): SteppingPathFinder<TileRef> {
    return new PathFinderStepper(
      sharedWaterChain(game),
      tileStepperConfig(game),
    );
  }

  static WaterSimple(game: Game): SteppingPathFinder<TileRef> {
    // Kept for backwards compatibility; shared chain auto-selects simple vs
    // hierarchical based on graph availability.
    return PathFinding.Water(game);
  }

  static Rail(game: Game): SteppingPathFinder<TileRef> {
    const miniMap = game.miniMap();
    const pf = new AStarRail(miniMap);

    return PathFinderBuilder.create(pf)
      .wrap((pf) => new MiniMapTransformer(pf, game.map(), miniMap))
      .buildWithStepper(tileStepperConfig(game));
  }

  static Stations(game: Game): SteppingPathFinder<TrainStation> {
    const pf = new StationPathFinder(game);

    return PathFinderBuilder.create(pf).buildWithStepper({
      equals: (a, b) => a.id === b.id,
      distance: (a, b) => game.manhattanDist(a.tile(), b.tile()),
    });
  }

  static Air(game: Game): SteppingPathFinder<TileRef> {
    const pf = new AirPathFinder(game);

    return PathFinderBuilder.create(pf).buildWithStepper({
      equals: (a, b) => a === b,
    });
  }
}

/**
 * Water pathfinder that auto-rebuilds when the water graph changes.
 * Wraps a per-ship stepper around the shared water chain on Game; tracks
 * waterGraphVersion to stagger when each ship invalidates its cached path.
 */
export class WaterPathFinder implements SteppingPathFinder<TileRef> {
  private stepper: PathFinderStepper<TileRef>;
  private _waterGraphVersion: number;
  private _rebuilt = false;

  // Stagger support: spread pathfinder rebuilds over multiple ticks so all
  // ships don't re-run A* simultaneously after a water-nuke.
  private _staggerCountdown: number;
  private _pendingVersion: number = -1;

  /**
   * @param stagger - How many ticks to wait before rebuilding when the water
   *   graph changes.  0 = immediate (default).  Pass a value spread across
   *   [0, STAGGER_SPREAD) to distribute rebuilds over time.
   */
  constructor(
    private game: Game,
    private _stagger: number = 0,
    private readonly _memoized: boolean = false,
  ) {
    this.stepper = new PathFinderStepper(
      sharedWaterChain(game, _memoized),
      tileStepperConfig(game),
    );
    this._waterGraphVersion = game.waterGraphVersion();
    this._staggerCountdown = 0;
  }

  /** Spread to use when auto-staggering ship pathfinders */
  static readonly STAGGER_SPREAD = 50;

  /** True if the pathfinder was rebuilt since the last call to `rebuilt`. Resets on read. */
  get rebuilt(): boolean {
    this.ensureFresh();
    const v = this._rebuilt;
    this._rebuilt = false;
    return v;
  }

  private ensureFresh(): void {
    const v = this.game.waterGraphVersion();
    if (v === this._waterGraphVersion) return;

    // New graph version detected — start or continue the stagger countdown.
    if (this._pendingVersion !== v) {
      this._pendingVersion = v;
      this._staggerCountdown = this._stagger;
    }

    if (this._staggerCountdown > 0) {
      this._staggerCountdown--;
      return; // Keep using old stepper (and its cached path) for now
    }

    // Countdown complete — swap to a fresh stepper around the (now-current)
    // shared chain. Dropping the old stepper invalidates the cached path,
    // which forces an A* re-run on the next call against the new graph.
    this._waterGraphVersion = v;
    this.stepper = new PathFinderStepper(
      sharedWaterChain(this.game, this._memoized),
      tileStepperConfig(this.game),
    );
    this._rebuilt = true;
  }

  next(from: TileRef, to: TileRef, dist?: number): PathResult<TileRef> {
    this.ensureFresh();
    return this.stepper.next(from, to, dist);
  }

  /** Runs a one-shot query without changing the path consumed by next(). */
  findPath(from: TileRef | TileRef[], to: TileRef): TileRef[] | null {
    this.ensureFresh();
    return this.stepper.findPath(from, to);
  }

  /**
   * Returns the route following a successful next() call, starting at `from`.
   * If refreshing the water graph replaced the stepper, fall back to the same
   * one-shot query used before traversal paths were reusable.
   */
  pathForTraversal(from: TileRef, to: TileRef): TileRef[] | Uint32Array {
    this.ensureFresh();
    const path =
      this.stepper.pathAfterNext() ?? this.stepper.findPath(from, to);
    if (path === null || path.length === 0) return [from];
    return path[0] === from ? path : [from, ...path];
  }

  invalidate(): void {
    this.stepper.invalidate();
  }
}

function tileStepperConfig(game: Game): StepperConfig<TileRef> {
  return {
    equals: (a, b) => a === b,
    distance: (a, b) => game.manhattanDist(a, b),
    preCheck: (from, to) =>
      typeof from !== "number" ||
      typeof to !== "number" ||
      !game.isValidRef(from) ||
      !game.isValidRef(to)
        ? { status: PathStatus.NOT_FOUND }
        : null,
  };
}
