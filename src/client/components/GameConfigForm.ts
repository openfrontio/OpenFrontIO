import { LitElement, TemplateResult, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  Difficulty,
  Duos,
  GameMapType,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
  UnitType,
} from "../../core/game/Game";
import { TeamCountConfig } from "../../core/Schemas";
import {
  cardStateClasses,
  renderCardInput,
  renderCardLabel,
  renderCategoryLabel,
  renderConfigCard,
  renderToggleCard,
  renderUnitTypeOptions,
} from "../utilities/ConfigCards";
import { translateText } from "../Utils";
import "./Difficulties";
import "./FluentSlider";
import "./map/MapPicker";

export type GameConfigFormVariant = "singleplayer" | "host";

const DEFAULT_CONFIG = {
  selectedMap: GameMapType.World,
  selectedDifficulty: Difficulty.Easy,
  disableNations: false,
  bots: 400,
  infiniteGold: false,
  infiniteTroops: false,
  compactMap: false,
  maxTimer: false,
  maxTimerValue: undefined as number | undefined,
  instantBuild: false,
  randomSpawn: false,
  useRandomMap: false,
  gameMode: GameMode.FFA,
  teamCount: 2 as TeamCountConfig,
  goldMultiplier: false,
  goldMultiplierValue: undefined as number | undefined,
  startingGold: false,
  startingGoldValue: undefined as number | undefined,
  disabledUnits: [] as UnitType[],
  donateGold: false,
  donateTroops: false,
  spawnImmunity: false,
  spawnImmunityDurationMinutes: undefined as number | undefined,
} as const;

export interface GameConfigSnapshot {
  selectedMap: GameMapType;
  selectedDifficulty: Difficulty;
  disableNations: boolean;
  bots: number;
  infiniteGold: boolean;
  infiniteTroops: boolean;
  compactMap: boolean;
  maxTimer: boolean;
  maxTimerValue: number | undefined;
  instantBuild: boolean;
  randomSpawn: boolean;
  useRandomMap: boolean;
  gameMode: GameMode;
  teamCount: TeamCountConfig;
  goldMultiplier: boolean;
  goldMultiplierValue: number | undefined;
  startingGold: boolean;
  startingGoldValue: number | undefined;
  disabledUnits: UnitType[];
  donateGold: boolean;
  donateTroops: boolean;
  spawnImmunity: boolean;
  spawnImmunityDurationMinutes: number | undefined;
}

function renderSectionHeader(
  svgIcon: TemplateResult,
  colorClass: string,
  title: string,
): TemplateResult {
  return html`
    <div class="flex items-center gap-4 pb-2 border-b border-white/10">
      <div
        class="w-8 h-8 rounded-lg ${colorClass} flex items-center justify-center"
      >
        ${svgIcon}
      </div>
      <h3 class="text-lg font-bold text-white uppercase tracking-wider">
        ${title}
      </h3>
    </div>
  `;
}

// SVG icons for section headers
const mapIcon = html`<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  fill="currentColor"
  class="w-5 h-5"
>
  <path
    d="M21.731 2.269a2.625 2.625 0 00-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 000-3.712zM19.513 8.199l-3.712-3.712-12.15 12.15a5.25 5.25 0 00-1.32 2.214l-.8 2.685a.75.75 0 00.933.933l2.685-.8a5.25 5.25 0 002.214-1.32L19.513 8.2z"
  />
</svg>`;

const difficultyIcon = html`<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  fill="currentColor"
  class="w-5 h-5"
>
  <path
    fill-rule="evenodd"
    d="M12.97 3.97a.75.75 0 011.06 0l7.5 7.5a.75.75 0 010 1.06l-7.5 7.5a.75.75 0 11-1.06-1.06l6.22-6.22H3a.75.75 0 010-1.5h16.19l-6.22-6.22a.75.75 0 010-1.06z"
    clip-rule="evenodd"
  />
</svg>`;

