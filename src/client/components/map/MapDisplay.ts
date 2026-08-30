import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Difficulty, GameMapType } from "../../../core/game/Game";
import { terrainMapFileLoader } from "../../TerrainMapFileLoader";
import { translateText } from "../../Utils";
import { starIcon } from "./MapFavorites";
import { MEDAL_ORDER, medalIcon } from "./Medals";

@customElement("map-display")
export class MapDisplay extends LitElement {
  @property({ type: String }) mapKey = "";
  @property({ type: Boolean }) selected = false;
  @property({ type: String }) translation: string = "";
  @property({ type: Boolean }) showMedals = false;
  @property({ type: Boolean }) favorite = false;
  @property({ attribute: false }) wins: Set<Difficulty> = new Set();
  @property({ attribute: false }) onToggleFavorite?: () => void;
  @state() private mapWebpPath: string | null = null;
  @state() private mapName: string | null = null;
  @state() private isLoading = true;
  @state() private hasNations = true;
  @state() private mapInfo: string | null = null;
  @state() private mapDesigners: string[] = [];
  private observer: IntersectionObserver | null = null;
  private dataLoaded = false;
  private infoTooltipEl: HTMLDivElement | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !this.dataLoaded) {
          this.dataLoaded = true;
          this.loadMapData();
          this.observer?.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    this.observer.observe(this);
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    this.observer = null;
    this.infoTooltipEl?.remove();
    this.infoTooltipEl = null;
    super.disconnectedCallback();
  }

  updated(changedProperties: Map<string, unknown>) {
    // If this element is reused for a different map, reload its data —
    // otherwise it keeps showing the previous map's thumbnail.
    const previousMapKey = changedProperties.get("mapKey");
    if (
      changedProperties.has("mapKey") &&
      previousMapKey !== undefined &&
      previousMapKey !== this.mapKey &&
      this.dataLoaded
    ) {
      this.loadMapData();
    }
  }

  private async loadMapData() {
    if (!this.mapKey) return;

    try {
      this.isLoading = true;
      const mapValue = GameMapType[this.mapKey as keyof typeof GameMapType];
      const data = terrainMapFileLoader.getMapData(mapValue);
      this.mapWebpPath = data.webpPath;
      const manifest = await data.manifest();
      this.mapName = manifest.name;
      this.hasNations =
        Array.isArray(manifest.nations) && manifest.nations.length > 0;
      this.mapInfo = manifest.info ?? null;
      this.mapDesigners = manifest.designers ?? [];
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

  private preventImageDrag(event: DragEvent) {
    event.preventDefault();
  }

  private handleToggleFavorite(event: Event) {
    event.stopPropagation();
    event.preventDefault();
    this.onToggleFavorite?.();
  }

  private renderFavoriteButton() {
    if (!this.onToggleFavorite) return null;
    const hasInfo = !!this.mapInfo || this.mapDesigners.length > 0;
    return html`<button
      type="button"
      @click=${this.handleToggleFavorite}
      @keydown=${(e: KeyboardEvent) => e.stopPropagation()}
      aria-pressed=${this.favorite}
      aria-label=${translateText(
        this.favorite ? "map_component.unfavorite" : "map_component.favorite",
      )}
      title=${translateText(
        this.favorite ? "map_component.unfavorite" : "map_component.favorite",
      )}
      class="absolute ${hasInfo
        ? "top-10"
        : "top-1.5"} right-1.5 w-7 h-7 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm transition-all duration-200 active:scale-90 ${this
        .favorite
        ? "opacity-100 text-cyber-yellow"
        : "opacity-0 group-hover:opacity-100 text-white hover:text-cyber-yellow"}"
    >
      ${starIcon(this.favorite, "w-4 h-4")}
    </button>`;
  }

  private formatDesigners(designers: string[]): string {
    if (designers.length === 1) return designers[0];
    if (designers.length === 2) return `${designers[0]} & ${designers[1]}`;
    return `${designers.slice(0, -1).join(", ")} & ${designers[designers.length - 1]}`;
  }

  private ensureInfoTooltipEl(): HTMLDivElement {
    if (!this.infoTooltipEl) {
      const el = document.createElement("div");
      el.setAttribute("role", "tooltip");
      el.className =
        "pointer-events-none fixed z-50 flex w-max max-w-56 flex-col gap-0.5 whitespace-normal rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-left text-xs text-white shadow-xl";
      document.body.appendChild(el);
      this.infoTooltipEl = el;
    }
    return this.infoTooltipEl;
  }

  private handleInfoTooltipShow(event: MouseEvent | FocusEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const el = this.ensureInfoTooltipEl();
    el.style.top = `${rect.bottom + 4}px`;
    el.style.right = `${window.innerWidth - rect.right}px`;
    el.replaceChildren();
    if (this.mapInfo) {
      const infoLine = document.createElement("div");
      infoLine.textContent = `${translateText("map_component.info")} ${this.mapInfo}`;
      el.appendChild(infoLine);
    }
    if (this.mapDesigners.length > 0) {
      const creditLine = document.createElement("div");
      creditLine.textContent = `${translateText(
        this.mapDesigners.length > 1
          ? "map_component.designer_plural"
          : "map_component.designer_singular",
      )} ${this.formatDesigners(this.mapDesigners)}`;
      el.appendChild(creditLine);
    }
  }

  private handleInfoTooltipHide() {
    this.infoTooltipEl?.remove();
    this.infoTooltipEl = null;
  }

  private renderInfoButton() {
    if (!this.mapInfo && this.mapDesigners.length === 0) return null;

    return html`<div
      data-map-info
      class="pointer-events-none absolute top-1.5 right-1.5 z-10"
      @click=${(event: Event) => event.stopPropagation()}
    >
      <button
        type="button"
        @mouseenter=${this.handleInfoTooltipShow}
        @mouseleave=${this.handleInfoTooltipHide}
        @focus=${this.handleInfoTooltipShow}
        @blur=${this.handleInfoTooltipHide}
        class="pointer-events-auto flex h-7 w-7 cursor-help items-center justify-center rounded-full bg-black/55 text-xs font-black text-white/80 ring-1 ring-white/20 transition-all duration-200 hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 opacity-0 group-hover:opacity-100"
      >
        ?
      </button>
    </div>`;
  }

  render() {
    return html`
      <div
        role="button"
        tabindex="0"
        aria-selected="${this.selected}"
        aria-label="${this.translation ?? this.mapName ?? this.mapKey}"
        @keydown="${this.handleKeydown}"
        class="w-full h-full p-3 flex flex-col items-center justify-between rounded-xl border cursor-pointer transition-all duration-200 active:scale-95 gap-3 group ${this
          .selected
          ? "bg-malibu-blue/20 border-malibu-blue/50 shadow-[var(--shadow-malibu-blue-strong)]"
          : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 hover:-translate-y-1"}"
      >
        ${this.isLoading
          ? html`<div
              class="w-full aspect-[2/1] text-white/40 transition-transform duration-200 rounded-lg bg-black/20 text-xs font-bold uppercase tracking-wider flex items-center justify-center animate-pulse"
            >
              ${translateText("common.loading")}
            </div>`
          : this.mapWebpPath
            ? html`<div
                class="w-full aspect-[2/1] relative rounded-lg bg-black/20"
              >
                <div class="absolute inset-0 overflow-hidden rounded-lg">
                  <img
                    src="${this.mapWebpPath}"
                    alt="${this.translation || this.mapName}"
                    draggable="false"
                    @dragstart=${this.preventImageDrag}
                    class="w-full h-full object-cover ${this.selected
                      ? "opacity-100"
                      : "opacity-80"} group-hover:opacity-100 transition-opacity duration-200"
                  />
                </div>
                ${this.renderFavoriteButton()} ${this.renderInfoButton()}
              </div>`
            : html`<div
                class="w-full aspect-[2/1] text-red-400 transition-transform duration-200 rounded-lg bg-red-500/10 text-xs font-bold uppercase tracking-wider flex items-center justify-center"
              >
                ${translateText("map_component.error")}
              </div>`}
        ${this.showMedals && this.hasNations
          ? html`<div class="flex gap-1 justify-center w-full">
              ${this.renderMedals()}
            </div>`
          : null}
        <div
          class="text-xs font-bold text-white uppercase tracking-wider text-center leading-tight break-words hyphens-auto"
        >
          ${this.translation || this.mapName}
        </div>
      </div>
    `;
  }

  private renderMedals() {
    const wins = this.readWins();
    return MEDAL_ORDER.map((medal) =>
      medalIcon(medal, "w-5 h-5", wins.has(medal)),
    );
  }

  private readWins(): Set<Difficulty> {
    return this.wins ?? new Set();
  }
}
