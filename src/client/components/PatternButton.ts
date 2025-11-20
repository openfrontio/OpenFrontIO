import { Colord } from "colord";
import { base64url } from "jose";
import { html, LitElement, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  ColorPalette,
  DefaultPattern,
  Pattern,
} from "../../core/CosmeticSchemas";
import { PatternDecoder } from "../../core/PatternDecoder";
import { PlayerPattern } from "../../core/Schemas";
import { translateText } from "../Utils";

export const BUTTON_WIDTH = 150;

@customElement("pattern-button")
export class PatternButton extends LitElement {
  @property({ type: Object })
  pattern: Pattern | null = null;

  @property({ type: Object })
  colorPalette: ColorPalette | null = null;

  @property({ type: Boolean })
  requiresPurchase: boolean = false;

  @property({ type: Function })
  onSelect?: (pattern: PlayerPattern | null) => void;

  @property({ type: Function })
  onPurchase?: (pattern: Pattern, colorPalette: ColorPalette | null) => void;

  createRenderRoot() {
    return this;
  }

  private translateCosmetic(prefix: string, patternName: string): string {
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
    if (this.pattern === null) {
      this.onSelect?.(null);
      return;
    }
    this.onSelect?.({
      name: this.pattern!.name,
      patternData: this.pattern!.pattern,
      colorPalette: this.colorPalette ?? undefined,
    } satisfies PlayerPattern);
  }

  private handlePurchase(e: Event) {
    e.stopPropagation();
    if (this.pattern?.product) {
      this.onPurchase?.(this.pattern, this.colorPalette ?? null);
    }
  }

  render() {
    const isDefaultPattern = this.pattern === null;

    return html`
      <div
        class="flex flex-col items-center gap-1 p-1 bg-white/10 rounded-lg max-w-[200px]"
      >
        <button
          class="bg-white/90 border-2 border-black/10 rounded-lg cursor-pointer transition-all duration-200 w-full
                 hover:bg-white hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20
                 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
          ?disabled=${this.requiresPurchase}
          @click=${this.handleClick}
        >
          <div class="text-sm font-bold text-gray-800 mb-1 text-center">
            ${isDefaultPattern
              ? translateText("territory_patterns.pattern.default")
              : this.translateCosmetic(
                  "territory_patterns.pattern",
                  this.pattern!.name,
                )}
          </div>
          ${this.colorPalette !== null
            ? html`
                <div class="text-xs font-bold text-gray-800 mb-1 text-center">
                  ${this.translateCosmetic(
                    "territory_patterns.color_palette",
                    this.colorPalette!.name,
                  )}
                </div>
              `
            : null}
          <div
            class="w-[120px] h-[120px] flex items-center justify-center bg-white rounded p-1 mx-auto"
            style="overflow: hidden;"
          >
            ${renderPatternPreview(
              this.pattern !== null
                ? ({
                    name: this.pattern!.name,
                    patternData: this.pattern!.pattern,
                    colorPalette: this.colorPalette ?? undefined,
                  } satisfies PlayerPattern)
                : DefaultPattern,
              BUTTON_WIDTH,
              BUTTON_WIDTH,
            )}
          </div>
        </button>

        ${this.requiresPurchase
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
  pattern: PlayerPattern | null,
  width: number,
  height: number,
): TemplateResult {
  if (pattern === null) {
    return renderBlankPreview(width, height);
  }
  return html`<img
    src="${generatePreviewDataUrl(pattern, width, height)}"
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
const DEFAULT_PRIMARY = new Colord("#ffffff").toRgb(); // White
const DEFAULT_SECONDARY = new Colord("#000000").toRgb(); // Black
function generatePreviewDataUrl(
  pattern?: PlayerPattern,
  width?: number,
  height?: number,
): string {
  pattern ??= DefaultPattern;
  const patternLookupKey = [
    pattern.name,
    pattern.colorPalette?.primaryColor ?? "undefined",
    pattern.colorPalette?.secondaryColor ?? "undefined",
    width,
    height,
  ].join("-");

  if (patternCache.has(patternLookupKey)) {
    return patternCache.get(patternLookupKey)!;
  }

  // Calculate canvas size
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
      data[i++] = 255; // Alpha
    }
  }

  // Create a data URL
  ctx.putImageData(imageData, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  patternCache.set(patternLookupKey, dataUrl);
  return dataUrl;
}
