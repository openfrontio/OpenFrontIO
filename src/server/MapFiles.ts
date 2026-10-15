import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import { normalizeAssetPath } from "@openfront/shared/AssetPaths";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { getRuntimeAssetManifest } from "./RuntimeAssetManifest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = path.join(__dirname, "../../static");
const resourcesDir = path.join(__dirname, "../../resources");

function mapDirName(map: GameMapType): string {
  const key = (
    Object.keys(GameMapType) as Array<keyof typeof GameMapType>
  ).find((k) => GameMapType[k] === map);
  if (!key) throw new Error(`Unknown map: ${map}`);
  return key.toLowerCase();
}

// Reads one of a map's files (manifest.json, map.bin, ...).
export async function readMapFile(
  map: GameMapType,
  fileName: string,
): Promise<Buffer> {
  const relativePath = `maps/${mapDirName(map)}/${fileName}`;

  // Production: resolve via the asset manifest to the hashed file under static/_assets/.
  const assetManifest = await getRuntimeAssetManifest();
  const hashedUrl = assetManifest[relativePath];
  if (hashedUrl) {
    return fs.readFile(path.join(staticDir, normalizeAssetPath(hashedUrl)));
  }

  // Dev: read directly from resources/. The Dockerfile deletes resources/maps in
  // production, so this branch only runs locally.
  return fs.readFile(path.join(resourcesDir, relativePath));
}
