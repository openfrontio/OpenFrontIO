import { colord } from "colord";
import { html, LitElement, nothing, PropertyValues, TemplateResult } from "lit";
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
  cosmeticRarityBadgeClass,
  cosmeticRarityLabel,
} from "./CosmeticPresentation";
import "./cosmetics/CosmeticRenderCanvas";
import type { CosmeticRenderCanvas } from "./cosmetics/CosmeticRenderCanvas";

export const TEAM_COLORS = [
  { name: "Red", hex: "#eb3333" },
  { name: "Blue", hex: "#2962ff" },
  { name: "Teal", hex: "#2bd4bd" },
  { name: "Purple", hex: "#9234ea" },
  { name: "Yellow", hex: "#e7b008" },
  { name: "Orange", hex: "#f97415" },
  { name: "Green", hex: "#41be52" },
];

const DEFAULT = "default";

/** A selectable color combination in the preview's palette bar. */
interface PaletteOption {
  name: string;
  label: string;
  primaryColor: string;
  secondaryColor: string;
}

/**
 * CosmeticPreviewModal — fullscreen interactive preview dialog for store cosmetics.
 *
 * Features:
 * - Real-time WebGL2 rendering of selected skins, structures, trails, and explosions.
 * - Skin colors: only the palette variants authored for that pattern in the catalog.
 * - Team colors: what the cosmetic looks like in a team game, where the fill is the
 *   team color and a pattern keeps its palette's secondary color.
 * - Backdrop click & Escape key dismissal; optional purchase action in the header.
 */
@customElement("cosmetic-preview-modal")
export class CosmeticPreviewModal extends LitElement {
  @property({ attribute: false })
  resolved: ResolvedCosmetic | null = null;

  @state()
  private selectedPrimary: string = DEFAULT;

  @state()
  private selectedSecondary: string = DEFAULT;

  /**
   * Secondary color of the last chosen skin palette. In a team game the fill
   * becomes the team color but a pattern keeps its palette's secondary, so
   * team swatches pair each team color with this.
   */
  @state()
  private paletteSecondary: string | null = null;

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

