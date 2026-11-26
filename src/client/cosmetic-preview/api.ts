// The public face of @openfront/cosmetic-preview: the store's own cosmetic
// preview (CosmeticRenderCanvas), packaged for other OpenFront apps — the
// dashboard first (openfrontio/opendash#74) — so they show a cosmetic exactly
// as the store does instead of reimplementing the renderer.
//
// Types only: scripts/buildCosmeticPreview.ts ships this file as the
// package's type declarations, so its only import is cardCheckTypes.ts (also
// shipped as is). config.ts checks at compile time that the runtime schema
// and these types agree.

import type { CardBackgroundFiles, CardIssue } from "./cardCheckTypes";

export type {
  CardBackgroundFiles,
  CardCheckImage,
  CardEffect,
  CardIssue,
  CardIssueCode,
} from "./cardCheckTypes";

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
      /**
       * https image URL; its host must allow CORS (it becomes a texture).
       * The viewer's browser fetches it, so hosts should pass only URLs
       * they trust, such as the catalogue's own CDN.
       */
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
  /**
   * Stop rendering and release the WebGL context. Final: afterwards show()
   * returns an error and the host element is left alone.
   */
  destroy(): void;
}

// ---- Card backgrounds. ----

/**
 * Where a card background shows in the game. The first three are drawn
 * animated (when `animated` is set); the rest are always still and crop
 * more tightly, as the game draws them:
 *  - "inventory": the Inventory's card preview
 *  - "large": the Store's large preview
 *  - "endScreen": the card on the end screens
 *  - "store": the Store tile (a 160 × 64 thumbnail)
 *  - "lobbyTag": the lobby name tag
 *  - "hover": the hover player summary in game
 *  - "panel": the in-game player panel
 */
export type CardPreviewSize =
  | "inventory"
  | "large"
  | "endScreen"
  | "store"
  | "lobbyTag"
  | "hover"
  | "panel";

export interface CardBackgroundPreviewInput {
  /**
   * The base image: an https:, blob: or data:image URL (http: only on
   * localhost). An https host must allow CORS for shimmer layers.
   */
  url: string;
  /**
   * The background's `animation`, as the catalogue stores it: checked
   * against the game's schema. Layer `src`s follow the same URL rules.
   */
  animation?: unknown;
  /** Seeds flicker, as the background's catalogue name does in game. */
  id?: string;
  /** Sets the card's border colour. Default "common". */
  rarity?: string;
}

export interface CardBackgroundPreviewOptions {
  size: CardPreviewSize;
  /** False: the still card players with reduced motion see. */
  animated: boolean;
  /** The sample player name on the card. */
  name?: string;
  /** Layer indexes (into animation.layers) to leave out. */
  hiddenLayers?: number[];
  /** Mark the centre 1260 × 290 of the art the small views keep. */
  safeArea?: boolean;
}

export interface CardBackgroundPreviewHandle {
  /**
   * Show another background or other options on the same card. An invalid
   * animation draws the still base and returns the error.
   */
  update(
    background: CardBackgroundPreviewInput,
    options: CardBackgroundPreviewOptions,
  ): CosmeticPreviewResult;
  /** Remove the card. Final: afterwards update() returns an error. */
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

  /**
   * Render a player card with `background` into `host`, at a size the game
   * uses, with a sample name and stats on it. The card sets its own width
   * (at most the game's), so the host only places it. An invalid URL
   * renders nothing; an invalid animation draws the still base. Either way
   * the result has the error.
   */
  mountCardBackgroundPreview(
    host: HTMLElement,
    background: CardBackgroundPreviewInput,
    options: CardBackgroundPreviewOptions,
  ): { handle: CardBackgroundPreviewHandle; result: CosmeticPreviewResult };

  /**
   * The game stops every card animation for the rest of the session after
   * about 2 s of slow frames. Calls `cb` each time that happens. Returns the
   * unsubscribe.
   */
  onCardAnimationStopped(cb: () => void): () => void;
  /** Whether slow frames have stopped card animation (until a restart). */
  cardAnimationStopped(): boolean;
  /** Undo a slow-frame stop and mount every live card preview afresh. */
  restartCardAnimation(): void;
  /**
   * Whether this browser asks for reduced motion: the game then draws every
   * card still, and so does the preview, whatever `animated` says.
   */
  systemPrefersReducedMotion(): boolean;
  /** The artist guide's checks: errors first, then warnings. Pure. */
  checkCardBackground(
    files: CardBackgroundFiles,
    animation: unknown,
  ): CardIssue[];
}

export interface LoadCosmeticPreviewOptions {
  /**
   * URL prefix where the package's assets/ directory is served, e.g.
   * "/openfront-preview". Every file in PREVIEW_ASSET_PATHS must be reachable
   * at `${assetBase}/${path}`.
   */
  assetBase: string;
}
