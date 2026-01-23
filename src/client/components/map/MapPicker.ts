import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  Difficulty,
  GameMapType,
  featuredMaps,
  mapCategories,
} from "../../../core/game/Game";
import { translateText } from "../../Utils";
import "./MapDisplay";
import randomMap from "/images/RandomMap.webp?url";

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
  @state() private showAllMaps = false;

  createRenderRoot() {
    return this;
  }

  private handleMapSelection(mapValue: GameMapType) {
    this.onSelectMap?.(mapValue);
  }

  private handleSelectRandomMap = () => {
    this.onSelectRandom?.();
  };

  private getWins(mapValue: GameMapType): Set<Difficulty> {
    return this.mapWins?.get(mapValue) ?? new Set();
  }

  render() {
    let featuredMapList = featuredMaps;
    if (!featuredMapList.includes(this.selectedMap)) {
      featuredMapList = [this.selectedMap, ...featuredMaps];
    }
    const mapKeyLookup = new Map(
      Object.entries(GameMapType).map(([key, value]) => [value, key]),
    );
    const mapCategoryEntries = Object.entries(mapCategories);
    const renderMapCard = (mapValue: GameMapType) => {
      const mapKey = mapKeyLookup.get(mapValue);
      return html`
        <div
          @click=${() => this.handleMapSelection(mapValue)}
          class="cursor-pointer transition-transform duration-200 active:scale-95"
        >
          <map-display
            .mapKey=${mapKey}
            .selected=${!this.useRandomMap && this.selectedMap === mapValue}
            .showMedals=${this.showMedals}
            .wins=${this.getWins(mapValue)}
            .translation=${translateText(`map.${mapKey?.toLowerCase()}`)}
          ></map-display>
        </div>
      `;
    };

    return html`
      <div class="space-y-8">
        <div class="w-full">
          <div
            role="tablist"
            aria-label="${translateText("map.map")}"
            class="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/20 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected=${!this.showAllMaps}
              class="px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${this
                .showAllMaps
                ? "text-white/60 hover:text-white"
                : "bg-blue-500/20 text-blue-100 shadow-[0_0_12px_rgba(59,130,246,0.2)]"}"
              @click=${() => (this.showAllMaps = false)}
            >
              ${translateText("map.featured")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected=${this.showAllMaps}
              class="px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${this
                .showAllMaps
                ? "bg-blue-500/20 text-blue-100 shadow-[0_0_12px_rgba(59,130,246,0.2)]"
                : "text-white/60 hover:text-white"}"
              @click=${() => (this.showAllMaps = true)}
            >
              ${translateText("map.all")}
            </button>
          </div>
        </div>
        ${this.showAllMaps
          ? html`<div class="space-y-8">
              ${mapCategoryEntries.map(
                ([categoryKey, maps]) => html`
                  <div class="w-full">
                    <h4
                      class="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2"
                    >
                      ${translateText(`map_categories.${categoryKey}`)}
                    </h4>
                    <div
                      class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
                    >
                      ${maps.map((mapValue) => renderMapCard(mapValue))}
                    </div>
                  </div>
                `,
              )}
            </div>`
          : html`<div class="w-full">
              <h4
                class="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2"
              >
                ${translateText("map_categories.featured")}
              </h4>
              <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                ${featuredMapList.map((mapValue) => renderMapCard(mapValue))}
              </div>
            </div>`}
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
              class="relative group rounded-xl border transition-all duration-200 overflow-hidden flex flex-col items-stretch ${this
                .useRandomMap
                ? "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]"
                : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"}"
              @click=${this.handleSelectRandomMap}
            >
              <div
                class="aspect-[2/1] w-full relative overflow-hidden bg-black/20"
              >
                <img
                  src=${randomMap}
                  alt=${translateText("map.random")}
                  class="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity"
                />
              </div>
              <div class="p-3 text-center border-t border-white/5">
                <div
                  class="text-xs font-bold text-white uppercase tracking-wider break-words hyphens-auto"
                >
                  ${translateText("map.random")}
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
