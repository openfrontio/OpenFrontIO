import { Unit } from "./Game";
import { GameMap, TileRef } from "./GameMap";
import { UnitView } from "./GameView";

export class DefenseGrid {
  private grid: Set<Unit | UnitView>[][];
  private readonly cellSize = 100;

  constructor(
    private gm: GameMap,
    private searchRange: number,
  ) {
    this.grid = Array(Math.ceil(gm.height() / this.cellSize))
      .fill(null)
      .map(() =>
        Array(Math.ceil(gm.width() / this.cellSize))
          .fill(null)
          .map(() => new Set<Unit | UnitView>()),
      );
  }

  // Get grid coordinates from pixel coordinates
  private getGridCoords(x: number, y: number): [number, number] {
    return [Math.floor(x / this.cellSize), Math.floor(y / this.cellSize)];
  }

  // Add a defense unit to the grid
  addDefense(unit: Unit | UnitView) {
    const tile = unit.tile();
    const [gridX, gridY] = this.getGridCoords(this.gm.x(tile), this.gm.y(tile));

    if (this.isValidCell(gridX, gridY)) {
      this.grid[gridY][gridX].add(unit);
    }
  }

  // Remove a defense unit from the grid
  removeDefense(unit: Unit | UnitView) {
    const tile = unit.tile();
    const [gridX, gridY] = this.getGridCoords(this.gm.x(tile), this.gm.y(tile));

    if (this.isValidCell(gridX, gridY)) {
      this.grid[gridY][gridX].delete(unit);
    }
  }

  private isValidCell(gridX: number, gridY: number): boolean {
    return (
      gridX >= 0 &&
      gridX < this.grid[0].length &&
      gridY >= 0 &&
      gridY < this.grid.length
    );
  }

  // Get all defense units within range of a point
  // Returns [unit, distanceSquared] pairs for efficient filtering
  nearbyDefenses(
    tile: TileRef,
  ): Array<{ unit: Unit | UnitView; distSquared: number }> {
    const x = this.gm.x(tile);
    const y = this.gm.y(tile);
    const [gridX, gridY] = this.getGridCoords(x, y);
    const cellsToCheck = Math.ceil(this.searchRange / this.cellSize);
    const nearby: Array<{ unit: Unit | UnitView; distSquared: number }> = [];

    // Pre-calculate range bounds for efficiency
    const startGridX = Math.max(0, gridX - cellsToCheck);
    const endGridX = Math.min(this.grid[0].length - 1, gridX + cellsToCheck);
    const startGridY = Math.max(0, gridY - cellsToCheck);
    const endGridY = Math.min(this.grid.length - 1, gridY + cellsToCheck);

    // Squared range for faster comparison (avoid sqrt)
    const rangeSquared = this.searchRange * this.searchRange;

    for (let cy = startGridY; cy <= endGridY; cy++) {
      for (let cx = startGridX; cx <= endGridX; cx++) {
        for (const unit of this.grid[cy][cx]) {
          const tileX = this.gm.x(unit.tile());
          const tileY = this.gm.y(unit.tile());
          const dx = tileX - x;
          const dy = tileY - y;
          const distSquared = dx * dx + dy * dy;

          if (distSquared <= rangeSquared) {
            nearby.push({ unit, distSquared });
          }
        }
      }
    }

    return nearby;
  }
}
