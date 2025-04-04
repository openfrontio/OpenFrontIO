import { decodePNGFromStream } from "pureimage";
import { Readable } from "stream";

const MIN_ISLAND_SIZE = 30;
const MIN_LAKE_SIZE = 200;

const FLAG_LAND = 1 << 7;
const FLAG_SHORELINE = 1 << 6;
const FLAG_OCEAN = 1 << 5;

interface MapData {
  width: number;
  height: number;
  flags: Uint8Array;
  magnitude: Float32Array;
}

interface ProcessedMapOutput {
  map: Uint8Array;
  miniMap: Uint8Array;
  thumb: {
    data: Buffer;
    width: number;
    height: number;
  };
}

export async function generateMap(
  imageBuffer: Buffer,
  removeSmall = true,
  name: string = "",
): Promise<ProcessedMapOutput> {
  const stream = Readable.from(imageBuffer);
  const img = await decodePNGFromStream(stream);
  const { width, height } = img;

  console.log(`[${name}] Processing Map: ${name} (${width}x${height})`);
  console.time(`[${name}] Total Generation Time`);

  console.time(`[${name}] Initial Pixel Processing`);
  const map: MapData = {
    width,
    height,
    flags: new Uint8Array(width * height),
    magnitude: new Float32Array(width * height),
  };
  const visited = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    const yOffset = y * width;
    for (let x = 0; x < width; x++) {
      const index = yOffset + x;
      const color = img.getPixelRGBA(x, y);
      const alpha = color & 0xff;
      const blue = (color >> 8) & 0xff;

      const isWater = alpha < 20 || blue === 106;

      if (!isWater) {
        map.flags[index] |= FLAG_LAND;
        const mag = Math.min(200, Math.max(140, blue)) - 140;
        map.magnitude[index] = mag / 2;
      }
    }
  }
  console.timeEnd(`[${name}] Initial Pixel Processing`);

  if (removeSmall) {
    console.time(`[${name}] Removing Small Islands`);
    removeSmallFeatures(map, visited, MIN_ISLAND_SIZE, true, name);
    console.timeEnd(`[${name}] Removing Small Islands`);
  }

  console.time(`[${name}] Processing Water`);
  processWaterBodies(map, visited, removeSmall, name);
  console.timeEnd(`[${name}] Processing Water`);

  console.time(`[${name}] Calculating Shorelines & Water Magnitude`);
  processShorelinesAndDistance(map, visited, name);
  console.timeEnd(`[${name}] Calculating Shorelines & Water Magnitude`);

  console.time(`[${name}] Creating Minimap`);
  const miniMapData = createMiniMap(map, name);
  console.timeEnd(`[${name}] Creating Minimap`);

  console.time(`[${name}] Creating Thumbnail`);
  const thumb = await createMapThumbnail(miniMapData, 0.5, name);
  console.timeEnd(`[${name}] Creating Thumbnail`);

  console.time(`[${name}] Packing Main Map`);
  const packedMainMap = packMapData(map, name);
  console.timeEnd(`[${name}] Packing Main Map`);

  console.time(`[${name}] Packing Minimap`);
  const packedMiniMap = packMapData(miniMapData, name);
  console.timeEnd(`[${name}] Packing Minimap`);

  console.timeEnd(`[${name}] Total Generation Time`);

  return {
    map: packedMainMap,
    miniMap: packedMiniMap,
    thumb: thumb,
  };
}

