// The public face of @openfront/cosmetic-preview: the store's own cosmetic
// preview (CosmeticRenderCanvas), packaged for other OpenFront apps — the
// dashboard first (openfrontio/opendash#74) — so they show a cosmetic exactly
// as the store does instead of reimplementing the renderer.
//
// Types only, and no imports: scripts/buildCosmeticPreview.ts ships this file
// as the package's type declarations. config.ts checks at compile time that
// the runtime schema and these types agree.

/** What to preview. Validated at runtime against the catalogue's schemas. */
export type CosmeticPreviewRequest =
  | {
      type: "pattern";
      /** base64url pattern data, as stored in the catalogue. */
      pattern: string;
      /** [primary, secondary] as #rrggbb. Omitted: the store's default. */
      colors?: [string, string];
    }
  | {
      type: "skin";
      /** https image URL; its host must allow CORS (it becomes a texture). */
      url: string;
    }
  | {
      type: "effect";
      /** One catalogue effect, e.g. cosmetics.json effects.nukeTrail.<name>. */
      effect: {
        effectType: string;
        name: string;
        attributes: Record<string, unknown>;
        [field: string]: unknown;
      };
    };

export type CosmeticPreviewResult = { ok: true } | { ok: false; error: string };

export interface CosmeticPreviewHandle {
  /** Switch to another cosmetic without recreating the WebGL context. */
  show(request: CosmeticPreviewRequest): CosmeticPreviewResult;
  zoomIn(): void;
  zoomOut(): void;
  /** Stop rendering and release the WebGL context. */
  destroy(): void;
}

export interface CosmeticPreviewModule {
  /**
   * Render `request` into `host` (sized by the host; fill it). Invalid
   * requests render nothing and return the validation error.
   */
  mountCosmeticPreview(
    host: HTMLElement,
    request: CosmeticPreviewRequest,
  ): { handle: CosmeticPreviewHandle; result: CosmeticPreviewResult };
}

export interface LoadCosmeticPreviewOptions {
  /**
   * URL prefix where the package's assets/ directory is served, e.g.
   * "/openfront-preview". Every file in PREVIEW_ASSET_PATHS must be reachable
   * at `${assetBase}/${path}`.
   */
  assetBase: string;
}
