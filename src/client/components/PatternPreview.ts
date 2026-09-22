import { Colord } from "colord";
import { base64url } from "jose";
import { html, LitElement, PropertyValues, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { DefaultPattern } from "../../core/CosmeticSchemas";
import { PatternDecoder } from "../../core/PatternDecoder";
import { PlayerPattern } from "../../core/Schemas";
import { translateText } from "../Utils";

export function renderPatternPreview(
  pattern: PlayerPattern | null,
  width: number,
  height: number,
): TemplateResult {
  if (pattern === null) {
    return renderBlankPreview();
  }
  return html`<pattern-preview-canvas
    .pattern=${pattern}
    .targetWidth=${width}
    .targetHeight=${height}
  ></pattern-preview-canvas>`;
}

/**
 * Paints straight into its own canvas rather than a PNG data URL, so a grid
 * of these never pays for an encode and keeps nothing alive once removed.
 */
@customElement("pattern-preview-canvas")
export class PatternPreviewCanvas extends LitElement {
  @property({ attribute: false }) pattern!: PlayerPattern;
  @property({ attribute: false }) targetWidth = 150;
  @property({ attribute: false }) targetHeight = 150;

  private paintedKey: string | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.classList.add("block", "h-full", "w-full");
    // Reconnecting doesn't re-render, but disconnecting released the pixels.
    if (this.hasUpdated) this.paint();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // WebKit keeps a canvas's backing store until it is resized to nothing,
    // even once detached, and iOS caps total canvas memory per page.
    const canvas = this.querySelector("canvas");
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    this.paintedKey = null;
  }

  render() {
    return html`<canvas
      role="img"
      aria-label=${translateText("cosmetics.pattern_preview")}
      class="w-full h-full object-contain [image-rendering:pixelated] pointer-events-none"
    ></canvas>`;
  }

  protected updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    this.paint();
  }

  private paint(): void {
    const canvas = this.querySelector("canvas");
    const key = previewKey(this.pattern, this.targetWidth, this.targetHeight);
    if (canvas === null || key === this.paintedKey) return;
    this.paintedKey = paintPattern(
      canvas,
      this.pattern,
      this.targetWidth,
      this.targetHeight,
    )
      ? key
      : null;
  }
}

function renderBlankPreview(): TemplateResult {
  return html`
    <div
      class="md:hidden flex items-center justify-center h-full w-full bg-white rounded overflow-hidden relative border border-[#ccc] box-border"
    >
      <div
        class="grid grid-cols-2 grid-rows-2 gap-0 w-[calc(100%-1px)] h-[calc(100%-2px)] box-border"
      >
        <div class="bg-white border border-black/10 box-border"></div>
        <div class="bg-white border border-black/10 box-border"></div>
        <div class="bg-white border border-black/10 box-border"></div>
        <div class="bg-white border border-black/10 box-border"></div>
      </div>
    </div>
    <div
      class="hidden md:flex items-center justify-center h-full w-full rounded overflow-hidden relative text-center p-1"
    >
      <span
        class="text-[10px] font-black text-white/40 uppercase leading-none break-words w-full"
      >
        ${translateText("territory_patterns.select_skin")}
      </span>
    </div>
  `;
}

const patternCache = new Map<string, string>();
const DEFAULT_PRIMARY = new Colord("#ffffff").toRgb();
const DEFAULT_SECONDARY = new Colord("#000000").toRgb();

function previewKey(
  pattern: PlayerPattern,
  width: number | undefined,
  height: number | undefined,
): string {
  return [
    pattern.name,
    pattern.patternData,
    pattern.colorPalette?.primaryColor ?? "undefined",
    pattern.colorPalette?.secondaryColor ?? "undefined",
    width,
    height,
  ].join("-");
}

/**
 * Sizes `canvas` to the largest whole number of pattern tiles that fits
 * width × height (one tile at minimum; the tile's own size when a dimension
 * is omitted) and paints the pattern into it. False if the data won't decode.
 */
function paintPattern(
  canvas: HTMLCanvasElement,
  pattern: PlayerPattern,
  width?: number,
  height?: number,
): boolean {
  let decoder: PatternDecoder;
  try {
    decoder = new PatternDecoder(
      {
        name: pattern.name,
        patternData: pattern.patternData,
        colorPalette: pattern.colorPalette,
      },
      base64url.decode,
    );
  } catch (e) {
    console.error("Error decoding pattern", e);
    canvas.width = 0;
    canvas.height = 0;
    return false;
  }

  const scaledWidth = decoder.scaledWidth();
  const scaledHeight = decoder.scaledHeight();

  width =
    width === undefined
      ? scaledWidth
      : Math.max(1, Math.floor(width / scaledWidth)) * scaledWidth;
  height =
    height === undefined
      ? scaledHeight
      : Math.max(1, Math.floor(height / scaledHeight)) * scaledHeight;

  canvas.width = width;
  canvas.height = height;
  // CPU-backed: painted once and never animated, and on a GPU-backed canvas
  // toDataURL is a synchronous GPU readback.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D context not supported");

  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  const primary = pattern.colorPalette?.primaryColor
    ? new Colord(pattern.colorPalette.primaryColor).toRgb()
    : DEFAULT_PRIMARY;
  const secondary = pattern.colorPalette?.secondaryColor
    ? new Colord(pattern.colorPalette.secondaryColor).toRgb()
    : DEFAULT_SECONDARY;
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgba = decoder.isPrimary(x, y) ? primary : secondary;
      data[i++] = rgba.r;
      data[i++] = rgba.g;
      data[i++] = rgba.b;
      data[i++] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return true;
}

export function generatePreviewDataUrl(
  pattern?: PlayerPattern,
  width?: number,
  height?: number,
): string {
  pattern ??= DefaultPattern;
  const key = previewKey(pattern, width, height);
  const cached = patternCache.get(key);
  if (cached !== undefined) return cached;

  const canvas = document.createElement("canvas");
  if (!paintPattern(canvas, pattern, width, height)) return "";
  const dataUrl = canvas.toDataURL("image/png");
  patternCache.set(key, dataUrl);
  return dataUrl;
}
