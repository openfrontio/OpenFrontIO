import { z } from "zod";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { snapshotType, zInt, zRef, zTiles } from "../snapshot/SnapshotType";
import { Game } from "./Game";
import { TileRef } from "./GameMap";
import { GameUpdateType } from "./GameUpdates";
import { TrainStation } from "./TrainStation";

export class Railroad {
  constructor(
    public from: TrainStation,
    public to: TrainStation,
    public tiles: TileRef[],
    public id: number,
  ) {}

  delete(game: Game) {
    game.addUpdate({
      type: GameUpdateType.RailroadDestructionEvent,
      id: this.id,
    });
    this.from.removeRailroad(this);
    this.to.removeRailroad(this);
  }

  getClosestTileIndex(game: Game, to: TileRef): number {
    if (this.tiles.length === 0) return -1;
    const toX = game.x(to);
    const toY = game.y(to);
    let closestIndex = 0;
    let minDistSquared = Infinity;
    for (let i = 0; i < this.tiles.length; i++) {
      const tile = this.tiles[i];
      const dx = game.x(tile) - toX;
      const dy = game.y(tile) - toY;
      const distSquared = dx * dx + dy * dy;

      if (distSquared < minDistSquared) {
        minDistSquared = distSquared;
        closestIndex = i;
      }
    }
    return closestIndex;
  }

  snapshot(w: SnapshotWriter): RailroadState {
    return {
      id: this.id,
      from: w.station(this.from),
      to: w.station(this.to),
      tiles: w.tiles(this.tiles),
    };
  }

  /** Fills a prototype-only shell; see RestorableExecution.restoreSnapshot. */
  restoreSnapshot(s: RailroadState, r: SnapshotReader): void {
    this.id = s.id;
    this.from = r.station(s.from);
    this.to = r.station(s.to);
    this.tiles = Array.from(s.tiles);
  }
}

export const RailroadSnapshot = snapshotType({
  name: "Railroad",
  version: 1,
  schema: z.object({
    id: zInt(),
    from: zRef(),
    to: zRef(),
    tiles: zTiles(),
  }),
});
export type RailroadState = z.infer<typeof RailroadSnapshot.schema>;

export function getOrientedRailroad(
  from: TrainStation,
  to: TrainStation,
): OrientedRailroad | null {
  const railroad = from.getRailroadTo(to);
  if (!railroad) return null;
  // If tiles are stored from -> to, we go forward when railroad.to === to
  const forward = railroad.to === to;
  return new OrientedRailroad(railroad, forward);
}

/**
 * Wrap a railroad with a direction so it always starts at tiles[0]
 */
export class OrientedRailroad {
  private tiles: TileRef[] = [];
  constructor(
    private railroad: Railroad,
    private forward: boolean,
  ) {
    this.tiles = this.forward
      ? this.railroad.tiles
      : [...this.railroad.tiles].reverse();
  }

  getTiles(): TileRef[] {
    return this.tiles;
  }

  getStart(): TrainStation {
    return this.forward ? this.railroad.from : this.railroad.to;
  }

  getEnd(): TrainStation {
    return this.forward ? this.railroad.to : this.railroad.from;
  }

  /** The wrapped railroad and direction, for game snapshots. */
  getState(): { railroad: Railroad; forward: boolean } {
    return { railroad: this.railroad, forward: this.forward };
  }
}
