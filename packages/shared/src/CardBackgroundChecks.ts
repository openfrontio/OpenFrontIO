import { z } from "zod/v4";
import {
  type FxEffect,
  FX_DEFAULTS,
  type LayerAnimation,
  LayerAnimationSchema,
} from "./CardBackgroundAnimation";

// The checks an artist's card background must pass before it's submitted,
// from the Animated Card Backgrounds artist guide. Pure: the dashboard's
// previewer (through @openfront/cosmetic-preview) decodes the files and hands
// over their pixels, so a rule change here reaches it on the next re-vendor.
//
// Issues carry a code and numbers, never text: the host writes the words.

// Background art is drawn at this size and exported in place.
export const CARD_ART_WIDTH = 2800;
export const CARD_ART_HEIGHT = 400;
// "Whole set under about 600 KB."
export const MAX_SET_BYTES = 600 * 1024;
// "Animated area is about a third of the image or less."
export const MAX_ANIMATED_FRACTION = 1 / 3;
// The dark gradient under the badge and name covers the left 45%.
export const NAME_AREA_FRACTION = 0.45;
export const MAX_LAYERS = 3;

const BASE_TYPES = new Set(["image/webp", "image/jpeg"]);
// A pixel counts as part of a layer from this alpha up: fainter is
// anti-aliasing and export noise, not something a player sees move.
const VISIBLE_ALPHA = 16;
// Bright: a visible pixel at least this luminous (0–255).
const BRIGHT_LUMA = 200;
// More than this share of the name area is "something" there.
const UNDER_NAME_SHARE = 0.01;
// A pulse or shimmer quicker than this many seconds reads as fast.
const FAST_PERIOD_S = 1.5;
// Mean difference per channel (0–255) between a drift layer's left and
// right edge columns above which the loop visibly jumps.
const SEAM_TOLERANCE = 24;

/** Decoded pixels: an ImageData, or anything shaped like one. */
export interface CardCheckImage {
  width: number;
  height: number;
  // RGBA, 4 bytes a pixel, row by row (not premultiplied).
  data: Uint8ClampedArray;
}

export interface CardBackgroundFiles {
  // `type` is the file's MIME type, `bytes` its size on disk.
  base: { image: CardCheckImage; type: string; bytes: number };
  // In the order the animation lists them.
  layers: { effect: FxEffect; image: CardCheckImage; bytes: number }[];
}

export type CardIssueCode =
  | "base_size"
  | "base_format"
  | "layer_size"
  | "too_many_layers"
  | "animation_not_layers"
  | "animation_invalid"
  | "layer_count_mismatch"
  | "layer_effect_mismatch"
  | "layer_opaque"
  | "set_too_large"
  | "animated_area"
  | "busy_under_name"
  | "drift_seam";

export interface CardIssue {
  code: CardIssueCode;
  // Errors block submitting; warnings don't.
  level: "error" | "warning";
  // Which layer (0-based), for a layer's own issue.
  layer?: number;
  params?: Record<string, string | number>;
}

function sizeOk(img: CardCheckImage): boolean {
  return img.width === CARD_ART_WIDTH && img.height === CARD_ART_HEIGHT;
}

function luma(d: Uint8ClampedArray, i: number): number {
  return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
}

function hasTransparency(img: CardCheckImage): boolean {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}

// Whether a drift layer's left edge continues its right edge: drift places
// two copies side by side, so column 0 is drawn right after the last one.
function edgesJoin(img: CardCheckImage): boolean {
  const { width, height, data } = img;
  let diff = 0;
  for (let y = 0; y < height; y++) {
    const l = y * width * 4;
    const r = (y * width + width - 1) * 4;
    // Compare colour weighted by alpha, so two transparent pixels match
    // whatever colour they hold.
    const la = data[l + 3] / 255;
    const ra = data[r + 3] / 255;
    for (let c = 0; c < 3; c++) {
      diff += Math.abs(data[l + c] * la - data[r + c] * ra);
    }
    diff += Math.abs(data[l + 3] - data[r + 3]);
  }
  return diff / (height * 4) <= SEAM_TOLERANCE;
}

function isFast(effect: FxEffect, period: number | undefined): boolean {
  if (effect === "flicker") return true;
  if (effect === "pulse" || effect === "shimmer") {
    return (period ?? FX_DEFAULTS.period) < FAST_PERIOD_S;
  }
  return false;
}

/**
 * Check a card background's files and animation settings against the
 * artist guide. Errors come first, then warnings, each in table order.
 *
 * Not measured here: whether key detail sits inside the centre
 * 1260 × 290 (the small views' crop; the previewer shows it as an overlay)
 * and slow frames (the previewer reports the renderer's stop).
 */
