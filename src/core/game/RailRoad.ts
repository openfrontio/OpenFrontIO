import { TileRef } from "./GameMap";
import { TrainStation } from "./TrainStation";

export type RailRoad = {
  from: TrainStation;
  to: TrainStation;
  tiles: TileRef[];
};

export function getOrientedRailroad(
  from: TrainStation,
  to: TrainStation,
): OrientedRailroad | null {
  for (const railroad of from.getRailroads()) {
    if (railroad.from === to) {
      return new OrientedRailroad(railroad, false);
    } else if (railroad.to === to) {
      return new OrientedRailroad(railroad, true);
    }
  }
  return null;
}

/**
 * Wrap a railroad with a direction so it always starts at tiles[0]
 */
export class OrientedRailroad {
  private tiles: TileRef[] = [];
  constructor(
    private railroad: RailRoad,
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
}
