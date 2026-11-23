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

// blob: and data: URLs carry no "//" but are just as final: a blob: URL is a
// file the page itself holds (an artist's dropped image in the dashboard's
// card preview), and a data: URL is the image itself. Only the cosmetic
// preview package needs them, so they pass through only once it opts in. In
// the game, a cosmetic's url comes from the catalogue, and the catalogue must
// never be able to point every player at an inline image: there they are
// treated as paths, as they always were.
let pageUrlsAllowed = false;

/**
 * Pass blob: and data: URLs through buildAssetUrl() unchanged. Only the
 * cosmetic preview package calls this (configurePreviewAssets()); the game
 * never does.
 */
export function allowPageAssetUrls(allowed: boolean = true): void {
  pageUrlsAllowed = allowed;
}

// Any scheme, not just http(s): the desktop shell resolves assets against an
// absolute app://openfront base (its cdnBase), and an already-resolved URL
// can be handed back to assetUrl() (e.g. WebGLFrameBuilder re-resolves
// player cosmetic refs that a singleplayer start resolved at join time).
// Matching only http(s) sent those through normalizeAssetPath, which mangled
// "app://openfront/_assets/flags/US.<hash>.svg" into
// "/app%3A/openfront/_assets/..." — a 404, and a country flag that silently
// never rendered in game on desktop.
function isAbsoluteUrl(path: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(path) ||
    (pageUrlsAllowed && /^(?:blob|data):/i.test(path))
  );
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
