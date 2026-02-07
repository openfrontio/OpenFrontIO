import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  Difficulty,
  GameMapType,
  mapCategories,
} from "../../../core/game/Game";
import { translateText } from "../../Utils";
import {
  cardImageClasses,
  cardStateClasses,
  renderCardLabel,
  renderCategoryLabel,
} from "../../utilities/ConfigCards";
import "./MapDisplay";
import randomMap from "/images/RandomMap.webp?url";

const MAP_GRID = "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4";

const featuredMaps: GameMapType[] = [
  GameMapType.World,
  GameMapType.Europe,
  GameMapType.NorthAmerica,
  GameMapType.SouthAmerica,
  GameMapType.Asia,
  GameMapType.Africa,
  GameMapType.Japan,
];

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

  private renderMapCard(mapValue: GameMapType) {
    const mapKey = Object.entries(GameMapType).find(
      ([_, value]) => value === mapValue,
    )?.[0];
    return html`
      <map-display
        @click=${() => this.handleMapSelection(mapValue)}
        .mapKey=${mapKey}
        .selected=${!this.useRandomMap && this.selectedMap === mapValue}
        .showMedals=${this.showMedals}
        .wins=${this.getWins(mapValue)}
        .translation=${translateText(`map.${mapKey?.toLowerCase()}`)}
      ></map-display>
    `;
  }

  private renderAllMaps() {
    const mapCategoryEntries = Object.entries(mapCategories);
    return html`<div class="space-y-8">
      ${mapCategoryEntries.map(
        ([categoryKey, maps]) => html`
          <div>
            ${renderCategoryLabel(
              translateText(`map_categories.${categoryKey}`),
            )}
            <div class="${MAP_GRID}">
              ${maps.map((mapValue) => this.renderMapCard(mapValue))}
            </div>
          </div>
        `,
      )}
    </div>`;
  }

  private renderFeaturedMaps() {
    let featuredMapList = featuredMaps;
    if (!featuredMapList.includes(this.selectedMap)) {
      featuredMapList = [this.selectedMap, ...featuredMaps];
    }
    return html`<div>
      ${renderCategoryLabel(translateText("map_categories.featured"))}
      <div class="${MAP_GRID}">
        ${featuredMapList.map((mapValue) => this.renderMapCard(mapValue))}
      </div>
    </div>`;
  }

  private renderTab(label: string, active: boolean, onClick: () => void) {
    return html`<button
      type="button"
      role="tab"
      aria-selected=${active}
      class="px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${active
        ? "bg-blue-500/20 text-blue-100 shadow-[0_0_12px_rgba(59,130,246,0.2)]"
        : "text-white/60 hover:text-white"}"
      @click=${onClick}
    >
      ${label}
    </button>`;
  }

  render() {
    return html`
      <div class="space-y-8">
        <div
          role="tablist"
          aria-label="${translateText("map.map")}"
          class="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/20 p-1"
        >
          ${this.renderTab(
            translateText("map.featured"),
            !this.showAllMaps,
            () => (this.showAllMaps = false),
          )}
          ${this.renderTab(
            translateText("map.all"),
            this.showAllMaps,
            () => (this.showAllMaps = true),
          )}
        </div>
        ${this.showAllMaps ? this.renderAllMaps() : this.renderFeaturedMaps()}
        <div
          class="${this.randomMapDivider ? "pt-4 border-t border-white/5" : ""}"
        >
          ${renderCategoryLabel(translateText("map_categories.special"))}
          <div class="${MAP_GRID}">
            <button
              class="relative group rounded-xl border transition-all duration-200 overflow-hidden flex flex-col items-stretch active:scale-95 ${cardStateClasses(
                this.useRandomMap,
              )}"
              @click=${this.handleSelectRandomMap}
            >
              <div class="aspect-[2/1] w-full bg-black/20">
                <img
                  draggable="false"
                  src=${randomMap}
                  alt=${translateText("map.random")}
                  class="${cardImageClasses(this.useRandomMap)}"
                />
              </div>
              <div class="p-3 border-t border-white/5">
                ${renderCardLabel(translateText("map.random"), true)}
              </div>
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
