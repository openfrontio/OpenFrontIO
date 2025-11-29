import { Game } from "./Game";
import { TileRef } from "./GameMap";
import { GameUpdateType, RailTile, RailType } from "./GameUpdates";
import { TrainStation } from "./TrainStation";

export class Railroad {
  constructor(
    public from: TrainStation,
    public to: TrainStation,
    public tiles: TileRef[],
  ) {}

  delete(game: Game) {
    const railTiles: RailTile[] = this.tiles.map((tile) => ({
      tile,
      railType: RailType.VERTICAL,
    }));
    game.addUpdate({
      type: GameUpdateType.RailroadEvent,
      isActive: false,
      railTiles,
    });
    this.from.removeRailroad(this);
    this.to.removeRailroad(this);
  }
}

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
}
