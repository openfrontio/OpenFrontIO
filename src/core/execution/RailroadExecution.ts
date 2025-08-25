import { Execution, Game } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { GameUpdateType, RailTile, RailType } from "../game/GameUpdates";
import { Railroad } from "../game/Railroad";

export class RailroadExecution implements Execution {
  private mg: Game | undefined;
  private active = true;
  private headIndex = 0;
  private tailIndex = 0;
  private readonly increment = 3;
  private readonly railTiles: RailTile[] = [];
  constructor(private readonly railRoad: Railroad) {
    this.tailIndex = railRoad.tiles.length;
  }

  isActive(): boolean {
    return this.active;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    const { tiles } = this.railRoad;
    // Inverse direction computation for the first tile
    this.railTiles.push({
      railType:
        tiles.length > 0
          ? this.computeExtremityDirection(tiles[0], tiles[1])
          : RailType.VERTICAL,
      tile: tiles[0],
    });
    for (let i = 1; i < tiles.length - 1; i++) {
      const direction = this.computeDirection(
        tiles[i - 1],
        tiles[i],
        tiles[i + 1],
      );
      this.railTiles.push({ railType: direction, tile: tiles[i] });
    }
    this.railTiles.push({
      railType:
        tiles.length > 0
          ? this.computeExtremityDirection(
              tiles[tiles.length - 1],
              tiles[tiles.length - 2],
            )
          : RailType.VERTICAL,
      tile: tiles[tiles.length - 1],
    });
  }

  private computeExtremityDirection(tile: TileRef, next: TileRef): RailType {
    if (this.mg === undefined) throw new Error("Not initialized");
    const x = this.mg.x(tile);
    const y = this.mg.y(tile);
    const nextX = this.mg.x(next);
    const nextY = this.mg.y(next);

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

  private computeDirection(
    prev: TileRef,
    current: TileRef,
    next: TileRef,
  ): RailType {
    if (this.mg === undefined) throw new Error("Not initialized");
    const x1 = this.mg.x(prev);
    const y1 = this.mg.y(prev);
    const x2 = this.mg.x(current);
    const y2 = this.mg.y(current);
    const x3 = this.mg.x(next);
    const y3 = this.mg.y(next);

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

  tick(ticks: number): void {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (!this.activeSourceOrDestination()) {
      this.active = false;
      return;
    }
    if (this.headIndex > this.tailIndex) {
      // Construction complete
      this.constructionComplete();
      return;
    }

    let updatedRailTiles: RailTile[];
    // Check if remaining tiles can be done all at once
    if (this.tailIndex - this.headIndex <= 2 * this.increment) {
      updatedRailTiles = this.railTiles.slice(this.headIndex, this.tailIndex);
      this.constructionComplete();
    } else {
      updatedRailTiles = this.railTiles.slice(
        this.headIndex,
        this.headIndex + this.increment,
      );
      updatedRailTiles = updatedRailTiles.concat(
        this.railTiles.slice(this.tailIndex - this.increment, this.tailIndex),
      );
      this.headIndex += this.increment;
      this.tailIndex -= this.increment;
    }
    if (updatedRailTiles) {
      this.mg.addUpdate({
        isActive: true,
        railTiles: updatedRailTiles,
        type: GameUpdateType.RailroadEvent,
      });
    }
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private activeSourceOrDestination(): boolean {
    return this.railRoad.from.isActive() && this.railRoad.to.isActive();
  }

  private constructionComplete() {
    this.redrawBuildings();
    this.active = false;
  }

  private redrawBuildings() {
    this.railRoad.from.unit.isActive() && this.railRoad.from.unit.touch();
    this.railRoad.to.unit.isActive() && this.railRoad.to.unit.touch();
  }
}
