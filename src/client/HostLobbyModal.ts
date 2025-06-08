import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import randomMap from "../../resources/images/RandomMap.webp";
import { translateText } from "../client/Utils";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import {
  Difficulty,
  Duos,
  GameMapType,
  GameMode,
  UnitType,
  mapCategories,
} from "../core/game/Game";
import { GameConfig, GameInfo } from "../core/Schemas";
import { generateID } from "../core/Util";
import "./components/baseComponents/Modal";
import "./components/Difficulties";
import { DifficultyDescription } from "./components/Difficulties";
import "./components/Maps";
import { JoinLobbyEvent } from "./Main";
import { renderUnitTypeOptions } from "./utilities/RenderUnitTypeOptions";

@customElement("host-lobby-modal")
export class HostLobbyModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };
  @state() private selectedMap: GameMapType = GameMapType.World;
  @state() private selectedDifficulty: Difficulty = Difficulty.Medium;
  @state() private disableNPCs = false;
  @state() private gameMode: GameMode = GameMode.FFA;
  @state() private teamCount: number | typeof Duos = 2;
  @state() private bots: number = 400;
  @state() private infiniteGold: boolean = false;
  @state() private infiniteTroops: boolean = false;
  @state() private instantBuild: boolean = false;
  @state() private lobbyId = "";
  @state() private copySuccess = false;
  @state() private players: string[] = [];
  @state() private useRandomMap: boolean = false;
  @state() private disabledUnits: UnitType[] = [];

  private playersInterval: NodeJS.Timeout | null = null;
  // Add a new timer for debouncing bot changes
  private botsUpdateTimer: number | null = null;

  render() {
    return html`
      <o-modal title=${translateText("host_modal.title")}>
        <div class="lobby-id-box">
          <button
            class="lobby-id-button"
            @click=${this.copyToClipboard}
            ?disabled=${this.copySuccess}
          >
            <span class="lobby-id">${this.lobbyId}</span>
            ${
              this.copySuccess
                ? html`<span class="copy-success-icon">✓</span>`
                : html`
                    <svg
                      class="clipboard-icon"
                      stroke="currentColor"
                      fill="currentColor"
                      stroke-width="0"
                      viewBox="0 0 512 512"
                      height="18px"
                      width="18px"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M296 48H176.5C154.4 48 136 65.4 136 87.5V96h-7.5C106.4 96 88 113.4 88 135.5v288c0 22.1 18.4 40.5 40.5 40.5h208c22.1 0 39.5-18.4 39.5-40.5V416h8.5c22.1 0 39.5-18.4 39.5-40.5V176L296 48zm0 44.6l83.4 83.4H296V92.6zm48 330.9c0 4.7-3.4 8.5-7.5 8.5h-208c-4.4 0-8.5-4.1-8.5-8.5v-288c0-4.1 3.8-7.5 8.5-7.5h7.5v255.5c0 22.1 10.4 32.5 32.5 32.5H344v7.5zm48-48c0 4.7-3.4 8.5-7.5 8.5h-208c-4.4 0-8.5-4.1-8.5-8.5v-288c0-4.1 3.8-7.5 8.5-7.5H264v128h128v167.5z"
                      ></path>
                    </svg>
                  `
            }
          </button>
        </div>
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
                          (key) => GameMapType[key] === mapValue,
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
                class="option-card random-map ${
                  this.useRandomMap ? "selected" : ""
                }"
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
            <div class="option-title">${translateText("difficulty.difficulty")}</div>
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
                        ${translateText(
                          `difficulty.${DifficultyDescription[key]}`,
                        )}
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
                class="option-card ${this.gameMode === GameMode.FFA ? "selected" : ""}"
                @click=${() => this.handleGameModeSelection(GameMode.FFA)}
              >
                <div class="option-card-title">
                  ${translateText("game_mode.ffa")}
                </div>
              </div>
              <div
                class="option-card ${this.gameMode === GameMode.Team ? "selected" : ""}"
                @click=${() => this.handleGameModeSelection(GameMode.Team)}
              >
                <div class="option-card-title">
                  ${translateText("game_mode.teams")}
                </div>
              </div>
            </div>
          </div>

          ${
            this.gameMode === GameMode.FFA
              ? ""
              : html`
                  <!-- Team Count Selection -->
                  <div class="options-section">
                    <div class="option-title">
                      ${translateText("host_modal.team_count")}
                    </div>
                    <div class="option-cards">
                      ${[Duos, 2, 3, 4, 5, 6, 7].map(
                        (o) => html`
                          <div
                            class="option-card ${this.teamCount === o
                              ? "selected"
                              : ""}"
                            @click=${() => this.handleTeamCountSelection(o)}
                          >
                            <div class="option-card-title">${o}</div>
                          </div>
                        `,
                      )}
                    </div>
                  </div>
                `
          }

          <!-- Game Options -->
          <div class="options-section">
            <div class="option-title">
              ${translateText("host_modal.options_title")}
            </div>
            <div class="option-cards">
              <label for="bots-count" class="option-card">
                <input
                  type="range"
                  id="bots-count"
                  min="0"
                  max="400"
                  step="1"
                  @input=${this.handleBotsChange}
                  @change=${this.handleBotsChange}
                  .value="${String(this.bots)}"
                />
                <div class="option-card-title">
                  <span>${translateText("host_modal.bots")}</span>${
                    this.bots === 0
                      ? translateText("host_modal.bots_disabled")
                      : this.bots
                  }
                </div>
              </label>

                <label
                  for="disable-npcs"
                  class="option-card ${this.disableNPCs ? "selected" : ""}"
                >
                  <div class="checkbox-icon"></div>
                  <input
                    type="checkbox"
                    id="disable-npcs"
                    @change=${this.handleDisableNPCsChange}
                    .checked=${this.disableNPCs}
                  />
                  <div class="option-card-title">
                    ${translateText("host_modal.disable_nations")}
                  </div>
                </label>

                <label
                  for="instant-build"
                  class="option-card ${this.instantBuild ? "selected" : ""}"
                >
                  <div class="checkbox-icon"></div>
                  <input
                    type="checkbox"
                    id="instant-build"
                    @change=${this.handleInstantBuildChange}
                    .checked=${this.instantBuild}
                  />
                  <div class="option-card-title">
                    ${translateText("host_modal.instant_build")}
                  </div>
                </label>

                <label
                  for="infinite-gold"
                  class="option-card ${this.infiniteGold ? "selected" : ""}"
                >
                  <div class="checkbox-icon"></div>
                  <input
                    type="checkbox"
                    id="infinite-gold"
                    @change=${this.handleInfiniteGoldChange}
                    .checked=${this.infiniteGold}
                  />
                  <div class="option-card-title">
                    ${translateText("host_modal.infinite_gold")}
                  </div>
                </label>

                <label
                  for="infinite-troops"
                  class="option-card ${this.infiniteTroops ? "selected" : ""}"
                >
                  <div class="checkbox-icon"></div>
                  <input
                    type="checkbox"
                    id="infinite-troops"
                    @change=${this.handleInfiniteTroopsChange}
                    .checked=${this.infiniteTroops}
                  />
                  <div class="option-card-title">
                    ${translateText("host_modal.infinite_troops")}
                  </div>
                </label>

                <hr style="width: 100%; border-top: 1px solid #444; margin: 16px 0;" />

                <!-- Individual disables for structures/weapons -->
                <div
                  style="margin: 8px 0 12px 0; font-weight: bold; color: #ccc; text-align: center;"
                >
                  ${translateText("host_modal.enables_title")}
                </div>
                <div
                  style="display: flex; flex-wrap: wrap; justify-content: center; gap: 12px;"
                >
                   ${renderUnitTypeOptions({
                     disabledUnits: this.disabledUnits,
                     toggleUnit: this.toggleUnit.bind(this),
                   })}
                  </div>
                </div>
              </div>
            </div>
          </div>

        <!-- Lobby Selection -->
        <div class="options-section">
          <div class="option-title">
            ${this.players.length}
            ${
              this.players.length === 1
                ? translateText("host_modal.player")
                : translateText("host_modal.players")
            }
          </div>

          <div class="players-list">
            ${this.players.map(
              (player) => html`<span class="player-tag">${player}</span>`,
            )}
          </div>
        </div>

        <div class="start-game-button-container">
          <button
            @click=${this.startGame}
            ?disabled=${this.players.length < 2}
            class="start-game-button"
          >
            ${
              this.players.length === 1
                ? translateText("host_modal.waiting")
                : translateText("host_modal.start")
            }
          </button>
        </div>

      </div>
    </o-modal>
    `;
  }

  createRenderRoot() {
    return this;
  }

  public open() {
    createLobby()
      .then((lobby) => {
        this.lobbyId = lobby.gameID;
        // join lobby
      })
      .then(() => {
        this.dispatchEvent(
          new CustomEvent("join-lobby", {
            detail: {
              gameID: this.lobbyId,
              clientID: generateID(),
            } as JoinLobbyEvent,
            bubbles: true,
            composed: true,
          }),
        );
      });
    this.modalEl?.open();
    this.playersInterval = setInterval(() => this.pollPlayers(), 1000);
  }

  public close() {
    this.modalEl?.close();
    this.copySuccess = false;
    if (this.playersInterval) {
      clearInterval(this.playersInterval);
      this.playersInterval = null;
    }
    // Clear any pending bot updates
    if (this.botsUpdateTimer !== null) {
      clearTimeout(this.botsUpdateTimer);
      this.botsUpdateTimer = null;
    }
  }

  private async handleRandomMapToggle() {
    this.useRandomMap = true;
    this.putGameConfig();
  }

  private async handleMapSelection(value: GameMapType) {
    this.selectedMap = value;
    this.useRandomMap = false;
    this.putGameConfig();
  }

  private async handleDifficultySelection(value: Difficulty) {
    this.selectedDifficulty = value;
    this.putGameConfig();
  }

  // Modified to include debouncing
  private handleBotsChange(e: Event) {
    const value = parseInt((e.target as HTMLInputElement).value);
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }

    // Update the display value immediately
    this.bots = value;

    // Clear any existing timer
    if (this.botsUpdateTimer !== null) {
      clearTimeout(this.botsUpdateTimer);
    }

    // Set a new timer to call putGameConfig after 300ms of inactivity
    this.botsUpdateTimer = window.setTimeout(() => {
      this.putGameConfig();
      this.botsUpdateTimer = null;
    }, 300);
  }

  private handleInstantBuildChange(e: Event) {
    this.instantBuild = Boolean((e.target as HTMLInputElement).checked);
    this.putGameConfig();
  }

  private handleInfiniteGoldChange(e: Event) {
    this.infiniteGold = Boolean((e.target as HTMLInputElement).checked);
    this.putGameConfig();
  }

  private handleInfiniteTroopsChange(e: Event) {
    this.infiniteTroops = Boolean((e.target as HTMLInputElement).checked);
    this.putGameConfig();
  }

  private async handleDisableNPCsChange(e: Event) {
    this.disableNPCs = Boolean((e.target as HTMLInputElement).checked);
    console.log(`updating disable npcs to ${this.disableNPCs}`);
    this.putGameConfig();
  }

  private async handleGameModeSelection(value: GameMode) {
    this.gameMode = value;
    this.putGameConfig();
  }

  private async handleTeamCountSelection(value: number | typeof Duos) {
    this.teamCount = value === Duos ? Duos : Number(value);
    this.putGameConfig();
  }

  private async putGameConfig() {
    const config = await getServerConfigFromClient();
    const response = await fetch(
      `${window.location.origin}/${config.workerPath(this.lobbyId)}/api/game/${this.lobbyId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gameMap: this.selectedMap,
          difficulty: this.selectedDifficulty,
          disableNPCs: this.disableNPCs,
          bots: this.bots,
          infiniteGold: this.infiniteGold,
          infiniteTroops: this.infiniteTroops,
          instantBuild: this.instantBuild,
          gameMode: this.gameMode,
          disabledUnits: this.disabledUnits,
          playerTeams: this.teamCount,
        } satisfies Partial<GameConfig>),
      },
    );
    return response;
  }

  private toggleUnit(unit: UnitType, checked: boolean): void {
    console.log(`Toggling unit type: ${unit} to ${checked}`);
    this.disabledUnits = checked
      ? [...this.disabledUnits, unit]
      : this.disabledUnits.filter((u) => u !== unit);

    this.putGameConfig();
  }

  private getRandomMap(): GameMapType {
    const maps = Object.values(GameMapType);
    const randIdx = Math.floor(Math.random() * maps.length);
    return maps[randIdx] as GameMapType;
  }

  private async startGame() {
    if (this.useRandomMap) {
      this.selectedMap = this.getRandomMap();
    }

    await this.putGameConfig();
    console.log(
      `Starting private game with map: ${GameMapType[this.selectedMap]} ${this.useRandomMap ? " (Randomly selected)" : ""}`,
    );
    this.close();
    const config = await getServerConfigFromClient();
    const response = await fetch(
      `${window.location.origin}/${config.workerPath(this.lobbyId)}/api/start_game/${this.lobbyId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
    return response;
  }

  private async copyToClipboard() {
    try {
      //TODO: Convert id to url and copy
      await navigator.clipboard.writeText(
        `${location.origin}/join/${this.lobbyId}`,
      );
      this.copySuccess = true;
      setTimeout(() => {
        this.copySuccess = false;
      }, 2000);
    } catch (err) {
      console.error(`Failed to copy text: ${err}`);
    }
  }

  private async pollPlayers() {
    const config = await getServerConfigFromClient();
    fetch(`/${config.workerPath(this.lobbyId)}/api/game/${this.lobbyId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((response) => response.json())
      .then((data: GameInfo) => {
        console.log(`got game info response: ${JSON.stringify(data)}`);
        this.players = data.clients?.map((p) => p.username) ?? [];
      });
  }
}

async function createLobby(): Promise<GameInfo> {
  const config = await getServerConfigFromClient();
  try {
    const id = generateID();
    const response = await fetch(
      `/${config.workerPath(id)}/api/create_game/${id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // body: JSON.stringify(data), // Include this if you need to send data
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Success:", data);

    return data as GameInfo;
  } catch (error) {
    console.error("Error creating lobby:", error);
    throw error; // Re-throw the error so the caller can handle it
  }
}
