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
  HumansVsNations,
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
import "./components/FluentSlider";
import "./components/Maps";
import { fetchCosmetics } from "./Cosmetics";
import { FlagInput } from "./FlagInput";
import { JoinLobbyEvent } from "./Main";
import { UsernameInput } from "./UsernameInput";
import { renderUnitTypeOptions } from "./utilities/RenderUnitTypeOptions";

@customElement("single-player-modal")
export class SinglePlayerModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };
  @state() private selectedMap: GameMapType = GameMapType.World;
  @state() private selectedDifficulty: Difficulty = Difficulty.Medium;
  @state() private disableNations: boolean = false;
  @state() private bots: number = 400;
  @state() private infiniteGold: boolean = false;
  @state() private infiniteTroops: boolean = false;
  @state() private compactMap: boolean = false;
  @state() private maxTimer: boolean = false;
  @state() private maxTimerValue: number | undefined = undefined;
  @state() private instantBuild: boolean = false;
  @state() private randomSpawn: boolean = false;
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
              <div class="option-card">
                <fluent-slider
                  min="0"
                  max="400"
                  step="1"
                  .value=${this.bots}
                  labelKey="single_modal.bots"
                  disabledKey="single_modal.bots_disabled"
                  @value-changed=${this.handleBotsChange}
                ></fluent-slider>
              </div>

              ${!(
                this.gameMode === GameMode.Team &&
                this.teamCount === HumansVsNations
              )
                ? html`
                    <label
                      for="singleplayer-modal-disable-nations"
                      class="option-card ${this.disableNations
                        ? "selected"
                        : ""}"
                    >
                      <div class="checkbox-icon"></div>
                      <input
                        type="checkbox"
                        id="singleplayer-modal-disable-nations"
                        @change=${this.handleDisableNationsChange}
                        .checked=${this.disableNations}
                      />
                      <div class="option-card-title">
                        ${translateText("single_modal.disable_nations")}
                      </div>
                    </label>
                  `
                : ""}

              <label
                for="singleplayer-modal-instant-build"
                class="option-card ${this.instantBuild ? "selected" : ""}"
              >
                <div class="checkbox-icon"></div>
                <input
                  type="checkbox"
                  id="singleplayer-modal-instant-build"
                  @change=${this.handleInstantBuildChange}
                  .checked=${this.instantBuild}
                />
                <div class="option-card-title">
                  ${translateText("single_modal.instant_build")}
                </div>
              </label>

              <label
                for="singleplayer-modal-random-spawn"
                class="option-card ${this.randomSpawn ? "selected" : ""}"
              >
                <div class="checkbox-icon"></div>
                <input
                  type="checkbox"
                  id="singleplayer-modal-random-spawn"
                  @change=${this.handleRandomSpawnChange}
                  .checked=${this.randomSpawn}
                />
                <div class="option-card-title">
                  ${translateText("single_modal.random_spawn")}
                </div>
              </label>

              <label
                for="singleplayer-modal-infinite-gold"
                class="option-card ${this.infiniteGold ? "selected" : ""}"
              >
                <div class="checkbox-icon"></div>
                <input
                  type="checkbox"
                  id="singleplayer-modal-infinite-gold"
                  @change=${this.handleInfiniteGoldChange}
                  .checked=${this.infiniteGold}
                />
                <div class="option-card-title">
                  ${translateText("single_modal.infinite_gold")}
                </div>
              </label>

              <label
                for="singleplayer-modal-infinite-troops"
                class="option-card ${this.infiniteTroops ? "selected" : ""}"
              >
                <div class="checkbox-icon"></div>
                <input
                  type="checkbox"
                  id="singleplayer-modal-infinite-troops"
                  @change=${this.handleInfiniteTroopsChange}
                  .checked=${this.infiniteTroops}
                />
                <div class="option-card-title">
                  ${translateText("single_modal.infinite_troops")}
                </div>
              </label>
              <label
                for="singleplayer-modal-compact-map"
                class="option-card ${this.compactMap ? "selected" : ""}"
              >
                <div class="checkbox-icon"></div>
                <input
                  type="checkbox"
                  id="singleplayer-modal-compact-map"
                  @change=${this.handleCompactMapChange}
                  .checked=${this.compactMap}
                />
                <div class="option-card-title">
                  ${translateText("single_modal.compact_map")}
                </div>
              </label>
              <label
                for="end-timer"
                class="option-card ${this.maxTimer ? "selected" : ""}"
              >
                <div class="checkbox-icon"></div>
                <input
                  type="checkbox"
                  id="end-timer"
                  @change=${(e: Event) => {
                    const checked = (e.target as HTMLInputElement).checked;
                    if (!checked) {
                      this.maxTimerValue = undefined;
                    }
                    this.maxTimer = checked;
                  }}
                  .checked=${this.maxTimer}
                />
                ${this.maxTimer === false
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
                    />`}
                <div class="option-card-title">
                  ${translateText("single_modal.max_timer")}
                </div>
              </label>
            </div>

            <hr
              style="width: 100%; border-top: 1px solid #444; margin: 16px 0;"
            />
            <div
              style="margin: 8px 0 12px 0; font-weight: bold; color: #ccc; text-align: center;"
            >
              ${translateText("single_modal.enables_title")}
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

  private handleBotsChange(e: Event) {
    const customEvent = e as CustomEvent<{ value: number }>;
    const value = customEvent.detail.value;
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }
    this.bots = value;
  }

  private handleInstantBuildChange(e: Event) {
    this.instantBuild = Boolean((e.target as HTMLInputElement).checked);
  }

  private handleRandomSpawnChange(e: Event) {
    this.randomSpawn = Boolean((e.target as HTMLInputElement).checked);
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
  }

  private handleDisableNationsChange(e: Event) {
    this.disableNations = Boolean((e.target as HTMLInputElement).checked);
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
              maxTimerValue: this.maxTimer ? this.maxTimerValue : undefined,
              bots: this.bots,
              infiniteGold: this.infiniteGold,
              donateGold: true,
              donateTroops: true,
              infiniteTroops: this.infiniteTroops,
              instantBuild: this.instantBuild,
              randomSpawn: this.randomSpawn,
              disabledUnits: this.disabledUnits
                .map((u) => Object.values(UnitType).find((ut) => ut === u))
                .filter((ut): ut is UnitType => ut !== undefined),
              ...(this.gameMode === GameMode.Team &&
              this.teamCount === HumansVsNations
                ? {
                    disableNations: false,
                  }
                : {
                    disableNations: this.disableNations,
                  }),
            },
            lobbyCreatedAt: Date.now(), // ms; server should be authoritative in MP
          },
        } satisfies JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }
}
