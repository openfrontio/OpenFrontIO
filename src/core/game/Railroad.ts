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
      railType: RailType.VERTICAL,
      tile,
    }));
    game.addUpdate({
      isActive: false,
      railTiles,
      type: GameUpdateType.RailroadEvent,
    });
    this.from.getRailroads().delete(this);
    this.to.getRailroads().delete(this);
  }
}

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
  private readonly tiles: TileRef[] = [];
  constructor(
    private readonly railroad: Railroad,
    private readonly forward: boolean,
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
