import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { GameMapType } from "../../core/game/Game";
import { getMapsImage } from "../utilities/Maps";

// Add map descriptions
export const MapDescription: Record<keyof typeof GameMapType, string> = {
  World: "World",
  Europe: "Europe",
  Mena: "MENA",
  NorthAmerica: "North America",
  Oceania: "Oceania",
  BlackSea: "Black Sea",
  Africa: "Africa",
  Asia: "Asia",
  Mars: "Mars",
};

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

  render() {
    const mapValue = GameMapType[this.mapKey as keyof typeof GameMapType];

    return html`
      <div class="option-card ${this.selected ? "selected" : ""}">
        ${getMapsImage(mapValue)
          ? html`<img
              src="${getMapsImage(mapValue)}"
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
