import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { GameMapType } from "../../../../core/game/Game";
import { terrainMapFileLoader } from "../../../../core/game/TerrainMapFileLoader";
import { translateText } from "../../../Utils";

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
};

@customElement("map-display")
export class MapDisplay extends LitElement {
  @property({ type: String }) mapKey = "";
  @property({ type: Boolean }) selected = false;
  @property({ type: String }) translation: string = "";
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
  private async loadMapData() {
    if (!this.mapKey) return;

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

  render() {
    return html`
      <div
        class="
          background-panel
          w-full
          p-2
          cursor-pointer
          flex flex-col items-center
          transition-all duration-300 
          hover:bg-backgroundDarkLighter
          ${this.selected ? "selected" : ""}
        "
      >
        <div class="w-full aspect-video overflow-hidden mb-2">
          ${this.isLoading
            ? html`<div class="option-image">
                ${translateText("map_component.loading")}
              </div>`
            : this.mapWebpPath
              ? html`<img
                  src="${this.mapWebpPath}"
                  alt="${this.mapKey}"
                  class="w-full h-full object-cover block"
                />`
              : html`<div
                  class="w-full h-full flex items-center justify-center bg-backgroundGrey text-textGrey text-small"
                >
                  Error
                </div>`}
        </div>
        <div class="text-small text-textLight text-center">
          ${this.translation || this.mapName}
        </div>
      </div>
    `;
  }
}
