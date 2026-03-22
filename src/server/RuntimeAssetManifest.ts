import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import type { AssetManifest } from "../core/AssetUrls";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = path.join(__dirname, "../../static");
const manifestPath = path.join(staticDir, "_assets", "asset-manifest.json");

let manifestPromise: Promise<AssetManifest> | null = null;

async function readRuntimeAssetManifest(): Promise<AssetManifest> {
  const raw = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(raw) as AssetManifest;
}

export async function getRuntimeAssetManifest(): Promise<AssetManifest> {
  if (process.env.GAME_ENV !== "prod") {
    return {};
  }

  manifestPromise ??= readRuntimeAssetManifest();
  return manifestPromise;
}

export function clearRuntimeAssetManifestCache(): void {
  manifestPromise = null;
}
