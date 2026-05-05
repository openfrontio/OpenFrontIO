import fs from "fs/promises";
import path from "path";
import { normalizeAssetPath } from "src/core/AssetUrls";
import { GameMapType } from "src/core/game/Game";
import { fileURLToPath } from "url";
import { logger } from "./Logger";
import { getRuntimeAssetManifest } from "./RuntimeAssetManifest";

const log = logger.child({ component: "MapLandTiles" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = path.join(__dirname, "../../static");
const resourcesDir = path.join(__dirname, "../../resources");

const landTilesCache = new Map<GameMapType, number>();

function mapDirName(map: GameMapType): string {
  const key = (
    Object.keys(GameMapType) as Array<keyof typeof GameMapType>
  ).find((k) => GameMapType[k] === map);
  if (!key) throw new Error(`Unknown map: ${map}`);
  return key.toLowerCase();
}

async function readManifestFile(map: GameMapType): Promise<string> {
  const relativePath = `maps/${mapDirName(map)}/manifest.json`;

  // Production: resolve via the asset manifest to the hashed file under static/_assets/.
  const assetManifest = await getRuntimeAssetManifest();
  const hashedUrl = assetManifest[relativePath];
  if (hashedUrl) {
    return fs.readFile(
      path.join(staticDir, normalizeAssetPath(hashedUrl)),
      "utf8",
    );
  }

  // Dev: read directly from resources/. The Dockerfile deletes resources/maps in
  // production, so this branch only runs locally.
  return fs.readFile(path.join(resourcesDir, relativePath), "utf8");
}

// Gets the number of land tiles for a map.
export async function getMapLandTiles(map: GameMapType): Promise<number> {
  const cached = landTilesCache.get(map);
  if (cached !== undefined) return cached;

  try {
    const raw = await readManifestFile(map);
    const tiles = (JSON.parse(raw) as { map: { num_land_tiles: number } }).map
      .num_land_tiles;
    landTilesCache.set(map, tiles);
    return tiles;
  } catch (error) {
    log.error(`Failed to load manifest for ${map}: ${error}`, { map });
    return 1_000_000; // Default fallback
  }
}
