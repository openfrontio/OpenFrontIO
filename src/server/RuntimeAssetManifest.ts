import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type { AssetManifest } from "../core/AssetUrls";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = path.join(__dirname, "../../static");
const manifestPath = path.join(staticDir, "_assets", "asset-manifest.mjs");

let manifestPromise: Promise<AssetManifest> | null = null;
let manifestVersion = 0;

async function importRuntimeAssetManifest(
  version: number,
): Promise<AssetManifest> {
  const manifestModule = (await import(
    `${pathToFileURL(manifestPath).href}?v=${version}`
  )) as {
    assetManifest?: AssetManifest;
    default?: AssetManifest;
  };
  return manifestModule.assetManifest ?? manifestModule.default ?? {};
}

export async function getRuntimeAssetManifest(): Promise<AssetManifest> {
  if (!fs.existsSync(manifestPath)) {
    return {};
  }

  manifestPromise ??= importRuntimeAssetManifest(manifestVersion).catch(
    () => ({}),
  );
  return manifestPromise;
}

export function clearRuntimeAssetManifestCache(): void {
  manifestVersion++;
  manifestPromise = null;
}
