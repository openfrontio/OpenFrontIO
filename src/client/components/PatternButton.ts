import { Colord } from "colord";
import { base64url } from "jose";
import { html, LitElement, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  ColorPalette,
  DefaultPattern,
  Pattern,
} from "../../core/CosmeticSchemas";
import { UserSettings } from "../../core/game/UserSettings";
import { PatternDecoder } from "../../core/PatternDecoder";
import { PlayerPattern } from "../../core/Schemas";
import { grantTemporaryFlare } from "../Api";
import { showRewardedAd } from "../RewardedVideoPromo";
import { translateText } from "../Utils";

export const BUTTON_WIDTH = 150;

@customElement("pattern-button")
export class PatternButton extends LitElement {
  @property({ type: Boolean })
  selected: boolean = false;
  @property({ type: Object })
  pattern: Pattern | null = null;

  @property({ type: Object })
  colorPalette: ColorPalette | null = null;

  @property({ type: Boolean })
  requiresPurchase: boolean = false;

  @property({ type: Number })
  trialTimeRemaining: number = 0;

  @property({ type: Boolean })
  allowTrial: boolean = true;

  @property({ type: Boolean })
  trialCooldown: boolean = false;

  @property({ type: Boolean })
  hasLinkedAccount: boolean = false;

  @property({ type: Function })
  onSelect?: (pattern: PlayerPattern | null) => void;

  @property({ type: Function })
  onPurchase?: (pattern: Pattern, colorPalette: ColorPalette | null) => void;

  private _countdownInterval: ReturnType<typeof setInterval> | null = null;

  @state()
  private _adLoading: boolean = false;

