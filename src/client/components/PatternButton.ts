import { base64url } from "jose";
import { html, LitElement, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Pattern } from "../../core/CosmeticSchemas";
import { PatternDecoder } from "../../core/PatternDecoder";
import { translateText } from "../Utils";

export const BUTTON_WIDTH = 150;

@customElement("pattern-button")
export class PatternButton extends LitElement {
  @property({ type: Object })
  pattern: Pattern | null = null;

  @property({ type: Function })
  onSelect?: (pattern: Pattern | null) => void;

  @property({ type: Function })
  onPurchase?: (pattern: Pattern) => void;

  createRenderRoot() {
    return this;
  }

  private translatePatternName(prefix: string, patternName: string): string {
    const translation = translateText(`${prefix}.${patternName}`);
    if (translation.startsWith(prefix)) {
      return patternName
        .split("_")
        .filter((word) => word.length > 0)
        .map((word) => word[0].toUpperCase() + word.substring(1))
        .join(" ");
    }
    return translation;
  }

  private handleClick() {
    const isDefaultPattern = this.pattern === null;
    if (isDefaultPattern || this.pattern?.product === null) {
      this.onSelect?.(this.pattern);
    }
  }

  private handlePurchase(e: Event) {
    e.stopPropagation();
    if (this.pattern?.product) {
      this.onPurchase?.(this.pattern);
    }
  }

  render() {
    const isDefaultPattern = this.pattern === null;
    const isPurchasable = !isDefaultPattern && this.pattern?.product !== null;

    return html`
      <div
        class="flex flex-col items-center gap-2 p-3 bg-white/10 rounded-lg max-w-[200px]"
      >
        <button
          class="bg-white/90 border-2 border-black/10 rounded-lg p-2 cursor-pointer transition-all duration-200 w-full
                 hover:bg-white hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20
                 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
          ?disabled=${isPurchasable}
          @click=${this.handleClick}
        >
          <div class="text-sm font-bold text-gray-800 mb-2 text-center">
            ${isDefaultPattern
              ? translateText("territory_patterns.pattern.default")
              : this.translatePatternName(
                  "territory_patterns.pattern",
                  this.pattern!.name,
                )}
          </div>
          <div
            class="w-[120px] h-[120px] flex items-center justify-center bg-white rounded p-1 mx-auto"
            style="overflow: hidden;"
          >
            ${renderPatternPreview(
              this.pattern?.pattern ?? null,
              BUTTON_WIDTH,
              BUTTON_WIDTH,
            )}
          </div>
        </button>

        ${isPurchasable
          ? html`
              <button
                class="w-full px-4 py-2 bg-green-500 text-white border-0 rounded-md text-sm font-semibold cursor-pointer transition-colors duration-200
                   hover:bg-green-600"
                @click=${this.handlePurchase}
              >
                ${translateText("territory_patterns.purchase")}
                (${this.pattern!.product!.price})
              </button>
            `
          : null}
      </div>
    `;
  }
}

export function renderPatternPreview(
  pattern: string | null,
  width: number,
  height: number,
): TemplateResult {
  if (pattern === null) {
    return renderBlankPreview(width, height);
  }
  const dataUrl = generatePreviewDataUrl(pattern, width, height);
  return html`<img
    src="${dataUrl}"
    alt="Pattern preview"
    class="w-full h-full object-contain"
    style="image-rendering: pixelated; image-rendering: -moz-crisp-edges; image-rendering: crisp-edges;"
  />`;
}

function renderBlankPreview(width: number, height: number): TemplateResult {
  return html`
    <div
      style="
        display: flex;
        align-items: center;
        justify-content: center;
        height: ${height}px;
        width: ${width}px;
        background-color: #ffffff;
        border-radius: 4px;
        box-sizing: border-box;
        overflow: hidden;
        position: relative;
        border: 1px solid #ccc;
      "
    >
      <div
        style="display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 0; width: calc(100% - 1px); height: calc(100% - 2px); box-sizing: border-box;"
      >
        <div
          style="background-color: #fff; border: 1px solid rgba(0, 0, 0, 0.1); box-sizing: border-box;"
        ></div>
        <div
          style="background-color: #fff; border: 1px solid rgba(0, 0, 0, 0.1); box-sizing: border-box;"
        ></div>
        <div
          style="background-color: #fff; border: 1px solid rgba(0, 0, 0, 0.1); box-sizing: border-box;"
        ></div>
        <div
          style="background-color: #fff; border: 1px solid rgba(0, 0, 0, 0.1); box-sizing: border-box;"
        ></div>
      </div>
    </div>
  `;
}

const patternCache = new Map<string, string>();
const DEFAULT_PATTERN_B64 = "AAAAAA"; // Empty 2x2 pattern
const COLOR_SET = [0, 0, 0, 255]; // Black
const COLOR_UNSET = [255, 255, 255, 255]; // White
function generatePreviewDataUrl(
  pattern?: string,
  width?: number,
  height?: number,
): string {
  pattern ??= DEFAULT_PATTERN_B64;
  const patternLookupKey = `${pattern}-${width}-${height}`;

  if (patternCache.has(patternLookupKey)) {
    return patternCache.get(patternLookupKey)!;
  }

  // Calculate canvas size
  let decoder: PatternDecoder;
  try {
    decoder = new PatternDecoder(pattern, base64url.decode);
  } catch (e) {
    console.error("Error decoding pattern", e);
    return "";
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

  // Create the canvas
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context not supported");

  // Create an image
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgba = decoder.isSet(x, y) ? COLOR_SET : COLOR_UNSET;
      data[i++] = rgba[0]; // Red
      data[i++] = rgba[1]; // Green
      data[i++] = rgba[2]; // Blue
      data[i++] = rgba[3]; // Alpha
    }
  }

  // Create a data URL
  ctx.putImageData(imageData, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  patternCache.set(patternLookupKey, dataUrl);
  return dataUrl;
}
