import { Bitmap, decodePNGFromStream } from "pureimage";
//import path from "path";
//import fs from "fs/promises";
//import { createReadStream } from "fs";
import { Readable } from "stream";
import { TerrainType } from "../core/game/Game";

const min_island_size = 30;
const min_lake_size = 200;

interface Coord {
  x: number;
  y: number;
}

enum InternalTerrainType {
  Land,
  Water,
}

class Terrain {
  public shoreline: boolean = false;
  public magnitude: number = 0;
  public ocean: boolean = false;
  constructor(
    public type: InternalTerrainType,
    public specificType: TerrainType,
  ) {}
}

const TARGET_COLORS: {
  [key in TerrainType]?: { r: number; g: number; b: number };
} = {
  [TerrainType.Plains]: { r: 124, g: 178, b: 92 }, // #7cb25c - green (plains)
  [TerrainType.Forest]: { r: 97, g: 133, b: 62 }, // #61853e - dark green (forest)
  [TerrainType.Desert]: { r: 232, g: 219, b: 145 }, // #e8db91 - yellow (desert)
  [TerrainType.DesertTransition]: { r: 229, g: 186, b: 69 }, // #e5ba45 - dark yellow (transition)
  [TerrainType.ArcticForest]: { r: 152, g: 192, b: 224 }, // #98c0e0 - arctic blue (snowy arctic forest - OLD Arctic)
  [TerrainType.Beach]: { r: 224, g: 200, b: 121 }, // #e0c879 - beach
  [TerrainType.MidMountain]: { r: 92, g: 97, b: 94 }, // #5c615e - gray (middle mountain)
  [TerrainType.HighMountain]: { r: 67, g: 72, b: 74 }, // #43484a - dark gray (mountain peaks)
  [TerrainType.Jungle]: { r: 34, g: 117, b: 45 }, // #22752d - jungle
  [TerrainType.JunglePlains]: { r: 71, g: 163, b: 93 }, // #47a35d - jungle plains
  [TerrainType.ArcticPlains]: { r: 173, g: 207, b: 237 }, // #adcfed - arctic plains
  [TerrainType.SnowyHighMountain]: { r: 231, g: 245, b: 255 }, // #e7f5ff - snowy high mountains
};

const OCEAN_COLOR = { r: 0, g: 0, b: 106 }; // #00006a

const COLOR_TOLERANCE = 15; // Allow slight variations in color matching

function colorDistanceSquared(
  c1: { r: number; g: number; b: number },
  c2: { r: number; g: number; b: number },
): number {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return dr * dr + dg * dg + db * db;
}

