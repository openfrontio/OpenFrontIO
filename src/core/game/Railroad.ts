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
