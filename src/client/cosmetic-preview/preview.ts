// The renderer half of @openfront/cosmetic-preview, loaded by index.ts only
// once the asset base is configured (see assets.ts for why the order matters).

// Named imports, so the bundle keeps these sections and drops the rest of
// en.json.
import {
  card_preview,
  player_card,
  progression,
  store,
} from "../../../resources/lang/en.json";
import "../components/cosmetics/CosmeticRenderCanvas";
import type { CosmeticRenderCanvas } from "../components/cosmetics/CosmeticRenderCanvas";
import { setStandaloneTranslations } from "../Translate";
import type {
  CosmeticPreviewHandle,
  CosmeticPreviewModule,
  CosmeticPreviewRequest,
  CosmeticPreviewResult,
} from "./api";
import { cardPreviewModule } from "./card";
import { parsePreviewRequest, toResolvedCosmetic } from "./config";

// The only strings the previews show: CosmeticRenderCanvas's, and the
// player card's (tracker labels, the level line, the sample name). A host app
// has no <lang-selector>, so without these it would show the raw keys.
const prefixed = (
  section: string,
  strings: Record<string, unknown>,
  keep: (key: string) => boolean = () => true,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(strings)
      .filter(([key, value]) => typeof value === "string" && keep(key))
      .map(([key, value]) => [`${section}.${key}`, value as string]),
  );
setStandaloneTranslations({
  "store.preview_error": store.preview_error,
  "store.preview_salvo_count": store.preview_salvo_count,
  "store.preview_salvo_toggle": store.preview_salvo_toggle,
  ...prefixed("player_card", player_card, (k) => k.startsWith("tracker_")),
  ...prefixed("progression", progression, (k) =>
    ["level", "prestige", "legend"].includes(k),
  ),
  ...prefixed("card_preview", card_preview),
});

/**
 * Create a preview handle and return the initial request's validation result.
 * Replace the host's contents on the first valid request; invalid requests leave
 * them intact. The handle reuses the canvas until destroy() releases it.
 */
function mountCosmeticPreview(
  host: HTMLElement,
  request: CosmeticPreviewRequest,
): { handle: CosmeticPreviewHandle; result: CosmeticPreviewResult } {
  const canvas = document.createElement(
    "cosmetic-render-canvas",
  ) as CosmeticRenderCanvas;
  canvas.className = "block h-full w-full";
  // One canvas shows one cosmetic after another: same-scene changes update
  // in place and keep the camera (CosmeticRenderCanvas.reuseScene).
  canvas.reuseScene = true;
  let mounted = false;
  // Terminal: reattaching the canvas would start a new WebGL context and
  // clear whatever the host has put in `host` since.
  let destroyed = false;

  const show = (next: CosmeticPreviewRequest): CosmeticPreviewResult => {
    if (destroyed) return { ok: false, error: "This preview was destroyed." };
    const parsed = parsePreviewRequest(next);
    if (!parsed.ok) return parsed;
    canvas.resolved = toResolvedCosmetic(parsed.request);
    // Mount on the first valid request: the component starts WebGL when it
    // connects, and has nothing to draw until it has a cosmetic.
    if (!mounted) {
      host.replaceChildren(canvas);
      mounted = true;
    }
    return { ok: true };
  };

  const handle: CosmeticPreviewHandle = {
    show,
    zoomIn: () => {
      if (!destroyed) canvas.zoomIn();
    },
    zoomOut: () => {
      if (!destroyed) canvas.zoomOut();
    },
    destroy: () => {
      destroyed = true;
      // Disconnecting is what releases the context (disconnectedCallback).
      canvas.remove();
    },
  };
  return { handle, result: show(request) };
}

export const previewModule: CosmeticPreviewModule = {
  mountCosmeticPreview,
  ...cardPreviewModule,
};
