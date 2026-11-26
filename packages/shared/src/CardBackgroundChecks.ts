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
// Layers keep their alpha, so they are PNGs.
const LAYER_TYPE = "image/png";
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

/**
 * Decoded pixels: an ImageData, or anything shaped like one, such as a
 * decoder's Node Buffer.
 */
export interface CardCheckImage {
  width: number;
  height: number;
  // RGBA, 4 bytes a pixel, row by row (not premultiplied).
  data: Uint8ClampedArray | Uint8Array;
}

export interface CardBackgroundFiles {
  // `type` is the file's MIME type, `bytes` its size on disk. A server takes
  // `type` from the bytes it received (their magic number), never from what
  // the page said: a browser's File.type comes from the file name.
  base: { image: CardCheckImage; type: string; bytes: number };
  // In the order the animation lists them.
  layers: {
    effect: FxEffect;
    image: CardCheckImage;
    type: string;
    bytes: number;
  }[];
}

export type CardIssueCode =
  | "files_invalid"
  | "base_size"
  | "base_format"
  | "layer_size"
  | "layer_format"
  | "too_many_layers"
  | "animation_not_layers"
  | "animation_invalid"
  | "layer_count_mismatch"
  | "layer_effect_mismatch"
  | "layer_src"
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

// Whether `img` is an image whose pixel buffer holds exactly width × height
// pixels. Anything else (no data, a short buffer) is never read pixel by pixel.
function pixelsOk(img: unknown): img is CardCheckImage {
  if (typeof img !== "object" || img === null) return false;
  const { width, height, data } = img as Record<string, unknown>;
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    // A real byte buffer, not anything with a length: a server re-checking
    // what a page sent may get { length: n } from JSON.
    (data instanceof Uint8ClampedArray || data instanceof Uint8Array) &&
    data.length === (width as number) * (height as number) * 4
  );
}

function sizeOk(img: CardCheckImage): boolean {
  return (
    pixelsOk(img) &&
    img.width === CARD_ART_WIDTH &&
    img.height === CARD_ART_HEIGHT
  );
}

// The width and height an image says it has, for a size issue.
function reportedSize(img: unknown): { width: number; height: number } {
  const { width, height } = (img ?? {}) as Partial<CardCheckImage>;
  return {
    width: typeof width === "number" ? width : 0,
    height: typeof height === "number" ? height : 0,
  };
}