export function checkCardBackground(
  files: CardBackgroundFiles,
  animation: unknown,
): CardIssue[] {
  const issues: CardIssue[] = [];
  const { base, layers } = files;

  // ---- Errors. ----
  if (!sizeOk(base.image)) {
    issues.push({
      code: "base_size",
      level: "error",
      params: { width: base.image.width, height: base.image.height },
    });
  }
  if (!BASE_TYPES.has(base.type)) {
    issues.push({
      code: "base_format",
      level: "error",
      params: { type: base.type },
    });
  }
  layers.forEach((l, i) => {
    if (!sizeOk(l.image)) {
      issues.push({
        code: "layer_size",
        level: "error",
        layer: i,
        params: { width: l.image.width, height: l.image.height },
      });
    }
  });
  if (layers.length > MAX_LAYERS) {
    issues.push({
      code: "too_many_layers",
      level: "error",
      params: { count: layers.length, max: MAX_LAYERS },
    });
  }

  let settings: LayerAnimation | null = null;
  if (animation !== undefined && animation !== null) {
    const kind = (animation as { kind?: unknown }).kind;
    if (kind !== "layers") {
      issues.push({
        code: "animation_not_layers",
        level: "error",
        params: { kind: String(kind) },
      });
    } else {
      const parsed = LayerAnimationSchema.safeParse(animation);
      if (parsed.success) {
        settings = parsed.data;
      } else if (layers.length <= MAX_LAYERS) {
        // Too many layers is already its own error.
        issues.push({
          code: "animation_invalid",
          level: "error",
          params: { details: z.prettifyError(parsed.error) },
        });
      }
    }
  }
  if (settings !== null) {
    if (settings.layers.length !== layers.length) {
      issues.push({
        code: "layer_count_mismatch",
        level: "error",
        params: { files: layers.length, settings: settings.layers.length },
      });
    }
    settings.layers.forEach((s, i) => {
      const file = layers[i];
      if (file !== undefined && file.effect !== s.effect) {
        issues.push({
          code: "layer_effect_mismatch",
          level: "error",
          layer: i,
          params: { file: file.effect, settings: s.effect },
        });
      }
    });
  }
  layers.forEach((l, i) => {
    if (!hasTransparency(l.image)) {
      issues.push({ code: "layer_opaque", level: "error", layer: i });
    }
  });

  // ---- Warnings. ----
  const bytes = base.bytes + layers.reduce((sum, l) => sum + l.bytes, 0);
  if (bytes > MAX_SET_BYTES) {
    issues.push({
      code: "set_too_large",
      level: "warning",
      params: { bytes, max: MAX_SET_BYTES },
    });
  }

  // Only layers the right size can be compared pixel for pixel.
  const sized = layers
    .map((l, i) => ({ ...l, index: i }))
    .filter((l) => sizeOk(l.image));

  if (sized.length > 0) {
    const pixels = CARD_ART_WIDTH * CARD_ART_HEIGHT;
    let animated = 0;
    for (let p = 0; p < pixels; p++) {
      const a = p * 4 + 3;
      if (sized.some((l) => l.image.data[a] >= VISIBLE_ALPHA)) animated++;
    }
    const fraction = animated / pixels;
    // "About" a third: rounding to a whole percent decides.
    const percent = Math.round(fraction * 100);
    if (percent > Math.round(MAX_ANIMATED_FRACTION * 100)) {
      issues.push({
        code: "animated_area",
        level: "warning",
        params: { percent },
      });
    }
  }

  const nameWidth = Math.round(CARD_ART_WIDTH * NAME_AREA_FRACTION);
  for (const l of sized) {
    // A drift slides the whole layer under the name, once a loop.
    const width = l.effect === "drift" ? CARD_ART_WIDTH : nameWidth;
    const area = width * CARD_ART_HEIGHT;
    const d = l.image.data;
    let visible = 0;
    let bright = 0;
    for (let y = 0; y < CARD_ART_HEIGHT; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * CARD_ART_WIDTH + x) * 4;
        if (d[i + 3] < VISIBLE_ALPHA) continue;
        visible++;
        if (d[i + 3] >= 128 && luma(d, i) >= BRIGHT_LUMA) bright++;
      }
    }
    const period = settings?.layers[l.index]?.period;
    const reason =
      bright / area > UNDER_NAME_SHARE
        ? "bright"
        : visible / area > UNDER_NAME_SHARE && isFast(l.effect, period)
          ? "fast"
          : null;
    if (reason !== null) {
      issues.push({
        code: "busy_under_name",
        level: "warning",
        layer: l.index,
        params: { reason },
      });
    }
  }

  for (const l of sized) {
    if (l.effect === "drift" && !edgesJoin(l.image)) {
      issues.push({ code: "drift_seam", level: "warning", layer: l.index });
    }
  }

  return issues;
}
