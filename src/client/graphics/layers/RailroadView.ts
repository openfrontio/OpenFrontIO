import { TileRef } from "src/core/game/GameMap";
import { GameView } from "src/core/game/GameView";

export enum RailType {
  VERTICAL,
  HORIZONTAL,
  TOP_LEFT,
  TOP_RIGHT,
  BOTTOM_LEFT,
  BOTTOM_RIGHT,
}

export type RailTile = {
  tile: TileRef;
  type: RailType;
};

export function computeRailTiles(game: GameView, tiles: TileRef[]): RailTile[] {
  const railTypes: RailTile[] = [];
  // Inverse direction computation for the first tile
  railTypes.push({
    tile: tiles[0],
    type:
      tiles.length > 0
        ? computeExtremityDirection(game, tiles[0], tiles[1])
        : RailType.VERTICAL,
  });
  for (let i = 1; i < tiles.length - 1; i++) {
    const direction = computeDirection(
      game,
      tiles[i - 1],
      tiles[i],
      tiles[i + 1],
    );
    railTypes.push({ tile: tiles[i], type: direction });
  }
  railTypes.push({
    tile: tiles[tiles.length - 1],
    type:
      tiles.length > 0
        ? computeExtremityDirection(
            game,
            tiles[tiles.length - 1],
            tiles[tiles.length - 2],
          )
        : RailType.VERTICAL,
  });
  return railTypes;
}

function computeExtremityDirection(
  game: GameView,
  tile: TileRef,
  next: TileRef,
): RailType {
  const x = game.x(tile);
  const y = game.y(tile);
  const nextX = game.x(next);
  const nextY = game.y(next);

  const dx = nextX - x;
  const dy = nextY - y;

  if (dx === 0 && dy === 0) return RailType.VERTICAL; // No movement

  if (dx === 0) {
    return RailType.VERTICAL;
  } else if (dy === 0) {
    return RailType.HORIZONTAL;
  }
  return RailType.VERTICAL;
}

export function computeDirection(
  game: GameView,
  prev: TileRef,
  current: TileRef,
  next: TileRef,
): RailType {
  const x1 = game.x(prev);
  const y1 = game.y(prev);
  const x2 = game.x(current);
  const y2 = game.y(current);
  const x3 = game.x(next);
  const y3 = game.y(next);

  const dx1 = x2 - x1;
  const dy1 = y2 - y1;
  const dx2 = x3 - x2;
  const dy2 = y3 - y2;

  // Straight line
  if (dx1 === dx2 && dy1 === dy2) {
    if (dx1 !== 0) return RailType.HORIZONTAL;
    if (dy1 !== 0) return RailType.VERTICAL;
  }

  // Turn (corner) cases
  if ((dx1 === 0 && dx2 !== 0) || (dx1 !== 0 && dx2 === 0)) {
    // Now figure out which type of corner
    if (dx1 === 0 && dx2 === 1 && dy1 === -1) return RailType.BOTTOM_RIGHT;
    if (dx1 === 0 && dx2 === -1 && dy1 === -1) return RailType.BOTTOM_LEFT;
    if (dx1 === 0 && dx2 === 1 && dy1 === 1) return RailType.TOP_RIGHT;
    if (dx1 === 0 && dx2 === -1 && dy1 === 1) return RailType.TOP_LEFT;

    if (dx1 === 1 && dx2 === 0 && dy2 === -1) return RailType.TOP_LEFT;
    if (dx1 === -1 && dx2 === 0 && dy2 === -1) return RailType.TOP_RIGHT;
    if (dx1 === 1 && dx2 === 0 && dy2 === 1) return RailType.BOTTOM_LEFT;
    if (dx1 === -1 && dx2 === 0 && dy2 === 1) return RailType.BOTTOM_RIGHT;
  }
  console.warn(`Invalid rail segment: ${dx1}:${dy1}, ${dx2}:${dy2}`);
  return RailType.VERTICAL;
}

/**
 * A list of tile that can be incrementally painted each tick
 */
export class RailroadView {
  private headIndex: number = 0;
  private tailIndex: number;
  private increment: number = 3;
  constructor(
    public id: number,
    private railTiles: RailTile[],
    complete: boolean = false,
  ) {
    // If the railroad is considered complete, no drawing or animation is required
    this.tailIndex = complete ? 0 : railTiles.length;
  }

  isComplete(): boolean {
    return this.headIndex >= this.tailIndex;
  }

  tiles(): RailTile[] {
    return this.railTiles;
  }

  remainingTiles(): RailTile[] {
    if (this.isComplete()) {
      // Animation complete, no tiles need to be painted
      return [];
    }
    return this.railTiles.slice(this.headIndex, this.tailIndex);
  }

  drawnTiles(): RailTile[] {
    if (this.isComplete()) {
      // Animation complete, every tiles have been painted
      return this.tiles();
    }
    let drawnTiles = this.railTiles.slice(0, this.headIndex);
    drawnTiles = drawnTiles.concat(this.railTiles.slice(this.tailIndex));
    return drawnTiles;
  }

  tick(): RailTile[] {
    if (this.isComplete()) return [];
    let updatedRailTiles: RailTile[];
    // Check if remaining tiles can be done all at once
    if (this.tailIndex - this.headIndex <= 2 * this.increment) {
      updatedRailTiles = this.railTiles.slice(this.headIndex, this.tailIndex);
    } else {
      updatedRailTiles = [
        ...this.railTiles.slice(
          this.headIndex,
          this.headIndex + this.increment,
        ),
        ...this.railTiles.slice(
          this.tailIndex - this.increment,
          this.tailIndex,
        ),
      ];
    }
    this.headIndex = Math.min(this.headIndex + this.increment, this.tailIndex);
    this.tailIndex = Math.max(this.tailIndex - this.increment, this.headIndex);
    return updatedRailTiles;
  }
}
