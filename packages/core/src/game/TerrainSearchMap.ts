export enum SearchMapTileType {
  Land,
  Shore,
  Water,
}

export class TerrainSearchMap {
  private width: number;
  private height: number;
  private mapData: Uint8Array;

  constructor(buffer: SharedArrayBuffer) {
    this.mapData = new Uint8Array(buffer);
    this.width = (this.mapData[1] << 8) | this.mapData[0];
    this.height = (this.mapData[3] << 8) | this.mapData[2];
  }

  node(x: number, y: number): SearchMapTileType {
    const packedByte = this.mapData[4 + y * this.width + x];
    const isLand = packedByte & 0b10000000;
    const shoreline = !!(packedByte & 0b01000000);
    const ocean = !!(packedByte & 0b00100000);
    const magnitude = packedByte & 0b00011111;
    if (isLand) {
      return SearchMapTileType.Land;
    }
    if (magnitude < 10) {
      return SearchMapTileType.Shore;
    }
    return SearchMapTileType.Water;
  }

  neighbors(x: number, y: number): Array<{ x: number; y: number }> {
    const result: Array<{ x: number; y: number }> = [];

    // Check all 8 adjacent tiles
    const dirs = [
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ];

    for (const [dx, dy] of dirs) {
      const newX = x + dx;
      const newY = y + dy;

      // Check bounds
      if (newX >= 0 && newX < this.width && newY >= 0 && newY < this.height) {
        result.push({ x: newX, y: newY });
      }
    }
    return result;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }
}
