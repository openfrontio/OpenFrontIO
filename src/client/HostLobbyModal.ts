import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import randomMap from "../../resources/images/RandomMap.webp";
import { translateText } from "../client/Utils";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import {
  Difficulty,
  Duos,
  GameMapSize,
  GameMapType,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
  UnitType,
  mapCategories,
} from "../core/game/Game";
import { UserSettings } from "../core/game/UserSettings";
import {
  ClientInfo,
  GameConfig,
  GameInfo,
  TeamCountConfig,
} from "../core/Schemas";
import { generateID } from "../core/Util";
import "./components/baseComponents/Modal";
import "./components/Difficulties";
import "./components/FluentSlider";
import "./components/LobbyTeamView";
import "./components/Maps";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { JoinLobbyEvent } from "./Main";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { renderUnitTypeOptions } from "./utilities/RenderUnitTypeOptions";
@customElement("host-lobby-modal")
export class HostLobbyModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
    onClose?: () => void;
  };
  @state() private selectedMap: GameMapType = GameMapType.World;
  @state() private selectedDifficulty: Difficulty = Difficulty.Medium;
  @state() private disableNations = false;
  @state() private gameMode: GameMode = GameMode.FFA;
  @state() private teamCount: TeamCountConfig = 2;
  @state() private bots: number = 400;
  @state() private infiniteGold: boolean = false;
  @state() private donateGold: boolean = false;
  @state() private infiniteTroops: boolean = false;
  @state() private donateTroops: boolean = false;
  @state() private maxTimer: boolean = false;
  @state() private maxTimerValue: number | undefined = undefined;
  @state() private instantBuild: boolean = false;
  @state() private randomSpawn: boolean = false;
  @state() private compactMap: boolean = false;
  @state() private lobbyId = "";
  @state() private copySuccess = false;
  @state() private clients: ClientInfo[] = [];
  @state() private useRandomMap: boolean = false;
  @state() private disabledUnits: UnitType[] = [];
  @state() private lobbyCreatorClientID: string = "";
  @state() private lobbyIdVisible: boolean = true;
  @state() private nationCount: number = 0;

  private playersInterval: NodeJS.Timeout | null = null;
  // Add a new timer for debouncing bot changes
  private botsUpdateTimer: number | null = null;
  private userSettings: UserSettings = new UserSettings();
  private mapLoader = terrainMapFileLoader;

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
      <o-modal title=${translateText("host_modal.title")}>
        <div class="lobby-id-box">
          <button class="lobby-id-button">
            <!-- Visibility toggle icon on the left -->
            ${
              this.lobbyIdVisible
                ? html`<svg
                    class="visibility-icon"
                    @click=${() => {
                      this.lobbyIdVisible = !this.lobbyIdVisible;
                      this.requestUpdate();
                    }}
                    style="margin-right: 8px; cursor: pointer;"
                    stroke="currentColor"
                    fill="currentColor"
                    stroke-width="0"
                    viewBox="0 0 512 512"
                    height="18px"
                    width="18px"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M256 105c-101.8 0-188.4 62.7-224 151 35.6 88.3 122.2 151 224 151s188.4-62.7 224-151c-35.6-88.3-122.2-151-224-151zm0 251.7c-56 0-101.7-45.7-101.7-101.7S200 153.3 256 153.3 357.7 199 357.7 255 312 356.7 256 356.7zm0-161.1c-33 0-59.4 26.4-59.4 59.4s26.4 59.4 59.4 59.4 59.4-26.4 59.4-59.4-26.4-59.4-59.4-59.4z"
                    ></path>
                  </svg>`
                : html`<svg
                    class="visibility-icon"
                    @click=${() => {
                      this.lobbyIdVisible = !this.lobbyIdVisible;
                      this.requestUpdate();
                    }}
                    style="margin-right: 8px; cursor: pointer;"
                    stroke="currentColor"
                    fill="currentColor"
                    stroke-width="0"
                    viewBox="0 0 512 512"
                    height="18px"
                    width="18px"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M448 256s-64-128-192-128S64 256 64 256c32 64 96 128 192 128s160-64 192-128z"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="32"
                    ></path>
                    <path
                      d="M144 256l224 0"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="32"
                      stroke-linecap="round"
                    ></path>
                  </svg>`
            }
            <!-- Lobby ID (conditionally shown) -->
            <span class="lobby-id" @click=${this.copyToClipboard} style="cursor: pointer;">
              ${this.lobbyIdVisible ? this.lobbyId : "••••••••"}
            </span>

            <!-- Copy icon/success indicator -->
            <div @click=${this.copyToClipboard} style="margin-left: 8px; cursor: pointer;">
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
            </div>
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
                        ${translateText(`difficulty.${key.toLowerCase()}`)}
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
                      ${[
                        2,
                        3,
                        4,
                        5,
                        6,
                        7,
                        Quads,
                        Trios,
                        Duos,
                        HumansVsNations,
                      ].map(
                        (o) => html`
                          <div
                            class="option-card ${this.teamCount === o
                              ? "selected"
                              : ""}"
                            @click=${() => this.handleTeamCountSelection(o)}
                          >
                            <div class="option-card-title">
                              ${typeof o === "string"
                                ? o === HumansVsNations
                                  ? translateText("public_lobby.teams_hvn")
                                  : translateText(`host_modal.teams_${o}`)
                                : translateText("public_lobby.teams", {
                                    num: o,
                                  })}
                            </div>
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
                <div class="option-card">
                <fluent-slider
                    min="0"
                    max="400"
                    step="1"
                    .value=${this.bots}
                  labelKey="host_modal.bots"
                  disabledKey="host_modal.bots_disabled"
                  @value-changed=${this.handleBotsChange}
                ></fluent-slider>
              </div>

                ${
                  !(
                    this.gameMode === GameMode.Team &&
                    this.teamCount === HumansVsNations
                  )
                    ? html`
                        <label
                          for="disable-nations"
                          class="option-card ${this.disableNations
                            ? "selected"
                            : ""}"
                        >
                          <div class="checkbox-icon"></div>
                          <input
                            type="checkbox"
                            id="disable-nations"
                            @change=${this.handleDisableNationsChange}
                            .checked=${this.disableNations}
                          />
                          <div class="option-card-title">
                            ${translateText("host_modal.disable_nations")}
                          </div>
                        </label>
                      `
                    : ""
                }

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
                  for="random-spawn"
                  class="option-card ${this.randomSpawn ? "selected" : ""}"
                >
                  <div class="checkbox-icon"></div>
                  <input
                    type="checkbox"
                    id="random-spawn"
                    @change=${this.handleRandomSpawnChange}
                    .checked=${this.randomSpawn}
                  />
                  <div class="option-card-title">
                    ${translateText("host_modal.random_spawn")}
                  </div>
                </label>

                <label
                  for="donate-gold"
                  class="option-card ${this.donateGold ? "selected" : ""}"
                >
                  <div class="checkbox-icon"></div>
                  <input
                    type="checkbox"
                    id="donate-gold"
                    @change=${this.handleDonateGoldChange}
                    .checked=${this.donateGold}
                  />
                  <div class="option-card-title">
                    ${translateText("host_modal.donate_gold")}
                  </div>
                </label>

                <label
                  for="donate-troops"
                  class="option-card ${this.donateTroops ? "selected" : ""}"
                >
                  <div class="checkbox-icon"></div>
                  <input
                    type="checkbox"
                    id="donate-troops"
                    @change=${this.handleDonateTroopsChange}
                    .checked=${this.donateTroops}
                  />
                  <div class="option-card-title">
                    ${translateText("host_modal.donate_troops")}
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
                <label
                for="host-modal-compact-map"
                class="option-card ${this.compactMap ? "selected" : ""}"
              >
                <div class="checkbox-icon"></div>
                <input
                  type="checkbox"
                  id="host-modal-compact-map"
                  @change=${this.handleCompactMapChange}
                  .checked=${this.compactMap}
                />
                <div class="option-card-title">
                  ${translateText("host_modal.compact_map")}
                </div>
              </label>

                <label
                  for="max-timer"
                class="option-card ${this.maxTimer ? "selected" : ""}"
                >
                  <div class="checkbox-icon"></div>
                  <input
                    type="checkbox"
                    id="max-timer"
                    @change=${(e: Event) => {
                      const checked = (e.target as HTMLInputElement).checked;
                      if (!checked) {
                        this.maxTimerValue = undefined;
                      }
                      this.maxTimer = checked;
                      this.putGameConfig();
                    }}
                    .checked=${this.maxTimer}
                  />
                    ${
                      this.maxTimer === false
                        ? ""
                        : html`<input
                            type="number"
                            id="end-timer-value"
                            min="0"
                            max="120"
                            .value=${String(this.maxTimerValue ?? "")}
                            style="width: 60px; color: black; text-align: right; border-radius: 8px;"
                            @input=${this.handleMaxTimerValueChanges}
                            @keydown=${this.handleMaxTimerValueKeyDown}
                          />`
                    }
                  <div class="option-card-title">
                    ${translateText("host_modal.max_timer")}
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
            ${this.clients.length}
            ${
              this.clients.length === 1
                ? translateText("host_modal.player")
                : translateText("host_modal.players")
            }
            <span style="margin: 0 8px;">•</span>
            ${this.disableNations ? 0 : this.nationCount}
            ${
              this.nationCount === 1
                ? translateText("host_modal.nation_player")
                : translateText("host_modal.nation_players")
            }
          </div>

          <lobby-team-view
            .gameMode=${this.gameMode}
            .clients=${this.clients}
            .lobbyCreatorClientID=${this.lobbyCreatorClientID}
            .teamCount=${this.teamCount}
            .nationCount=${this.disableNations ? 0 : this.nationCount}
            .onKickPlayer=${(clientID: string) => this.kickPlayer(clientID)}
          ></lobby-team-view>
        </div>

        <div class="start-game-button-container">
          <button
            @click=${this.startGame}
            ?disabled=${this.clients.length < 2}
            class="start-game-button"
          >
            ${
              this.clients.length === 1
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
    this.lobbyCreatorClientID = generateID();
    this.lobbyIdVisible = this.userSettings.get(
      "settings.lobbyIdVisibility",
      true,
    );

    createLobby(this.lobbyCreatorClientID)
      .then((lobby) => {
        this.lobbyId = lobby.gameID;
        crazyGamesSDK.showInviteButton(this.lobbyId);
      })
      .then(() => {
        this.dispatchEvent(
          new CustomEvent("join-lobby", {
            detail: {
              gameID: this.lobbyId,
              clientID: this.lobbyCreatorClientID,
            } as JoinLobbyEvent,
            bubbles: true,
            composed: true,
          }),
        );
      });
    this.modalEl?.open();
    this.modalEl.onClose = () => {
      this.close();
    };
    this.playersInterval = setInterval(() => this.pollPlayers(), 1000);
    this.loadNationCount();
  }

  public close() {
    console.log("Closing host lobby modal");
    crazyGamesSDK.hideInviteButton();
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
    this.selectedMap = this.getRandomMap();
    await this.loadNationCount();
    this.putGameConfig();
  }

  private async handleMapSelection(value: GameMapType) {
    this.selectedMap = value;
    this.useRandomMap = false;
    await this.loadNationCount();
    this.putGameConfig();
  }

  private async handleDifficultySelection(value: Difficulty) {
    this.selectedDifficulty = value;
    this.putGameConfig();
  }

  // Modified to include debouncing
  private handleBotsChange(e: Event) {
    const customEvent = e as CustomEvent<{ value: number }>;
    const value = customEvent.detail.value;
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

  private handleRandomSpawnChange(e: Event) {
    this.randomSpawn = Boolean((e.target as HTMLInputElement).checked);
    this.putGameConfig();
  }

  private handleInfiniteGoldChange(e: Event) {
    this.infiniteGold = Boolean((e.target as HTMLInputElement).checked);
    this.putGameConfig();
  }

  private handleDonateGoldChange(e: Event) {
    this.donateGold = Boolean((e.target as HTMLInputElement).checked);
    this.putGameConfig();
  }

  private handleInfiniteTroopsChange(e: Event) {
    this.infiniteTroops = Boolean((e.target as HTMLInputElement).checked);
    this.putGameConfig();
  }

  private handleCompactMapChange(e: Event) {
    this.compactMap = Boolean((e.target as HTMLInputElement).checked);
    this.putGameConfig();
  }

  private handleDonateTroopsChange(e: Event) {
    this.donateTroops = Boolean((e.target as HTMLInputElement).checked);
    this.putGameConfig();
  }

  private handleMaxTimerValueKeyDown(e: KeyboardEvent) {
    if (["-", "+", "e"].includes(e.key)) {
      e.preventDefault();
    }
  }

  private handleMaxTimerValueChanges(e: Event) {
    (e.target as HTMLInputElement).value = (
      e.target as HTMLInputElement
    ).value.replace(/[e+-]/gi, "");
    const value = parseInt((e.target as HTMLInputElement).value);

    if (isNaN(value) || value < 0 || value > 120) {
      return;
    }
    this.maxTimerValue = value;
    this.putGameConfig();
  }

  private async handleDisableNationsChange(e: Event) {
    this.disableNations = Boolean((e.target as HTMLInputElement).checked);
    console.log(`updating disable nations to ${this.disableNations}`);
    this.putGameConfig();
  }

  private async handleGameModeSelection(value: GameMode) {
    this.gameMode = value;
    this.putGameConfig();
  }

  private async handleTeamCountSelection(value: TeamCountConfig) {
    this.teamCount = value;
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
          gameMapSize: this.compactMap
            ? GameMapSize.Compact
            : GameMapSize.Normal,
          difficulty: this.selectedDifficulty,
          bots: this.bots,
          infiniteGold: this.infiniteGold,
          donateGold: this.donateGold,
          infiniteTroops: this.infiniteTroops,
          donateTroops: this.donateTroops,
          instantBuild: this.instantBuild,
          randomSpawn: this.randomSpawn,
          gameMode: this.gameMode,
          disabledUnits: this.disabledUnits,
          playerTeams: this.teamCount,
          ...(this.gameMode === GameMode.Team &&
          this.teamCount === HumansVsNations
            ? {
                disableNations: false,
              }
            : {
                disableNations: this.disableNations,
              }),
          maxTimerValue:
            this.maxTimer === true ? this.maxTimerValue : undefined,
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
    await this.putGameConfig();
    console.log(
      `Starting private game with map: ${GameMapType[this.selectedMap as keyof typeof GameMapType]} ${this.useRandomMap ? " (Randomly selected)" : ""}`,
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
      await navigator.clipboard.writeText(
        `${location.origin}/#join=${this.lobbyId}`,
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
        this.clients = data.clients ?? [];
      });
  }

  private kickPlayer(clientID: string) {
    // Dispatch event to be handled by WebSocket instead of HTTP
    this.dispatchEvent(
      new CustomEvent("kick-player", {
        detail: { target: clientID },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async loadNationCount() {
    try {
      const mapData = this.mapLoader.getMapData(this.selectedMap);
      const manifest = await mapData.manifest();
      this.nationCount = manifest.nations.length;
    } catch (error) {
      console.warn("Failed to load nation count", error);
      this.nationCount = 0;
    }
  }
}

async function createLobby(creatorClientID: string): Promise<GameInfo> {
  const config = await getServerConfigFromClient();
  try {
    const id = generateID();
    const response = await fetch(
      `/${config.workerPath(id)}/api/create_game/${id}?creatorClientID=${encodeURIComponent(creatorClientID)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // body: JSON.stringify(data), // Include this if you need to send data
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Server error response:", errorText);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Success:", data);

    return data as GameInfo;
  } catch (error) {
    console.error("Error creating lobby:", error);
    throw error;
  }
}
