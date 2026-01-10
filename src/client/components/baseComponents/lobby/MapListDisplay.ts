import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Difficulty, GameMapType } from "../../../../core/game/Game";
import { terrainMapFileLoader } from "../../../TerrainMapFileLoader";
import { translateText } from "../../../Utils";
import "./MapCard";

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
  BritanniaClassic: "Britannia Classic",
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
  Pluto: "Pluto",
  Montreal: "Montreal",
  NewYorkCity: "New York City",
  Achiran: "Achiran",
  BaikalNukeWars: "Baikal (Nuke Wars)",
  FourIslands: "Four Islands",
  Svalmel: "Svalmel",
  GulfOfStLawrence: "Gulf of St. Lawrence",
  Lisbon: "Lisbon",
  Manicouagan: "Manicouagan",
  Lemnos: "Lemnos",
  TwoLakes: "Two Lakes",
  Sierpinski: "Sierpinski",
  StraitOfHormuz: "Strait of Hormuz",
  Surrounded: "Surrounded",
  Didier: "Didier",
  DidierFrance: "Didier (France)",
  AmazonRiver: "Amazon River",
};

@customElement("map-list-display")
export class MapListDisplay extends LitElement {
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
    const name = this.translation?.length
      ? this.translation
      : (this.mapName ?? this.mapKey);
    const imageSrc = this.isLoading ? undefined : (this.mapWebpPath ?? null);
    return html`
      <lobby-map-card
        .imageSrc=${imageSrc}
        .name=${name}
        aria-selected=${this.selected ? "true" : "false"}
      >
        ${this.showMedals ? this.renderMedals() : null}
      </lobby-map-card>
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
