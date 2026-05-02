import { createHash } from "crypto";
import fs from "fs";
import { globSync } from "glob";
import path from "path";
import {
  type AssetManifest,
  encodeAssetPath,
  normalizeAssetPath,
} from "../core/AssetUrls";

const HASHED_PUBLIC_ASSET_GLOBS = [
  "changelog.md",
  "manifest.json",
  "cosmetics/**/*",
  "flags/**/*",
  "fonts/**/*",
  "icons/**/*",
  "images/**/*",
  "lang/**/*",
  "maps/**/*",
  "sounds/**/*",
  "sprites/**/*",
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

// Bump this to force-invalidate all CDN-cached assets (e.g. after a bad deploy with wrong cache headers).
const CACHE_BUST_VERSION = "2";

type DerivedPublicAssetRenderContext = {
  resourcesDir: string;
  relativePath: string;
  assetManifest: AssetManifest;
};

type DerivedPublicAssetRenderer = {
  matches: (relativePath: string) => boolean;
  render: (context: DerivedPublicAssetRenderContext) => string;
};

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

function createContentHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return createHash("sha256")
    .update(CACHE_BUST_VERSION)
    .update(content)
    .digest("hex")
    .slice(0, 12);
}

function createStringHash(content: string): string {
  return createHash("sha256")
    .update(CACHE_BUST_VERSION)
    .update(content)
    .digest("hex")
    .slice(0, 12);
}

function createHashedAssetUrl(relativePath: string, hash: string): string {
  const parsed = path.posix.parse(toPosixPath(relativePath));
  const hashedFileName = `${parsed.name}.${hash}${parsed.ext}`;
  const hashedRelativePath = path.posix.join(
    "_assets",
    parsed.dir,
    hashedFileName,
  );
  return `/${encodeAssetPath(hashedRelativePath)}`;
}

function readPublicAssetText(
  resourcesDir: string,
  relativePath: string,
): string {
  const sourcePath = path.join(resourcesDir, relativePath);
  return fs.readFileSync(sourcePath, "utf8");
}

function resolveDerivedAssetReference(
  relativePath: string,
  referencePath: string,
): string {
  const baseDir = path.posix.dirname(toPosixPath(relativePath));
  return normalizeAssetPath(path.posix.join(baseDir, referencePath));
}

function getEmittedAssetRelativePath(
  fromRelativePath: string,
  targetHashedUrl: string,
): string {
  const emittedFromDir = path.posix.join(
    "_assets",
    path.posix.dirname(toPosixPath(fromRelativePath)),
  );
  const emittedTargetPath = normalizeAssetPath(targetHashedUrl);
  return path.posix.relative(emittedFromDir, emittedTargetPath);
}

function isExternalAssetReference(referencePath: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(referencePath) || referencePath.startsWith("//")
  );
}