  /** Palette variants authored for this cosmetic (patterns), or the plain default (PNG skins). */
  private skinPalettes(): PaletteOption[] {
    if (!this.resolved) return [];
    if (this.resolved.type === "skin") {
      return [
        {
          name: DEFAULT,
          label: translateText("territory_patterns.pattern.default"),
          primaryColor: DEFAULT,
          secondaryColor: DEFAULT,
        },
      ];
    }
    if (this.resolved.type !== "pattern") return [];

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
        if (cp.isArchived || seen.has(cp.name)) continue;
        const pal = catalog.colorPalettes[cp.name];
        if (pal) {
          palettes.push(pal);
          seen.add(cp.name);
        }
      }
    }
    return palettes.map((p) => ({
      name: p.name,
      label: translateCosmetic("territory_patterns.color_palette", p.name),
      primaryColor: p.primaryColor,
      secondaryColor: p.secondaryColor,
    }));
  }

  private teamPalettes(): PaletteOption[] {
    if (!this.resolved) return [];
    const isPattern = this.resolved.type === "pattern";
    if (!isPattern && this.resolved.type !== "skin") return [];
    return TEAM_COLORS.map((tc) => ({
      name: tc.name,
      label: translateText(`team_colors.${tc.name.toLowerCase()}`),
      primaryColor: tc.hex,
      secondaryColor: isPattern
        ? (this.paletteSecondary ?? colord(tc.hex).darken(0.125).toHex())
        : tc.hex,
    }));
  }

  updated(changedProps: PropertyValues) {
    super.updated(changedProps);
    if (changedProps.has("resolved") && this.resolved) {
      const first = this.skinPalettes()[0];
      this.selectedPrimary = first?.primaryColor ?? DEFAULT;
      this.selectedSecondary = first?.secondaryColor ?? DEFAULT;
      this.paletteSecondary =
        this.resolved.type === "pattern"
          ? (first?.secondaryColor ?? null)
          : null;
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.resolved) {
      e.stopImmediatePropagation();
      e.preventDefault();
      this.close();
    }
  };

  private selectPalette(option: PaletteOption, isSkinPalette: boolean): void {
    this.selectedPrimary = option.primaryColor;
    this.selectedSecondary = option.secondaryColor;
    if (isSkinPalette && this.resolved?.type === "pattern") {
      this.paletteSecondary = option.secondaryColor;
    }
  }

  private get canvasEl(): CosmeticRenderCanvas | null {
    return this.querySelector("cosmetic-render-canvas");
  }

  close(): void {
    this.resolved = null;
    this.dispatchEvent(new CustomEvent("close-preview", { bubbles: true }));
  }

  private customColors(): string[] | null {
    if (!this.resolved) return null;
    if (this.resolved.type === "skin") {
      return this.selectedPrimary === DEFAULT ? null : [this.selectedPrimary];
    }
    if (this.resolved.type === "pattern") {
      return [this.selectedPrimary, this.selectedSecondary];
    }
    return null;
  }

  private renderSwatch(
    option: PaletteOption,
    isSkinPalette: boolean,
  ): TemplateResult {
    const isSelected =
      this.selectedPrimary === option.primaryColor &&
      this.selectedSecondary === option.secondaryColor;
    const ring = isSelected
      ? "ring-2 ring-cyan-400 ring-offset-2 ring-offset-zinc-900 border-white"
      : "";
    if (option.primaryColor === DEFAULT) {
      return html`<button
        type="button"
        title=${option.label}
        aria-label=${option.label}
        aria-pressed=${isSelected ? "true" : "false"}
        class="group relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer ${isSelected
          ? `${ring} bg-white/25 text-white shadow-sm`
          : "border-white/30 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"}"
        @click=${() => this.selectPalette(option, isSkinPalette)}
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
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </button>`;
    }
    const split = option.primaryColor !== option.secondaryColor;
    return html`<button
      type="button"
      title=${option.label}
      aria-label=${option.label}
      aria-pressed=${isSelected ? "true" : "false"}
      class="group relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/40 overflow-hidden transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer ${ring}"
      @click=${() => this.selectPalette(option, isSkinPalette)}
    >
      <div
        class="w-full h-full"
        style=${split
          ? `background-image: linear-gradient(135deg, ${option.primaryColor} 0 calc(50% - 0.5px), rgba(255,255,255,0.55) calc(50% - 0.5px) calc(50% + 0.5px), ${option.secondaryColor} calc(50% + 0.5px) 100%);`
          : `background-color: ${option.primaryColor};`}
      ></div>
    </button>`;
  }

  private renderPaletteGroup(
    labelKey: string,
    options: PaletteOption[],
    isSkinPalette: boolean,
  ): TemplateResult | typeof nothing {
    if (options.length === 0) return nothing;
    return html`<div class="flex items-center gap-2.5">
      <span class="font-bold text-white/70 whitespace-nowrap"
        >${translateText(labelKey)}</span
      >
      <div class="flex items-center gap-2.5 p-1.5">
        ${options.map((o) => this.renderSwatch(o, isSkinPalette))}
      </div>
    </div>`;
  }

  render() {
    if (!this.resolved) {
      return nothing;
    }

    const name = cosmeticDisplayName(this.resolved);
    const rarityLabel = cosmeticRarityLabel(this.resolved);
    const skinPalettes = this.skinPalettes();
    const teamPalettes = this.teamPalettes();
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
        class="relative flex flex-col w-full max-w-3xl h-[600px] max-h-[85vh] rounded-2xl bg-zinc-900 border border-white/15 shadow-2xl overflow-hidden"
      >
        <!-- Header -->
        <div
          class="flex items-center justify-between gap-4 px-6 py-3 border-b border-white/10 bg-zinc-900/90"
        >
          <div class="flex items-center gap-3 min-w-0">
            <h2 class="text-lg font-bold text-white tracking-wide truncate">
              ${name}
            </h2>
            <span
              class="rounded-full px-2.5 py-0.5 text-xs font-black uppercase tracking-wider border ${cosmeticRarityBadgeClass(
                this.resolved,
              )}"
            >
              ${rarityLabel}
            </span>
            ${artist
              ? html`<span class="text-xs text-white/60 whitespace-nowrap">
                  ${translateText("cosmetics.artist_label")}
                  <span class="text-white/90 font-medium">${artist}</span>
                </span>`
              : nothing}
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <div
              class="flex items-center gap-1 p-1 rounded-lg bg-white/5 border border-white/10"
            >
              <button
                type="button"
                aria-label=${translateText("user_setting.zoom_out")}
                title=${translateText("user_setting.zoom_out")}
                class="flex h-7 w-7 items-center justify-center rounded-md text-white/80 hover:bg-white/15 hover:text-white transition active:scale-90 cursor-pointer text-sm font-bold"
                @click=${() => this.canvasEl?.zoomOut()}
              >
                −
              </button>
              <button
                type="button"
                aria-label=${translateText("user_setting.zoom_in")}
                title=${translateText("user_setting.zoom_in")}
                class="flex h-7 w-7 items-center justify-center rounded-md text-white/80 hover:bg-white/15 hover:text-white transition active:scale-90 cursor-pointer text-sm font-bold"
                @click=${() => this.canvasEl?.zoomIn()}
              >
                +
              </button>
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
        </div>

        <!-- WebGL Canvas Viewport -->
        <div class="flex-1 p-3 bg-zinc-950/60 min-h-0">
          <cosmetic-render-canvas
            .resolved=${this.resolved}
            .customColors=${this.customColors()}
            class="block h-full w-full"
          ></cosmetic-render-canvas>
        </div>

        <!-- Skin colors (catalog palettes) and team colors (team-game look) -->
        ${skinPalettes.length + teamPalettes.length > 1
          ? html`
              <div
                class="flex flex-wrap items-center gap-x-6 gap-y-1 px-6 py-2 border-t border-white/10 bg-zinc-900/80 text-xs text-white/80 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                ${this.renderPaletteGroup(
                  "store.preview_skin_colors",
                  skinPalettes,
                  true,
                )}
                ${this.renderPaletteGroup(
                  "store.preview_team_colors",
                  teamPalettes,
                  false,
                )}
              </div>
            `
          : nothing}
      </div>
    </div>`;
  }
}
