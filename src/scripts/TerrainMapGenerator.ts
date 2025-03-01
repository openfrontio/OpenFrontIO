import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { decodePNGFromStream } from "pureimage";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mapName = "Asia";

interface Coord {
  x: number;
  y: number;
}

enum TerrainType {
  Land,
  Water,
}

class Terrain {
  public shoreline: boolean = false;
  public magnitude: number = 0;
  public ocean: boolean;
  constructor(public type: TerrainType) {}
}

export async function loadTerrainMap(): Promise<void> {
  const imagePath = path.resolve(
    __dirname,
    "..",
    "..",
    "resources",
    "maps",
    mapName + ".png",
  );

  const readStream = createReadStream(imagePath);
  const img = await decodePNGFromStream(readStream);

  console.log("Image loaded successfully");
  console.log("Image dimensions:", img.width, "x", img.height);

  const terrain: Terrain[][] = Array(img.width)
    .fill(null)
    .map(() => Array(img.height).fill(null));

  // Iterate through each pixel
  for (let x = 0; x < img.width; x++) {
    for (let y = 0; y < img.height; y++) {
      const color = img.getPixelRGBA(x, y);
      const alpha = color & 0xff;
      const blue = (color >> 8) & 0xff;

      if (alpha < 20 || blue == 106) {
        // transparent
        terrain[x][y] = new Terrain(TerrainType.Water);
      } else {
        terrain[x][y] = new Terrain(TerrainType.Land);
        terrain[x][y].magnitude = 0;

        // 140 -> 200 = 60
        const mag = Math.min(200, Math.max(140, blue)) - 140;
        terrain[x][y].magnitude = mag / 2;
      }
    }
  }

  removeSmallLakes(terrain);
  const shorelineWaters = processShore(terrain);
  processDistToLand(shorelineWaters, terrain);
  processOcean(terrain);
  const outputPath = path.join(
    __dirname,
    "..",
    "..",
    "resources",
    "maps",
    mapName + ".bin",
  );
  fs.writeFile(outputPath, packTerrain(terrain));

  const miniTerrain = await createMiniMap(terrain);
  const miniOutputPath = path.join(
    __dirname,
    "..",
    "..",
    "resources",
    "maps",
    mapName + "Mini.bin",
  );
  fs.writeFile(miniOutputPath, packTerrain(miniTerrain));
}

export async function createMiniMap(tm: Terrain[][]): Promise<Terrain[][]> {
  // Create 2D array properly with correct dimensions
  const miniMap: Terrain[][] = Array(Math.floor(tm.length / 2))
    .fill(null)
    .map(() => Array(Math.floor(tm[0].length / 2)).fill(null));

  for (let x = 0; x < tm.length; x++) {
    for (let y = 0; y < tm[0].length; y++) {
      const miniX = Math.floor(x / 2);
      const miniY = Math.floor(y / 2);

      if (
        miniMap[miniX][miniY] == null ||
        miniMap[miniX][miniY].type != TerrainType.Water
      ) {
        // We shrink 4 tiles into 1 tile. If any of the 4 large tiles
        // has water, then the mini tile is considered water.
        miniMap[miniX][miniY] = tm[x][y];
      }
    }
  }
  return miniMap;
}

function processShore(map: Terrain[][]): Coord[] {
  const shorelineWaters: Coord[] = [];
  for (let x = 0; x < map.length; x++) {
    for (let y = 0; y < map[0].length; y++) {
      const terrain = map[x][y];
      const ns = neighbors(x, y, map);
      if (terrain.type == TerrainType.Land) {
        if (ns.filter((t) => t.type == TerrainType.Water).length > 0) {
          terrain.shoreline = true;
        }
      } else {
        if (ns.filter((t) => t.type == TerrainType.Land).length > 0) {
          terrain.shoreline = true;
          shorelineWaters.push({ x, y });
        }
      }
    }
  }
  return shorelineWaters;
}

