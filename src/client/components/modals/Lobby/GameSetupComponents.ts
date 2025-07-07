// shared/GameSetupComponents.ts
import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import randomMap from "../../../../../resources/images/RandomMap.webp";
import {
  Difficulty,
  Duos,
  GameMapType,
  GameMode,
  UnitType,
  mapCategories,
} from "../../../../core/game/Game";
import { translateText } from "../../../Utils";
import { DifficultyDescription } from "./Difficulties";

export type Step = "map" | "difficulty" | "mode" | "options" | "waiting";
export type MapTab = "Continental" | "Regional" | "Other" | "Random";

export interface GameSetupConfig {
  selectedMap: GameMapType;
  selectedDifficulty: Difficulty;
  disableNPCs: boolean;
  gameMode: GameMode;
  teamCount: number | typeof Duos;
  bots: number;
  infiniteGold: boolean;
  infiniteTroops: boolean;
  instantBuild: boolean;
  useRandomMap: boolean;
  disabledUnits: UnitType[];
}

// Progress Steps Component
@customElement("game-setup-progress")
export class GameSetupProgress extends LitElement {
  @property() currentStep: Step = "map";
  @property({ type: Boolean }) hideWaiting = false;

  private get steps() {
    return [
      { id: "map", label: translateText("map.map"), icon: "icons/map.svg" },
      {
        id: "difficulty",
        label: translateText("difficulty.difficulty"),
        icon: "icons/swords.svg",
      },
      {
        id: "mode",
        label: translateText("host_modal.mode"),
        icon: "icons/users.svg",
      },
      {
        id: "options",
        label: translateText("host_modal.options_title"),
        icon: "icons/settings.svg",
      },
    ];
  }

