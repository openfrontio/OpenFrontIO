import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { AssetManifest } from "../core/AssetUrls";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = path.join(__dirname, "../../static");
const manifestPath = path.join(staticDir, "asset-manifest.json");

let cachedManifest: AssetManifest | null = null;

export async function getRuntimeAssetManifest(): Promise<AssetManifest> {
  if (cachedManifest !== null) {
    return cachedManifest;
  }
  if (!fs.existsSync(manifestPath)) {
    cachedManifest = {};
    return cachedManifest;
  }
  try {
    cachedManifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf8"),
    ) as AssetManifest;
  } catch (err) {
    console.error(`Failed to parse asset manifest at ${manifestPath}:`, err);
    cachedManifest = {};
  }
  return cachedManifest;
}

export function clearRuntimeAssetManifestCache(): void {
  cachedManifest = null;
}
