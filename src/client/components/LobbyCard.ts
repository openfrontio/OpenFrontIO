import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { GameMode } from "../../core/game/Game";
import { GameConfig } from "../../core/Schemas";
import { terrainMapFileLoader } from "../TerrainMapFileLoader";
import { renderDuration, translateText } from "../Utils";

/**
 * Reusable lobby card component
 * Used by PublicLobby to advertise lobbies and JoinPrivateLobbyModal to display game info
 */
@customElement("lobby-card")
export class LobbyCard extends LitElement {
  /**
   * Game configuration to display
   */
  @property({ type: Object }) gameConfig?: GameConfig;

  /**
   * Map image source URL
   */
  @property({ type: String }) mapImageSrc?: string;

  /**
   * Whether the card should be highlighted (green gradient)
   */
  @property({ type: Boolean }) highlighted: boolean = false;

  /**
   * Whether the card is clickable/interactive
   */
  @property({ type: Boolean }) interactive: boolean = true;

  /**
   * Show the "Join next Game" CTA
   */
  @property({ type: Boolean }) showCta: boolean = true;

  /**
   * Show player count
   */
  @property({ type: Boolean }) showPlayerCount: boolean = true;

  /**
   * Show countdown timer
   */
  @property({ type: Boolean }) showTimer: boolean = true;

  /**
   * Show difficulty level
   */
  @property({ type: Boolean }) showDifficulty: boolean = false;

  /**
   * Number of current players
   */
  @property({ type: Number }) numClients?: number;

  /**
   * Maximum number of players
   */
  @property({ type: Number }) maxPlayers?: number;

  /**
   * Time remaining in seconds
   */
  @property({ type: Number }) timeRemaining?: number;

  /**
   * Whether the card is in a debounced state
   */
  @property({ type: Boolean }) debounced: boolean = false;

  private currentMapType: string = "";

  createRenderRoot() {
    return this;
  }

  async connectedCallback() {
    super.connectedCallback();
    // Load map image if needed and not provided
    if (this.gameConfig && !this.mapImageSrc) {
      this.loadMapImage();
    }
  }

  updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties);

    // Check if gameConfig changed and if the map type is different
    if (changedProperties.has("gameConfig") && this.gameConfig) {
      if (this.gameConfig.gameMap !== this.currentMapType) {
        this.loadMapImage();
      }
    }
  }

  private async loadMapImage() {
    if (!this.gameConfig) return;

    try {
      const data = terrainMapFileLoader.getMapData(this.gameConfig.gameMap);
      this.mapImageSrc = await data.webpPath();
      this.currentMapType = this.gameConfig.gameMap;
      this.requestUpdate();
    } catch (error) {
      console.error("Failed to load map image:", error);
    }
  }

  render() {
    if (!this.gameConfig) return html``;

    const teamCount =
      this.gameConfig.gameMode === GameMode.Team
        ? (this.gameConfig.playerTeams ?? 0)
        : null;

    const timeDisplay =
      this.timeRemaining !== undefined
        ? renderDuration(this.timeRemaining)
        : "";

    const cardClasses = `
      isolate grid h-40 grid-cols-[100%] grid-rows-[100%] place-content-stretch w-full overflow-hidden
      ${
        this.highlighted
          ? "bg-gradient-to-r from-green-600 to-green-500"
          : "bg-gradient-to-r from-blue-600 to-blue-500"
      }
      text-white font-medium rounded-xl transition-opacity duration-200
      ${this.interactive ? "hover:opacity-90 cursor-pointer" : ""}
      ${this.debounced ? "opacity-70 cursor-not-allowed" : ""}
    `;

    const cardContent = html`
      ${this.mapImageSrc
        ? html`<img
            src="${this.mapImageSrc}"
            alt="${this.gameConfig.gameMap}"
            class="place-self-start col-span-full row-span-full h-full -z-10"
            style="mask-image: linear-gradient(to left, transparent, #fff)"
          />`
        : html`<div
            class="place-self-start col-span-full row-span-full h-full -z-10 bg-gray-300"
          ></div>`}
      <div
        class="flex flex-col justify-between h-full col-span-full row-span-full p-4 md:p-6 text-right z-0"
      >
        <div>
          ${this.showCta
            ? html`<div class="text-lg md:text-2xl font-semibold">
                ${translateText("public_lobby.join")}
              </div>`
            : ""}
          <div class="text-md font-medium text-blue-100">
            <span
              class="text-sm ${this.highlighted
                ? "text-green-600"
                : "text-blue-600"} bg-white rounded-sm px-1"
              >${this.gameConfig.gameMode === GameMode.Team
                ? typeof teamCount === "string"
                  ? translateText(`public_lobby.teams_${teamCount}`)
                  : translateText("public_lobby.teams", {
                      num: teamCount ?? 0,
                    })
                : translateText("game_mode.ffa")}</span
            >
            <span>
              ${translateText(
                `map.${this.gameConfig.gameMap.toLowerCase().replace(/\s+/g, "")}`,
              )}</span
            >
          </div>
          ${this.showDifficulty
            ? html`<div class="text-md font-medium text-blue-100 mt-1">
                ${translateText(
                  "private_lobby.difficulty",
                )}${this.formatDifficulty()}
              </div>`
            : ""}
        </div>

        <div>
          ${this.showPlayerCount &&
          this.numClients !== undefined &&
          this.maxPlayers !== undefined
            ? html`<div class="text-md font-medium text-blue-100">
                ${this.numClients} / ${this.maxPlayers}
              </div>`
            : ""}
          ${this.showTimer && timeDisplay
            ? html`<div class="text-md font-medium text-blue-100">
                ${timeDisplay}
              </div>`
            : ""}
        </div>
      </div>
    `;

    return this.interactive
      ? html`
          <button
            class="${cardClasses}"
            ?disabled=${this.debounced}
            @click=${this.handleClick}
          >
            ${cardContent}
          </button>
        `
      : html` <div class="${cardClasses}">${cardContent}</div> `;
  }

  private formatDifficulty(): string {
    if (!this.gameConfig) return "";

    const difficulty = this.gameConfig.difficulty;

    // Difficulty is a string enum ("Easy", "Medium", "Hard", "Impossible")
    const translated = translateText(`difficulty.${difficulty}`);
    if (translated !== `difficulty.${difficulty}`) {
      return translated;
    }

    return String(difficulty);
  }

  private handleClick() {
    if (this.interactive && !this.debounced) {
      this.dispatchEvent(
        new CustomEvent("card-click", {
          bubbles: true,
          composed: true,
        }),
      );
    }
  }
}
