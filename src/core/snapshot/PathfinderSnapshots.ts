import { z } from "zod";
import { Game } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { TrainStation } from "../game/TrainStation";
import {
  PathFinding,
  UniversalPathFinding,
  WaterPathFinder,
} from "../pathfinding/PathFinder";
import { AirPathFinder } from "../pathfinding/PathFinder.Air";
import { ParabolaUniversalPathFinder } from "../pathfinding/PathFinder.Parabola";
import { PathFinderStepper } from "../pathfinding/PathFinderStepper";
import { SteppingPathFinder } from "../pathfinding/types";
import type { SnapshotReader, SnapshotWriter } from "./SnapshotContext";
import { zInt, zNum, zRef, zTile, zTiles } from "./SnapshotType";

/**
 * Snapshot helpers for pathfinders held by executions. A cached path is
 * state, not a cache: recomputing it after a restore could pick a different
 * route, so steppers are saved with their path and position.
 */

export const TileStepperSchema = z.object({
  path: zTiles().nullable(),
  pathIndex: zInt(),
  lastTo: zTile().nullable(),
});
export type TileStepperState = z.infer<typeof TileStepperSchema>;

function asStepper<T>(pf: SteppingPathFinder<T>): PathFinderStepper<T> {
  if (!(pf instanceof PathFinderStepper)) {
    throw new Error("expected a PathFinderStepper");
  }
  return pf;
}

export function tileStepperState(
  pf: SteppingPathFinder<TileRef>,
): TileStepperState {
  const s = asStepper(pf).getState();
  return {
    path: s.path === null ? null : Uint32Array.from(s.path),
    pathIndex: s.pathIndex,
    lastTo: s.lastTo,
  };
}

export function setTileStepperState(
  pf: SteppingPathFinder<TileRef>,
  s: TileStepperState,
): void {
  asStepper(pf).setState({
    path: s.path === null ? null : s.path.slice(),
    pathIndex: s.pathIndex,
    lastTo: s.lastTo,
  });
}

/** PathFinding.Air: a tile stepper plus the seed of its random walk. */
export const AirPathFinderSchema = z.object({
  seed: zInt(),
  stepper: TileStepperSchema,
});
export type AirPathFinderState = z.infer<typeof AirPathFinderSchema>;

export function airPathFinderState(
  pf: SteppingPathFinder<TileRef>,
): AirPathFinderState {
  const air = asStepper(pf).innerFinder() as AirPathFinder;
  return { seed: air.getSeed(), stepper: tileStepperState(pf) };
}

export function restoreAirPathFinder(
  game: Game,
  s: AirPathFinderState,
): SteppingPathFinder<TileRef> {
  const pf = PathFinding.Air(game);
  (asStepper(pf).innerFinder() as AirPathFinder).setSeed(s.seed);
  setTileStepperState(pf, s.stepper);
  return pf;
}

/** PathFinding.Stations: a stepper over train stations. */
export const StationStepperSchema = z.object({
  path: z.array(zRef()).nullable(),
  pathIndex: zInt(),
  lastTo: zRef().nullable(),
});
export type StationStepperState = z.infer<typeof StationStepperSchema>;

export function stationStepperState(
  pf: SteppingPathFinder<TrainStation>,
  w: SnapshotWriter,
): StationStepperState {
  const s = asStepper(pf).getState();
  return {
    path:
      s.path === null
        ? null
        : (s.path as TrainStation[]).map((st) => w.station(st)),
    pathIndex: s.pathIndex,
    lastTo: s.lastTo === null ? null : w.station(s.lastTo),
  };
}

export function restoreStationStepper(
  game: Game,
  s: StationStepperState,
  r: SnapshotReader,
): SteppingPathFinder<TrainStation> {
  const pf = PathFinding.Stations(game);
  asStepper(pf).setState({
    path: s.path === null ? null : s.path.map((i) => r.station(i)),
    pathIndex: s.pathIndex,
    lastTo: s.lastTo === null ? null : r.station(s.lastTo),
  });
  return pf;
}

export const WaterPathFinderSchema = z.object({
  stagger: zInt(),
  memoized: z.boolean(),
  waterGraphVersion: zInt(),
  rebuilt: z.boolean(),
  staggerCountdown: zInt(),
  pendingVersion: zInt(),
  stepper: TileStepperSchema,
});
export type WaterPathFinderState = z.infer<typeof WaterPathFinderSchema>;

export function waterPathFinderState(
  pf: WaterPathFinder,
): WaterPathFinderState {
  const s = pf.getState();
  return {
    ...s,
    stepper: {
      path: s.stepper.path === null ? null : s.stepper.path.slice(),
      pathIndex: s.stepper.pathIndex,
      lastTo: s.stepper.lastTo,
    },
  };
}

export function restoreWaterPathFinder(
  game: Game,
  s: WaterPathFinderState,
): WaterPathFinder {
  return WaterPathFinder.fromState(game, {
    ...s,
    stepper: {
      path: s.stepper.path === null ? null : s.stepper.path.slice(),
      pathIndex: s.stepper.pathIndex,
      lastTo: s.stepper.lastTo,
    },
  });
}

const PointSchema = z.object({ x: zNum(), y: zNum() });

export const ParabolaSchema = z.object({
  options: z
    .object({
      increment: zNum().optional(),
      distanceBasedHeight: z.boolean().optional(),
      directionUp: z.boolean().optional(),
      ignoreMapBounds: z.boolean().optional(),
    })
    .nullable(),
  lastTo: zTile().nullable(),
  curve: z
    .object({
      points: z.tuple([PointSchema, PointSchema, PointSchema, PointSchema]),
      currentIndex: zInt(),
      accumulatedDistanceScaled: zInt(),
    })
    .nullable(),
});
export type ParabolaState = z.infer<typeof ParabolaSchema>;

export function parabolaState(pf: ParabolaUniversalPathFinder): ParabolaState {
  return pf.getState();
}

export function restoreParabola(
  game: Game,
  s: ParabolaState,
): ParabolaUniversalPathFinder {
  const pf = UniversalPathFinding.Parabola(game);
  pf.setState(s);
  return pf;
}
