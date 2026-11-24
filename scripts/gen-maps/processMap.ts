// Generates one map's binaries, thumbnail, layers and manifest.json.
import {
  type GeneratedMap,
  generateMap,
  MIN_ISLAND_SIZE,
  MIN_LAKE_SIZE,
} from "@openfront/engine-lib/mapgen/GenerateMap";
import type { RemovedBody } from "@openfront/engine-lib/mapgen/SmallBodies";
import {
  KIND_LAND,
  KIND_WATER,
} from "@openfront/engine-lib/mapgen/TerrainBytes";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { goJSON, goQuote } from "./gofmt";
import { cropToNRGBA, downscaleHalf } from "./layers";
import { type Logger, PERF, REMOVAL } from "./logger";
import { inputMapDir, outputMapDir } from "./paths";
import { decodePNG, decodePNGConfig } from "./png";
import { encodeWebP } from "./webp";

const layerWebPQuality = 90;
const thumbnailWebPQuality = 45;
const minRecommendedPixelSize = 2000000;
const maxRecommendedPixelSize = 3000000;
const maxRecommendedLandTileCount = 3000000;
const KIND_NAMES = ["water", "land", "impassable"];

/** Returns the path of the manifest.json written. */
export function processMap(log: Logger, name: string, isTest: boolean): string {
  const inDir = join(inputMapDir(isTest), name);
  const inputPath = join(inDir, "image.png");
  let imageBuffer: Buffer;
  try {
    imageBuffer = readFileSync(inputPath);
  } catch (e) {
    throw new Error(
      `failed to read map file ${inputPath}: ${(e as Error).message}`,
    );
  }
  const sourceImg = decodePNGConfig(imageBuffer);

  const manifestPath = join(inDir, "info.json");
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw new Error(
      `failed to parse info.json for ${name}: ${(e as Error).message}`,
    );
  }

  let result: GeneratedMap;
  try {
    result = generate(log, name, decodePNG(imageBuffer), !isTest);
  } catch (e) {
    throw new Error(
      `failed to generate map for ${name}: ${(e as Error).message}`,
    );
  }

  const dims = (m: {
    width: number;
    height: number;
    numLandTiles: number;
  }) => ({
    width: m.width,
    height: m.height,
    num_land_tiles: m.numLandTiles,
  });
  manifest.map = dims(result.map);
  manifest.map4x = dims(result.map4x);
  manifest.map16x = dims(result.map16x);

  const mapDir = join(outputMapDir(isTest), name);
  mkdirSync(mapDir, { recursive: true });
  writeFileSync(join(mapDir, "map.bin"), result.map.terrain);
  writeFileSync(join(mapDir, "map4x.bin"), result.map4x.terrain);
  writeFileSync(join(mapDir, "map16x.bin"), result.map16x.terrain);
  const thumb = result.thumbnail;
  writeFileSync(
    join(mapDir, "thumbnail.webp"),
    encodeWebP(thumb.rgba, thumb.width, thumb.height, thumbnailWebPQuality),
  );

  if (Array.isArray(manifest.layers)) {
    for (const layer of manifest.layers) {
      if (layer === null || typeof layer !== "object" || Array.isArray(layer))
        continue;
      const layerID = typeof layer.id === "string" ? layer.id : "";
      if (layerID === "") continue;
      const placement =
        typeof layer.placement === "string" ? layer.placement : "";
      if (placement !== "land" && placement !== "water") {
        throw new Error(
          `map ${name}: layer ${goQuote(layerID)} has invalid placement ${goQuote(placement)} (must be "land" or "water")`,
        );
      }
      const srcPng = join(inDir, layerID + ".png");
      let pngData: Buffer;
      try {
        pngData = readFileSync(srcPng);
      } catch (e) {
        throw new Error(
          `map ${name}: layer ${goQuote(layerID)} PNG not found at ${srcPng}: ${(e as Error).message}`,
        );
      }
      let img;
      try {
        img = decodePNG(pngData);
      } catch (e) {
        throw new Error(
          `map ${name}: layer ${goQuote(layerID)} PNG failed to decode: ${(e as Error).message}`,
        );
      }
      const matchesMap =
        img.width === result.map.width && img.height === result.map.height;
      const matchesSource =
        img.width === sourceImg.width && img.height === sourceImg.height;
      if (!matchesMap && !matchesSource) {
        throw new Error(
          `map ${name}: layer ${goQuote(layerID)} PNG dimensions (${img.width}x${img.height}) do not match image.png (${sourceImg.width}x${sourceImg.height})`,
        );
      }
      const { width, height } = result.map;
      const full = cropToNRGBA(img, width, height);
      img = null;
      writeFileSync(
        join(mapDir, layerID + ".webp"),
        encodeWebP(full, width, height, layerWebPQuality),
      );
      const hw = result.map4x.width;
      const hh = result.map4x.height;
      writeFileSync(
        join(mapDir, layerID + ".4x.webp"),
        encodeWebP(
          downscaleHalf(full, width, hw, hh),
          hw,
          hh,
          layerWebPQuality,
        ),
      );
    }
  }

  for (const key of ["$schema", "author", "description", "location"])
    delete manifest[key];
  const outPath = join(mapDir, "manifest.json");
  writeFileSync(outPath, goJSON(manifest, "  ", true));
  return outPath;
}

/** generateMap, with its logs. */
function generate(
  log: Logger,
  name: string,
  image: ReturnType<typeof decodePNG>,
  removeSmall: boolean,
): GeneratedMap {
  const width = image.width - (image.width % 4);
  const height = image.height - (image.height % 4);
  log.info(`Processing Map: ${name}, dimensions: ${width}x${height}`);
  const area = width * height;
  if (area < minRecommendedPixelSize || area > maxRecommendedPixelSize) {
    log.debug(
      `Map area ${area} pixels is outside recommended range (${minRecommendedPixelSize} - ${maxRecommendedPixelSize})`,
      PERF,
    );
  }

  const result = generateMap(image, { removeSmall });

  if (removeSmall) {
    logRemoved(log, result.removed, KIND_LAND, "islands", MIN_ISLAND_SIZE);
    logRemoved(log, result.removed, KIND_WATER, "lakes", MIN_LAKE_SIZE);
    logRemoved(
      log,
      result.removed4x,
      KIND_LAND,
      "islands from map4x",
      MIN_ISLAND_SIZE / 2,
    );
  }
  log.debug(`Land Tile Count (1x): ${result.map.numLandTiles}`);
  log.debug(`Land Tile Count (4x): ${result.map4x.numLandTiles}`);
  log.debug(`Land Tile Count (16x): ${result.map16x.numLandTiles}`);
  if (result.map.numLandTiles > maxRecommendedLandTileCount) {
    log.debug(
      `Map has more land tiles (${result.map.numLandTiles}) than recommended maximum (${maxRecommendedLandTileCount})`,
      PERF,
    );
  }
  return result;
}

function logRemoved(
  log: Logger,
  removed: RemovedBody[],
  kind: number,
  what: string,
  minSize: number,
): void {
  const bodies = removed.filter((b) => b.kind === kind);
  for (const b of bodies) {
    log.debug(
      `Removed ${KIND_NAMES[kind]} at ${b.x},${b.y} (size ${b.size}) -> ${KIND_NAMES[b.replacement]}`,
      REMOVAL,
    );
  }
  log.info(`Removed ${bodies.length} ${what} smaller than ${minSize} tiles`);
}
