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
  baseUrl: string = "",
): string {
  if (isAbsoluteUrl(path)) {
    return path;
  }

  const normalizedPath = normalizeAssetPath(path);

  const directUrl = assetManifest[normalizedPath];
  if (directUrl) {
    return baseUrl ? `${baseUrl}${directUrl}` : directUrl;
  }

  return `/${encodeAssetPath(normalizedPath)}`;
}

declare global {
  var __ASSET_MANIFEST__: AssetManifest | undefined;
  var __CDN_BASE__: string | undefined;

  interface Window {
    ASSET_MANIFEST?: AssetManifest;
    CDN_BASE?: string;
  }
}

export function getAssetManifest(): AssetManifest {
  if (typeof window !== "undefined" && window.ASSET_MANIFEST !== undefined) {
    return window.ASSET_MANIFEST;
  }
  return globalThis.__ASSET_MANIFEST__ ?? {};
}

// Web workers have no `window`, so they read from the build-time
// `__CDN_BASE__` define instead. Without this fallback, asset fetches inside
// workers (e.g. map binaries) would silently bypass the CDN.
function getCdnBase(): string {
  if (typeof window !== "undefined" && window.CDN_BASE !== undefined) {
    return window.CDN_BASE;
  }
  return globalThis.__CDN_BASE__ ?? "";
}

export function assetUrl(path: string): string {
  return buildAssetUrl(path, getAssetManifest(), getCdnBase());
}
