// vite.config.ts imports this file, and Vite's config loader leaves
// @openfront/* imports to Node, which only strips types: type-only imports
// must be marked `type` here and in anything this file imports.
import {
  type AssetManifest,
  buildAssetUrl,
} from "@openfront/shared/AssetPaths";

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

// Web workers have no `window`, so they read `__CDN_BASE__` off globalThis,
// which Worker.worker.ts sets from the init message before any asset fetches.
// Without this fallback, asset fetches inside workers (e.g. map binaries)
// would silently bypass the CDN.
export function getCdnBase(): string {
  if (
    typeof window !== "undefined" &&
    window.BOOTSTRAP_CONFIG?.cdnBase !== undefined
  ) {
    return window.BOOTSTRAP_CONFIG.cdnBase;
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
