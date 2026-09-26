// The renderer half of @openfront/cosmetic-preview, loaded by index.ts only
// once the asset base is configured (see assets.ts for why the order matters).

import { store } from "../../../resources/lang/en.json";
import "../components/cosmetics/CosmeticRenderCanvas";
import type { CosmeticRenderCanvas } from "../components/cosmetics/CosmeticRenderCanvas";
import { setStandaloneTranslations } from "../Utils";
import type {
  CosmeticPreviewHandle,
  CosmeticPreviewModule,
  CosmeticPreviewRequest,
  CosmeticPreviewResult,
} from "./api";
import { parsePreviewRequest, toResolvedCosmetic } from "./config";

// The only strings CosmeticRenderCanvas shows. A host app has no
// <lang-selector>, so without these it would show the raw keys.
setStandaloneTranslations({
  "store.preview_error": store.preview_error,
  "store.preview_salvo_count": store.preview_salvo_count,
  "store.preview_salvo_toggle": store.preview_salvo_toggle,
});

function mountCosmeticPreview(
  host: HTMLElement,
  request: CosmeticPreviewRequest,
): { handle: CosmeticPreviewHandle; result: CosmeticPreviewResult } {
  const canvas = document.createElement(
    "cosmetic-render-canvas",
  ) as CosmeticRenderCanvas;
  canvas.className = "block h-full w-full";

  const show = (next: CosmeticPreviewRequest): CosmeticPreviewResult => {
    const parsed = parsePreviewRequest(next);
    if (!parsed.ok) return parsed;
    canvas.resolved = toResolvedCosmetic(parsed.request);
    // Mount on the first valid request: the component starts WebGL when it
    // connects, and has nothing to draw until it has a cosmetic.
    if (!canvas.isConnected) host.replaceChildren(canvas);
    return { ok: true };
  };

  const handle: CosmeticPreviewHandle = {
    show,
    zoomIn: () => canvas.zoomIn(),
    zoomOut: () => canvas.zoomOut(),
    // Disconnecting is what releases the context (disconnectedCallback).
    destroy: () => canvas.remove(),
  };
  return { handle, result: show(request) };
}

export const previewModule: CosmeticPreviewModule = { mountCosmeticPreview };
