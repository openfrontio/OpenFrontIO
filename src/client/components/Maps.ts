import { LitElement, css, html } from "lit";
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
  MarsRevised: "Mars Revised",
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
  NorthernHemisphere: "Northern Hemisphere",
  StraitOfGibraltar: "Strait of Gibraltar",
  Italia: "Italia",
  Yenisei: "Yenisei",
  Pluto: "Pluto",
};

@customElement("map-display")
export class MapDisplay extends LitElement {
  @property({ type: String }) mapKey = "";
  @property({ type: Boolean }) selected = false;
  @property({ type: String }) translation = "";
  @state() private mapWebpPath: string | null = null;
  @state() private mapName: string | null = null;
  @state() private isLoading = true;

  static styles = css`
    .option-card {
      width: 100%;
      min-width: 100px;
      max-width: 120px;
      padding: 4px 4px 0 4px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      background: rgba(30, 30, 30, 0.95);
      border: 2px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s ease-in-out;
    }

    .option-card:hover {
      transform: translateY(-2px);
      border-color: rgba(255, 255, 255, 0.3);
      background: rgba(40, 40, 40, 0.95);
    }

    .option-card.selected {
      border-color: #4a9eff;
      background: rgba(74, 158, 255, 0.1);
    }

    .option-card-title {
      font-size: 14px;
      color: #aaa;
      text-align: center;
      margin: 0 0 4px 0;
    }

    .option-image {
      width: 100%;
      aspect-ratio: 4/2;
      color: #aaa;
      transition: transform 0.2s ease-in-out;
      border-radius: 8px;
      background-color: rgba(255, 255, 255, 0.1);
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  `;

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
      <div class="option-card ${this.selected ? "selected" : ""}">
        ${this.isLoading
          ? html`<div class="option-image">
              ${translateText("map_component.loading")}
            </div>`
          : this.mapWebpPath
            ? html`<img
                src="${this.mapWebpPath}"
                alt="${this.mapKey}"
                class="option-image"
              />`
            : html`<div class="option-image">Error</div>`}
        <div class="option-card-title">${this.translation || this.mapName}</div>
      </div>
    `;
  }
}
