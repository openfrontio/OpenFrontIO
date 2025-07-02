import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { GameMapType } from "../../../../core/game/Game";
import { getMapsImage } from "../../../utilities/Maps";

// Add map descriptions
export const MapDescription: Record<keyof typeof GameMapType, string> = {
  World: "World",
  WorldMapGiant: "Giant World Map",
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
  Japan: "Japan",
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

  createRenderRoot() {
    return this;
  }

  render() {
    const mapValue = GameMapType[this.mapKey as keyof typeof GameMapType];
    const isSelected = this.selected;

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
        ${isSelected ? "selected" : ""}
      "
      >
        <div class="w-full aspect-video overflow-hidden mb-2">
          ${getMapsImage(mapValue)
            ? html`<img
                src="${getMapsImage(mapValue)}"
                alt="${this.mapKey}"
                class="w-full h-full object-cover block"
              />`
            : html`<div
                class="w-full h-full flex items-center justify-center bg-backgroudGrey text-textGrey text-small"
              >
                <p>${this.mapKey}</p>
              </div>`}
        </div>
        <p class="text-small  text-textLight text-center">
          ${this.translation ||
          MapDescription[this.mapKey as keyof typeof GameMapType]}
        </p>
      </div>
    `;
  }
}
