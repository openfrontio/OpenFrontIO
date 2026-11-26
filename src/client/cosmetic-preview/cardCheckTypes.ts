// The card background check types, shared by both of
// @openfront/cosmetic-preview's entries. Types only, no imports, and nothing
// from the DOM: scripts/buildCosmeticPreview.ts ships this file as is as
// cardCheckTypes.d.ts, which the DOM-free checks entry imports, so a server
// with no DOM lib can compile against it.

export type CardEffect = "pulse" | "shimmer" | "flicker" | "drift";

/**
 * Decoded pixels: an ImageData, or anything shaped like one, such as a
 * decoder's Node Buffer.
 */
export interface CardCheckImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes a pixel, row by row. */
  data: Uint8ClampedArray | Uint8Array;
}

export interface CardBackgroundFiles {
  /**
   * `type` is the file's MIME type, `bytes` its size. A host's server must
   * take `type` from the bytes it received (their magic number), not forward
   * the browser's File.type, which comes from the file name.
   */
  base: { image: CardCheckImage; type: string; bytes: number };
  /** In the order the animation lists them. Each must be an image/png. */
  layers: {
    effect: CardEffect;
    image: CardCheckImage;
    type: string;
    bytes: number;
  }[];
}

export type CardIssueCode =
  /** The files given aren't shaped as CardBackgroundFiles. */
  | "files_invalid"
  | "base_size"
  | "base_format"
  | "layer_size"
  /** A layer file isn't an image/png. */
  | "layer_format"
  | "too_many_layers"
  | "animation_not_layers"
  | "animation_invalid"
  /** The animation lists a different number of layers than the files, or there is none. */
  | "layer_count_mismatch"
  | "layer_effect_mismatch"
  /** A layer src isn't a catalogue PNG path or https:// link (checks entry only). */
  | "layer_src"
  | "layer_opaque"
  | "set_too_large"
  | "animated_area"
  | "busy_under_name"
  | "drift_seam";

/** One problem with a card background. The host writes the words. */
export interface CardIssue {
  code: CardIssueCode;
  /** Errors block submitting; warnings don't. */
  level: "error" | "warning";
  /** Which layer (0-based), for a layer's own issue. */
  layer?: number;
  params?: Record<string, string | number>;
}
