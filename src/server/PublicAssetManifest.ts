import { createHash } from "crypto";
import fs from "fs";
import { globSync } from "glob";
import path from "path";
import {
  type AssetManifest,
  buildAssetUrl,
  encodeAssetPath,
  normalizeAssetPath,
} from "../core/AssetUrls";

const HASHED_PUBLIC_ASSET_GLOBS = [
  "changelog.md",
  "manifest.json",
  "cosmetics/**/*",
  "flags/**/*",
  "icons/**/*",
  "images/**/*",
  "lang/**/*",
  "maps/**/*",
] as const;

const ROOT_PUBLIC_FILES = new Set([
  "LICENSE",
  "ads.txt",
  "privacy-policy.html",
  "robots.txt",
  "terms-of-service.html",
  "version.txt",
]);

const manifestCache = new Map<string, AssetManifest>();

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

function createContentHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

export function getResourcesDir(rootDir: string = process.cwd()): string {
  return path.join(rootDir, "resources");
}

export function shouldKeepRootPublicFile(relativePath: string): boolean {
  return ROOT_PUBLIC_FILES.has(normalizeAssetPath(relativePath));
}

export function listHashedPublicAssetPaths(resourcesDir: string): string[] {
  const files = new Set<string>();
  for (const pattern of HASHED_PUBLIC_ASSET_GLOBS) {
    for (const file of globSync(pattern, {
      cwd: resourcesDir,
      nodir: true,
      dot: false,
      posix: true,
    })) {
      files.add(normalizeAssetPath(file));
    }
  }
  return [...files].sort();
}

export function listRootPublicFiles(resourcesDir: string): string[] {
  return globSync("**/*", {
    cwd: resourcesDir,
    nodir: true,
    dot: false,
    posix: true,
  })
    .map((file) => normalizeAssetPath(file))
    .filter((file) => shouldKeepRootPublicFile(file))
    .sort();
}

export function buildPublicAssetManifest(resourcesDir: string): AssetManifest {
  const cached = manifestCache.get(resourcesDir);
  if (cached) {
    return cached;
  }

  const manifest: AssetManifest = {};
  for (const relativePath of listHashedPublicAssetPaths(resourcesDir)) {
    const absolutePath = path.join(resourcesDir, relativePath);
    const parsed = path.posix.parse(toPosixPath(relativePath));
    const hash = createContentHash(absolutePath);
    const hashedFileName = `${parsed.name}.${hash}${parsed.ext}`;
    const hashedRelativePath = path.posix.join(
      "_assets",
      parsed.dir,
      hashedFileName,
    );
    manifest[relativePath] = `/${encodeAssetPath(hashedRelativePath)}`;
  }

  manifestCache.set(resourcesDir, manifest);
  return manifest;
}

export function clearPublicAssetManifestCache(): void {
  manifestCache.clear();
}

export function createHashedPublicAssetFiles(
  resourcesDir: string,
  outDir: string,
  assetManifest: AssetManifest,
): void {
  for (const [relativePath, hashedUrl] of Object.entries(assetManifest)) {
    const sourcePath = path.join(resourcesDir, relativePath);
    const outputPath = path.join(outDir, normalizeAssetPath(hashedUrl));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    if (relativePath === "manifest.json") {
      const manifest = JSON.parse(fs.readFileSync(sourcePath, "utf8")) as {
        icons?: Array<{ src?: string }>;
      };
      manifest.icons = manifest.icons?.map((icon) => ({
        ...icon,
        src: buildAssetUrl(icon.src ?? "", assetManifest),
      }));
      fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
      continue;
    }

    fs.copyFileSync(sourcePath, outputPath);
  }
}

export function copyRootPublicFiles(
  resourcesDir: string,
  outDir: string,
): void {
  for (const relativePath of listRootPublicFiles(resourcesDir)) {
    const sourcePath = path.join(resourcesDir, relativePath);
    const outputPath = path.join(outDir, relativePath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.copyFileSync(sourcePath, outputPath);
  }
}

export function writePublicAssetManifestFile(
  outDir: string,
  assetManifest: AssetManifest,
): void {
  const manifestPath = path.join(outDir, "_assets", "asset-manifest.json");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(assetManifest, null, 2)}\n`);
}
