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

  // Fallback to current location origin so Web Workers inside blob: schemes can parse URLs
  let effectiveBase = baseUrl;
  if (!effectiveBase) {
    if (typeof self !== "undefined" && self.location && self.location.origin && self.location.origin !== "null") {
      effectiveBase = self.location.origin;
    } else if (typeof window !== "undefined" && window.location && window.location.origin) {
      effectiveBase = window.location.origin;
    }
  }

  const directUrl = assetManifest[normalizedPath];
  if (directUrl) {
    if (isAbsoluteUrl(directUrl)) {
      return directUrl;
    }
    return effectiveBase
      ? `${effectiveBase.replace(/\/+$/, "")}/${directUrl.replace(/^\/+/, "")}`
      : directUrl;
  }

  const encoded = encodeAssetPath(normalizedPath);
  return effectiveBase
    ? `${effectiveBase.replace(/\/+$/, "")}/${encoded}`
    : `/${encoded}`;
}

declare global {
  var __ASSET_MANIFEST__: AssetManifest | undefined;
  var __CDN_BASE__: string | undefined;
}

export function getAssetManifest(): AssetManifest {
  if (
    typeof window !== "undefined" &&
    window.BOOTSTRAP_CONFIG?.assetManifest !== undefined
  ) {
    return window.BOOTSTRAP_CONFIG.assetManifest;
  }
  return globalThis.__ASSET_MANIFEST__ ?? {};
}

export function getCdnBase(): string {
  if (
    typeof window !== "undefined" &&
    window.BOOTSTRAP_CONFIG?.cdnBase !== undefined
  ) {
    return window.BOOTSTRAP_CONFIG.cdnBase;
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return globalThis.__CDN_BASE__ ?? "";
}

export function assetUrl(path: string): string {
  return buildAssetUrl(path, getAssetManifest(), getCdnBase());
}

export function rewriteAssetsForCdn(html: string): string {
  return html.replace(
    /(\s(?:src|href)=)(["'])\/assets\//g,
    `$1$2<%- locals.cdnBaseRaw || "" %>/assets/`,
  );
}
