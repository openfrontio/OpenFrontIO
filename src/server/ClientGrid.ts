import { GameMap } from "../core/game/GameMap";
import { Client } from "./Client";

export class ClientGrid {
  // Grid stores Sets of Clients
  private grid: Set<Client>[][];
  private readonly cellSize = 100; // Adjust cell size as needed

  constructor(private gm: GameMap) {
    this.grid = Array(Math.ceil(gm.height() / this.cellSize))
      .fill(null)
      .map(() =>
        Array(Math.ceil(gm.width() / this.cellSize))
          .fill(null)
          .map(() => new Set<Client>()),
      );
  }

  private getGridCoords(x: number, y: number): [number, number] {
    return [Math.floor(x / this.cellSize), Math.floor(y / this.cellSize)];
  }

  addClient(client: Client, x: number, y: number) {
    const [gridX, gridY] = this.getGridCoords(x, y);

    if (this.isValidCell(gridX, gridY)) {
      this.grid[gridY][gridX].add(client);
    }
  }

  removeClient(client: Client, x: number, y: number) {
    const [gridX, gridY] = this.getGridCoords(x, y);

    if (this.isValidCell(gridX, gridY)) {
      this.grid[gridY][gridX].delete(client);
    }
  }

  updateClient(
    client: Client,
    oldX: number,
    oldY: number,
    newX: number,
    newY: number,
  ) {
    const [oldGridX, oldGridY] = this.getGridCoords(oldX, oldY);
    const [newGridX, newGridY] = this.getGridCoords(newX, newY);

    if (oldGridX !== newGridX || oldGridY !== newGridY) {
      if (this.isValidCell(oldGridX, oldGridY)) {
        this.grid[oldGridY][oldGridX].delete(client);
      }
      if (this.isValidCell(newGridX, newGridY)) {
        this.grid[newGridY][newGridX].add(client);
      }
    }
  }

  // Get all unique clients within a range
  nearbyClients(x: number, y: number, range: number): Client[] {
    const clients = new Set<Client>();
    const { startGridX, endGridX, startGridY, endGridY } = this.getCellsInRange(
      x,
      y,
      range,
    );

    for (let cy = startGridY; cy <= endGridY; cy++) {
      for (let cx = startGridX; cx <= endGridX; cx++) {
        for (const client of this.grid[cy][cx]) {
          clients.add(client);
        }
      }
    }
    return Array.from(clients);
  }

  private getCellsInRange(x: number, y: number, range: number) {
    const cellSize = this.cellSize;
    const [gridX, gridY] = this.getGridCoords(x, y);
    const startGridX = Math.max(
      0,
      gridX - Math.ceil((range - (x % cellSize)) / cellSize),
    );
    const endGridX = Math.min(
      this.grid[0].length - 1,
      gridX + Math.ceil((range - (cellSize - (x % cellSize))) / cellSize),
    );
    const startGridY = Math.max(
      0,
      gridY - Math.ceil((range - (y % cellSize)) / cellSize),
    );
    const endGridY = Math.min(
      this.grid.length - 1,
      gridY + Math.ceil((range - (cellSize - (y % cellSize))) / cellSize),
    );

    return { startGridX, endGridX, startGridY, endGridY };
  }

  private isValidCell(gridX: number, gridY: number): boolean {
    return (
      gridX >= 0 &&
      gridX < this.grid[0].length &&
      gridY >= 0 &&
      gridY < this.grid.length
    );
  }
}
