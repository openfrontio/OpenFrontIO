import { html, LitElement, PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Difficulty, GameMapType } from "../../../../core/game/Game";
import { terrainMapFileLoader } from "../../../TerrainMapFileLoader";
import { translateText } from "../../../Utils";

@customElement("lobby-map-card")
export class LobbyMapCard extends LitElement {
  @property({ attribute: false }) imageSrc?: string | null;
  @property({ type: String }) name = "";
  @property({ attribute: "aria-selected" }) ariaSelected: string | null = null;
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

  updated(changedProperties: PropertyValues) {
    if (changedProperties.has("mapKey")) {
      this.loadMapData();
    }
  }

  private async loadMapData() {
    if (!this.mapKey) {
      this.mapWebpPath = null;
      this.mapName = null;
      this.isLoading = false;
      return;
    }

    try {
      this.isLoading = true;
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

  private handleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      (event.currentTarget as HTMLElement).click();
    }
  }

  private resolveName() {
    if (!this.mapKey) {
      return this.name;
    }

    return this.translation?.length
      ? this.translation
      : (this.mapName ?? this.mapKey);
  }

  private resolveImageSrc() {
    if (!this.mapKey) {
      return this.imageSrc;
    }

    return this.isLoading ? undefined : (this.mapWebpPath ?? null);
  }

  private renderImage(name: string, isSelected: boolean) {
    const imageSrc = this.resolveImageSrc();

    if (imageSrc === undefined) {
      return html`<div
        class="w-full aspect-[2/1] text-white/40 transition-transform duration-200 rounded-lg bg-black/20 text-xs font-bold uppercase tracking-wider flex items-center justify-center animate-pulse"
      >
        ${translateText("map_component.loading")}
      </div>`;
    }

    if (imageSrc === null) {
      return html`<div
        class="w-full aspect-[2/1] text-red-400 transition-transform duration-200 rounded-lg bg-red-500/10 text-xs font-bold uppercase tracking-wider flex items-center justify-center"
      >
        ${translateText("map_component.error")}
      </div>`;
    }

    return html`<div
      class="w-full aspect-[2/1] relative overflow-hidden rounded-lg bg-black/20"
    >
      <img
        src="${imageSrc}"
        alt="${name}"
        class="w-full h-full object-cover ${isSelected
          ? "opacity-100"
          : "opacity-80"} group-hover:opacity-100 transition-opacity duration-200"
      />
    </div>`;
  }

  render() {
    const name = this.resolveName();
    const isSelected = this.selected || this.ariaSelected === "true";
    return html`
      <div
        role="button"
        tabindex="0"
        aria-selected="${isSelected}"
        aria-label="${name}"
        @keydown=${this.handleKeydown}
        class="w-full h-full p-3 flex flex-col items-center justify-between rounded-xl border cursor-pointer transition-all duration-200 gap-3 group ${isSelected
          ? "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]"
          : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 hover:-translate-y-1 active:scale-95"}"
      >
        ${this.renderImage(name, isSelected)}
        ${this.showMedals ? this.renderMedals() : html`<slot></slot>`}
        <div
          class="text-xs font-bold text-white uppercase tracking-wider text-center leading-tight break-words hyphens-auto"
        >
          ${name}
        </div>
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
    const medals = medalOrder.map((medal) => {
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
    return html`<div class="flex gap-1 justify-center w-full">${medals}</div>`;
  }

  private readWins(): Set<Difficulty> {
    return this.wins ?? new Set();
  }
}
