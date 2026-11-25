// The hand-written declarations @openfront/cosmetic-preview publishes. Kept
// apart from buildCosmeticPreview.ts so a test can compile a consumer against
// them without running the Vite build.

// api.ts's one import, as the published files name it.
const CARD_CHECK_TYPES_IMPORT = /from "\.\/cardCheckTypes";/g;

/**
 * index.d.ts: the public types (api.ts) and the runtime entry. api.ts's card
 * check types come from cardCheckTypes.d.ts, which is cardCheckTypes.ts as is.
 */
export function indexDts(api: string): string {
  const imports = api.match(CARD_CHECK_TYPES_IMPORT)?.length ?? 0;
  if (imports === 0) {
    throw new Error('api.ts no longer imports "./cardCheckTypes"');
  }
  return `${api.replace(CARD_CHECK_TYPES_IMPORT, 'from "./cardCheckTypes.js";')}
/** Configure where assets/ is served, then load the renderer. Call once. */
export declare function loadCosmeticPreview(
  options: LoadCosmeticPreviewOptions,
): Promise<CosmeticPreviewModule>;

/** Files under assets/ the host must serve at \`\${assetBase}/\${path}\`. */
export declare const PREVIEW_ASSET_PATHS: readonly string[];
`;
}

/**
 * checks.d.ts: the DOM-free entry (src/client/cosmetic-preview/checks.ts). Its
 * card types come from cardCheckTypes.d.ts, never index.d.ts, whose renderer
 * types need the DOM lib. Keep it in step with checks.ts's exports.
 */
export const CHECKS_DTS = `import type { CardBackgroundFiles, CardEffect, CardIssue } from "./cardCheckTypes.js";

export type {
  CardBackgroundFiles,
  CardCheckImage,
  CardEffect,
  CardIssue,
  CardIssueCode,
} from "./cardCheckTypes.js";

export declare const CARD_ART_WIDTH: 2800;
export declare const CARD_ART_HEIGHT: 400;
export declare const MAX_SET_BYTES: number;
export declare const MAX_LAYERS: 3;

/** A layer animation as the game's schema accepts it. */
export interface CardLayerAnimation {
  kind: "layers";
  layers: {
    src: string;
    effect: CardEffect;
    period?: number;
    strength?: number;
    min?: number;
    max?: number;
    angle?: number;
    rate?: "low" | "medium" | "high";
  }[];
}

export type CardAnimationResult =
  | { ok: true; animation: CardLayerAnimation }
  | { ok: false; error: string };

/** Which layer srcs the checks accept, beyond relative catalogue paths. */
export interface LayerSrcOptions {
  /**
   * The origins an https:// layer src may come from, like
   * "https://cdn.example.com" (a bare host gets https:// added; a port must
   * match as written). The src must also be under /cosmetics/. Empty, the
   * default, refuses every https:// src. Relative srcs don't depend on it.
   */
  allowedLayerHosts?: readonly string[];
}

/**
 * Whether \`src\` is a catalogue PNG layer: a relative path, or an https://
 * link from one of \`allowedLayerHosts\`, under /cosmetics/.
 */
export declare function isCatalogueLayerSrc(
  src: unknown,
  options?: LayerSrcOptions,
): boolean;

/**
 * Parse a layer animation with the game's own schema, and check each layer's
 * src as checkCardBackground does.
 */
export declare function parseCardAnimation(
  input: unknown,
  options?: LayerSrcOptions,
): CardAnimationResult;

/**
 * The artist guide's checks, errors first, then warnings, plus a \`layer_src\`
 * error for each layer whose src isn't allowed (see isCatalogueLayerSrc).
 * Check with the srcs that will be stored. Pure.
 *
 * On a server, take each file's \`type\` from the bytes received (sniff the
 * magic number), never from the browser's File.type: that comes from the
 * file name, so a renamed file would pass as a PNG.
 */
export declare function checkCardBackground(
  files: CardBackgroundFiles,
  animation: unknown,
  options?: LayerSrcOptions,
): CardIssue[];
`;
