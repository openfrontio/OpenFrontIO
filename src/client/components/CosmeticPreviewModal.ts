import { html, LitElement, nothing, PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ColorPalette, Pattern } from "../../core/CosmeticSchemas";
import {
  getCachedCosmetics,
  ResolvedCosmetic,
  translateCosmetic,
} from "../Cosmetics";
import { translateText } from "../Utils";
import {
  cosmeticDisplayName,
  cosmeticRarityLabel,
} from "./CosmeticPresentation";
import "./cosmetics/CosmeticRenderCanvas";

/**
 * CosmeticPreviewModal — fullscreen interactive preview dialog for store cosmetics.
 *
 * Features:
 * - Real-time WebGL2 rendering of selected skins, structures, trails, and explosions.
 * - Strict catalog lookup: only displays palette variants authored for that particular skin in JSON.
 * - Backdrop click & Escape key dismissal.
 */
@customElement("cosmetic-preview-modal")
export class CosmeticPreviewModal extends LitElement {
  @property({ attribute: false })
  resolved: ResolvedCosmetic | null = null;

  @state()
  private selectedPrimary: string = "#3b82f6";

  @state()
  private selectedSecondary: string = "#1d4ed8";

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.onKeyDown);
    super.disconnectedCallback();
  }

  private getAvailablePalettes(): ColorPalette[] {
    if (!this.resolved || this.resolved.type !== "pattern") return [];
    const pattern = this.resolved.cosmetic as Pattern | null;
    if (!pattern) return [];
    const catalog = getCachedCosmetics();
    const palettes: ColorPalette[] = [];
    const seen = new Set<string>();

    if (this.resolved.colorPalette) {
      palettes.push(this.resolved.colorPalette);
      seen.add(this.resolved.colorPalette.name);
    }

    if (pattern.colorPalettes && catalog?.colorPalettes) {
      for (const cp of pattern.colorPalettes) {
        if (cp.isArchived) continue;
        if (seen.has(cp.name)) continue;
        const pal = catalog.colorPalettes[cp.name];
        if (pal) {
          palettes.push(pal);
          seen.add(cp.name);
        }
      }
    }
    return palettes;
  }

  updated(changedProps: PropertyValues) {
    super.updated(changedProps);
    if (changedProps.has("resolved") && this.resolved) {
      if (this.resolved.colorPalette) {
        this.selectedPrimary = this.resolved.colorPalette.primaryColor;
        this.selectedSecondary = this.resolved.colorPalette.secondaryColor;
      } else {
        const available = this.getAvailablePalettes();
        if (available.length > 0) {
          this.selectedPrimary = available[0].primaryColor;
          this.selectedSecondary = available[0].secondaryColor;
        } else {
          this.selectedPrimary = "#3b82f6";
          this.selectedSecondary = "#1d4ed8";
        }
      }
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      this.close();
    }
  };

  private selectPalette(primary: string, secondary: string): void {
    this.selectedPrimary = primary;
    this.selectedSecondary = secondary;
  }

  close(): void {
    this.resolved = null;
    this.dispatchEvent(new CustomEvent("close-preview", { bubbles: true }));
  }

  render() {
    if (!this.resolved) {
      return nothing;
    }

    const name = cosmeticDisplayName(this.resolved);
    const rarityLabel = cosmeticRarityLabel(this.resolved);
    const palettes = this.getAvailablePalettes();

    return html`<div
      data-cosmetic-preview-modal
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200"
      @click=${(e: MouseEvent) => {
        if (e.target === e.currentTarget) this.close();
      }}
    >
      <div
        class="relative flex flex-col w-full max-w-2xl h-[540px] max-h-[90vh] rounded-2xl bg-zinc-900 border border-white/15 shadow-2xl overflow-hidden"
      >
        <!-- Header -->
        <div
          class="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-zinc-900/90"
        >
          <div class="flex items-center gap-3">
            <h2 class="text-lg font-bold text-white tracking-wide">${name}</h2>
            <span
              class="rounded-full px-2.5 py-0.5 text-xs font-black uppercase tracking-wider bg-white/10 text-white/80 border border-white/20"
            >
              ${rarityLabel}
            </span>
          </div>
          <button
            type="button"
            aria-label=${translateText("common.close")}
            title=${translateText("common.close")}
            class="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/70 hover:bg-white/15 hover:text-white transition-colors"
            @click=${() => this.close()}
          >
            ✕
          </button>
        </div>

        <!-- WebGL Canvas Viewport -->
        <div class="flex-1 p-4 bg-zinc-950/60 min-h-0">
          <cosmetic-render-canvas
            .resolved=${this.resolved}
            .customColors=${this.resolved.type === "skin" ||
            this.resolved.type === "pattern"
              ? [this.selectedPrimary, this.selectedSecondary]
              : null}
            class="block h-full w-full"
          ></cosmetic-render-canvas>
        </div>

        <!-- Skin / Pattern Color Customizer (Only Palettes Specified in JSON) -->
        ${palettes.length > 1
          ? html`
              <div
                class="flex items-center justify-between gap-3 px-6 py-2 border-t border-white/10 bg-zinc-900/80 text-xs text-white/80"
              >
                <div class="flex items-center gap-3">
                  <span class="font-bold text-white/70"
                    >${translateText("cosmetics.color_label")}</span
                  >
                  <div
                    class="flex items-center gap-2.5 p-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-w-[380px] sm:max-w-none"
                  >
                    ${palettes.map((p) => {
                      const label = translateCosmetic(
                        "territory_patterns.color_palette",
                        p.name,
                      );
                      const isSelected =
                        this.selectedPrimary === p.primaryColor &&
                        this.selectedSecondary === p.secondaryColor;
                      return html`
                        <button
                          type="button"
                          title=${label}
                          aria-label=${label}
                          class="group relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/40 overflow-hidden transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer ${isSelected
                            ? "ring-2 ring-cyan-400 ring-offset-2 ring-offset-zinc-900 border-white"
                            : ""}"
                          @click=${() =>
                            this.selectPalette(
                              p.primaryColor,
                              p.secondaryColor,
                            )}
                        >
                          <div
                            class="w-full h-full"
                            style="background-image: linear-gradient(135deg, ${p.primaryColor} 0 calc(50% - 0.5px), rgba(255,255,255,0.55) calc(50% - 0.5px) calc(50% + 0.5px), ${p.secondaryColor} calc(50% + 0.5px) 100%);"
                          ></div>
                        </button>
                      `;
                    })}
                  </div>
                </div>
              </div>
            `
          : nothing}

        <!-- Footer -->
        <div
          class="flex items-center justify-between px-6 py-3 border-t border-white/10 bg-zinc-900/60 text-xs text-white/60"
        >
          <span>${translateText("store.preview_interactive_hint")}</span>
          <button
            type="button"
            class="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 font-bold text-white transition-colors shadow-md shadow-cyan-950"
            @click=${() => this.close()}
          >
            ${translateText("common.close")}
          </button>
        </div>
      </div>
    </div>`;
  }
}