function renderWebManifestAsset({
  resourcesDir,
  assetManifest,
}: DerivedPublicAssetRenderContext): string {
  const sourcePath = path.join(resourcesDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(sourcePath, "utf8")) as {
    icons?: Array<{ src?: string }>;
  };
  manifest.icons = manifest.icons?.map((icon) => {
    const src = icon.src;
    if (src === undefined) {
      return icon;
    }

    if (src.trim().length === 0) {
      throw new Error(
        "Derived asset manifest.json contains an icon with a blank src",
      );
    }

    if (isExternalAssetReference(src)) {
      return icon;
    }

    const referencedAssetPath = resolveDerivedAssetReference(
      "manifest.json",
      src,
    );
    const referencedHashedUrl = assetManifest[referencedAssetPath];
    if (!referencedHashedUrl) {
      throw new Error(
        `Derived asset manifest.json references ${referencedAssetPath}, but it is missing from the asset manifest`,
      );
    }

    return {
      ...icon,
      src: referencedHashedUrl,
    };
  });
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function renderBitmapFontAsset({
  resourcesDir,
  relativePath,
  assetManifest,
}: DerivedPublicAssetRenderContext): string {
  const sourceXml = readPublicAssetText(resourcesDir, relativePath);
  return sourceXml.replace(
    /(<page\b[^>]*\bfile=)(["'])([^"']+)(["'])/g,
    (
      match,
      prefix: string,
      openQuote: string,
      filePath: string,
      closeQuote: string,
    ) => {
      if (openQuote !== closeQuote) {
        return match;
      }

      const referencedAssetPath = resolveDerivedAssetReference(
        relativePath,
        filePath,
      );
      const referencedHashedUrl = assetManifest[referencedAssetPath];
      if (!referencedHashedUrl) {
        throw new Error(
          `Derived asset ${relativePath} references ${referencedAssetPath}, but it is missing from the asset manifest`,
        );
      }

      const rewrittenFilePath = getEmittedAssetRelativePath(
        relativePath,
        referencedHashedUrl,
      );
      return `${prefix}${openQuote}${rewrittenFilePath}${closeQuote}`;
    },
  );
}

const DERIVED_PUBLIC_ASSET_RENDERERS: DerivedPublicAssetRenderer[] = [
  {
    matches: (relativePath) => relativePath === "manifest.json",
    render: renderWebManifestAsset,
  },
  {
    matches: (relativePath) =>
      relativePath.startsWith("fonts/") && relativePath.endsWith(".xml"),
    render: renderBitmapFontAsset,
  },
];

function getDerivedPublicAssetRenderer(
  relativePath: string,
): DerivedPublicAssetRenderer | undefined {
  return DERIVED_PUBLIC_ASSET_RENDERERS.find((renderer) =>
    renderer.matches(relativePath),
  );
}

export function isDerivedPublicAsset(relativePath: string): boolean {
  return (
    getDerivedPublicAssetRenderer(normalizeAssetPath(relativePath)) !==
    undefined
  );
}

function renderDerivedPublicAsset(
  resourcesDir: string,
  relativePath: string,
  assetManifest: AssetManifest,
): string | null {
  const normalizedPath = normalizeAssetPath(relativePath);
  const renderer = getDerivedPublicAssetRenderer(normalizedPath);
  if (!renderer) {
    return null;
  }

  return renderer.render({
    resourcesDir,
    relativePath: normalizedPath,
    assetManifest,
  });
}

export function getResourcesDir(rootDir: string = process.cwd()): string {
  return path.join(rootDir, "resources");
}

export function getProprietaryDir(rootDir: string = process.cwd()): string {
  return path.join(rootDir, "proprietary");
}

// Scans directories with synchronous fs.existsSync — assumes a small number of sourceDirs.
function resolveSourceDir(relativePath: string, sourceDirs: string[]): string {
  for (const dir of sourceDirs) {
    const candidate = path.join(dir, relativePath);
    if (fs.existsSync(candidate)) {
      return dir;
    }
  }
  throw new Error(
    `Asset ${relativePath} not found in any source directory: ${sourceDirs.join(", ")}`,
  );
}

function resolveSourceFile(relativePath: string, sourceDirs: string[]): string {
  return path.join(resolveSourceDir(relativePath, sourceDirs), relativePath);
}

export function shouldKeepRootPublicFile(relativePath: string): boolean {
  return ROOT_PUBLIC_FILES.has(normalizeAssetPath(relativePath));
}

export function listHashedPublicAssetPaths(sourceDirs: string[]): string[] {
  const files = new Set<string>();
  for (const dir of sourceDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const pattern of HASHED_PUBLIC_ASSET_GLOBS) {
      for (const file of globSync(pattern, {
        cwd: dir,
        nodir: true,
        dot: false,
        posix: true,
      })) {
        files.add(normalizeAssetPath(file));
      }
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

export function buildPublicAssetManifest(sourceDirs: string[]): AssetManifest {
  const cacheKey = sourceDirs.join("\0");
  const cached = manifestCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const hashedPublicAssetPaths = listHashedPublicAssetPaths(sourceDirs);
  const rawAssetPaths = hashedPublicAssetPaths.filter(
    (relativePath) => !isDerivedPublicAsset(relativePath),
  );
  const derivedAssetPaths = hashedPublicAssetPaths.filter((relativePath) =>
    isDerivedPublicAsset(relativePath),
  );

  const manifest: AssetManifest = {};
  for (const relativePath of rawAssetPaths) {
    const absolutePath = resolveSourceFile(relativePath, sourceDirs);
    const hash = createContentHash(absolutePath);
    manifest[relativePath] = createHashedAssetUrl(relativePath, hash);
  }

  for (const relativePath of derivedAssetPaths) {
    const renderedAsset = renderDerivedPublicAsset(
      resolveSourceDir(relativePath, sourceDirs),
      relativePath,
      manifest,
    );
    if (renderedAsset === null) {
      throw new Error(`Missing derived asset renderer for ${relativePath}`);
    }

    manifest[relativePath] = createHashedAssetUrl(
      relativePath,
      createStringHash(renderedAsset),
    );
  }

  manifestCache.set(cacheKey, manifest);
  return manifest;
}

export function clearPublicAssetManifestCache(): void {
  manifestCache.clear();
}

export function createHashedPublicAssetFiles(
  sourceDirs: string[],
  outDir: string,
  assetManifest: AssetManifest,
): void {
  for (const [relativePath, hashedUrl] of Object.entries(assetManifest)) {
    const sourceDir = resolveSourceDir(relativePath, sourceDirs);
    const sourcePath = path.join(sourceDir, relativePath);
    const outputPath = path.join(outDir, normalizeAssetPath(hashedUrl));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const renderedAsset = renderDerivedPublicAsset(
      sourceDir,
      relativePath,
      assetManifest,
    );
    if (renderedAsset !== null) {
      fs.writeFileSync(outputPath, renderedAsset);
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

export function writePublicAssetManifest(
  outDir: string,
  assetManifest: AssetManifest,
): void {
  const manifestPath = path.join(outDir, "asset-manifest.json");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(assetManifest, null, 2)}\n`);
}
