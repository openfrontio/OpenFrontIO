export type AssetManifest = Record<string, string>;

function safeDecodeAssetSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function assertSafeAssetSegment(segment: string): string {
  const decodedSegment = safeDecodeAssetSegment(segment);
  if (
    segment === "." ||
    segment === ".." ||
    decodedSegment === "." ||
    decodedSegment === ".."
  ) {
    throw new Error(`Invalid asset path segment: ${segment}`);
  }
  return decodedSegment;
}

export function encodeAssetPath(path: string): string {
  return normalizeAssetPath(path)
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function normalizeAssetPath(path: string): string {
  const normalizedPath = path
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => assertSafeAssetSegment(segment))
    .join("/");

  if (normalizedPath.length === 0) {
    throw new Error("Asset path must not be empty");
  }

  return normalizedPath;
}

function isAbsoluteUrl(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

export function buildAssetUrl(
  path: string,
  assetManifest: AssetManifest = {},
): string {
  if (isAbsoluteUrl(path)) {
    return path;
  }

  const normalizedPath = normalizeAssetPath(path);

  const directUrl = assetManifest[normalizedPath];
  if (directUrl) {
    return directUrl;
  }

  const directoryPrefix = `${normalizedPath}/`;
  const hasNestedAssets = Object.keys(assetManifest).some((manifestPath) =>
    manifestPath.startsWith(directoryPrefix),
  );
  if (hasNestedAssets) {
    return `/_assets/${encodeAssetPath(normalizedPath)}`;
  }

  return `/${encodeAssetPath(normalizedPath)}`;
}

declare global {
  var __ASSET_MANIFEST__: AssetManifest | undefined;

  interface Window {
    ASSET_MANIFEST?: AssetManifest;
  }
}

export function getAssetManifest(): AssetManifest {
  if (typeof window !== "undefined" && window.ASSET_MANIFEST !== undefined) {
    return window.ASSET_MANIFEST;
  }
  return globalThis.__ASSET_MANIFEST__ ?? {};
}

export function assetUrl(path: string): string {
  return buildAssetUrl(path, getAssetManifest());
}