  render() {
    if (this.currentStep === "waiting" && !this.hideWaiting) return html``;

    return html`
      <div class="flex items-center justify-between mb-8 px-6">
        ${this.steps.map((step, index) => {
          const currentIndex = this.steps.findIndex(
            (s) => s.id === this.currentStep,
          );
          return html`
            <div
              class="flex items-center ${index < this.steps.length - 1
                ? "flex-1"
                : ""}"
            >
              <button
                @click=${() =>
                  this.handleStepClick(step.id as Step, index, currentIndex)}
                class="flex items-center ${index <= currentIndex
                  ? "text-textLight"
                  : "text-textGrey"} ${index === currentIndex
                  ? "scale-100"
                  : ""} transition-all"
              >
                <div
                  class="w-10 h-10 rounded-full flex items-center justify-center ${index ===
                  currentIndex
                    ? "bg-primary"
                    : index < currentIndex
                      ? "bg-green"
                      : "bg-backgroundGrey"}"
                >
                  <o-icon
                    src=${step.icon}
                    size="large"
                    color="${index === currentIndex
                      ? "var(--text-color-light)"
                      : index < currentIndex
                        ? "var(--text-color-light)"
                        : "var(--text-color-grey)"}"
                  ></o-icon>
                </div>
                <span class="ml-2 text-small hidden sm:block"
                  >${step.label}</span
                >
              </button>
              ${index < this.steps.length - 1
                ? html`
                    <div
                      class="flex-1 h-0.5 mx-4 ${index < currentIndex
                        ? "bg-green"
                        : "bg-backgroundGrey"}"
                    ></div>
                  `
                : ""}
            </div>
          `;
        })}
      </div>
    `;
  }

  private handleStepClick(stepId: Step, index: number, currentIndex: number) {
    if (index <= currentIndex) {
      this.dispatchEvent(
        new CustomEvent("step-change", {
          detail: { step: stepId },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  createRenderRoot() {
    return this;
  }
}

@customElement("game-setup-waiting")
export class GameSetupWaiting extends LitElement {
  @property({ type: Array }) players: string[] = [];

  render() {
    return html`
      <div class="space-y-8 py-12 text-center">
        <h3 class="text-2xl font-bold text-textLight mb-4">
          ${this.players.length}
          ${this.players.length === 1
            ? translateText("private_lobby.player")
            : translateText("private_lobby.players")}
        </h3>
        <div class="flex justify-center gap-2 flex-wrap">
          ${this.players.map(
            (player) => html`
              <div class="background-panel px-4 py-2">
                <span class="text-textLight">${player}</span>
              </div>
            `,
          )}
        </div>
        <p class="text-textGrey animate-pulse">
          ${translateText("host_modal.waiting")}
        </p>
      </div>
    `;
  }

  createRenderRoot() {
    return this;
  }
}

// Map Selection Component
@customElement("map-selection")
export class MapSelection extends LitElement {
  @property() selectedMap: GameMapType = GameMapType.World;
  @property({ type: Boolean }) useRandomMap = false;
  @state() private activeMapTab: MapTab = "Continental";
  @state() private isReady = false;

  connectedCallback() {
    super.connectedCallback();
    setTimeout(() => {
      this.isReady = true;
      this.requestUpdate();
    }, 0);
  }

  private getMapsByCategory() {
    const categorizedMaps: Record<
      MapTab,
      { key: string; value: GameMapType; name: string }[]
    > = {
      Continental: [],
      Regional: [],
      Other: [],
      Random: [
        {
          key: "Random",
          value: GameMapType.World,
          name: this.isReady ? translateText("map.random") : "Random",
        },
      ],
    };

    Object.entries(mapCategories).forEach(([categoryKey, maps]) => {
      const mappedMaps = maps.map((mapValue) => {
        const mapKey = Object.keys(GameMapType).find(
          (key) => GameMapType[key as keyof typeof GameMapType] === mapValue,
        );

        const translatedName =
          this.isReady && mapKey
            ? translateText(`map.${mapKey.toLowerCase()}`)
            : mapKey || "Unknown";

        return {
          key: mapKey || "",
          value: mapValue,
          name: translatedName,
        };
      });

      if (categoryKey.includes("continent") || categoryKey.includes("world")) {
        categorizedMaps.Continental.push(...mappedMaps);
      } else if (categoryKey.includes("region")) {
        categorizedMaps.Regional.push(...mappedMaps);
      } else {
        categorizedMaps.Other.push(...mappedMaps);
      }
    });

    return categorizedMaps;
  }

  render() {
    // Define translation key mapping for MapTab values
    const tabTranslationKeys: Record<MapTab, string> = {
      Continental: "map_categories.continental",
      Regional: "map_categories.regional",
      Other: "map_categories.fantasy",
      Random: "map.random",
    };

    return html`
      <div class="space-y-6">
        <div class="background-panel p-1 flex">
          ${(["Continental", "Regional", "Other", "Random"] as MapTab[]).map(
            (tab) => html`
              <button
                @click=${() => {
                  this.activeMapTab = tab;
                  this.requestUpdate();
                }}
                class="flex-1 px-4 py-2 text-small transition-all ${this
                  .activeMapTab === tab
                  ? "bg-primary text-textLight"
                  : "text-textGrey hover:textLight hover:backgroundGrey"}"
              >
                ${this.isReady ? translateText(tabTranslationKeys[tab]) : tab}
              </button>
            `,
          )}
        </div>

        <div
          class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 overflow-x-hidden"
        >
          ${this.activeMapTab === "Random"
            ? html`
                <button
                  @click=${this.handleRandomMapToggle}
                  class="background-panel w-full p-2 cursor-pointer flex flex-col items-center transition-all duration-300 hover:bg-backgroundDarkLighter ${this
                    .useRandomMap
                    ? "selected"
                    : ""} border ${this.useRandomMap
                    ? "border-primary"
                    : "border-textGrey"}"
                >
                  <div class="w-full aspect-video overflow-hidden mb-2">
                    <img
                      src=${randomMap}
                      alt="Random Map"
                      class="w-full h-full object-cover block"
                    />
                  </div>
                  <p class="text-small text-textLight text-center">
                    ${this.isReady ? translateText("map.random") : "Random"}
                  </p>
                </button>
              `
            : this.getMapsByCategory()[this.activeMapTab].map(
                (map) => html`
                  <button @click=${() => this.handleMapSelection(map.value)}>
                    <map-display
                      .mapKey=${map.key}
                      .selected=${!this.useRandomMap &&
                      this.selectedMap === map.value}
                      .translation=${map.name}
                    ></map-display>
                  </button>
                `,
              )}
        </div>
      </div>
    `;
  }

  private handleRandomMapToggle() {
    this.useRandomMap = true;
    this.dispatchEvent(
      new CustomEvent("map-change", {
        detail: { useRandomMap: true },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleMapSelection(value: GameMapType) {
    this.selectedMap = value;
    this.useRandomMap = false;
    this.dispatchEvent(
      new CustomEvent("map-change", {
        detail: { selectedMap: value, useRandomMap: false },
        bubbles: true,
        composed: true,
      }),
    );
  }

  createRenderRoot() {
    return this;
  }
}
// Difficulty Selection Component
@customElement("difficulty-selection")
export class DifficultySelection extends LitElement {
  @property() selectedDifficulty: Difficulty = Difficulty.Medium;

  render() {
    return html`
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        ${Object.entries(Difficulty)
          .filter(([key]) => isNaN(Number(key)))
          .map(([key, value]) => {
            const skulls =
              key === "Easy"
                ? 1
                : key === "Medium"
                  ? 2
                  : key === "Hard"
                    ? 3
                    : 4;
            return html`
              <button
                @click=${() => this.handleDifficultySelection(value)}
                class="background-panel p-6 transition-all hover:bg-backgroundDarkLighter ${this
                  .selectedDifficulty === value
                  ? "selected"
                  : ""}"
              >
                <div class="flex items-center justify-center mb-2">
                  ${Array(skulls)
                    .fill("💀")
                    .map(
                      (skull) =>
                        html`<span
                          class="text-2xl ${this.selectedDifficulty === value
                            ? "text-primary"
                            : "text-textGrey"}"
                          >${skull}</span
                        >`,
                    )}
                </div>
                <p
                  class="text-center ${this.selectedDifficulty === value
                    ? "text-textLight"
                    : "text-textLight"}"
                >
                  ${translateText(`difficulty.${DifficultyDescription[key]}`)}
                </p>
              </button>
            `;
          })}
      </div>
    `;
  }

  private handleDifficultySelection(value: Difficulty) {
    this.selectedDifficulty = value;
    this.dispatchEvent(
      new CustomEvent("difficulty-change", {
        detail: { selectedDifficulty: value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  createRenderRoot() {
    return this;
  }
}

// Game Mode Selection Component
@customElement("game-mode-selection")
export class GameModeSelection extends LitElement {
  @property() gameMode: GameMode = GameMode.FFA;
  @property() teamCount: number | typeof Duos = 2;

  render() {
    return html`
      <div class="space-y-6">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            @click=${() => this.handleGameModeSelection(GameMode.FFA)}
            class="background-panel hover:bg-backgroundDarkLighter py-6 ${this
              .gameMode === GameMode.FFA
              ? "selected"
              : ""}"
          >
            <div class="text-4xl text-center">
              <o-icon
                src="icons/swords.svg"
                size="extra-large"
                color="var(--text-color-white)"
              ></o-icon>
            </div>
            <h3 class="text-textLight text-center mb-2 font-bold">
              ${translateText("game_mode.ffa")}
            </h3>
            <p class="text-textGrey text-small text-center">
              ${translateText("game_mode.ffa_description")}
            </p>
          </button>

          <button
            @click=${() => this.handleGameModeSelection(GameMode.Team)}
            class="background-panel hover:bg-backgroundDarkLighter py-6 ${this
              .gameMode === GameMode.Team
              ? "selected"
              : ""} "
          >
            <div class="text-4xl text-center">
              <o-icon
                src="icons/users.svg"
                size="extra-large"
                color="var(--text-color-white)"
              ></o-icon>
            </div>
            <h3 class="text-textLight text-center mb-2 font-bold">
              ${translateText("game_mode.teams")}
            </h3>
            <p class="text-textGrey text-small text-center">
              ${translateText("game_mode.teams_description")}
            </p>
          </button>
        </div>

        ${this.gameMode === GameMode.Team
          ? html`
              <div class="background-panel p-4">
                <h3 class="text-textLight mb-4 font-bold">
                  ${translateText("host_modal.team_count")}
                </h3>
                <div class="grid grid-cols-7 gap-2">
                  ${[Duos, 2, 3, 4, 5, 6, 7].map(
                    (num) => html`
                      <button
                        @click=${() => this.handleTeamCountSelection(num)}
                        class="py-4 background-panel hover:bg-backgroundDarkLighter  ${this
                          .teamCount === num
                          ? "selected"
                          : ""} "
                      >
                        <span class="text-textLight text-center block"
                          >${num}</span
                        >
                      </button>
                    `,
                  )}
                </div>
              </div>
            `
          : ""}
      </div>
    `;
  }

  private handleGameModeSelection(value: GameMode) {
    this.gameMode = value;
    this.dispatchEvent(
      new CustomEvent("game-mode-change", {
        detail: { gameMode: value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleTeamCountSelection(value: number | typeof Duos) {
    this.teamCount = value === Duos ? Duos : Number(value);
    this.dispatchEvent(
      new CustomEvent("team-count-change", {
        detail: { teamCount: this.teamCount },
        bubbles: true,
        composed: true,
      }),
    );
  }

  createRenderRoot() {
    return this;
  }
}

// Game Options Component
@customElement("game-options")
export class GameOptions extends LitElement {
  @property() bots: number = 400;
  @property({ type: Boolean }) disableNPCs = false;
  @property({ type: Boolean }) instantBuild = false;
  @property({ type: Boolean }) infiniteGold = false;
  @property({ type: Boolean }) infiniteTroops = false;
  @state() disabledUnits: UnitType[] = [UnitType.Factory];
  @property({ type: Boolean }) isSinglePlayer = false;

  private botsUpdateTimer: number | null = null;

  render() {
    const translationPrefix = this.isSinglePlayer
      ? "single_modal"
      : "host_modal";

    return html`
      <div class="space-y-4">
        <div class="background-panel p-4">
          <div class="flex items-center justify-between mb-2">
            <span class="text-textLight">
              ${translateText(`${translationPrefix}.bots`)}
            </span>
          </div>

          <input
            type="range"
            min="0"
            max="400"
            step="1"
            @input=${this.handleBotsChange}
            @change=${this.handleBotsChange}
            .value="${String(this.bots)}"
            class="w-full h-2 cursor-pointer slider"
            style="background: linear-gradient(to right, var(--primary-color) ${this
              .bots / 4}%, var(--background-color-grey) ${this.bots / 4}%);"
          />

          <div class="text-center mt-2 font-title text-textGrey">
            ${this.bots === 0
              ? translateText(`${translationPrefix}.bots_disabled`)
              : this.bots}
          </div>
        </div>

        ${[
          {
            id: "disableNPCs",
            label: translateText(`${translationPrefix}.disable_nations`),
            checked: this.disableNPCs,
          },
          {
            id: "instantBuild",
            label: translateText(`${translationPrefix}.instant_build`),
            checked: this.instantBuild,
          },
          {
            id: "infiniteGold",
            label: translateText(`${translationPrefix}.infinite_gold`),
            checked: this.infiniteGold,
          },
          {
            id: "infiniteTroops",
            label: translateText(`${translationPrefix}.infinite_troops`),
            checked: this.infiniteTroops,
          },
        ].map(
          (option) => html`
            <div class="background-panel p-4">
              <label class="flex items-center justify-between cursor-pointer">
                <span class="text-textLight ">${option.label}</span>
                <button
                  @click=${() => this.toggleOption(option.id)}
                  class="w-14 h-7 flex items-center rounded-full ${option.checked
                    ? "bg-primary"
                    : "bg-backgroundGrey"} relative transition-colors duration-200"
                >
                  <div
                    class="w-5 h-5 bg-white rounded-full shadow-sm transform transition-transform duration-200 ${option.checked
                      ? "translate-x-7"
                      : "translate-x-1"}"
                  ></div>
                </button>
              </label>
            </div>
          `,
        )}

        <div class="background-panel p-4">
          <h3 class="text-textLight font-bold mb-4 text-center">
            ${translateText(`${translationPrefix}.enables_title`)}
          </h3>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
            ${[
              [UnitType.City, "unit_type.city"],
              [UnitType.DefensePost, "unit_type.defense_post"],
              [UnitType.Port, "unit_type.port"],
              [UnitType.Warship, "unit_type.warship"],
              [UnitType.MissileSilo, "unit_type.missile_silo"],
              [UnitType.SAMLauncher, "unit_type.sam_launcher"],
              [UnitType.AtomBomb, "unit_type.atom_bomb"],
              [UnitType.HydrogenBomb, "unit_type.hydrogen_bomb"],
              [UnitType.MIRV, "unit_type.mirv"],
            ].map(
              ([unitType, translationKey]: [UnitType, string]) => html`
                <label
                  class="background-panel p-3 cursor-pointer hover:bg-backgroundDarkLighter transition-all ${this.disabledUnits.includes(
                    unitType,
                  )
                    ? ""
                    : "selected"}"
                >
                  <div class="flex items-center justify-between">
                    <span class="text-textLight text-small"
                      >${translateText(translationKey)}</span
                    >
                    <input
                      type="checkbox"
                      @change=${(e: Event) =>
                        this.handleUnitToggle(e, unitType)}
                      .checked=${!this.disabledUnits.includes(unitType)}
                      class="rounded"
                    />
                  </div>
                </label>
              `,
            )}
          </div>
        </div>
      </div>
    `;
  }

  private toggleOption(optionId: string) {
    const changes: Partial<GameSetupConfig> = {};

    switch (optionId) {
      case "disableNPCs":
        this.disableNPCs = !this.disableNPCs;
        changes.disableNPCs = this.disableNPCs;
        break;
      case "instantBuild":
        this.instantBuild = !this.instantBuild;
        changes.instantBuild = this.instantBuild;
        break;
      case "infiniteGold":
        this.infiniteGold = !this.infiniteGold;
        changes.infiniteGold = this.infiniteGold;
        break;
      case "infiniteTroops":
        this.infiniteTroops = !this.infiniteTroops;
        changes.infiniteTroops = this.infiniteTroops;
        break;
    }

    this.dispatchEvent(
      new CustomEvent("options-change", {
        detail: changes,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleUnitToggle(e: Event, unitType: UnitType) {
    const checked = (e.target as HTMLInputElement).checked;
    if (checked) {
      this.disabledUnits = this.disabledUnits.filter((u) => u !== unitType);
    } else {
      this.disabledUnits = [...this.disabledUnits, unitType];
    }

    this.dispatchEvent(
      new CustomEvent("options-change", {
        detail: { disabledUnits: this.disabledUnits },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleBotsChange(e: Event) {
    const value = parseInt((e.target as HTMLInputElement).value);
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }

    this.bots = value;

    // Clear any existing timer
    if (this.botsUpdateTimer !== null) {
      clearTimeout(this.botsUpdateTimer);
    }

    // For single player, update immediately. For multiplayer, debounce
    if (this.isSinglePlayer) {
      this.dispatchEvent(
        new CustomEvent("options-change", {
          detail: { bots: this.bots },
          bubbles: true,
          composed: true,
        }),
      );
    } else {
      // Set a new timer to call update after 300ms of inactivity
      this.botsUpdateTimer = window.setTimeout(() => {
        this.dispatchEvent(
          new CustomEvent("options-change", {
            detail: { bots: this.bots },
            bubbles: true,
            composed: true,
          }),
        );
        this.botsUpdateTimer = null;
      }, 300);
    }
  }

  createRenderRoot() {
    return this;
  }
}
