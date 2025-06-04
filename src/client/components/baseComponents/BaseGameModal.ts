// File: BaseGameModal.ts

import { html, LitElement } from "lit";
import { query, state } from "lit/decorators.js";
import {
  Difficulty,
  Duos,
  GameMapType,
  GameMode,
  GameType,
  mapCategories,
  UnitType,
} from "../../../core/game/Game";
import { GameConfig } from "../../../core/Schemas";
import { renderCheckboxOption } from "../../utilities/RenderCheckboxOption";
import { renderUnitTypeOptions } from "../../utilities/RenderUnitTypeOptions";
import { translateText } from "../../Utils";
import { DifficultyDescription } from "../Difficulties";

export abstract class BaseGameModal extends LitElement {
  @query("o-modal") protected modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() protected selectedMap: GameMapType = GameMapType.World;
  @state() protected selectedDifficulty: Difficulty = Difficulty.Medium;
  @state() protected useRandomMap = false;
  @state() protected gameMode: GameMode = GameMode.FFA;
  @state() protected teamCount: number | typeof Duos = 2;
  @state() protected disabledUnits: UnitType[] = [];

  @state() protected gameOptions = {
    disableNPCs: false,
    bots: 400,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
  };

  private randomMap =
    typeof window !== "undefined"
      ? require("../../../../resources/images/RandomMap.webp")
      : "";

  protected botsUpdateTimer: number | null = null;

  // Translation helper
  protected t(key: string): string {
    return translateText(`${this.getTranslationPrefix()}.${key}`);
  }

  // Public interface
  public open() {
    this.modalEl?.open();
    this.useRandomMap = false;
  }

  public close() {
    this.modalEl?.close();
    if (this.botsUpdateTimer !== null) {
      clearTimeout(this.botsUpdateTimer);
      this.botsUpdateTimer = null;
    }
  }

  public getGameConfig(): GameConfig {
    return {
      gameMap: this.useRandomMap ? this.getRandomMap() : this.selectedMap,
      difficulty: this.selectedDifficulty,
      disableNPCs: this.gameOptions.disableNPCs,
      bots: this.gameOptions.bots,
      infiniteGold: this.gameOptions.infiniteGold,
      infiniteTroops: this.gameOptions.infiniteTroops,
      instantBuild: this.gameOptions.instantBuild,
      gameMode: this.gameMode,
      playerTeams: this.teamCount,
      disabledUnits: this.disabledUnits,
      gameType: GameType.Singleplayer,
    };
  }

  // Rendering Methods
  protected renderMapSelection() {
    return html`
      <div class="options-section">
        <div class="option-title">${translateText("map.map")}</div>
        <div class="option-cards flex-col">
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
                      (k) => GameMapType[k] === mapValue,
                    );
                    return html`
                      <div @click=${() => this.handleMapSelection(mapValue)}>
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
            @click=${() => (this.useRandomMap = true)}
          >
            <div class="option-image">
              <img
                src=${this.randomMap}
                alt="Random Map"
                class="map-thumbnail"
              />
            </div>
            <div class="option-card-title">${translateText("map.random")}</div>
          </div>
        </div>
      </div>
    `;
  }

  protected renderDifficultySelection() {
    return html`
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
                    ${translateText(`difficulty.${DifficultyDescription[key]}`)}
                  </p>
                </div>
              `,
            )}
        </div>
      </div>
    `;
  }

  protected renderGameModeSelection() {
    return html`
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
    `;
  }

  protected renderTeamSelectionIfApplicable() {
    if (this.gameMode === GameMode.FFA) return null;
    return html`
      <div class="options-section">
        <div class="option-title">${this.t("team_count")}</div>
        <div class="option-cards">
          ${[Duos, 2, 3, 4, 5, 6, 7].map(
            (count) => html`
              <div
                class="option-card ${this.teamCount === count
                  ? "selected"
                  : ""}"
                @click=${() => this.handleTeamCountSelection(count)}
              >
                <div class="option-card-title">${count}</div>
              </div>
            `,
          )}
        </div>
      </div>
    `;
  }

  protected renderGameOptions() {
    const checkboxOptions = [
      {
        id: "disable-npcs",
        key: "disableNPCs",
        label: this.t("disable_nations"),
      },
      {
        id: "instant-build",
        key: "instantBuild",
        label: this.t("instant_build"),
      },
      {
        id: "infinite-gold",
        key: "infiniteGold",
        label: this.t("infinite_gold"),
      },
      {
        id: "infinite-troops",
        key: "infiniteTroops",
        label: this.t("infinite_troops"),
      },
    ];

    return html`
      <div class="options-section">
        <div class="option-title">${this.t("options_title")}</div>
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
              .value="${String(this.gameOptions.bots)}"
            />
            <div class="option-card-title">
              <span>${this.t("bots")}</span>
              ${this.gameOptions.bots === 0
                ? this.t("bots_disabled")
                : this.gameOptions.bots}
            </div>
          </label>
          ${checkboxOptions.map((opt) =>
            renderCheckboxOption(
              opt.id,
              this.gameOptions[opt.key],
              opt.label,
              (e: Event) =>
                this.handleToggleOption(
                  opt.key as keyof typeof this.gameOptions,
                  e,
                ),
            ),
          )}
        </div>

        <hr style="width: 100%; border-top: 1px solid #444; margin: 16px 0;" />
        <div
          style="margin: 8px 0 12px 0; font-weight: bold; color: #ccc; text-align: center;"
        >
          ${this.t("enables_title")}
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
    `;
  }

  // Event Handlers
  protected handleMapSelection(value: GameMapType) {
    this.selectedMap = value;
    this.useRandomMap = false;
  }

  protected handleDifficultySelection(value: Difficulty) {
    this.selectedDifficulty = value;
  }

  protected handleBotsChange(e: Event) {
    const value = parseInt((e.target as HTMLInputElement).value);
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }

    this.gameOptions = {
      ...this.gameOptions,
      bots: value,
    };

    if (this.botsUpdateTimer !== null) {
      clearTimeout(this.botsUpdateTimer);
    }

    this.botsChangeTimer();
  }

  protected botsChangeTimer() {
    this.botsUpdateTimer = window.setTimeout(() => {
      this.botsUpdateTimer = null;
    }, 300);
  }

  protected handleToggleOption(
    option: keyof typeof this.gameOptions,
    e: Event,
  ) {
    const checked = (e.target as HTMLInputElement).checked;
    this.gameOptions = { ...this.gameOptions, [option]: checked };
  }

  protected handleGameModeSelection(value: GameMode) {
    this.gameMode = value;
  }

  protected handleTeamCountSelection(value: number | typeof Duos) {
    this.teamCount = value;
  }

  protected toggleUnit(unit: UnitType, checked: boolean): void {
    this.disabledUnits = checked
      ? [...this.disabledUnits, unit]
      : this.disabledUnits.filter((u) => u !== unit);
  }

  protected getRandomMap(): GameMapType {
    const maps = Object.values(GameMapType);
    return maps[Math.floor(Math.random() * maps.length)] as GameMapType;
  }

  protected abstract getTranslationPrefix(): string;
  protected abstract startGame(): void;
}
