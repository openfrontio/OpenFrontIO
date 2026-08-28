import { colord } from "colord";
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

export const TEAM_COLORS = [
  { name: "Red", hex: "#eb3333" },
  { name: "Blue", hex: "#2962ff" },
  { name: "Teal", hex: "#2bd4bd" },
  { name: "Purple", hex: "#9234ea" },
  { name: "Yellow", hex: "#e7b008" },
  { name: "Orange", hex: "#f97415" },
  { name: "Green", hex: "#41be52" },
];

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
    // Capture phase so this runs before the parent Store/Inventory modal's
    // own window-level Escape handler (BaseModal), which would otherwise
    // close the parent along with the preview.
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    super.disconnectedCallback();
  }

  private getAvailablePalettes(): ColorPalette[] {
    if (!this.resolved) return [];

    if (this.resolved.type === "skin") {
      return [
        {
          name: "Default",
          primaryColor: "default",
          secondaryColor: "default",
        },
        ...TEAM_COLORS.map((tc) => ({
          name: tc.name,
          primaryColor: tc.hex,
          secondaryColor: tc.hex,
        })),
      ];
    }

    if (this.resolved.type === "pattern") {
      const pattern = this.resolved.cosmetic as Pattern | null;
      const catalog = getCachedCosmetics();
      const palettes: ColorPalette[] = [];
      const seen = new Set<string>();

      if (this.resolved.colorPalette) {
        palettes.push(this.resolved.colorPalette);
        seen.add(this.resolved.colorPalette.name);
      }

      if (pattern?.colorPalettes && catalog?.colorPalettes) {
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

      // Add the 7 team colors for pattern skins
      for (const tc of TEAM_COLORS) {
        const secondary = colord(tc.hex).darken(0.125).toHex();
        palettes.push({
          name: tc.name,
          primaryColor: tc.hex,
          secondaryColor: secondary,
        });
      }

      return palettes;
    }

    return [];
  }

  updated(changedProps: PropertyValues) {
    super.updated(changedProps);
    if (changedProps.has("resolved") && this.resolved) {
      if (this.resolved.type === "skin") {
        this.selectedPrimary = "default";
        this.selectedSecondary = "default";
      } else if (this.resolved.colorPalette) {
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
    if (e.key === "Escape" && this.resolved) {
      e.stopImmediatePropagation();
      e.preventDefault();
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
    const artist = (this.resolved.cosmetic as { artist?: string } | null)
      ?.artist;

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
            ${artist
              ? html`<span class="text-xs text-white/60">
                  ${translateText("cosmetics.artist_label")}
                  <span class="text-white/90 font-medium">${artist}</span>
                </span>`
              : nothing}
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
            .customColors=${this.resolved.type === "skin"
              ? this.selectedPrimary === "default"
                ? null
                : [this.selectedPrimary]
              : this.resolved.type === "pattern"
                ? [this.selectedPrimary, this.selectedSecondary]
                : null}
            class="block h-full w-full"
          ></cosmetic-render-canvas>
        </div>

        <!-- Skin / Pattern Color Customizer (Only Palettes Specified in JSON + Team Colors for Skins) -->
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
                    ${palettes.map((p, idx) => {
                      const isDefault = p.name === "Default";
                      const isTeam = TEAM_COLORS.some(
                        (tc) => tc.name === p.name,
                      );
                      const isFirstTeam =
                        isTeam &&
                        idx > 0 &&
                        !TEAM_COLORS.some(
                          (tc) => tc.name === palettes[idx - 1].name,
                        );
                      const label = isDefault
                        ? translateText("territory_patterns.pattern.default")
                        : isTeam
                          ? translateText(`team_colors.${p.name.toLowerCase()}`)
                          : translateCosmetic(
                              "territory_patterns.color_palette",
                              p.name,
                            );
                      const isSelected =
                        this.selectedPrimary === p.primaryColor &&
                        this.selectedSecondary === p.secondaryColor;
                      return html`
                        ${isFirstTeam
                          ? html`<div
                              class="h-5 w-px bg-white/20 mx-0.5 shrink-0"
                              role="separator"
                            ></div>`
                          : nothing}
                        ${this.resolved?.type === "skin" && isDefault
                          ? html`
                              <button
                                type="button"
                                title=${translateText(
                                  "territory_patterns.pattern.default",
                                )}
                                aria-label=${translateText(
                                  "territory_patterns.pattern.default",
                                )}
                                class="group relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer ${isSelected
                                  ? "ring-2 ring-cyan-400 ring-offset-2 ring-offset-zinc-900 border-white bg-white/25 text-white shadow-sm"
                                  : "border-white/30 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"}"
                                @click=${() =>
                                  this.selectPalette(
                                    p.primaryColor,
                                    p.secondaryColor,
                                  )}
                              >
                                <svg
                                  class="w-3.5 h-3.5"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2.5"
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                >
                                  <path
                                    d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
                                  />
                                  <path d="M3 3v5h5" />
                                </svg>
                              </button>
                            `
                          : html`
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
                                  style=${isTeam
                                    ? `background-color: ${p.primaryColor};`
                                    : `background-image: linear-gradient(135deg, ${p.primaryColor} 0 calc(50% - 0.5px), rgba(255,255,255,0.55) calc(50% - 0.5px) calc(50% + 0.5px), ${p.secondaryColor} calc(50% + 0.5px) 100%);`}
                                ></div>
                              </button>
                            `}
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
