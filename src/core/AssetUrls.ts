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
    return baseUrl ? `${baseUrl.replace(/\/+$/, "")}${directUrl}` : directUrl;
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

// Web workers have no `window`, so they read `__CDN_BASE__` off globalThis,
// which Worker.worker.ts sets from the init message before any asset fetches.
// Without this fallback, asset fetches inside workers (e.g. map binaries)
// would silently bypass the CDN.
export function getCdnBase(): string {
  if (typeof window !== "undefined" && window.CDN_BASE !== undefined) {
    return window.CDN_BASE;
  }
  return globalThis.__CDN_BASE__ ?? "";
}

export function assetUrl(path: string): string {
  return buildAssetUrl(path, getAssetManifest(), getCdnBase());
}

// Rewrites Vite's emitted /assets/... references in the built index.html to
// use the cdnBaseRaw EJS placeholder, so RenderHtml.ts can prefix them with
// CDN_BASE at request time. Scoped to src=/href= attribute values so inline
// scripts containing the literal "/assets/..." can't be mangled. Does NOT
// match /_assets/ (underscore) — source-asset manifest URLs are prefixed via
// buildAssetUrl, not this rewrite. Falls back to "" when cdnBaseRaw is missing
// so a future renderer that forgets to provide it still produces working
// same-origin URLs.
export function rewriteAssetsForCdn(html: string): string {
  return html.replace(
    /(\s(?:src|href)=)(["'])\/assets\//g,
    `$1$2<%- locals.cdnBaseRaw || "" %>/assets/`,
  );
}
