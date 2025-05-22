import { Bitmap, decodePNGFromStream } from "pureimage";
//import path from "path";
//import fs from "fs/promises";
//import { createReadStream } from "fs";
import { Readable } from "stream";

const min_island_size = 30;
const min_lake_size = 200;

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
  public ocean: boolean = false;
  constructor(public type: TerrainType) {}
}

export async function generateMap(
  imageBuffer: Buffer,
  removeSmall = true,
  name: string = "",
): Promise<{ map: Uint8Array; miniMap: Uint8Array; thumb: Bitmap }> {
  const stream = Readable.from(imageBuffer);
  const img = await decodePNGFromStream(stream);

  console.debug(
    `Processing Map: ${name}, dimensions: ${img.width}x${img.height}`,
  );

  const terrain: Terrain[][] = Array(img.width)
    .fill(null)
    .map(() => Array(img.height).fill(null));

  for (let x = 0; x < img.width; x++) {
    for (let y = 0; y < img.height; y++) {
      const color = img.getPixelRGBA(x, y);
      const alpha = color & 0xff;
      const blue = (color >> 8) & 0xff;

      if (alpha < 20 || blue === 106) {
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

  removeSmallIslands(terrain, removeSmall);
  processWater(terrain, removeSmall);

  const miniTerrain = await createMiniMap(terrain);
  const thumb = await createMapThumbnail(miniTerrain);

  return {
    map: packTerrain(terrain),
    miniMap: packTerrain(miniTerrain),
    thumb: thumb,
  };
}

async function createMiniMap(tm: Terrain[][]): Promise<Terrain[][]> {
  // Create 2D array properly with correct dimensions
  const miniMap: Terrain[][] = Array(Math.floor(tm.length / 2))
    .fill(null)
    .map(() => Array(Math.floor(tm[0].length / 2)).fill(null));

  for (let x = 0; x < tm.length; x++) {
    for (let y = 0; y < tm[0].length; y++) {
      const miniX = Math.floor(x / 2);
      const miniY = Math.floor(y / 2);

      if (
        miniMap[miniX][miniY] === null ||
        miniMap[miniX][miniY].type !== TerrainType.Water
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
  console.debug("Identifying shorelines");
  const shorelineWaters: Coord[] = [];
  for (let x = 0; x < map.length; x++) {
    for (let y = 0; y < map[0].length; y++) {
      const tile = map[x][y];
      const ns = neighbors(x, y, map);
      if (tile.type === TerrainType.Land) {
        if (ns.filter((t) => t.type === TerrainType.Water).length > 0) {
          tile.shoreline = true;
        }
      } else {
        if (ns.filter((t) => t.type === TerrainType.Land).length > 0) {
          tile.shoreline = true;
          shorelineWaters.push({ x, y });
        }
      }
    }
  }
  return shorelineWaters;
}

function processDistToLand(shorelineWaters: Coord[], map: Terrain[][]) {
  console.debug(
    "Setting Water tiles magnitude = Manhattan distance from nearest land",
  );

  const width = map.length;
  const height = map[0].length;

  const visited = Array.from({ length: width }, () =>
    Array(height).fill(false),
  );
  const queue: { x: number; y: number; dist: number }[] = [];

  for (const { x, y } of shorelineWaters) {
    queue.push({ x, y, dist: 0 });
    visited[x][y] = true;
    map[x][y].magnitude = 0;
  }

  const directions = [
    { dx: 0, dy: 1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: -1 },
    { dx: -1, dy: 0 },
  ];

  while (queue.length > 0) {
    const { x, y, dist } = queue.shift()!;

    for (const { dx, dy } of directions) {
      const nx = x + dx;
      const ny = y + dy;

      if (
        nx >= 0 &&
        ny >= 0 &&
        nx < width &&
        ny < height &&
        !visited[nx][ny] &&
        map[nx][ny].type === TerrainType.Water
      ) {
        visited[nx][ny] = true;
        map[nx][ny].magnitude = dist + 1;
        queue.push({ x: nx, y: ny, dist: dist + 1 });
      }
    }
  }
}

function neighbors(x: number, y: number, map: Terrain[][]): Terrain[] {
  const nCoords: Coord[] = getNeighborCoords(x, y, map);
  const ns: Terrain[] = [];
  for (const nCoord of nCoords) {
    ns.push(map[nCoord.x][nCoord.y]);
  }
  return ns;
}

function processWater(map: Terrain[][], removeSmall: boolean) {
  console.debug("Processing water bodies");
  const visited = new Set<string>();
  const waterBodies: { coords: Coord[]; size: number }[] = [];

  // Find all distinct water bodies
  for (let x = 0; x < map.length; x++) {
    for (let y = 0; y < map[0].length; y++) {
      if (map[x][y].type === TerrainType.Water) {
        const key = `${x},${y}`;
        if (visited.has(key)) continue;

        const waterBody: Coord[] = getArea(x, y, map, visited);
        waterBodies.push({
          coords: waterBody,
          size: waterBody.length,
        });
      }
    }
  }

  // Sort water bodies by size (largest first)
  waterBodies.sort((a, b) => b.size - a.size);

  let smallLakes = 0;

  if (waterBodies.length > 0) {
    // Mark the largest water body as ocean
    const largestWaterBody = waterBodies[0];
    for (const coord of largestWaterBody.coords) {
      map[coord.x][coord.y].ocean = true;
    }
    console.debug(`Identified ocean with ${largestWaterBody.size} water tiles`);

    if (removeSmall) {
      // Assess size of the other water bodies and remove those smaller than min_lake_size
      console.debug("Searching for small water bodies for removal");
      for (let w = 1; w < waterBodies.length; w++) {
        if (waterBodies[w].size < min_lake_size) {
          smallLakes++;
          for (const coord of waterBodies[w].coords) {
            map[coord.x][coord.y].type = TerrainType.Land;
            map[coord.x][coord.y].magnitude = 0;
          }
        }
      }
      console.debug(
        `Identified and removed ${smallLakes} bodies of water smaller than ${min_lake_size} tiles`,
      );
    }

    //Identify shoreline tiles, get array of shoreline water tiles
    const shorelineWaters = processShore(map);
    //Adjust water tile magnitudes to reflect distance from land
    processDistToLand(shorelineWaters, map);
  } else {
    console.debug("No water bodies found in the map");
  }
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
      const tile = map[x][y];
      let packedByte = 0;
      if (tile === null) {
        throw new Error(`terrain null at ${x}:${y}`);
      }

      if (tile.type === TerrainType.Land) {
        packedByte |= 0b10000000;
      }
      if (tile.shoreline) {
        packedByte |= 0b01000000;
      }
      if (tile.ocean) {
        packedByte |= 0b00100000;
      }
      if (tile.type === TerrainType.Land) {
        packedByte |= Math.min(Math.ceil(tile.magnitude), 31);
      } else {
        packedByte |= Math.min(Math.ceil(tile.magnitude / 2), 31);
      }

      packedData[4 + y * width + x] = packedByte;
    }
  }
  logBinaryAsBits(packedData);
  return packedData;
}

function getArea(
  x: number,
  y: number,
  map: Terrain[][],
  visited: Set<string>,
): Coord[] {
  const targetType: TerrainType = map[x][y].type;
  const area: Coord[] = [];
  const queue: Coord[] = [{ x, y }];

  while (queue.length > 0) {
    const coord = queue.shift()!;
    const key = `${coord.x},${coord.y}`;

    if (visited.has(key)) continue;
    visited.add(key);

    if (map[coord.x][coord.y].type === targetType) {
      area.push({ x: coord.x, y: coord.y });

      const nCoords: Coord[] = getNeighborCoords(coord.x, coord.y, map);
      for (const nCoord of nCoords) {
        queue.push({ x: nCoord.x, y: nCoord.y });
      }
    }
  }
  return area;
}

function removeSmallIslands(map: Terrain[][], removeSmall: boolean) {
  if (!removeSmall) return;
  const visited = new Set<string>();
  const landBodies: { coords: Coord[]; size: number }[] = [];

  // Find all distinct land bodies
  for (let x = 0; x < map.length; x++) {
    for (let y = 0; y < map[0].length; y++) {
      if (map[x][y].type === TerrainType.Land) {
        const key = `${x},${y}`;
        if (visited.has(key)) continue;

        const landBody: Coord[] = getArea(x, y, map, visited);
        landBodies.push({
          coords: landBody,
          size: landBody.length,
        });
      }
    }
  }

  let smallIslands = 0;

  for (let b = 0; b < landBodies.length; b++) {
    if (landBodies[b].size < min_island_size) {
      smallIslands++;
      for (const coord of landBodies[b].coords) {
        map[coord.x][coord.y].type = TerrainType.Water;
        map[coord.x][coord.y].magnitude = 0;
      }
    }
  }
  console.debug(
    `Identified and removed ${smallIslands} islands smaller than ${min_island_size} tiles`,
  );
}

function logBinaryAsBits(data: Uint8Array, length: number = 8) {
  const bits = Array.from(data.slice(0, length))
    .map((b) => b.toString(2).padStart(8, "0"))
    .join(" ");
  console.debug(`Binary data (bits):`, bits);
}

function getNeighborCoords(x: number, y: number, map: Terrain[][]): Coord[] {
  const coords: Coord[] = [];
  if (x > 0) {
    coords.push({ x: x - 1, y: y });
  }
  if (x < map.length - 1) {
    coords.push({ x: x + 1, y });
  }
  if (y > 0) {
    coords.push({ x: x, y: y - 1 });
  }
  if (y < map[0].length - 1) {
    coords.push({ x: x, y: y + 1 });
  }
  return coords;
}

async function createMapThumbnail(
  map: Terrain[][],
  quality: number = 0.5,
): Promise<Bitmap> {
  console.debug("creating thumbnail");

  const srcWidth = map.length;
  const srcHeight = map[0].length;

  const targetWidth = Math.max(1, Math.floor(srcWidth * quality));
  const targetHeight = Math.max(1, Math.floor(srcHeight * quality));

  const bitmap = new Bitmap(targetWidth, targetHeight);

  for (let x = 0; x < targetWidth; x++) {
    for (let y = 0; y < targetHeight; y++) {
      const srcX = Math.floor(x / quality);
      const srcY = Math.floor(y / quality);
      const terrain =
        map[Math.min(srcX, srcWidth - 1)][Math.min(srcY, srcHeight - 1)];
      const rgba = getThumbnailColor(terrain);
      bitmap.setPixelRGBA_i(x, y, rgba.r, rgba.g, rgba.b, rgba.a);
    }
  }

  return bitmap;
}

function getThumbnailColor(t: Terrain): {
  r: number;
  g: number;
  b: number;
  a: number;
} {
  if (t.type === TerrainType.Water) {
    // Shoreline water
    if (t.shoreline) return { r: 100, g: 143, b: 255, a: 0 };
    // All other water: adjust based on magnitude
    const waterAdjRGB: number = 11 - Math.min(t.magnitude / 2, 10) - 10;
    return {
      r: Math.max(70 + waterAdjRGB, 0),
      g: Math.max(132 + waterAdjRGB, 0),
      b: Math.max(180 + waterAdjRGB, 0),
      a: 0,
    };
  }
  //shoreline land
  if (t.shoreline) {
    return { r: 204, g: 203, b: 158, a: 255 };
  }
  let adjRGB: number;
  if (t.magnitude < 10) {
    // Plains
    adjRGB = 220 - 2 * t.magnitude;
    return {
      r: 190,
      g: adjRGB,
      b: 138,
      a: 255,
    };
  } else if (t.magnitude < 20) {
    // Highlands
    adjRGB = 2 * t.magnitude;
    return {
      r: 200 + adjRGB,
      g: 183 + adjRGB,
      b: 138 + adjRGB,
      a: 255,
    };
  } else {
    // Mountains
    adjRGB = Math.floor(230 + t.magnitude / 2);
    return {
      r: adjRGB,
      g: adjRGB,
      b: adjRGB,
      a: 255,
    };
  }
}