const gameModeIcon = html`<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  fill="currentColor"
  class="w-5 h-5"
>
  <path
    d="M11.25 4.533A9.707 9.707 0 006 3a9.735 9.735 0 00-3.25.555.75.75 0 00-.5.707v14.25a.75.75 0 001 .707A8.237 8.237 0 016 18.75c1.995 0 3.823.707 5.25 1.886V4.533zM12.75 20.636A8.214 8.214 0 0118 18.75c.966 0 1.89.166 2.75.47a.75.75 0 001-.708V4.262a.75.75 0 00-.5-.707A9.735 9.735 0 0018 3a9.707 9.707 0 00-5.25 1.533v16.103z"
  />
</svg>`;

const optionsIcon = html`<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  fill="currentColor"
  class="w-5 h-5"
>
  <path
    fill-rule="evenodd"
    d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 00-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 00-2.282.819l-.922 1.597a1.875 1.875 0 00.432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 000 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 00-.432 2.385l.922 1.597a1.875 1.875 0 002.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 002.28-.819l.922-1.597a1.875 1.875 0 00-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 000-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 00-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 00-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 00-1.85-1.567h-1.843zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z"
    clip-rule="evenodd"
  />
</svg>`;

const unitsIcon = html`<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  fill="currentColor"
  class="w-5 h-5"
>
  <path
    fill-rule="evenodd"
    d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zm0 8.625a1.125 1.125 0 100 2.25 1.125 1.125 0 000-2.25zM15.375 12a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0zM7.5 10.875a1.125 1.125 0 100 2.25 1.125 1.125 0 000-2.25z"
    clip-rule="evenodd"
  />
</svg>`;

@customElement("game-config-form")
export class GameConfigForm extends LitElement {
  createRenderRoot() {
    return this;
  }

  // --- Variant & parent-provided props ---
  @property({ type: String }) variant: GameConfigFormVariant = "singleplayer";
  @property({ type: Boolean }) showAchievements = false;
  @property({ attribute: false }) mapWins: Map<GameMapType, Set<Difficulty>> =
    new Map();

  // --- Shared config state ---
  @state() private selectedMap: GameMapType = DEFAULT_CONFIG.selectedMap;
  @state() private selectedDifficulty: Difficulty =
    DEFAULT_CONFIG.selectedDifficulty;
  @state() private disableNations: boolean = DEFAULT_CONFIG.disableNations;
  @state() private bots: number = DEFAULT_CONFIG.bots;
  @state() private infiniteGold: boolean = DEFAULT_CONFIG.infiniteGold;
  @state() private infiniteTroops: boolean = DEFAULT_CONFIG.infiniteTroops;
  @state() private compactMap: boolean = DEFAULT_CONFIG.compactMap;
  @state() private maxTimer: boolean = DEFAULT_CONFIG.maxTimer;
  @state() private maxTimerValue: number | undefined =
    DEFAULT_CONFIG.maxTimerValue;
  @state() private instantBuild: boolean = DEFAULT_CONFIG.instantBuild;
  @state() private randomSpawn: boolean = DEFAULT_CONFIG.randomSpawn;
  @state() private useRandomMap: boolean = DEFAULT_CONFIG.useRandomMap;
  @state() private gameMode: GameMode = DEFAULT_CONFIG.gameMode;
  @state() private teamCount: TeamCountConfig = DEFAULT_CONFIG.teamCount;
  @state() private goldMultiplier: boolean = DEFAULT_CONFIG.goldMultiplier;
  @state() private goldMultiplierValue: number | undefined =
    DEFAULT_CONFIG.goldMultiplierValue;
  @state() private startingGold: boolean = DEFAULT_CONFIG.startingGold;
  @state() private startingGoldValue: number | undefined =
    DEFAULT_CONFIG.startingGoldValue;
  @state() private disabledUnits: UnitType[] = [
    ...DEFAULT_CONFIG.disabledUnits,
  ];

  // --- Host-only config state ---
  @state() private donateGold: boolean = DEFAULT_CONFIG.donateGold;
  @state() private donateTroops: boolean = DEFAULT_CONFIG.donateTroops;
  @state() private spawnImmunity: boolean = DEFAULT_CONFIG.spawnImmunity;
  @state() private spawnImmunityDurationMinutes: number | undefined =
    DEFAULT_CONFIG.spawnImmunityDurationMinutes;