// A value from the caller's JSON, as text for an issue's params. Never calls
// the value's own toString, which JSON can set to anything ({"toString":null}).
function asText(v: unknown): string {
  if (typeof v === "string") return v;
  if (
    typeof v === "number" ||
    typeof v === "boolean" ||
    typeof v === "bigint" ||
    v === null ||
    v === undefined
  ) {
    return `${v}`;
  }
  return `[${typeof v}]`;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

// Whether `files` has the shape checkCardBackground reads. The host builds it
// from files it decoded; a server re-checking what a page sent can't assume
// that.
function filesShapeOk(files: unknown): files is CardBackgroundFiles {
  if (!isObject(files) || !isObject(files.base)) return false;
  if (!Array.isArray(files.layers)) return false;
  // An index loop, not every(): every() skips holes, so [ , ] would pass and
  // the checks would then read a layer that isn't there.
  for (let i = 0; i < files.layers.length; i++) {
    if (!isObject(files.layers[i])) return false;
  }
  return true;
}

// A layer's src in a catalogue entry: a PNG at a relative path, like
// /cosmetics/card-backgrounds/bg_neon_grid_fx-drift.png, or the bare file
// name, or an https:// link, as the Assets page hands out for the bucket. A
// link has a host (letters, digits, "." and "-") and an optional port. No
// other scheme, no "//host" without one, no query, fragment, "..", backslash,
// quote, bracket or space: the game loads it as an image and inside a CSS
// url(). infra's LayerSrcSchema uses this same regex.
const CATALOGUE_SRC =
  /^(?:https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?\/|\/)?(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.png$/i;
const MAX_SRC_LENGTH = 200;

// An https:// src must also come from a listed origin, under this path.
const LINK_ORIGIN = /^https:\/\/[^/]+/i;
const LINK_PATH_PREFIX = "/cosmetics/";

export interface LayerSrcOptions {
  /**
   * The origins an https:// layer src may come from, like
   * "https://cdn.example.com" (a bare host gets https:// added; a port must
   * match as written). Empty, the default, refuses every https:// src.
   * Relative srcs don't depend on it.
   */
  allowedLayerHosts?: readonly string[];
}

function normalOrigin(origin: string): string {
  const o = origin.trim().replace(/\/+$/, "").toLowerCase();
  return o.includes("://") ? o : `https://${o}`;
}

/**
 * Whether `src` is a catalogue PNG layer: a relative path, or an https://
 * link from one of `allowedLayerHosts`, under /cosmetics/.
 */
export function isCatalogueLayerSrc(
  src: unknown,
  options: LayerSrcOptions = {},
): boolean {
  if (
    typeof src !== "string" ||
    src.length > MAX_SRC_LENGTH ||
    !CATALOGUE_SRC.test(src)
  ) {
    return false;
  }
  const origin = LINK_ORIGIN.exec(src)?.[0];
  if (origin === undefined) return true;
  const allowed = (options.allowedLayerHosts ?? []).map(normalOrigin);
  return (
    allowed.includes(origin.toLowerCase()) &&
    src.slice(origin.length).startsWith(LINK_PATH_PREFIX)
  );
}

/**
 * The layers of `animation` whose src isn't a catalogue PNG path or allowed
 * link (see isCatalogueLayerSrc), as `layer_src` errors. Not part of
 * checkCardBackground, since the browser previews layers from blob: URLs: the
 * checks entry adds it, for what a host stores or sends on.
 */
export function checkLayerSources(
  animation: unknown,
  options: LayerSrcOptions = {},
): CardIssue[] {
  if (!isObject(animation) || !Array.isArray(animation.layers)) return [];
  const issues: CardIssue[] = [];
  // An index loop, not forEach(): forEach() skips holes, and a hole is a
  // layer with no src.
  for (let i = 0; i < animation.layers.length; i++) {
    const layer: unknown = animation.layers[i];
    const src = isObject(layer) ? layer.src : undefined;
    if (!isCatalogueLayerSrc(src, options)) {
      issues.push({
        code: "layer_src",
        level: "error",
        layer: i,
        params: { src: asText(src).slice(0, MAX_SRC_LENGTH) },
      });
    }
  }
  return issues;
}

function luma(d: CardCheckImage["data"], i: number): number {
  return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
}

function hasTransparency(img: CardCheckImage): boolean {
  // Only an image the right size is read: any other already has its size
  // issue, and its claimed size is not to be trusted (10^5 × 10^5 would take
  // minutes).
  if (!sizeOk(img)) return true;
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
  if (!filesShapeOk(files)) {
    return [{ code: "files_invalid", level: "error" }];
  }
  const issues: CardIssue[] = [];
  const { base, layers } = files;

  // ---- Errors. ----
  if (!sizeOk(base.image)) {
    issues.push({
      code: "base_size",
      level: "error",
      params: reportedSize(base.image),
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
        params: reportedSize(l.image),
      });
    }
    if (l.type !== LAYER_TYPE) {
      issues.push({
        code: "layer_format",
        level: "error",
        layer: i,
        params: { type: asText(l.type) },
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
  if (animation === undefined || animation === null) {
    // Layer files with nothing saying how they move: the game would never
    // draw them, so the set is not what the artist sent.
    if (layers.length > 0) {
      issues.push({
        code: "layer_count_mismatch",
        level: "error",
        params: { files: layers.length, settings: 0 },
      });
    }
  } else {
    const kind = (animation as { kind?: unknown }).kind;
    if (kind !== "layers") {
      issues.push({
        code: "animation_not_layers",
        level: "error",
        params: { kind: asText(kind) },
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
  const size = (b: unknown) => (typeof b === "number" && b > 0 ? b : 0);
  const bytes =
    size(base.bytes) + layers.reduce((sum, l) => sum + size(l.bytes), 0);
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
