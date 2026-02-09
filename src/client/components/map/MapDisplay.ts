import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Difficulty, GameMapType } from "../../../core/game/Game";
import { terrainMapFileLoader } from "../../TerrainMapFileLoader";
import { translateText } from "../../Utils";
import {
  cardImageClasses,
  cardStateClasses,
  renderCardLabel,
} from "../../utilities/ConfigCards";

@customElement("map-display")
export class MapDisplay extends LitElement {
  @property({ type: String }) mapKey = "";
  @property({ type: Boolean }) selected = false;
  @property({ type: String }) translation: string = "";
  @property({ type: Boolean }) showMedals = false;
  @property({ attribute: false }) wins: Set<Difficulty> = new Set();
  @state() private mapWebpPath: string | null = null;
  @state() private mapName: string | null = null;
  @state() private isLoading = true;
  @state() private hasNations = true;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadMapData();
  }

  private async loadMapData() {
    if (!this.mapKey) return;

    try {
      this.isLoading = true;
      const mapValue = GameMapType[this.mapKey as keyof typeof GameMapType];
      const data = terrainMapFileLoader.getMapData(mapValue);
      this.mapWebpPath = await data.webpPath();
      const manifest = await data.manifest();
      this.mapName = manifest.name;
      this.hasNations =
        Array.isArray(manifest.nations) && manifest.nations.length > 0;
    } catch (error) {
      console.error("Failed to load map data:", error);
    } finally {
      this.isLoading = false;
    }
  }

  private handleKeydown(event: KeyboardEvent) {
    // Trigger the same activation logic as click when Enter or Space is pressed
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      // Dispatch a click event to maintain compatibility with parent click handlers
      (event.target as HTMLElement).click();
    }
  }

  render() {
    return html`
      <div
        role="button"
        tabindex="0"
        aria-selected="${this.selected}"
        aria-label="${this.translation ?? this.mapName ?? this.mapKey}"
        @keydown="${this.handleKeydown}"
        class="w-full h-full p-3 flex flex-col items-center justify-between rounded-xl border cursor-pointer transition-all duration-200 gap-3 group active:scale-95 ${cardStateClasses(
          this.selected,
        )}"
      >
        ${this.isLoading
          ? html`<div
              class="w-full aspect-[2/1] text-white/40 rounded-lg bg-black/20 text-xs font-bold uppercase tracking-wider flex items-center justify-center animate-pulse"
            >
              ${translateText("map_component.loading")}
            </div>`
          : this.mapWebpPath
            ? html`<div
                class="w-full aspect-[2/1] relative overflow-hidden rounded-lg bg-black/20"
              >
                <img
                  draggable="false"
                  src="${this.mapWebpPath}"
                  alt="${this.translation || this.mapName}"
                  class="${cardImageClasses(this.selected)}"
                />
              </div>`
            : html`<div
                class="w-full aspect-[2/1] text-red-400 rounded-lg bg-red-500/10 text-xs font-bold uppercase tracking-wider flex items-center justify-center"
              >
                ${translateText("map_component.error")}
              </div>`}
        ${this.showMedals && this.hasNations
          ? html`<div class="flex gap-1 justify-center w-full">
              ${this.renderMedals()}
            </div>`
          : null}
        ${renderCardLabel(this.translation ?? this.mapName ?? "", true)}
      </div>
    `;
  }

  private renderMedals() {
    const medalOrder: Difficulty[] = [
      Difficulty.Easy,
      Difficulty.Medium,
      Difficulty.Hard,
      Difficulty.Impossible,
    ];
    const colors: Record<Difficulty, string> = {
      [Difficulty.Easy]: "var(--medal-easy)",
      [Difficulty.Medium]: "var(--medal-medium)",
      [Difficulty.Hard]: "var(--medal-hard)",
      [Difficulty.Impossible]: "var(--medal-impossible)",
    };
    const wins = this.readWins();
    return medalOrder.map((medal) => {
      const earned = wins.has(medal);
      const mask =
        "url('/images/MedalIconWhite.svg') no-repeat center / contain";
      return html`<div
        class="w-5 h-5 ${earned ? "opacity-100" : "opacity-25"}"
        style="background-color:${colors[
          medal
        ]}; mask: ${mask}; -webkit-mask: ${mask};"
        title=${translateText(`difficulty.${medal.toLowerCase()}`)}
      ></div>`;
    });
  }

  private readWins(): Set<Difficulty> {
    return this.wins ?? new Set();
  }
}
