import { decodePNGFromStream } from "pureimage";
import path from "path";
import fs from "fs/promises";
import { createReadStream } from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const maps = [
  "Africa",
  "Asia",
  "WorldMap",
  "BlackSea",
  "Europe",
  "Mars",
  "Mena",
  "Oceania",
  "NorthAmerica",
  "SouthAmerica",
];
const min_island_size = 30;

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

async function loadTerrainMap(mapName: string): Promise<void> {
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

  console.log(`${mapName}: Image loaded successfully`);
  console.log(`${mapName}: `, "Image dimensions:", img.width, "x", img.height);

  const terrain: Terrain[][] = Array(img.width)
    .fill(null)
    .map(() => Array(img.height).fill(null));

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

  removeSmallIslands(terrain);
  removeSmallLakes(mapName, terrain);
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
  fs.writeFile(outputPath, packTerrain(mapName, terrain));

  const miniTerrain = await createMiniMap(terrain);
  const miniOutputPath = path.join(
    __dirname,
    "..",
    "..",
    "resources",
    "maps",
    mapName + "Mini.bin",
  );
  fs.writeFile(miniOutputPath, packTerrain(mapName, miniTerrain));
}

export async function loadTerrainMaps() {
  await Promise.all(maps.map((map) => loadTerrainMap(map)));
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

// Improved processOcean function that identifies the largest body of water
function processOcean(map: Terrain[][]) {
  const visited = new Set<string>();
  const waterBodies: { coords: Coord[]; size: number }[] = [];

  // Find all distinct water bodies
  for (let x = 0; x < map.length; x++) {
    for (let y = 0; y < map[0].length; y++) {
      if (map[x][y].type === TerrainType.Water) {
        const key = `${x},${y}`;
        if (visited.has(key)) continue;

        // Find all connected water tiles
        const waterBody: Coord[] = [];
        const queue: Coord[] = [{ x, y }];

        while (queue.length > 0) {
          const coord = queue.shift()!;
          const currentKey = `${coord.x},${coord.y}`;

          if (visited.has(currentKey)) continue;
          visited.add(currentKey);

          if (map[coord.x][coord.y].type === TerrainType.Water) {
            waterBody.push(coord);

            // Check all four directions
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

        // Store this water body if it has any tiles
        if (waterBody.length > 0) {
          waterBodies.push({
            coords: waterBody,
            size: waterBody.length,
          });
        }
      }
    }
  }

  // Sort water bodies by size (largest first)
  waterBodies.sort((a, b) => b.size - a.size);

  // Mark the largest water body as ocean
  if (waterBodies.length > 0) {
    const largestWaterBody = waterBodies[0];

    // Mark all tiles in the largest water body as ocean
    for (const coord of largestWaterBody.coords) {
      map[coord.x][coord.y].ocean = true;
    }

    console.log(`Identified ocean with ${largestWaterBody.size} water tiles`);
  } else {
    console.log("No water bodies found in the map");
  }
}

function packTerrain(mapName: string, map: Terrain[][]): Uint8Array {
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
  logBinaryAsBits(mapName, packedData);
  return packedData;
}

function getArea(
  map: Terrain[][],
  x: number,
  y: number,
  visited: Set<string>,
  targetType: TerrainType,
) {
  const area = [];
  const next = [[x, y]];
  while (next.length) {
    const [x, y] = next.pop();
    const key = `${x},${y}`;
    if (
      x < 0 ||
      x >= map.length ||
      y < 0 ||
      y >= map[0].length ||
      visited.has(key)
    )
      continue;

    if (map[x][y].type === targetType) {
      next.push([x + 1, y]);
      next.push([x - 1, y]);
      next.push([x, y + 1]);
      next.push([x, y - 1]);
    }

    area.push([x, y]);
    visited.add(key);
  }

  return area;
}

function removeSmallIslands(map: Terrain[][]) {
  const visited = new Set<string>();

  for (let x = 0; x < map.length; x++) {
    for (let y = 0; y < map[0].length; y++) {
      if (map[x][y].type === TerrainType.Land) {
        const key = `${x},${y}`;
        if (visited.has(key)) continue;

        const island = getArea(map, x, y, visited, TerrainType.Land);
        if (island.length < min_island_size) {
          island.forEach((pos) => {
            const x = pos[0];
            const y = pos[1];
            map[x][y].type = TerrainType.Water;
            map[x][y].ocean = true;
          });
        }
      }
    }
  }
}

function removeSmallLakes(mapName: string, map: Terrain[][]) {
  const visited = new Set<string>();
  const min_lake_size = 30; // Using same size threshold as islands

  console.log(
    `${mapName}: removing small lakes ${map.length}, ${map[0].length}`,
  );

  for (let x = 0; x < map.length; x++) {
    for (let y = 0; y < map[0].length; y++) {
      if (map[x][y].type === TerrainType.Water && !map[x][y].ocean) {
        const key = `${x},${y}`;
        if (visited.has(key)) continue;

        const lake = getArea(map, x, y, visited, TerrainType.Water);
        if (lake.length < min_lake_size) {
          lake.forEach((pos) => {
            const x = pos[0];
            const y = pos[1];
            map[x][y].type = TerrainType.Land;
            map[x][y].magnitude = 0;
            map[x][y].ocean = false;
          });
        }
      }
    }
  }
}

function logBinaryAsBits(
  mapName: string,
  data: Uint8Array,
  length: number = 8,
) {
  const bits = Array.from(data.slice(0, length))
    .map((b) => b.toString(2).padStart(8, "0"))
    .join(" ");
  console.log(`${mapName}: Binary data (bits):`, bits);
}

await loadTerrainMaps();
