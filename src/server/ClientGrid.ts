import { Client } from "./Client";

export class ClientGrid {
  // Grid stores Sets of Clients
  private grid: Set<Client>[][];
  private readonly cellSize = 100; // Adjust cell size as needed

  constructor(width: number, height: number) {
    this.grid = Array(Math.ceil(height / this.cellSize))
      .fill(null)
      .map(() =>
        Array(Math.ceil(width / this.cellSize))
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
        // Ensure we access valid grid cells
        if (this.isValidCell(cx, cy)) {
          for (const client of this.grid[cy][cx]) {
            clients.add(client);
          }
        }
      }
    }
    return Array.from(clients);
  }

  private getCellsInRange(x: number, y: number, range: number) {
    const cellSize = this.cellSize;
    const startGridX = Math.max(0, Math.floor((x - range) / cellSize));
    const endGridX = Math.min(
      this.grid[0].length - 1,
      Math.floor((x + range) / cellSize),
    );
    const startGridY = Math.max(0, Math.floor((y - range) / cellSize));
    const endGridY = Math.min(
      this.grid.length - 1,
      Math.floor((y + range) / cellSize),
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
