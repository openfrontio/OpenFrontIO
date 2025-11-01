import { LitElement, PropertyValues, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { GameMapType } from "../../core/game/Game";
import { terrainMapFileLoader } from "../TerrainMapFileLoader";
import { translateText } from "../Utils";

// Add map descriptions
export const MapDescription: Record<keyof typeof GameMapType, string> = {
  World: "World",
  GiantWorldMap: "Giant World Map",
  Europe: "Europe",
  EuropeClassic: "Europe Classic",
  Mena: "MENA",
  NorthAmerica: "North America",
  Oceania: "Oceania",
  BlackSea: "Black Sea",
  Africa: "Africa",
  Pangaea: "Pangaea",
  Asia: "Asia",
  Mars: "Mars",
  SouthAmerica: "South America",
  Britannia: "Britannia",
  GatewayToTheAtlantic: "Gateway to the Atlantic",
  Australia: "Australia",
  Iceland: "Iceland",
  EastAsia: "East Asia",
  BetweenTwoSeas: "Between Two Seas",
  FaroeIslands: "Faroe Islands",
  DeglaciatedAntarctica: "Deglaciated Antarctica",
  FalklandIslands: "Falkland Islands",
  Baikal: "Baikal",
  Halkidiki: "Halkidiki",
  StraitOfGibraltar: "Strait of Gibraltar",
  Italia: "Italia",
  Japan: "Japan",
  Yenisei: "Yenisei",
  Pluto: "Pluto",
  Montreal: "Montreal",
  Achiran: "Achiran",
  BaikalNukeWars: "Baikal (Nuke Wars)",
};

@customElement("map-display")
export class MapDisplay extends LitElement {
  @property({ type: String }) mapKey = "";
  @property({ type: Boolean }) selected = false;
  @property({ type: String }) translation: string = "";
  @state() private mapWebpPath: string | null = null;
  @state() private mapName: string | null = null;
  @state() private isLoading = true;

  private _loadToken = 0;

  connectedCallback() {
    super.connectedCallback();
    this.loadMapData();
  }

  protected updated(changed: PropertyValues) {
    if (changed.has("mapKey")) {
      this.loadMapData();
    }
  }

  createRenderRoot() {
    return this;
  }

  private async loadMapData() {
    if (!this.mapKey) return;

    const myToken = ++this._loadToken;
    this.isLoading = true;
    this.mapWebpPath = null;

    try {
      const normKey = Object.keys(GameMapType).find(
        (k) => k.toLowerCase() === this.mapKey.toLowerCase(),
      ) as keyof typeof GameMapType | undefined;
      if (!normKey) throw new Error(`Unknown mapKey: ${this.mapKey}`);
      const mapValue = GameMapType[normKey];
      const data = terrainMapFileLoader.getMapData(mapValue);
      const [webpPath, manifest] = await Promise.all([
        data.webpPath(),
        data.manifest(),
      ]);

      // if another load started after this one, ignore this result
      if (myToken !== this._loadToken) return;

      this.mapWebpPath = webpPath;
      this.mapName = manifest.name;
    } catch (error) {
      console.error("Failed to load map data:", error);
    } finally {
      this.isLoading = false;
    }
  }

  render() {
    return html`
      <div
        class="relative flex h-full min-h-32 cursor-pointer flex-col items-start justify-end rounded-xl border bg-white/5 p-3 text-left outline-none transition-all duration-300 ease-in-out hover:border-white/20 focus-visible:ring-2 focus-visible:ring-blue-400
        ${this.selected
          ? "border-blue-400/60 ring-inset ring-2 ring-blue-400/50 shadow-[0_0_0_2px_rgba(59,130,246,0.5),0_4px_8px_rgba(0,0,0,0.2)] scale-[1.02]"
          : "border-white/10 shadow-md"}"
      >
        ${this.isLoading
          ? html`<div
              class="flex h-full w-full items-center justify-center text-sm text-zinc-400"
            >
              ${translateText("map_component.loading")}
            </div>`
          : this.mapWebpPath
            ? html`<img
                src="${this.mapWebpPath}"
                alt="${this.translation ??
                this.mapName ??
                translateText("common.untitled")}"
                loading="lazy"
                class="absolute inset-0 h-full w-full rounded-xl object-cover opacity-70 z-0"
              />`
            : html`<div
                class="flex h-full w-full items-center justify-center text-sm text-zinc-400"
              >
                ${translateText("map_component.error")}
              </div>`}

        <div
          class="absolute inset-0 z-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent rounded-xl"
        ></div>
        <div class="absolute inset-x-0 bottom-0 z-10 p-3">
          <h3
            class="font-semibold text-white leading-tight text-base sm:text-lg max-w-full line-clamp-2"
            title="${this.translation ??
            this.mapName ??
            translateText("common.untitled")}"
          >
            ${this.translation ??
            this.mapName ??
            translateText("common.untitled")}
          </h3>
        </div>
      </div>
    `;
  }
}