function getAreaIndices(
  map: MapData,
  visited: Uint8Array,
  startX: number,
  startY: number,
  targetIsLand: boolean,
): { indices: number[]; size: number } {
  const { width, height, flags } = map;
  const targetFlag = targetIsLand ? FLAG_LAND : 0;
  const startIndex = startY * width + startX;

  if (
    startIndex < 0 ||
    startIndex >= flags.length ||
    (flags[startIndex] & FLAG_LAND) !== targetFlag ||
    visited[startIndex] === 1
  ) {
    return { indices: [], size: 0 };
  }

  const areaIndices: number[] = [];
  const queue: number[] = [];
  let queueIndex = 0;

  queue.push(startIndex);
  visited[startIndex] = 1;

  const directions = [-1, 1, -width, width];

  while (queueIndex < queue.length) {
    const currentIndex = queue[queueIndex++];
    areaIndices.push(currentIndex);
    const currentX = currentIndex % width;
    const currentY = Math.floor(currentIndex / width);

    for (const offset of directions) {
      const nextIndex = currentIndex + offset;

      if (nextIndex < 0 || nextIndex >= flags.length) continue;
      const nextY = Math.floor(nextIndex / width);
      if (offset === -1 && nextY !== currentY) continue;
      if (offset === 1 && nextY !== currentY) continue;

      if (
        visited[nextIndex] === 0 &&
        (flags[nextIndex] & FLAG_LAND) === targetFlag
      ) {
        visited[nextIndex] = 1;
        queue.push(nextIndex);
      }
    }
  }
  return { indices: areaIndices, size: areaIndices.length };
}

function removeSmallFeatures(
  map: MapData,
  visited: Uint8Array,
  minSize: number,
  removeLand: boolean,
  mapName: string,
) {
  const { width, height, flags, magnitude } = map;
  visited.fill(0);
  let featuresRemoved = 0;
  const typeToRemove = removeLand ? "islands" : "lakes";
  const targetFlag = removeLand ? FLAG_LAND : 0;

  console.log(
    `[${mapName}] Searching for small ${typeToRemove} (< ${minSize} tiles)...`,
  );

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (visited[index] === 0 && (flags[index] & FLAG_LAND) === targetFlag) {
        const { indices, size } = getAreaIndices(
          map,
          visited,
          x,
          y,
          removeLand,
        );

        if (size > 0 && size < minSize) {
          featuresRemoved++;
          for (const idx of indices) {
            if (removeLand) {
              flags[idx] &= ~FLAG_LAND;
            } else {
              flags[idx] |= FLAG_LAND;
            }
            magnitude[idx] = 0;
            flags[idx] &= ~(FLAG_SHORELINE | FLAG_OCEAN);
          }
        }
      }
    }
  }
  console.log(
    `[${mapName}] Identified and removed ${featuresRemoved} small ${typeToRemove}.`,
  );
  visited.fill(0);
}

function processWaterBodies(
  map: MapData,
  visited: Uint8Array,
  removeSmallLakes: boolean,
  mapName: string,
) {
  const { width, height, flags } = map;
  visited.fill(0);
  let largestWaterBodySize = 0;
  let largestWaterBodyIndices: number[] = [];
  const lakeSizes: { indices: number[]; size: number }[] = [];

  console.log(`[${mapName}] Identifying water bodies...`);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (visited[index] === 0 && !(flags[index] & FLAG_LAND)) {
        const { indices, size } = getAreaIndices(map, visited, x, y, false);
        if (size > 0) {
          lakeSizes.push({ indices, size });
          if (size > largestWaterBodySize) {
            largestWaterBodySize = size;
            largestWaterBodyIndices = indices;
          }
        }
      }
    }
  }

  if (largestWaterBodySize > 0) {
    console.log(
      `[${mapName}] Identified largest water body (ocean) with ${largestWaterBodySize} tiles.`,
    );
    for (const index of largestWaterBodyIndices) {
      flags[index] |= FLAG_OCEAN;
    }

    if (removeSmallLakes) {
      let smallLakesRemoved = 0;
      console.log(
        `[${mapName}] Searching for small lakes (< ${MIN_LAKE_SIZE} tiles)...`,
      );
      for (const lake of lakeSizes) {
        if (lake.size !== largestWaterBodySize && lake.size < MIN_LAKE_SIZE) {
          smallLakesRemoved++;
          for (const index of lake.indices) {
            flags[index] |= FLAG_LAND;
            flags[index] &= ~(FLAG_OCEAN | FLAG_SHORELINE);
            map.magnitude[index] = 0;
          }
        }
      }
      console.log(
        `[${mapName}] Identified and removed ${smallLakesRemoved} small lakes.`,
      );
    }
  } else {
    console.log(`[${mapName}] No water bodies found.`);
  }
  visited.fill(0);
}

