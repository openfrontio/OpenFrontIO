// The game assets the preview fetches at runtime, relative to resources/.
// The package ships exactly these under assets/, and the host serves them.
//
// Everything else the renderer needs (shaders, render settings, atlas
// metadata) is compiled into the bundle. If a pass starts fetching a new file
// through assetUrl(), it belongs here — scripts/buildCosmeticPreview.ts fails
// the build until it is.
export const PREVIEW_ASSET_PATHS = [
  "atlases/fx-atlas.png",
  "atlases/icon-atlas.png",
  "atlases/unit-atlas.png",
  "maps/australia/manifest.json",
  "maps/australia/map4x.bin",
] as const;

/**
 * Configure the asset globals used by assetUrl() without window.BOOTSTRAP_CONFIG.
 * Call before importing the renderer, whose passes resolve URLs on module load.
 * @param assetBase URL prefix for the shipped assets; trailing slashes are removed.
 * @throws If the asset base was already configured to a different location.
 */
export function configurePreviewAssets(assetBase: string): void {
  const base = assetBase.replace(/\/+$/, "");
  const current = globalThis.__CDN_BASE__;
  if (current !== undefined && current !== base) {
    throw new Error(
      `Cosmetic preview assets already configured at "${current}"; cannot move them to "${base}".`,
    );
  }
  globalThis.__ASSET_MANIFEST__ = Object.fromEntries(
    PREVIEW_ASSET_PATHS.map((path) => [path, `/${path}`]),
  );
  globalThis.__CDN_BASE__ = base;
}