  // --- Public API ---

  public getConfig(): GameConfigSnapshot {
    return {
      selectedMap: this.selectedMap,
      selectedDifficulty: this.selectedDifficulty,
      disableNations: this.disableNations,
      bots: this.bots,
      infiniteGold: this.infiniteGold,
      infiniteTroops: this.infiniteTroops,
      compactMap: this.compactMap,
      maxTimer: this.maxTimer,
      maxTimerValue: this.maxTimerValue,
      instantBuild: this.instantBuild,
      randomSpawn: this.randomSpawn,
      useRandomMap: this.useRandomMap,
      gameMode: this.gameMode,
      teamCount: this.teamCount,
      goldMultiplier: this.goldMultiplier,
      goldMultiplierValue: this.goldMultiplierValue,
      startingGold: this.startingGold,
      startingGoldValue: this.startingGoldValue,
      disabledUnits: [...this.disabledUnits],
      donateGold: this.donateGold,
      donateTroops: this.donateTroops,
      spawnImmunity: this.spawnImmunity,
      spawnImmunityDurationMinutes: this.spawnImmunityDurationMinutes,
    };
  }

  /** Resolve the random map if useRandomMap is set, then return the actual map. */
  public resolveSelectedMap(): GameMapType {
    if (this.useRandomMap) {
      this.selectedMap = this.getRandomMap();
    }
    return this.selectedMap;
  }

  public reset(): void {
    this.selectedMap = DEFAULT_CONFIG.selectedMap;
    this.selectedDifficulty = DEFAULT_CONFIG.selectedDifficulty;
    this.disableNations = DEFAULT_CONFIG.disableNations;
    this.bots = DEFAULT_CONFIG.bots;
    this.infiniteGold = DEFAULT_CONFIG.infiniteGold;
    this.infiniteTroops = DEFAULT_CONFIG.infiniteTroops;
    this.compactMap = DEFAULT_CONFIG.compactMap;
    this.maxTimer = DEFAULT_CONFIG.maxTimer;
    this.maxTimerValue = DEFAULT_CONFIG.maxTimerValue;
    this.instantBuild = DEFAULT_CONFIG.instantBuild;
    this.randomSpawn = DEFAULT_CONFIG.randomSpawn;
    this.useRandomMap = DEFAULT_CONFIG.useRandomMap;
    this.gameMode = DEFAULT_CONFIG.gameMode;
    this.teamCount = DEFAULT_CONFIG.teamCount;
    this.goldMultiplier = DEFAULT_CONFIG.goldMultiplier;
    this.goldMultiplierValue = DEFAULT_CONFIG.goldMultiplierValue;
    this.startingGold = DEFAULT_CONFIG.startingGold;
    this.startingGoldValue = DEFAULT_CONFIG.startingGoldValue;
    this.disabledUnits = [...DEFAULT_CONFIG.disabledUnits];
    this.donateGold = DEFAULT_CONFIG.donateGold;
    this.donateTroops = DEFAULT_CONFIG.donateTroops;
    this.spawnImmunity = DEFAULT_CONFIG.spawnImmunity;
    this.spawnImmunityDurationMinutes =
      DEFAULT_CONFIG.spawnImmunityDurationMinutes;
  }

  /** Check if any options differ from defaults (used by SP for achievement warning). */
  public hasOptionsChanged(): boolean {
    return (
      this.disableNations !== DEFAULT_CONFIG.disableNations ||
      this.bots !== DEFAULT_CONFIG.bots ||
      this.infiniteGold !== DEFAULT_CONFIG.infiniteGold ||
      this.infiniteTroops !== DEFAULT_CONFIG.infiniteTroops ||
      this.compactMap !== DEFAULT_CONFIG.compactMap ||
      this.maxTimer !== DEFAULT_CONFIG.maxTimer ||
      this.instantBuild !== DEFAULT_CONFIG.instantBuild ||
      this.randomSpawn !== DEFAULT_CONFIG.randomSpawn ||
      this.gameMode !== DEFAULT_CONFIG.gameMode ||
      this.goldMultiplier !== DEFAULT_CONFIG.goldMultiplier ||
      this.startingGold !== DEFAULT_CONFIG.startingGold ||
      this.disabledUnits.length > 0
    );
  }