export async function generateMap(
  imageBuffer: Buffer,
  removeSmall = true,
  name: string = "",
): Promise<{ map: Uint8Array; miniMap: Uint8Array; thumb: Bitmap }> {
  const stream = Readable.from(imageBuffer);
  const img = await decodePNGFromStream(stream);

  console.log(`Processing Map: ${name}`);
  console.log("Image loaded successfully");
  console.log("Image dimensions:", img.width, "x", img.height);

  const terrain: Terrain[][] = Array(img.width)
    .fill(null)
    .map(() => Array(img.height).fill(null));

  for (let x = 0; x < img.width; x++) {
    for (let y = 0; y < img.height; y++) {
      const colorValue = img.getPixelRGBA(x, y);
      const r = (colorValue >> 24) & 0xff;
      const g = (colorValue >> 16) & 0xff;
      const b = (colorValue >> 8) & 0xff;
      const a = colorValue & 0xff;
      const pixelColor = { r, g, b };

      if (
        a < 20 ||
        colorDistanceSquared(pixelColor, OCEAN_COLOR) <=
          COLOR_TOLERANCE * COLOR_TOLERANCE
      ) {
        terrain[x][y] = new Terrain(
          InternalTerrainType.Water,
          TerrainType.Ocean,
        );
      } else {
        let matchedType: TerrainType | null = null;
        let minDistance = Infinity;

        for (const typeStr in TARGET_COLORS) {
          const type = parseInt(typeStr) as TerrainType;
          const targetColor = TARGET_COLORS[type];
          const distance = colorDistanceSquared(pixelColor, targetColor);

          if (distance < minDistance) {
            minDistance = distance;
            matchedType = type;
          }
        }

        if (minDistance <= COLOR_TOLERANCE * COLOR_TOLERANCE) {
          terrain[x][y] = new Terrain(InternalTerrainType.Land, matchedType!);
          switch (matchedType) {
            case TerrainType.Plains:
            case TerrainType.Desert:
            case TerrainType.Beach:
            case TerrainType.ArcticPlains:
            case TerrainType.JunglePlains:
              terrain[x][y].magnitude = 0;
              break;
            case TerrainType.Forest:
            case TerrainType.DesertTransition:
            case TerrainType.ArcticForest:
            case TerrainType.Jungle:
              terrain[x][y].magnitude = 5;
              break;
            case TerrainType.MidMountain:
              terrain[x][y].magnitude = 20;
              break;
            case TerrainType.HighMountain:
            case TerrainType.SnowyHighMountain:
              terrain[x][y].magnitude = 30;
              break;
            default:
              terrain[x][y].magnitude = 0;
          }
        } else {
          console.warn(
            `Color ${r},${g},${b} at ${x},${y} did not match any target, defaulting to Plains.`,
          );
          terrain[x][y] = new Terrain(
            InternalTerrainType.Land,
            TerrainType.Plains,
          );
          terrain[x][y].magnitude = 0;
        }
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
  const miniMapWidth = Math.floor(tm.length / 2);
  const miniMapHeight = Math.floor(tm[0].length / 2);
  const miniMap: Terrain[][] = Array(miniMapWidth)
    .fill(null)
    .map(() => Array(miniMapHeight).fill(null));

  for (let miniX = 0; miniX < miniMapWidth; miniX++) {
    for (let miniY = 0; miniY < miniMapHeight; miniY++) {
      const startX = miniX * 2;
      const startY = miniY * 2;
      let isWater = false;
      let isOcean = false;
      let isShoreline = false;
      let totalMagnitude = 0;
      let landCount = 0;
      let waterCount = 0;
      let lastLandType: TerrainType = TerrainType.Plains;

      for (let dx = 0; dx < 2; dx++) {
        for (let dy = 0; dy < 2; dy++) {
          const x = startX + dx;
          const y = startY + dy;
          if (x >= tm.length || y >= tm[0].length) continue;
          const tile = tm[x][y];
          if (tile.type === InternalTerrainType.Water) {
            isWater = true;
            waterCount++;
            if (tile.ocean) isOcean = true;
            if (tile.shoreline) isShoreline = true;
            totalMagnitude += tile.magnitude;
          } else {
            landCount++;
            totalMagnitude += tile.magnitude;
            lastLandType = tile.specificType;
            if (tile.shoreline) isShoreline = true;
          }
        }
      }

      if (isWater) {
        const avgMagnitude = waterCount > 0 ? totalMagnitude / waterCount : 0;
        const waterType = isOcean ? TerrainType.Ocean : TerrainType.Lake;
        miniMap[miniX][miniY] = new Terrain(
          InternalTerrainType.Water,
          waterType,
        );
        miniMap[miniX][miniY].ocean = isOcean;
        miniMap[miniX][miniY].magnitude = Math.round(avgMagnitude);
        miniMap[miniX][miniY].shoreline = isShoreline;
      } else {
        const avgMagnitude = landCount > 0 ? totalMagnitude / landCount : 0;
        miniMap[miniX][miniY] = new Terrain(
          InternalTerrainType.Land,
          lastLandType,
        );
        miniMap[miniX][miniY].magnitude = Math.round(avgMagnitude);
        miniMap[miniX][miniY].shoreline = isShoreline;
      }
    }
  }
  return miniMap;
}

function processShore(map: Terrain[][]): Coord[] {
  console.log("Identifying shorelines");
  const shorelineWaters: Coord[] = [];
  for (let x = 0; x < map.length; x++) {
    for (let y = 0; y < map[0].length; y++) {
      const tile = map[x][y];
      tile.shoreline = false;
      const ns = neighbors(x, y, map);
      if (tile.type == InternalTerrainType.Land) {
        if (ns.some((t) => t.type == InternalTerrainType.Water)) {
          tile.shoreline = true;
        }
      } else {
        if (ns.some((t) => t.type == InternalTerrainType.Land)) {
          tile.shoreline = true;
          shorelineWaters.push({ x, y });
        }
      }
    }
  }
  return shorelineWaters;
}

function processDistToLand(shorelineWaters: Coord[], map: Terrain[][]) {
  console.log(
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
        map[nx][ny].type === InternalTerrainType.Water
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
  console.log("Processing water bodies");
  const visited = new Set<string>();
  const waterBodies: { coords: Coord[]; size: number }[] = [];

  for (let x = 0; x < map.length; x++) {
    for (let y = 0; y < map[0].length; y++) {
      if (map[x][y].type === InternalTerrainType.Water) {
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
    console.log(`Identified ocean with ${largestWaterBody.size} water tiles`);

    if (removeSmall) {
      // Assess size of the other water bodies and remove those smaller than min_lake_size
      console.log("Searching for small water bodies for removal");
      for (let w = 1; w < waterBodies.length; w++) {
        if (waterBodies[w].size < min_lake_size) {
          smallLakes++;
          for (const coord of waterBodies[w].coords) {
            map[coord.x][coord.y].type = InternalTerrainType.Land;
            // map[coord.x][coord.y].specificType = TerrainType.Plains; // Default fill
            map[coord.x][coord.y].magnitude = 0;
          }
        }
      }
      console.log(
        `Identified and removed ${smallLakes} bodies of water smaller than ${min_lake_size} tiles`,
      );
    }

    //Identify shoreline tiles, get array of shoreline water tiles
    const shorelineWaters = processShore(map);
    //Adjust water tile magnitudes to reflect distance from land
    processDistToLand(shorelineWaters, map);
  } else {
    console.log("No water bodies found in the map");
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
      if (tile == null) {
        throw new Error(`terrain null at ${x}:${y}`);
      }

      const terrainTypeValue = tile.specificType;
      if (tile.type === InternalTerrainType.Land) {
        packedByte |= 0b10000000;
      }
      if (tile.shoreline) {
        packedByte |= 0b01000000;
      }
      if (tile.ocean) {
        packedByte |= 0b00100000;
      }

      packedByte |= terrainTypeValue & 0x1f;

      if (tile.type === InternalTerrainType.Water) {
        packedByte |= Math.min(Math.ceil(tile.magnitude / 2), 31) & 0x1f;
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
  const targetType: InternalTerrainType = map[x][y].type;
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
      if (map[x][y].type === InternalTerrainType.Land) {
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
        map[coord.x][coord.y].type = InternalTerrainType.Water;
        // map[coord.x][coord.y].specificType = TerrainType.Ocean;
        map[coord.x][coord.y].magnitude = 0;
      }
    }
  }
  console.log(
    `Identified and removed ${smallIslands} islands smaller than ${min_island_size} tiles`,
  );
}

function logBinaryAsBits(data: Uint8Array, length: number = 8) {
  const bits = Array.from(data.slice(0, length))
    .map((b) => b.toString(2).padStart(8, "0"))
    .join(" ");
  console.log(`Binary data (bits):`, bits);
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
  console.log("creating thumbnail");

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
  switch (t.specificType) {
    case TerrainType.Ocean:
      return { r: 0, g: 0, b: 106, a: 0 };
    case TerrainType.Lake:
      return { r: 70, g: 132, b: 180, a: 0 };
    case TerrainType.Plains:
      return { r: 124, g: 178, b: 92, a: 255 };
    case TerrainType.Forest:
      return { r: 97, g: 133, b: 62, a: 255 };
    case TerrainType.Desert:
      return { r: 232, g: 219, b: 145, a: 255 };
    case TerrainType.DesertTransition:
      return { r: 229, g: 186, b: 69, a: 255 };
    case TerrainType.ArcticForest:
      return { r: 152, g: 192, b: 224, a: 255 };
    case TerrainType.Beach:
      return { r: 224, g: 200, b: 121, a: 255 };
    case TerrainType.MidMountain:
      return { r: 92, g: 97, b: 94, a: 255 };
    case TerrainType.HighMountain:
      return { r: 67, g: 72, b: 74, a: 255 };
    case TerrainType.Jungle:
      return { r: 34, g: 117, b: 45, a: 255 };
    case TerrainType.JunglePlains:
      return { r: 71, g: 163, b: 93, a: 255 };
    case TerrainType.ArcticPlains:
      return { r: 173, g: 207, b: 237, a: 255 };
    case TerrainType.SnowyHighMountain:
      return { r: 231, g: 245, b: 255, a: 255 };
    default:
      return { r: 128, g: 128, b: 128, a: 255 };
  }
}