function processShorelinesAndDistance(
  map: MapData,
  visited: Uint8Array,
  mapName: string,
): void {
  const { width, height, flags, magnitude } = map;
  const queue: number[] = [];
  let queueIndex = 0;

  console.log(`[${mapName}] Identifying shorelines...`);
  visited.fill(0);

  const directions = [-1, 1, -width, width];

  for (let y = 0; y < height; y++) {
    const yOffset = y * width;
    for (let x = 0; x < width; x++) {
      const index = yOffset + x;
      const isLand = (flags[index] & FLAG_LAND) !== 0;
      let hasDifferentNeighbor = false;

      for (const offset of directions) {
        const ni = index + offset;
        if (ni < 0 || ni >= flags.length) continue;
        const ny = Math.floor(ni / width);
        if (offset === -1 && ny !== y) continue;
        if (offset === 1 && ny !== y) continue;

        const neighborIsLand = (flags[ni] & FLAG_LAND) !== 0;
        if (isLand !== neighborIsLand) {
          hasDifferentNeighbor = true;
          break;
        }
      }

      if (hasDifferentNeighbor) {
        flags[index] |= FLAG_SHORELINE;
        if (!isLand) {
          if (visited[index] === 0) {
            visited[index] = 1;
            magnitude[index] = 0;
            queue.push(index);
          }
        }
      } else {
        flags[index] &= ~FLAG_SHORELINE;
      }
    }
  }
  console.log(
    `[${mapName}] Identified ${queue.length} initial shoreline water tiles for BFS.`,
  );

  console.log(
    `[${mapName}] Calculating Manhattan distance from land for water tiles...`,
  );

  while (queueIndex < queue.length) {
    const index = queue[queueIndex++];
    const currentDist = magnitude[index];
    const currentY = Math.floor(index / width);

    for (const offset of directions) {
      const ni = index + offset;
      if (ni < 0 || ni >= flags.length) continue;
      const ny = Math.floor(ni / width);
      if (offset === -1 && ny !== currentY) continue;
      if (offset === 1 && ny !== currentY) continue;

      if (!(flags[ni] & FLAG_LAND) && visited[ni] === 0) {
        visited[ni] = 1;
        const newDist = currentDist + 1;
        magnitude[ni] = newDist;
        queue.push(ni);
      }
    }
  }

  console.log(`[${mapName}] Finished calculating water distances.`);
  visited.fill(0);
}

function createMiniMap(map: MapData, mapName: string): MapData {
  const { width, height, flags, magnitude } = map;
  const miniWidth = Math.max(1, Math.floor(width / 2));
  const miniHeight = Math.max(1, Math.floor(height / 2));

  console.log(`[${mapName}] Creating minimap (${miniWidth}x${miniHeight})...`);

  const miniMap: MapData = {
    width: miniWidth,
    height: miniHeight,
    flags: new Uint8Array(miniWidth * miniHeight),
    magnitude: new Float32Array(miniWidth * miniHeight),
  };

  for (let my = 0; my < miniHeight; my++) {
    const miniYOffset = my * miniWidth;
    for (let mx = 0; mx < miniWidth; mx++) {
      const miniIndex = miniYOffset + mx;
      const startX = mx * 2;
      const startY = my * 2;
      const srcX = Math.min(startX, width - 1);
      const srcY = Math.min(startY, height - 1);
      const sourceIndex = srcY * width + srcX;

      if (sourceIndex >= 0 && sourceIndex < flags.length) {
        miniMap.flags[miniIndex] = flags[sourceIndex];
        miniMap.magnitude[miniIndex] = magnitude[sourceIndex];
      } else {
        miniMap.flags[miniIndex] = 0;
        miniMap.magnitude[miniIndex] = 100;
      }
    }
  }
  return miniMap;
}