  // --- Event emission ---

  private fireConfigChanged(): void {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: this.getConfig(),
        bubbles: true,
        composed: true,
      }),
    );
  }

  // --- Render ---

  render() {
    const isHost = this.variant === "host";
    const prefix = isHost ? "host_modal" : "single_modal";

    return html`
      <div class="max-w-5xl mx-auto space-y-6">
        ${this.renderMapSection()} ${this.renderDifficultySection()}
        ${this.renderGameModeSection()} ${this.renderTeamCountSection()}
        ${this.renderOptionsSection(prefix, isHost)}
        ${this.renderUnitsSection(prefix)}
      </div>
    `;
  }

  // --- Section renderers ---

  private renderMapSection(): TemplateResult {
    return html`
      <div class="space-y-6">
        ${renderSectionHeader(
          mapIcon,
          "bg-blue-500/20 text-blue-400",
          translateText("map.map"),
        )}
        <map-picker
          .selectedMap=${this.selectedMap}
          .useRandomMap=${this.useRandomMap}
          .showMedals=${this.showAchievements}
          .mapWins=${this.mapWins}
          .randomMapDivider=${this.variant === "host"}
          .onSelectMap=${(mapValue: GameMapType) =>
            this.handleMapSelection(mapValue)}
          .onSelectRandom=${() => this.handleSelectRandomMap()}
        ></map-picker>
      </div>
    `;
  }

  private renderDifficultySection(): TemplateResult {
    return html`
      <div class="space-y-6">
        ${renderSectionHeader(
          difficultyIcon,
          "bg-green-500/20 text-green-400",
          translateText("difficulty.difficulty"),
        )}
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          ${Object.entries(Difficulty)
            .filter(([key]) => isNaN(Number(key)))
            .map(([key, value]) => {
              const isSelected = this.selectedDifficulty === value;
              const isDisabled = this.disableNations;
              return renderConfigCard({
                selected: isSelected,
                disabled: isDisabled,
                onClick: () =>
                  !isDisabled && this.handleDifficultySelection(value),
                content: html`
                  <difficulty-display
                    .difficultyKey=${key}
                    class="scale-125 origin-center ${isDisabled
                      ? "pointer-events-none"
                      : ""}"
                  ></difficulty-display>
                  ${renderCardLabel(
                    translateText(`difficulty.${key.toLowerCase()}`),
                    !isDisabled && isSelected,
                  )}
                `,
              });
            })}
        </div>
      </div>
    `;
  }

  private renderGameModeSection(): TemplateResult {
    return html`
      <div class="space-y-6">
        ${renderSectionHeader(
          gameModeIcon,
          "bg-purple-500/20 text-purple-400",
          translateText("host_modal.mode"),
        )}
        <div class="grid grid-cols-2 gap-4">
          ${[GameMode.FFA, GameMode.Team].map((mode) => {
            const isSelected = this.gameMode === mode;
            return renderConfigCard({
              selected: isSelected,
              onClick: () => this.handleGameModeSelection(mode),
              label:
                mode === GameMode.FFA
                  ? translateText("game_mode.ffa")
                  : translateText("game_mode.teams"),
            });
          })}
        </div>
      </div>
    `;
  }

  private renderTeamCountSection(): TemplateResult {
    if (this.gameMode === GameMode.FFA) return html``;

    return html`
      <div class="space-y-6">
        ${renderCategoryLabel(translateText("host_modal.team_count"))}
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
          ${[2, 3, 4, 5, 6, 7, Quads, Trios, Duos, HumansVsNations].map((o) => {
            const isSelected = this.teamCount === o;
            const label =
              typeof o === "string"
                ? o === HumansVsNations
                  ? translateText("public_lobby.teams_hvn")
                  : translateText(`host_modal.teams_${o}`)
                : translateText("public_lobby.teams", { num: o });
            return renderConfigCard({
              selected: isSelected,
              onClick: () => this.handleTeamCountSelection(o),
              label,
            });
          })}
        </div>
      </div>
    `;
  }

  private renderOptionsSection(
    prefix: string,
    isHost: boolean,
  ): TemplateResult {
    return html`
      <div class="space-y-6">
        ${renderSectionHeader(
          optionsIcon,
          "bg-orange-500/20 text-orange-400",
          translateText(`${prefix}.options_title`),
        )}
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <!-- Bot Slider -->
          <div
            class="col-span-2 rounded-xl p-4 flex flex-col justify-center min-h-[100px] border transition-all duration-200 ${cardStateClasses(
              this.bots > 0,
              { dimWhenOff: true },
            )}"
          >
            <fluent-slider
              min="0"
              max="400"
              step="1"
              .value=${this.bots}
              labelKey="${prefix}.bots"
              disabledKey="${prefix}.bots_disabled"
              @value-changed=${this.handleBotsChange}
            ></fluent-slider>
          </div>

          ${!(
            this.gameMode === GameMode.Team &&
            this.teamCount === HumansVsNations
          )
            ? this.renderOptionToggle(
                `${prefix}.disable_nations`,
                this.disableNations,
                (val) => {
                  this.disableNations = val;
                  this.fireConfigChanged();
                },
              )
            : ""}
          ${this.renderOptionToggle(
            `${prefix}.instant_build`,
            this.instantBuild,
            (val) => {
              this.instantBuild = val;
              this.fireConfigChanged();
            },
          )}
          ${this.renderOptionToggle(
            `${prefix}.random_spawn`,
            this.randomSpawn,
            (val) => {
              this.randomSpawn = val;
              this.fireConfigChanged();
            },
          )}
          ${isHost
            ? html`
                ${this.renderOptionToggle(
                  "host_modal.donate_gold",
                  this.donateGold,
                  (val) => {
                    this.donateGold = val;
                    this.fireConfigChanged();
                  },
                )}
                ${this.renderOptionToggle(
                  "host_modal.donate_troops",
                  this.donateTroops,
                  (val) => {
                    this.donateTroops = val;
                    this.fireConfigChanged();
                  },
                )}
              `
            : ""}
          ${this.renderOptionToggle(
            `${prefix}.infinite_gold`,
            this.infiniteGold,
            (val) => {
              this.infiniteGold = val;
              this.fireConfigChanged();
            },
          )}
          ${this.renderOptionToggle(
            `${prefix}.infinite_troops`,
            this.infiniteTroops,
            (val) => {
              this.infiniteTroops = val;
              this.fireConfigChanged();
            },
          )}
          ${this.renderOptionToggle(
            `${prefix}.compact_map`,
            this.compactMap,
            (val) => {
              this.compactMap = val;
              if (val && this.bots === 400) {
                this.bots = 100;
              } else if (!val && this.bots === 100) {
                this.bots = 400;
              }
              this.fireConfigChanged();
            },
          )}

          <!-- Max Timer -->
          ${this.renderToggleInputCardWithHandlers({
            labelKey: `${prefix}.max_timer`,
            checked: this.maxTimer,
            toggleGetter: () => this.maxTimer,
            toggleSetter: (val) => (this.maxTimer = val),
            valueGetter: () => this.maxTimerValue,
            valueSetter: (val) => (this.maxTimerValue = val),
            defaultValue: 30,
            inputOptions: {
              id: "end-timer-value",
              min: 1,
              max: 120,
              ariaLabel: translateText(`${prefix}.max_timer`),
              placeholder: translateText(
                isHost
                  ? "host_modal.mins_placeholder"
                  : "single_modal.max_timer_placeholder",
              ),
              onInput: this.handleMaxTimerValueChanges,
              onKeyDown: this.handleMaxTimerValueKeyDown,
            },
          })}

          <!-- Spawn Immunity (host only) -->
          ${isHost
            ? this.renderToggleInputCardWithHandlers({
                labelKey: "host_modal.player_immunity_duration",
                checked: this.spawnImmunity,
                toggleGetter: () => this.spawnImmunity,
                toggleSetter: (val) => (this.spawnImmunity = val),
                valueGetter: () => this.spawnImmunityDurationMinutes,
                valueSetter: (val) => (this.spawnImmunityDurationMinutes = val),
                defaultValue: 5,
                inputOptions: {
                  min: 0,
                  max: 120,
                  step: 1,
                  ariaLabel: translateText(
                    "host_modal.player_immunity_duration",
                  ),
                  placeholder: translateText("host_modal.mins_placeholder"),
                  onInput: this.handleSpawnImmunityDurationInput,
                  onKeyDown: this.handleNumberKeyDown,
                },
              })
            : ""}

          <!-- Gold Multiplier -->
          ${this.renderToggleInputCardWithHandlers({
            labelKey: "single_modal.gold_multiplier",
            checked: this.goldMultiplier,
            toggleGetter: () => this.goldMultiplier,
            toggleSetter: (val) => (this.goldMultiplier = val),
            valueGetter: () => this.goldMultiplierValue,
            valueSetter: (val) => (this.goldMultiplierValue = val),
            defaultValue: 2,
            inputOptions: {
              id: "gold-multiplier-value",
              min: 0.1,
              max: 1000,
              step: "any",
              ariaLabel: translateText("single_modal.gold_multiplier"),
              placeholder: translateText(
                "single_modal.gold_multiplier_placeholder",
              ),
              onChange: this.handleGoldMultiplierValueChanges,
              onKeyDown: this.handleNumberKeyDown,
            },
          })}

          <!-- Starting Gold -->
          ${this.renderToggleInputCardWithHandlers({
            labelKey: "single_modal.starting_gold",
            checked: this.startingGold,
            toggleGetter: () => this.startingGold,
            toggleSetter: (val) => (this.startingGold = val),
            valueGetter: () => this.startingGoldValue,
            valueSetter: (val) => (this.startingGoldValue = val),
            defaultValue: 5000000,
            inputOptions: {
              id: "starting-gold-value",
              min: 0,
              max: 1000000000,
              step: 100000,
              ariaLabel: translateText("single_modal.starting_gold"),
              placeholder: translateText(
                "single_modal.starting_gold_placeholder",
              ),
              onInput: this.handleStartingGoldValueChanges,
              onKeyDown: this.handleNumberKeyDown,
            },
          })}
        </div>
      </div>
    `;
  }

  private renderUnitsSection(prefix: string): TemplateResult {
    return html`
      <div class="space-y-6">
        ${renderSectionHeader(
          unitsIcon,
          "bg-teal-500/20 text-teal-400",
          translateText(`${prefix}.enables_title`),
        )}
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          ${renderUnitTypeOptions(
            this.disabledUnits,
            this.toggleUnit.bind(this),
          )}
        </div>
      </div>
    `;
  }

  // --- Shared UI helpers ---

  private renderOptionToggle(
    labelKey: string,
    checked: boolean,
    onChange: (val: boolean) => void,
    hidden: boolean = false,
  ): TemplateResult {
    if (hidden) return html``;
    return renderConfigCard({
      selected: checked,
      dimWhenOff: true,
      onClick: () => onChange(!checked),
      label: translateText(labelKey),
    });
  }

  private renderToggleInputCardWithHandlers(opts: {
    labelKey: string;
    checked: boolean;
    toggleGetter: () => boolean;
    toggleSetter: (val: boolean) => void;
    valueGetter: () => number | undefined;
    valueSetter: (val: number | undefined) => void;
    defaultValue: number;
    inputOptions: {
      id?: string;
      min?: number | string;
      max?: number | string;
      step?: number | string;
      ariaLabel?: string;
      placeholder?: string;
      onInput?: (e: Event) => void;
      onChange?: (e: Event) => void;
      onKeyDown?: (e: KeyboardEvent) => void;
    };
  }): TemplateResult {
    const toggleLogic = (e: Event) => {
      if ((e.target as HTMLElement).tagName.toLowerCase() === "input") return;
      const newState = !opts.toggleGetter();
      opts.toggleSetter(newState);
      if (newState) {
        opts.valueSetter(opts.valueGetter() ?? opts.defaultValue);
      } else {
        opts.valueSetter(undefined);
      }
      this.fireConfigChanged();
      this.requestUpdate();
    };

    return renderToggleCard({
      labelKey: opts.labelKey,
      checked: opts.checked,
      onClick: toggleLogic,
      input: renderCardInput({
        ...opts.inputOptions,
        value: opts.valueGetter() ?? "",
      }),
    });
  }

  // --- Handlers ---

  private handleMapSelection(value: GameMapType): void {
    this.selectedMap = value;
    this.useRandomMap = false;
    this.fireConfigChanged();
  }

  private handleSelectRandomMap(): void {
    this.useRandomMap = true;
    if (this.variant === "host") {
      this.selectedMap = this.getRandomMap();
    }
    this.fireConfigChanged();
  }

  private handleDifficultySelection(value: Difficulty): void {
    this.selectedDifficulty = value;
    this.fireConfigChanged();
  }

  private handleGameModeSelection(value: GameMode): void {
    this.gameMode = value;
    if (this.variant === "host") {
      if (value === GameMode.Team) {
        this.donateGold = true;
        this.donateTroops = true;
      } else {
        this.donateGold = false;
        this.donateTroops = false;
      }
    }
    this.fireConfigChanged();
  }

  private handleTeamCountSelection(value: TeamCountConfig): void {
    this.teamCount = value;
    this.fireConfigChanged();
  }

  private handleBotsChange = (e: Event) => {
    const customEvent = e as CustomEvent<{ value: number }>;
    const value = customEvent.detail.value;
    if (isNaN(value) || value < 0 || value > 400) return;
    this.bots = value;
    this.fireConfigChanged();
  };

  private toggleUnit(unit: UnitType, checked: boolean): void {
    this.disabledUnits = checked
      ? [...this.disabledUnits, unit]
      : this.disabledUnits.filter((u) => u !== unit);
    this.fireConfigChanged();
  }

  private getRandomMap(): GameMapType {
    const maps = Object.values(GameMapType);
    const randIdx = Math.floor(Math.random() * maps.length);
    return maps[randIdx] as GameMapType;
  }

  // --- Input validation handlers ---

  private handleNumberKeyDown = (e: KeyboardEvent) => {
    if (["-", "+", "e", "E"].includes(e.key)) {
      e.preventDefault();
    }
  };

  private handleMaxTimerValueKeyDown = (e: KeyboardEvent) => {
    if (["-", "+", "e"].includes(e.key)) {
      e.preventDefault();
    }
  };

  private handleMaxTimerValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    input.value = input.value.replace(/[e+-]/gi, "");
    const value = parseInt(input.value);
    if (isNaN(value) || value < 1 || value > 120) {
      this.maxTimerValue = undefined;
    } else {
      this.maxTimerValue = value;
    }
    this.fireConfigChanged();
  };

  private handleGoldMultiplierValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseFloat(input.value);
    if (isNaN(value) || value < 0.1 || value > 1000) {
      this.goldMultiplierValue = undefined;
      input.value = "";
    } else {
      this.goldMultiplierValue = value;
    }
    this.fireConfigChanged();
  };

  private handleStartingGoldValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    input.value = input.value.replace(/[eE+-]/g, "");
    const value = parseInt(input.value);
    if (isNaN(value) || value < 0 || value > 1000000000) {
      this.startingGoldValue = undefined;
    } else {
      this.startingGoldValue = value;
    }
    this.fireConfigChanged();
  };

  private handleSpawnImmunityDurationInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    input.value = input.value.replace(/[eE+-]/g, "");
    const value = parseInt(input.value, 10);
    if (Number.isNaN(value) || value < 0 || value > 120) return;
    this.spawnImmunityDurationMinutes = value;
    this.fireConfigChanged();
  };
}
