export function normalizeAssetVersion(
  version: string | null | undefined,
): string | null {
  const trimmed = version?.trim();
  if (!trimmed || trimmed === "DEV" || trimmed === "undefined") {
    return null;
  }
  return trimmed;
}

export function buildVersionedAssetBasePath(
  version: string | null | undefined,
): string {
  const normalized = normalizeAssetVersion(version);
  return normalized ? `/_assets/${encodeURIComponent(normalized)}` : "";
}

export function buildAssetUrl(
  path: string,
  assetBasePath: string = "",
): string {
  const normalizedPath = path.replace(/^\/+/, "");
  if (!assetBasePath) {
    return `/${normalizedPath}`;
  }
  return `${assetBasePath}/${normalizedPath}`;
}

declare global {
  var __ASSET_BASE_PATH__: string | undefined;

  interface Window {
    ASSET_BASE_PATH?: string;
  }
}

export function getAssetBasePath(): string {
  if (typeof window !== "undefined" && window.ASSET_BASE_PATH !== undefined) {
    return window.ASSET_BASE_PATH;
  }
  return globalThis.__ASSET_BASE_PATH__ ?? "";
}

export function assetUrl(path: string): string {
  return buildAssetUrl(path, getAssetBasePath());
}