  createRenderRoot() {
    return this;
  }

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("trialTimeRemaining")) {
      this.setupCountdown();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.clearCountdown();
  }

  private setupCountdown() {
    this.clearCountdown();
    if (this.trialTimeRemaining > 0) {
      this._countdownInterval = setInterval(() => {
        this.trialTimeRemaining--;
        if (this.trialTimeRemaining <= 0) {
          this.trialTimeRemaining = 0;
          this.clearCountdown();
        }
      }, 1000);
    }
  }

  private clearCountdown() {
    if (this._countdownInterval !== null) {
      clearInterval(this._countdownInterval);
      this._countdownInterval = null;
    }
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

  private async grantTrial() {
    const flare =
      this.colorPalette?.name === undefined
        ? `pattern:${this.pattern!.name}`
        : `pattern:${this.pattern!.name}:${this.colorPalette.name}`;
    await grantTemporaryFlare(flare);
    new UserSettings().setSelectedPatternName(flare);
    alert(translateText("territory_patterns.trial_granted"));
    window.location.reload();
  }

  private showSteamModal(): Promise<void> {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className =
        "fixed inset-0 bg-black/80 flex items-center justify-center z-[9999]";

      let secondsLeft = 10;
      const updateContent = () => {
        overlay.innerHTML = `
          <div class="bg-slate-900 border border-white/20 rounded-xl p-8 max-w-md text-center">
            <h2 class="text-2xl font-bold text-white mb-4">Wishlist on Steam!</h2>
            <p class="text-white/70 mb-6">${translateText("territory_patterns.steam_wishlist_prompt")}</p>
            <a
              href="https://store.steampowered.com/app/3560670"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-block px-6 py-3 bg-[#1b2838] hover:bg-[#2a475e] text-white font-bold rounded-lg mb-6 transition-colors"
            >
              <span class="flex items-center gap-2">
                <svg class="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658a3.387 3.387 0 0 1 1.912-.59c.064 0 .128.003.191.006l2.866-4.158v-.058c0-2.495 2.03-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.091 2.921c0 .054.003.108.003.163 0 1.871-1.523 3.393-3.394 3.393-1.646 0-3.02-1.179-3.33-2.74L.453 15.406C1.727 20.279 6.228 24 11.979 24 18.627 24 24 18.627 24 12S18.627 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012zm11.415-9.303a3.015 3.015 0 0 0-3.015-3.015 3.015 3.015 0 1 0 3.015 3.015zm-5.273-.005c0-1.248 1.013-2.26 2.262-2.26a2.26 2.26 0 1 1 0 4.52 2.261 2.261 0 0 1-2.262-2.26z"/>
                </svg>
                Wishlist on Steam
              </span>
            </a>
            <div class="text-white/50 text-sm">
              ${translateText("territory_patterns.reward_countdown", { seconds: secondsLeft.toString() })}
            </div>
          </div>
        `;
      };

      updateContent();
      document.body.appendChild(overlay);

      const interval = setInterval(() => {
        secondsLeft--;
        if (secondsLeft <= 0) {
          clearInterval(interval);
          overlay.remove();
          resolve();
        } else {
          updateContent();
        }
      }, 1000);
    });
  }

  private async handleTryMe(e: Event) {
    e.stopPropagation();
    if (this.pattern === null || this._adLoading) return;

    if (!this.hasLinkedAccount) {
      alert(translateText("territory_patterns.trial_login_required"));
      return;
    }

    if (this.trialCooldown) {
      alert(translateText("territory_patterns.trial_cooldown"));
      return;
    }

    console.log("[PatternButton] handleTryMe called");
    this._adLoading = true;

    try {
      console.log("[PatternButton] Calling showRewardedAd...");
      await showRewardedAd();
      console.log("[PatternButton] showRewardedAd resolved");
      await this.grantTrial();
    } catch (error) {
      console.error("[PatternButton] Rewarded ad failed:", error);
      // Show Steam wishlist modal with countdown
      await this.showSteamModal();
      await this.grantTrial();
    } finally {
      this._adLoading = false;
    }
  }

  private formatTimeRemaining(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
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
        class="no-crazygames flex flex-col items-center justify-between gap-2 p-3 bg-white/5 backdrop-blur-sm border rounded-xl w-48 h-full transition-all duration-200 ${this
          .selected
          ? "border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.5)]"
          : "hover:bg-white/10 hover:border-white/20 hover:shadow-xl border-white/10"}"
      >
        <button
          class="group relative flex flex-col items-center w-full gap-2 rounded-lg cursor-pointer transition-all duration-200
                 disabled:cursor-not-allowed flex-1"
          ?disabled=${this.requiresPurchase}
          @click=${this.handleClick}
        >
          <div class="flex flex-col items-center w-full">
            <div
              class="text-xs font-bold text-white uppercase tracking-wider mb-1 text-center truncate w-full ${this
                .requiresPurchase
                ? "opacity-50"
                : ""}"
              title="${isDefaultPattern
                ? translateText("territory_patterns.pattern.default")
                : this.translateCosmetic(
                    "territory_patterns.pattern",
                    this.pattern!.name,
                  )}"
            >
              ${isDefaultPattern
                ? translateText("territory_patterns.pattern.default")
                : this.translateCosmetic(
                    "territory_patterns.pattern",
                    this.pattern!.name,
                  )}
            </div>
            ${this.colorPalette !== null
              ? html`
                  <div
                    class="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2 text-center truncate w-full ${this
                      .requiresPurchase
                      ? "opacity-50"
                      : ""}"
                  >
                    ${this.translateCosmetic(
                      "territory_patterns.color_palette",
                      this.colorPalette!.name,
                    )}
                  </div>
                `
              : html`<div class="h-[22px] mb-2 w-full"></div>`}
          </div>

          <div
            class="w-full aspect-square flex items-center justify-center bg-white/5 rounded-lg p-2 border border-white/10 group-hover:border-white/20 transition-colors duration-200 overflow-hidden"
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

        ${(this.requiresPurchase || this.trialTimeRemaining > 0) &&
        this.pattern?.product
          ? html`
              <div class="w-full mt-2 flex flex-col gap-2">
                ${this.trialTimeRemaining > 0
                  ? html`
                      <div
                        class="w-full px-4 py-2 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-lg text-xs font-bold uppercase tracking-wider text-center"
                      >
                        ${this.formatTimeRemaining(this.trialTimeRemaining)}
                        ${translateText("territory_patterns.trial_remaining")}
                      </div>
                    `
                  : this.allowTrial
                    ? html`
                        <button
                          class="w-full px-4 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition-all duration-200
                           hover:bg-blue-500/30 hover:shadow-[0_0_15px_rgba(59,130,246,0.2)] flex items-center justify-center gap-2"
                          @click=${this.handleTryMe}
                          ?disabled=${this._adLoading}
                        >
                          ${this._adLoading
                            ? html`<svg
                                class="animate-spin h-4 w-4"
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                              >
                                <circle
                                  class="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  stroke-width="4"
                                ></circle>
                                <path
                                  class="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                ></path>
                              </svg>`
                            : translateText("territory_patterns.try_me")}
                        </button>
                      `
                    : null}
                <button
                  class="w-full px-4 py-2 bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition-all duration-200
                   hover:bg-green-500/30 hover:shadow-[0_0_15px_rgba(74,222,128,0.2)]"
                  @click=${this.handlePurchase}
                >
                  ${translateText("territory_patterns.purchase")}
                  <span class="ml-1 text-white/60"
                    >(${this.pattern.product.price})</span
                  >
                </button>
              </div>
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
    class="w-full h-full object-contain [image-rendering:pixelated]"
  />`;
}

function renderBlankPreview(width: number, height: number): TemplateResult {
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
