// Entry point of @openfront/cosmetic-preview (built by
// scripts/buildCosmeticPreview.ts). Deliberately tiny: it configures where the
// game assets live, and only then loads the renderer, whose modules resolve
// asset URLs as they load.
//
//   const { mountCosmeticPreview } = await loadCosmeticPreview({
//     assetBase: "/openfront-preview",
//   });
//   const { handle, result } = mountCosmeticPreview(el, {
//     type: "pattern",
//     pattern,
//     colors: ["#e2e8f0", "#0c7cc9"],
//   });

import type { CosmeticPreviewModule, LoadCosmeticPreviewOptions } from "./api";
import { configurePreviewAssets } from "./assets";
import "./preview.css";

export { PREVIEW_ASSET_PATHS } from "./assets";

/**
 * Configure the host's asset base before loading and returning the renderer API.
 * Reject if asset configuration fails or the renderer cannot be imported.
 */
export async function loadCosmeticPreview(
  options: LoadCosmeticPreviewOptions,
): Promise<CosmeticPreviewModule> {
  configurePreviewAssets(options.assetBase);
  const { previewModule } = await import("./preview");
  return previewModule;
}
