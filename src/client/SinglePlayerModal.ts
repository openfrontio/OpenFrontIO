import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import randomMap from "../../resources/images/RandomMap.webp";
import { translateText } from "../client/Utils";
import {
  Difficulty,
  Duos,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Quads,
  Trios,
  UnitType,
  mapCategories,
} from "../core/game/Game";
import { UserSettings } from "../core/game/UserSettings";
import { TeamCountConfig } from "../core/Schemas";
import { generateID } from "../core/Util";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import "./components/Difficulties";
import "./components/GameOptionsDisplay";
import "./components/Maps";
import { fetchCosmetics } from "./Cosmetics";
import { FlagInput } from "./FlagInput";
import { JoinLobbyEvent } from "./Main";
import { UsernameInput } from "./UsernameInput";

@customElement("single-player-modal")
export class SinglePlayerModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };
  @state() private selectedMap: GameMapType = GameMapType.World;
  @state() private selectedDifficulty: Difficulty = Difficulty.Medium;
  @state() private disableNPCs: boolean = false;
  @state() private bots: number = 400;
  @state() private infiniteGold: boolean = false;
  @state() private infiniteTroops: boolean = false;
  @state() private compactMap: boolean = false;
  @state() private instantBuild: boolean = false;
  @state() private useRandomMap: boolean = false;
  @state() private gameMode: GameMode = GameMode.FFA;
  @state() private teamCount: TeamCountConfig = 2;

  @state() private disabledUnits: UnitType[] = [];

  private userSettings: UserSettings = new UserSettings();

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.handleKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleKeyDown);
    super.disconnectedCallback();
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      e.preventDefault();
      this.close();
    }
  };

  render() {
    return html`
      <o-modal title=${translateText("single_modal.title")}>
        <div class="options-layout">
          <!-- Map Selection -->
          <div class="options-section">
            <div class="option-title">${translateText("map.map")}</div>
            <div class="option-cards flex-col">
              <!-- Use the imported mapCategories -->
              ${Object.entries(mapCategories).map(
                ([categoryKey, maps]) => html`
                  <div class="w-full mb-4">
                    <h3
                      class="text-lg font-semibold mb-2 text-center text-gray-300"
                    >
                      ${translateText(`map_categories.${categoryKey}`)}
                    </h3>
                    <div class="flex flex-row flex-wrap justify-center gap-4">
                      ${maps.map((mapValue) => {
                        const mapKey = Object.keys(GameMapType).find(
                          (key) =>
                            GameMapType[key as keyof typeof GameMapType] ===
                            mapValue,
                        );
                        return html`
                          <div
                            @click=${() => this.handleMapSelection(mapValue)}
                          >
                            <map-display
                              .mapKey=${mapKey}
                              .selected=${!this.useRandomMap &&
                              this.selectedMap === mapValue}
                              .translation=${translateText(
                                `map.${mapKey?.toLowerCase()}`,
                              )}
                            ></map-display>
                          </div>
                        `;
                      })}
                    </div>
                  </div>
                `,
              )}
              <div
                class="option-card random-map ${this.useRandomMap
                  ? "selected"
                  : ""}"
                @click=${this.handleRandomMapToggle}
              >
                <div class="option-image">
                  <img
                    src=${randomMap}
                    alt="Random Map"
                    style="width:100%; aspect-ratio: 4/2; object-fit:cover; border-radius:8px;"
                  />
                </div>
                <div class="option-card-title">
                  ${translateText("map.random")}
                </div>
              </div>
            </div>
          </div>

          <!-- Difficulty Selection -->
          <div class="options-section">
            <div class="option-title">
              ${translateText("difficulty.difficulty")}
            </div>
            <div class="option-cards">
              ${Object.entries(Difficulty)
                .filter(([key]) => isNaN(Number(key)))
                .map(
                  ([key, value]) => html`
                    <div
                      class="option-card ${this.selectedDifficulty === value
                        ? "selected"
                        : ""}"
                      @click=${() => this.handleDifficultySelection(value)}
                    >
                      <difficulty-display
                        .difficultyKey=${key}
                      ></difficulty-display>
                      <p class="option-card-title">
                        ${translateText(`difficulty.${key}`)}
                      </p>
                    </div>
                  `,
                )}
            </div>
          </div>

          <!-- Game Mode Selection -->
          <div class="options-section">
            <div class="option-title">${translateText("host_modal.mode")}</div>
            <div class="option-cards">
              <div
                class="option-card ${this.gameMode === GameMode.FFA
                  ? "selected"
                  : ""}"
                @click=${() => this.handleGameModeSelection(GameMode.FFA)}
              >
                <div class="option-card-title">
                  ${translateText("game_mode.ffa")}
                </div>
              </div>
              <div
                class="option-card ${this.gameMode === GameMode.Team
                  ? "selected"
                  : ""}"
                @click=${() => this.handleGameModeSelection(GameMode.Team)}
              >
                <div class="option-card-title">
                  ${translateText("game_mode.teams")}
                </div>
              </div>
            </div>
          </div>

          ${this.gameMode === GameMode.FFA
            ? ""
            : html`
                <!-- Team Count Selection -->
                <div class="options-section">
                  <div class="option-title">
                    ${translateText("host_modal.team_count")}
                  </div>
                  <div class="option-cards">
                    ${[2, 3, 4, 5, 6, 7, Quads, Trios, Duos].map(
                      (o) => html`
                        <div
                          class="option-card ${this.teamCount === o
                            ? "selected"
                            : ""}"
                          @click=${() => this.handleTeamCountSelection(o)}
                        >
                          <div class="option-card-title">
                            ${typeof o === "string"
                              ? translateText(`public_lobby.teams_${o}`)
                              : translateText(`public_lobby.teams`, { num: o })}
                          </div>
                        </div>
                      `,
                    )}
                  </div>
                </div>
              `}

          <!-- Game Options -->
          <div class="options-section">
            <div class="option-title">
              ${translateText("single_modal.options_title")}
            </div>
            <div class="option-cards">
              <game-options-display
                .gameConfig=${this.getCurrentGameConfig()}
                .editable=${true}
                .bots=${this.bots}
                .onBotsChange=${this.handleBotsChange.bind(this)}
                .onOptionChange=${this.handleOptionChange.bind(this)}
                .onUnitToggle=${this.toggleUnit.bind(this)}
              ></game-options-display>
            </div>
          </div>
        </div>

        <o-button
          title=${translateText("single_modal.start")}
          @click=${this.startGame}
          blockDesktop
        ></o-button>
      </o-modal>
    `;
  }

  createRenderRoot() {
    return this; // light DOM
  }

  public open() {
    this.modalEl?.open();
    this.useRandomMap = false;
  }

  public close() {
    this.modalEl?.close();
  }

  private handleRandomMapToggle() {
    this.useRandomMap = true;
  }

  private handleMapSelection(value: GameMapType) {
    this.selectedMap = value;
    this.useRandomMap = false;
  }

  private handleDifficultySelection(value: Difficulty) {
    this.selectedDifficulty = value;
  }

  private handleBotsChange(value: number) {
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }
    this.bots = value;
  }

  private handleInstantBuildChange(e: Event) {
    this.instantBuild = Boolean((e.target as HTMLInputElement).checked);
  }

  private handleInfiniteGoldChange(e: Event) {
    this.infiniteGold = Boolean((e.target as HTMLInputElement).checked);
  }

  private handleInfiniteTroopsChange(e: Event) {
    this.infiniteTroops = Boolean((e.target as HTMLInputElement).checked);
  }

  private handleCompactMapChange(e: Event) {
    this.compactMap = Boolean((e.target as HTMLInputElement).checked);
  }

  private handleDisableNPCsChange(e: Event) {
    this.disableNPCs = Boolean((e.target as HTMLInputElement).checked);
  }

  private handleGameModeSelection(value: GameMode) {
    this.gameMode = value;
  }

  private handleTeamCountSelection(value: TeamCountConfig) {
    this.teamCount = value;
  }

  private getRandomMap(): GameMapType {
    const maps = Object.values(GameMapType);
    const randIdx = Math.floor(Math.random() * maps.length);
    return maps[randIdx] as GameMapType;
  }

  private toggleUnit(unit: UnitType, checked: boolean): void {
    console.log(`Toggling unit type: ${unit} to ${checked}`);
    this.disabledUnits = checked
      ? [...this.disabledUnits, unit]
      : this.disabledUnits.filter((u) => u !== unit);
  }

  /**
   * Gets the current game configuration for the options display component
   */
  private getCurrentGameConfig() {
    return {
      gameMap: this.selectedMap,
      gameMapSize: this.compactMap ? GameMapSize.Compact : GameMapSize.Normal,
      difficulty: this.selectedDifficulty,
      disableNPCs: this.disableNPCs,
      bots: this.bots,
      infiniteGold: this.infiniteGold,
      donateGold: true,
      infiniteTroops: this.infiniteTroops,
      donateTroops: true,
      instantBuild: this.instantBuild,
      gameMode: this.gameMode,
      gameType: GameType.Singleplayer,
      disabledUnits: this.disabledUnits,
      playerTeams: this.teamCount,
    };
  }

  /**
   * Unified handler for option changes from the shared component
   */
  private handleOptionChange(key: string, value: boolean) {
    switch (key) {
      case "disableNPCs":
        this.disableNPCs = value;
        break;
      case "instantBuild":
        this.instantBuild = value;
        break;
      case "infiniteGold":
        this.infiniteGold = value;
        break;
      case "infiniteTroops":
        this.infiniteTroops = value;
        break;
      case "compactMap":
        this.compactMap = value;
        break;
    }
  }

  private async startGame() {
    // If random map is selected, choose a random map now
    if (this.useRandomMap) {
      this.selectedMap = this.getRandomMap();
    }

    console.log(
      `Starting single player game with map: ${GameMapType[this.selectedMap as keyof typeof GameMapType]}${this.useRandomMap ? " (Randomly selected)" : ""}`,
    );
    const clientID = generateID();
    const gameID = generateID();

    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;
    if (!usernameInput) {
      console.warn("Username input element not found");
    }

    const flagInput = document.querySelector("flag-input") as FlagInput;
    if (!flagInput) {
      console.warn("Flag input element not found");
    }
    const cosmetics = await fetchCosmetics();
    let selectedPattern = this.userSettings.getSelectedPatternName(cosmetics);
    selectedPattern ??= cosmetics
      ? (this.userSettings.getDevOnlyPattern() ?? null)
      : null;

    const selectedColor = this.userSettings.getSelectedColor();

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          clientID: clientID,
          gameID: gameID,
          gameStartInfo: {
            gameID: gameID,
            players: [
              {
                clientID,
                username: usernameInput.getCurrentUsername(),
                cosmetics: {
                  flag:
                    flagInput.getCurrentFlag() === "xx"
                      ? ""
                      : flagInput.getCurrentFlag(),
                  pattern: selectedPattern ?? undefined,
                  color: selectedColor ? { color: selectedColor } : undefined,
                },
              },
            ],
            config: {
              gameMap: this.selectedMap,
              gameMapSize: this.compactMap
                ? GameMapSize.Compact
                : GameMapSize.Normal,
              gameType: GameType.Singleplayer,
              gameMode: this.gameMode,
              playerTeams: this.teamCount,
              difficulty: this.selectedDifficulty,
              disableNPCs: this.disableNPCs,
              bots: this.bots,
              infiniteGold: this.infiniteGold,
              donateGold: true,
              donateTroops: true,
              infiniteTroops: this.infiniteTroops,
              instantBuild: this.instantBuild,
              disabledUnits: this.disabledUnits
                .map((u) => Object.values(UnitType).find((ut) => ut === u))
                .filter((ut): ut is UnitType => ut !== undefined),
            },
          },
        } satisfies JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }
}
