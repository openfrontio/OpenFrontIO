import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import {
  Difficulty,
  GameMapType,
  mapCategories,
  mapTranslationKeys,
} from "../../../core/game/Game";
import { translateText } from "../../Utils";
import "./MapDisplay";
import { getFavoriteMaps, toggleFavoriteMap } from "./MapFavorites";
const randomMap = assetUrl("images/RandomMap.webp");

@customElement("map-picker")
export class MapPicker extends LitElement {
  @property({ type: String }) selectedMap: GameMapType = GameMapType.World;
  @property({ type: Boolean }) useRandomMap = false;
  @property({ type: Boolean }) showMedals = false;
  @property({ type: Boolean }) randomMapDivider = false;
  @property({ attribute: false }) mapWins: Map<GameMapType, Set<Difficulty>> =
    new Map();
  @property({ attribute: false }) onSelectMap?: (map: GameMapType) => void;
  @property({ attribute: false }) onSelectRandom?: () => void;
  @state() private expandedSections: Set<string> = new Set(["featured"]);
  @state() private favorites: GameMapType[] = getFavoriteMaps();

  createRenderRoot() {
    return this;
  }

  private handleToggleFavorite(mapValue: GameMapType) {
    this.favorites = toggleFavoriteMap(mapValue);
  }

  private handleMapSelection(mapValue: GameMapType) {
    this.onSelectMap?.(mapValue);
  }

  private handleSelectRandomMap = () => {
    this.onSelectRandom?.();
  };

  private toggleSection(sectionKey: string) {
    const expanded = new Set(this.expandedSections);
    if (expanded.has(sectionKey)) {
      expanded.delete(sectionKey);
    } else {
      expanded.add(sectionKey);
    }
    this.expandedSections = expanded;
  }

  private preventImageDrag(event: DragEvent) {
    event.preventDefault();
  }

  private getWins(mapValue: GameMapType): Set<Difficulty> {
    return this.mapWins?.get(mapValue) ?? new Set();
  }

  private renderMapCard(mapValue: GameMapType) {
    const mapKey = Object.entries(GameMapType).find(
      ([_, value]) => value === mapValue,
    )?.[0];
    return html`
      <div
        @click=${() => this.handleMapSelection(mapValue)}
        class="cursor-pointer"
      >
        <map-display
          .mapKey=${mapKey}
          .selected=${!this.useRandomMap && this.selectedMap === mapValue}
          .showMedals=${this.showMedals}
          .wins=${this.getWins(mapValue)}
          .favorite=${this.favorites.includes(mapValue)}
          .onToggleFavorite=${() => this.handleToggleFavorite(mapValue)}
          .translation=${translateText(mapTranslationKeys[mapValue])}
        ></map-display>
      </div>
    `;
  }

  private renderSection(
    sectionKey: string,
    label: string,
    maps: GameMapType[],
  ) {
    const expanded = this.expandedSections.has(sectionKey);
    return html`<div class="w-full">
      <button
        type="button"
        aria-expanded=${expanded}
        @click=${() => this.toggleSection(sectionKey)}
        class="w-full flex items-center gap-2 text-xs font-bold uppercase tracking-widest pl-2 transition-colors ${expanded
          ? "text-white/70 mb-4"
          : "text-white/40 hover:text-white/70"}"
      >
        <svg
          class="w-3 h-3 shrink-0 transition-transform duration-200 ${expanded
            ? "rotate-90"
            : ""}"
          viewBox="0 0 12 12"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M4 2l5 4-5 4z" />
        </svg>
        ${label}
      </button>
      ${expanded
        ? html`<div
            class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
          >
            ${maps.map((mapValue) => this.renderMapCard(mapValue))}
          </div>`
        : null}
    </div>`;
  }

  // The featured section also shows the currently selected map, so the
  // selection stays visible with all other sections collapsed.
  private featuredSectionMaps(maps: GameMapType[]): GameMapType[] {
    if (!this.useRandomMap && !maps.includes(this.selectedMap)) {
      return [this.selectedMap, ...maps];
    }
    return maps;
  }

  render() {
    return html`
      <div class="space-y-4">
        ${this.favorites.length > 0
          ? this.renderSection(
              "favorites",
              translateText("map_categories.favorites"),
              this.favorites,
            )
          : null}
        ${Object.entries(mapCategories).map(([categoryKey, maps]) =>
          this.renderSection(
            categoryKey,
            translateText(`map_categories.${categoryKey}`),
            categoryKey === "featured" ? this.featuredSectionMaps(maps) : maps,
          ),
        )}
        <div
          class="w-full ${this.randomMapDivider
            ? "pt-4 border-t border-white/5"
            : ""}"
        >
          <h4
            class="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2"
          >
            ${translateText("map_categories.special")}
          </h4>
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <button
              type="button"
              class="w-full h-full p-3 flex flex-col items-center justify-between rounded-xl border cursor-pointer transition-all duration-200 active:scale-95 gap-3 group ${this
                .useRandomMap
                ? "bg-malibu-blue/20 border-malibu-blue/50 shadow-[var(--shadow-malibu-blue-strong)]"
                : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 hover:-translate-y-1"}"
              @click=${this.handleSelectRandomMap}
            >
              <div
                class="w-full aspect-[2/1] relative overflow-hidden rounded-lg bg-black/20"
              >
                <img
                  src=${randomMap}
                  alt=${translateText("map.random")}
                  draggable="false"
                  @dragstart=${this.preventImageDrag}
                  class="w-full h-full object-cover ${this.useRandomMap
                    ? "opacity-100"
                    : "opacity-80"} group-hover:opacity-100 transition-opacity duration-200"
                />
              </div>
              <div
                class="text-xs font-bold text-white uppercase tracking-wider text-center leading-tight break-words hyphens-auto"
              >
                ${translateText("map.random")}
              </div>
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