function processDistToLand(shorelineWaters: Coord[], map: Terrain[][]) {
  const queue: [Coord, number][] = shorelineWaters.map((coord) => [coord, 0]);
  const visited = new Set<string>();

  while (queue.length > 0) {
    const [coord, distance] = queue.shift()!;
    const key = `${coord.x},${coord.y}`;

    if (visited.has(key)) continue;
    visited.add(key);

    const terrain = map[coord.x][coord.y];
    if (terrain.type === TerrainType.Water) {
      terrain.magnitude = distance;

      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const newX = coord.x + dx;
        const newY = coord.y + dy;

        if (
          newX >= 0 &&
          newX < map.length &&
          newY >= 0 &&
          newY < map[0].length
        ) {
          queue.push([{ x: newX, y: newY }, distance + 1]);
        }
      }
    }
  }
}

function neighbors(x: number, y: number, map: Terrain[][]): Terrain[] {
  const ns: Terrain[] = [];
  if (x > 0) {
    ns.push(map[x - 1][y]);
  }
  if (x < map.length - 1) {
    ns.push(map[x + 1][y]);
  }
  if (y > 0) {
    ns.push(map[x][y - 1]);
  }
  if (y < map[0].length - 1) {
    ns.push(map[x][y + 1]);
  }
  return ns;
}

function packTerrain(map: Terrain[][]): Uint8Array {
  const width = map.length;
  const height = map[0].length;
  const packedData = new Uint8Array(4 + width * height);

  // Add width and height to the first 4 bytes
  packedData[0] = width & 0xff;
  packedData[1] = (width >> 8) & 0xff;
  packedData[2] = height & 0xff;
  packedData[3] = (height >> 8) & 0xff;

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const terrain = map[x][y];
      let packedByte = 0;
      if (terrain == null) {
        throw new Error(`terrain null at ${x}:${y}`);
      }

      if (terrain.type === TerrainType.Land) {
        packedByte |= 0b10000000;
      }
      if (terrain.shoreline) {
        packedByte |= 0b01000000;
      }
      if (terrain.ocean) {
        packedByte |= 0b00100000;
      }
      if (terrain.type == TerrainType.Land) {
        packedByte |= Math.min(Math.ceil(terrain.magnitude), 31);
      } else {
        packedByte |= Math.min(Math.ceil(terrain.magnitude / 2), 31);
      }

      packedData[4 + y * width + x] = packedByte;
    }
  }
  logBinaryAsBits(packedData);
  return packedData;
}

function processOcean(map: Terrain[][]) {
  const queue: Coord[] = [];
  if (map[0][0].type == TerrainType.Water) {
    queue.push({ x: 0, y: 0 });
  } else if (map[map.length - 1][map[0].length - 1].type == TerrainType.Water) {
    queue.push({ x: map.length - 1, y: map[0].length - 1 });
  } else {
    queue.push({ x: 0, y: map[0].length - 1 });
  }
  const visited = new Set<string>();

  while (queue.length > 0) {
    const coord = queue.shift()!;
    const key = `${coord.x},${coord.y}`;

    if (visited.has(key)) continue;
    visited.add(key);

    const terrain = map[coord.x][coord.y];
    if (terrain.type === TerrainType.Water) {
      terrain.ocean = true;

      // Check neighbors
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const newX = coord.x + dx;
        const newY = coord.y + dy;

        if (
          newX >= 0 &&
          newX < map.length &&
          newY >= 0 &&
          newY < map[0].length
        ) {
          queue.push({ x: newX, y: newY });
        }
      }
    }
  }
}

function removeSmallLakes(map: Terrain[][]) {
  console.log(`removing lakes ${map.length}, ${map[0].length}`);

  for (let x = 0; x < map.length; x++) {
    for (let y = 0; y < map[0].length; y++) {
      if (map[x][y].type != TerrainType.Water) {
        continue;
      }
      let allLand = true;
      for (const neighbor of neighbors(x, y, map)) {
        if (neighbor.type != TerrainType.Land) {
          allLand = false;
        }
      }
      if (allLand) {
        map[x][y].type = TerrainType.Land;
        map[x][y].magnitude = 0;
      }
    }
  }
}

function logBinaryAsBits(data: Uint8Array, length: number = 8) {
  const bits = Array.from(data.slice(0, length))
    .map((b) => b.toString(2).padStart(8, "0"))
    .join(" ");
  console.log("Binary data (bits):", bits);
}

await loadTerrainMap();
