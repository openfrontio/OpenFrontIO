import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Difficulty, GameMapType } from "../../core/game/Game";
import { terrainMapFileLoader } from "../TerrainMapFileLoader";
import { translateText } from "../Utils";

export const MAP_CARD_CLASS_BASE =
  "w-full h-full p-3 flex flex-col items-center justify-between rounded-xl " +
  "border cursor-pointer transition-all duration-200 gap-3 group";
export const MAP_CARD_CLASS_SELECTED =
  "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]";
export const MAP_CARD_CLASS_IDLE =
  "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 " +
  "hover:-translate-y-1 active:scale-95";
export const MAP_CARD_PREVIEW_CLASS_BASE =
  "w-full aspect-[2/1] transition-transform duration-200 rounded-lg " +
  "flex items-center justify-center";
export const MAP_CARD_PREVIEW_CLASS_LOADING =
  "bg-black/20 text-white/40 text-xs font-bold uppercase tracking-wider " +
  "animate-pulse";
export const MAP_CARD_PREVIEW_CLASS_ERROR =
  "bg-red-500/10 text-red-400 text-xs font-bold uppercase tracking-wider";
export const MAP_CARD_IMAGE_WRAPPER_CLASS =
  "w-full aspect-[2/1] relative overflow-hidden rounded-lg bg-black/20";
export const MAP_CARD_IMAGE_CLASS_BASE =
  "w-full h-full object-cover transition-opacity duration-200 group-hover:opacity-100";
export const MAP_CARD_LABEL_CLASS =
  "text-xs font-bold text-white uppercase tracking-wider text-center " +
  "leading-tight break-words hyphens-auto";
export const MAP_CARD_MEDALS_CLASS = "flex gap-1 justify-center w-full";

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

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadMapData();
  }

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("mapKey")) {
      this.loadMapData();
    }
  }

  private async loadMapData() {
    if (!this.mapKey) return;

    try {
      this.isLoading = true;
      this.mapWebpPath = null;
      this.mapName = null;
      const mapValue = GameMapType[this.mapKey as keyof typeof GameMapType];
      const data = terrainMapFileLoader.getMapData(mapValue);
      this.mapWebpPath = await data.webpPath();
      this.mapName = (await data.manifest()).name;
    } catch (error) {
      console.error("Failed to load map data:", error);
    } finally {
      this.isLoading = false;
    }
  }

  private getDisplayLabel(): string {
    if (this.translation) {
      return this.translation;
    }
    if (this.mapName) {
      return this.mapName;
    }
    return this.mapKey;
  }

  private getCardClass(): string {
    return `${MAP_CARD_CLASS_BASE} ${
      this.selected ? MAP_CARD_CLASS_SELECTED : MAP_CARD_CLASS_IDLE
    }`;
  }

  private renderPreview(): ReturnType<typeof html> {
    if (this.isLoading) {
      return html`<div
        class="${MAP_CARD_PREVIEW_CLASS_BASE} ${MAP_CARD_PREVIEW_CLASS_LOADING}"
      >
        ${translateText("map_component.loading")}
      </div>`;
    }

    if (this.mapWebpPath) {
      return html`<div class="${MAP_CARD_IMAGE_WRAPPER_CLASS}">
        <img
          src="${this.mapWebpPath}"
          alt="${this.getDisplayLabel()}"
          class="${MAP_CARD_IMAGE_CLASS_BASE} ${this.selected
            ? "opacity-100"
            : "opacity-80"}"
        />
      </div>`;
    }

    return html`<div
      class="${MAP_CARD_PREVIEW_CLASS_BASE} ${MAP_CARD_PREVIEW_CLASS_ERROR}"
    >
      ${translateText("map_component.error")}
    </div>`;
  }

  render() {
    const label = this.getDisplayLabel();
    return html`
      <button
        type="button"
        aria-pressed="${this.selected}"
        aria-label="${label}"
        class="${this.getCardClass()}"
      >
        ${this.renderPreview()}
        ${this.showMedals
          ? html`<div class="${MAP_CARD_MEDALS_CLASS}">
              ${this.renderMedals()}
            </div>`
          : null}
        <div class="${MAP_CARD_LABEL_CLASS}">${label}</div>
      </button>
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
