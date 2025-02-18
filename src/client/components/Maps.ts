import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { GameMapType } from "../../core/game/Game";

// Add map descriptions
export const MapDescription: Record<keyof typeof GameMapType, string> = {
  World: "World",
  Europe: "Europe",
  Mena: "MENA",
  NorthAmerica: "North America",
  Oceania: "Oceania",
  BlackSea: "Black Sea",
  Antarctica: "Antarctica",
};

import world from "../../../resources/maps/WorldMap.png";
import oceania from "../../../resources/maps/Oceania.png";
import europe from "../../../resources/maps/Europe.png";
import mena from "../../../resources/maps/Mena.png";
import northAmerica from "../../../resources/maps/NorthAmerica.png";
import blackSea from "../../../resources/maps/BlackSea.png";
import antarctica from "../../../resources/maps/Antarctica.png";

@customElement("map-display")
export class MapDisplay extends LitElement {
  @property({ type: String }) mapKey = "";
  @property({ type: Boolean }) selected = false;

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

  private getMapsImage(map: GameMapType): string {
    switch (map) {
      case GameMapType.World:
        return world;
      case GameMapType.Oceania:
        return oceania;
      case GameMapType.Europe:
        return europe;
      case GameMapType.Mena:
        return mena;
      case GameMapType.NorthAmerica:
        return northAmerica;
      case GameMapType.BlackSea:
        return blackSea;
      case GameMapType.Antarctica:
        return antarctica;
      default:
        return "";
    }
  }

  render() {
    const mapValue = GameMapType[this.mapKey as keyof typeof GameMapType];

    return html`
      <div class="option-card ${this.selected ? "selected" : ""}">
        ${this.getMapsImage(mapValue)
          ? html`<img
              src="${this.getMapsImage(mapValue)}"
              alt="${this.mapKey}"
              class="option-image"
            />`
          : html`<div class="option-image">
              <p>${this.mapKey}</p>
            </div>`}
        <div class="option-card-title">
          ${MapDescription[this.mapKey as keyof typeof GameMapType]}
        </div>
      </div>
    `;
  }
}
