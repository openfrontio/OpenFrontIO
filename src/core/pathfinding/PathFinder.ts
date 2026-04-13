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
import { StepperConfig } from "./PathFinderStepper";
import { ComponentCheckTransformer } from "./transformers/ComponentCheckTransformer";
import { MiniMapTransformer } from "./transformers/MiniMapTransformer";
import { ShoreCoercingTransformer } from "./transformers/ShoreCoercingTransformer";
import { SmoothingWaterTransformer } from "./transformers/SmoothingWaterTransformer";
import { PathResult, PathStatus, SteppingPathFinder } from "./types";

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

/**
 * Pathfinders that require Game - simulation layer only
 */
export class PathFinding {
  static Water(game: Game): SteppingPathFinder<TileRef> {
    const pf = game.miniWaterHPA();
    const graph = game.miniWaterGraph();

    if (!pf || !graph || graph.nodeCount < 100) {
      return PathFinding.WaterSimple(game);
    }

    const miniMap = game.miniMap();
    const componentCheckFn = (t: TileRef) => graph.getComponentId(t);

    return PathFinderBuilder.create(pf)
      .wrap((pf) => new ComponentCheckTransformer(pf, componentCheckFn))
      .wrap((pf) => new SmoothingWaterTransformer(pf, miniMap))
      .wrap((pf) => new ShoreCoercingTransformer(pf, miniMap))
      .wrap((pf) => new MiniMapTransformer(pf, game.map(), miniMap))
      .buildWithStepper(tileStepperConfig(game));
  }

  static WaterSimple(game: Game): SteppingPathFinder<TileRef> {
    const miniMap = game.miniMap();
    const pf = new AStarWater(miniMap);

    return PathFinderBuilder.create(pf)
      .wrap((pf) => new ShoreCoercingTransformer(pf, miniMap))
      .wrap((pf) => new MiniMapTransformer(pf, game.map(), miniMap))
      .buildWithStepper(tileStepperConfig(game));
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
 * Wraps SteppingPathFinder and tracks waterGraphVersion internally.
 */
export class WaterPathFinder implements SteppingPathFinder<TileRef> {
  private inner: SteppingPathFinder<TileRef>;
  private _waterGraphVersion: number;
  private _rebuilt = false;

  constructor(private game: Game) {
    this.inner = PathFinding.Water(game);
    this._waterGraphVersion = game.waterGraphVersion();
  }

  /** True if the pathfinder was rebuilt since the last call to `rebuilt`. Resets on read. */
  get rebuilt(): boolean {
    this.ensureFresh();
    const v = this._rebuilt;
    this._rebuilt = false;
    return v;
  }

  private ensureFresh(): void {
    const v = this.game.waterGraphVersion();
    if (v !== this._waterGraphVersion) {
      this._waterGraphVersion = v;
      this.inner = PathFinding.Water(this.game);
      this._rebuilt = true;
    }
  }

  next(from: TileRef, to: TileRef, dist?: number): PathResult<TileRef> {
    this.ensureFresh();
    return this.inner.next(from, to, dist);
  }

  findPath(from: TileRef | TileRef[], to: TileRef): TileRef[] | null {
    this.ensureFresh();
    return this.inner.findPath(from, to);
  }

  invalidate(): void {
    this.inner.invalidate();
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