function packMapData(map: MapData, mapName: string): Uint8Array {
  const { width, height, flags, magnitude } = map;
  const totalTiles = width * height;
  const packedData = new Uint8Array(4 + totalTiles);

  console.log(`[${mapName}] Packing map data (${width}x${height})...`);

  packedData[0] = width & 0xff;
  packedData[1] = (width >> 8) & 0xff;
  packedData[2] = height & 0xff;
  packedData[3] = (height >> 8) & 0xff;

  for (let i = 0; i < totalTiles; i++) {
    const tileFlags = flags[i];
    const tileMag = magnitude[i];
    let packedByte = 0;
    packedByte |= tileFlags & (FLAG_LAND | FLAG_SHORELINE | FLAG_OCEAN);
    let packedMag = 0;
    if (tileFlags & FLAG_LAND) {
      packedMag = Math.min(31, Math.max(0, Math.ceil(tileMag)));
    } else {
      packedMag = Math.min(31, Math.max(0, Math.ceil(tileMag / 2)));
    }
    packedByte |= packedMag;
    packedData[4 + i] = packedByte;
  }
  return packedData;
}

function getThumbnailColor(
  flags: number,
  magnitude: number,
): { r: number; g: number; b: number; a: number } {
  const isLand = (flags & FLAG_LAND) !== 0;
  const isShoreline = (flags & FLAG_SHORELINE) !== 0;

  if (!isLand) {
    if (isShoreline) {
      return { r: 100, g: 143, b: 255, a: 0 };
    } else {
      const adj = 1 - Math.min(magnitude / 2, 10);
      const r = Math.max(0, 70 + adj);
      const g = Math.max(0, 132 + adj);
      const b = Math.max(0, 180 + adj);
      return {
        r: Math.min(255, r),
        g: Math.min(255, g),
        b: Math.min(255, b),
        a: 0,
      };
    }
  } else {
    if (isShoreline) {
      return { r: 204, g: 203, b: 158, a: 255 };
    }

    let r = 0,
      g = 0,
      b = 0;
    const elev = magnitude;

    if (elev < 10) {
      const adjG = 220 - 2 * elev;
      r = 190;
      g = adjG;
      b = 138;
    } else if (elev < 20) {
      const adjRGB = 2 * elev;
      r = 200 + adjRGB;
      g = 183 + adjRGB;
      b = 138 + adjRGB;
    } else {
      const adjRGB = Math.floor(230 + elev / 2);
      r = adjRGB;
      g = adjRGB;
      b = adjRGB;
    }

    return {
      r: Math.min(255, Math.max(0, r)),
      g: Math.min(255, Math.max(0, g)),
      b: Math.min(255, Math.max(0, b)),
      a: 255,
    };
  }
}

async function createMapThumbnail(
  map: MapData,
  quality: number = 0.5,
  mapName: string,
): Promise<{ data: Buffer; width: number; height: number }> {
  const { width: srcWidth, height: srcHeight, flags, magnitude } = map;
  const targetWidth = Math.max(1, Math.floor(srcWidth * quality));
  const targetHeight = Math.max(1, Math.floor(srcHeight * quality));

  console.log(
    `[${mapName}] Creating thumbnail (${targetWidth}x${targetHeight})...`,
  );

  const pixelData = Buffer.alloc(targetWidth * targetHeight * 4);

  for (let y = 0; y < targetHeight; y++) {
    const targetYOffset = y * targetWidth;
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.min(srcWidth - 1, Math.floor(x / quality));
      const srcY = Math.min(srcHeight - 1, Math.floor(y / quality));
      const srcIndex = srcY * srcWidth + srcX;

      const rgba = getThumbnailColor(flags[srcIndex], magnitude[srcIndex]);

      const RgbaIndex = (targetYOffset + x) * 4;
      pixelData[RgbaIndex + 0] = rgba.r;
      pixelData[RgbaIndex + 1] = rgba.g;
      pixelData[RgbaIndex + 2] = rgba.b;
      pixelData[RgbaIndex + 3] = rgba.a;
    }
  }
  return { data: pixelData, width: targetWidth, height: targetHeight };
}
