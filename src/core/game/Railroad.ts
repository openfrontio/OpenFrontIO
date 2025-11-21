import { Game } from "./Game";
import { TileRef } from "./GameMap";
import { GameUpdateType, RailTile, RailType } from "./GameUpdates";
import { TrainStation } from "./TrainStation";

export class Railroad {
  private trainCount: number = 0;

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

  incrementTrainCount(): void {
    this.trainCount++;
  }

  decrementTrainCount(): void {
    this.trainCount = Math.max(0, this.trainCount - 1);
  }

  getLength(): number {
    return this.tiles.length;
  }

  getFare(): bigint {
    const lengthFare = BigInt(this.getLength() * 100); // Base fare proportional to length
    // Busy railroads should be more expensive: each train adds a congestion premium
    const congestionFactor = BigInt(1 + this.trainCount); // 1,2,3,...
    const congestionFare = (lengthFare * congestionFactor) / 10n;
    return lengthFare + congestionFare;
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

  getRailroad(): Railroad {
    return this.railroad;
  }

  getStart(): TrainStation {
    return this.forward ? this.railroad.from : this.railroad.to;
  }

  getEnd(): TrainStation {
    return this.forward ? this.railroad.to : this.railroad.from;
  }
}
