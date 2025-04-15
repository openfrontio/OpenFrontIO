import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import randomMap from "../../resources/images/RandomMap.webp";
import { translateText } from "../client/Utils";
import { consolex } from "../core/Consolex";
import { Difficulty, GameMapType, GameMode, GameType } from "../core/game/Game";
import { generateID } from "../core/Util";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import "./components/Difficulties";
import { DifficultyDescription } from "./components/Difficulties";
import "./components/Maps";
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
  @state() private disableNukes: boolean = false;
  @state() private bots: number = 400;
  @state() private infiniteGold: boolean = false;
  @state() private infiniteTroops: boolean = false;
  @state() private instantBuild: boolean = false;
  @state() private useRandomMap: boolean = false;
  @state() private gameMode: GameMode = GameMode.FFA;

  render() {
    return html`
      <o-modal title=${translateText("single_modal.title")}>
        <div class="options-layout">
          <!-- Map Selection -->
          <div class="options-section">
            <div class="option-title">${translateText("map.map")}</div>
            <div class="option-cards">
              ${Object.entries(GameMapType)
                .filter(([key]) => isNaN(Number(key)))
                .map(
                  ([key, value]) => html`
                    <div
                      @click=${function () {
                        this.handleMapSelection(value);
                      }}
                    >
                      <map-display
                        .mapKey=${key}
                        .selected=${!this.useRandomMap &&
                        this.selectedMap === value}
                        .translation=${translateText(
                          `map.${key.toLowerCase()}`,
                        )}
                      ></map-display>
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

          <!-- Game Options -->
          <div class="options-section">
            <div class="option-title">
              ${translateText("single_modal.options_title")}
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
                  <span>${translateText("single_modal.bots")}</span>${this
                    .bots == 0
                    ? translateText("single_modal.bots_disabled")
                    : this.bots}
                </div>
              </label>

              <label
                for="singleplayer-modal-disable-npcs"
                class="option-card ${this.disableNPCs ? "selected" : ""}"
              >
                <div class="checkbox-icon"></div>
                <input
                  type="checkbox"
                  id="singleplayer-modal-disable-npcs"
                  @change=${this.handleDisableNPCsChange}
                  .checked=${this.disableNPCs}
                />
                <div class="option-card-title">
                  ${translateText("single_modal.disable_nations")}
                </div>
              </label>
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
                for="singleplayer-modal-disable-nukes"
                class="option-card ${this.disableNukes ? "selected" : ""}"
              >
                <div class="checkbox-icon"></div>
                <input
                  type="checkbox"
                  id="singleplayer-modal-disable-nukes"
                  @change=${this.handleDisableNukesChange}
                  .checked=${this.disableNukes}
                />
                <div class="option-card-title">
                  ${translateText("single_modal.disable_nukes")}
                </div>
              </label>
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
    const value = parseInt((e.target as HTMLInputElement).value);
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

  private handleDisableNPCsChange(e: Event) {
    this.disableNPCs = Boolean((e.target as HTMLInputElement).checked);
  }

  private handleDisableNukesChange(e: Event) {
    this.disableNukes = Boolean((e.target as HTMLInputElement).checked);
  }

  private handleGameModeSelection(value: GameMode) {
    this.gameMode = value;
  }

  private getRandomMap(): GameMapType {
    const maps = Object.values(GameMapType);
    const randIdx = Math.floor(Math.random() * maps.length);
    return maps[randIdx] as GameMapType;
  }

  private startGame() {
    // If random map is selected, choose a random map now
    if (this.useRandomMap) {
      this.selectedMap = this.getRandomMap();
    }

    consolex.log(
      `Starting single player game with map: ${GameMapType[this.selectedMap]}${this.useRandomMap ? " (Randomly selected)" : ""}`,
    );
    const clientID = generateID();
    const gameID = generateID();

    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;
    if (!usernameInput) {
      consolex.warn("Username input element not found");
    }

    const flagInput = document.querySelector("flag-input") as FlagInput;
    if (!flagInput) {
      consolex.warn("Flag input element not found");
    }
    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          clientID: clientID,
          gameID: gameID,
          gameStartInfo: {
            gameID: gameID,
            players: [
              {
                playerID: generateID(),
                clientID,
                username: usernameInput.getCurrentUsername(),
                flag:
                  flagInput.getCurrentFlag() == "xx"
                    ? ""
                    : flagInput.getCurrentFlag(),
              },
            ],
            config: {
              gameMap: this.selectedMap,
              gameType: GameType.Singleplayer,
              gameMode: this.gameMode,
              difficulty: this.selectedDifficulty,
              disableNPCs: this.disableNPCs,
              disableNukes: this.disableNukes,
              bots: this.bots,
              infiniteGold: this.infiniteGold,
              infiniteTroops: this.infiniteTroops,
              instantBuild: this.instantBuild,
            },
          },
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }
}
