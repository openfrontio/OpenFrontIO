import { TemplateResult, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { UserMeResponse } from "../core/ApiSchemas";
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
import { hasLinkedAccount } from "./Api";
import "./components/baseComponents/Button";
import "./components/baseComponents/lobby/MapCard";
import "./components/baseComponents/Modal";
import { BaseModal } from "./components/BaseModal";
import "./components/Difficulties";
import "./components/FluentSlider";
import { fetchCosmetics } from "./Cosmetics";
import { FlagInput } from "./FlagInput";
import { JoinLobbyEvent } from "./Main";
import { UsernameInput } from "./UsernameInput";
import { renderUnitTypeOptions } from "./utilities/RenderUnitTypeOptions";
import randomMap from "/images/RandomMap.webp?url";

@customElement("single-player-modal")
export class SinglePlayerModal extends BaseModal {
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
  @state() private showAchievements: boolean = false;
  @state() private mapWins: Map<GameMapType, Set<Difficulty>> = new Map();
  @state() private userMeResponse: UserMeResponse | false = false;

  @state() private disabledUnits: UnitType[] = [];

  private userSettings: UserSettings = new UserSettings();

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "userMeResponse",
      this.handleUserMeResponse as EventListener,
    );
  }

  disconnectedCallback() {
    document.removeEventListener(
      "userMeResponse",
      this.handleUserMeResponse as EventListener,
    );
    super.disconnectedCallback();
  }

  private toggleAchievements = () => {
    this.showAchievements = !this.showAchievements;
  };

  private handleUserMeResponse = (
    event: CustomEvent<UserMeResponse | false>,
  ) => {
    this.userMeResponse = event.detail;
    this.applyAchievements(event.detail);
  };

  private renderNotLoggedInBanner(): TemplateResult {
    return html`<div
      class="px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors duration-200 rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 whitespace-nowrap shrink-0"
    >
      ${translateText("single_modal.sign_in_for_achievements")}
    </div>`;
  }

  private applyAchievements(userMe: UserMeResponse | false) {
    if (!userMe) {
      this.mapWins = new Map();
      return;
    }

    const achievements = Array.isArray(userMe.player.achievements)
      ? userMe.player.achievements
      : [];

    const completions =
      achievements.find(
        (achievement) => achievement?.type === "singleplayer-map",
      )?.data ?? [];

    const winsMap = new Map<GameMapType, Set<Difficulty>>();
    for (const entry of completions) {
      const { mapName, difficulty } = entry ?? {};
      const isValidMap =
        typeof mapName === "string" &&
        Object.values(GameMapType).includes(mapName as GameMapType);
      const isValidDifficulty =
        typeof difficulty === "string" &&
        Object.values(Difficulty).includes(difficulty as Difficulty);
      if (!isValidMap || !isValidDifficulty) continue;

      const map = mapName as GameMapType;
      const set = winsMap.get(map) ?? new Set<Difficulty>();
      set.add(difficulty as Difficulty);
      winsMap.set(map, set);
    }

    this.mapWins = winsMap;
  }

  render() {
    const content = html`
      <div
        class="h-full flex flex-col bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden"
      >
        <!-- Header -->
        <div
          class="flex items-center pb-2 border-b border-white/10 gap-4 shrink-0 px-6 pt-6"
        >
          <button
            @click=${this.close}
            class="group flex items-center justify-center w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 transition-all border border-white/10 shrink-0"
            aria-label="${translateText("common.back")}"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="w-5 h-5 text-gray-400 group-hover:text-white transition-colors"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
          </button>
          <span
            class="text-white text-xl sm:text-2xl md:text-3xl font-bold uppercase tracking-widest flex-1 break-words hyphens-auto"
          >
            ${translateText("main.solo") || "Solo"}
          </span>

          ${hasLinkedAccount(this.userMeResponse)
            ? html`<button
                @click=${this.toggleAchievements}
                class="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all shrink-0 ${this
                  .showAchievements
                  ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
                  : "text-white/60"}"
              >
                <img
                  src="/images/MedalIconWhite.svg"
                  class="w-4 h-4 opacity-80 shrink-0"
                  style="${this.showAchievements
                    ? ""
                    : "filter: grayscale(1);"}"
                />
                <span
                  class="text-xs font-bold uppercase tracking-wider whitespace-nowrap"
                  >${translateText("single_modal.toggle_achievements")}</span
                >
              </button>`
            : this.renderNotLoggedInBanner()}
        </div>

        <!-- Scrollable Content -->
        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pb-6 mr-1">
          <div class="max-w-5xl mx-auto space-y-6 pt-4">
            <!-- Map Selection -->
            <div class="space-y-6">
              <div
                class="flex items-center gap-4 pb-2 border-b border-white/10"
              >
                <div
                  class="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    class="w-5 h-5"
                  >
                    <path
                      d="M21.731 2.269a2.625 2.625 0 00-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 000-3.712zM19.513 8.199l-3.712-3.712-12.15 12.15a5.25 5.25 0 00-1.32 2.214l-.8 2.685a.75.75 0 00.933.933l2.685-.8a5.25 5.25 0 002.214-1.32L19.513 8.2z"
                    />
                  </svg>
                </div>
                <h3
                  class="text-lg font-bold text-white uppercase tracking-wider"
                >
                  ${translateText("map.map")}
                </h3>
              </div>

              <div class="space-y-8">
                ${Object.entries(mapCategories).map(
                  ([categoryKey, maps]) => html`
                    <div class="w-full">
                      <h4
                        class="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2"
                      >
                        ${translateText(`map_categories.${categoryKey}`)}
                      </h4>
                      <div
                        class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
                      >
                        ${maps.map((mapValue) => {
                          const mapKey = Object.keys(GameMapType).find(
                            (key) =>
                              GameMapType[key as keyof typeof GameMapType] ===
                              mapValue,
                          );
                          return html`
                            <lobby-map-card
                              @click=${() => this.handleMapSelection(mapValue)}
                              .mapKey=${mapKey}
                              .selected=${!this.useRandomMap &&
                              this.selectedMap === mapValue}
                              .showMedals=${this.showAchievements}
                              .wins=${this.mapWins.get(mapValue) ?? new Set()}
                              .translation=${translateText(
                                `map.${mapKey?.toLowerCase()}`,
                              )}
                            ></lobby-map-card>
                          `;
                        })}
                      </div>
                    </div>
                  `,
                )}

                <!-- Random Map Card -->
                <div class="w-full">
                  <h4
                    class="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2"
                  >
                    ${translateText("map_categories.special")}
                  </h4>
                  <div
                    class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
                  >
                    <lobby-map-card
                      @click=${this.handleSelectRandomMap}
                      .imageSrc=${randomMap}
                      .name=${translateText("map.random")}
                      aria-selected=${this.useRandomMap ? "true" : "false"}
                    ></lobby-map-card>
                  </div>
                </div>
              </div>
            </div>

            <!-- Difficulty Selection -->
            <div class="space-y-6">
              <div
                class="flex items-center gap-4 pb-2 border-b border-white/10"
              >
                <div
                  class="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center text-green-400"
                >
                  <svg
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
                  </svg>
                </div>
                <h3
                  class="text-lg font-bold text-white uppercase tracking-wider"
                >
                  ${translateText("difficulty.difficulty")}
                </h3>
              </div>

              <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                ${Object.entries(Difficulty)
                  .filter(([key]) => isNaN(Number(key)))
                  .map(
                    ([key, value]) => html`
                      <button
                        class="relative group rounded-xl border transition-all duration-200 w-full overflow-hidden flex flex-col items-center p-4 gap-3 ${this
                          .selectedDifficulty === value
                          ? "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                          : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"} ${this
                          .disableNations
                          ? "opacity-30 cursor-not-allowed grayscale"
                          : ""}"
                        @click=${() =>
                          !this.disableNations &&
                          this.handleDifficultySelection(value)}
                      >
                        <difficulty-display
                          class="${this.disableNations
                            ? "pointer-events-none"
                            : ""} transform scale-125"
                          .difficultyKey=${key}
                        ></difficulty-display>
                        <div
                          class="text-xs font-bold text-white uppercase tracking-wider text-center w-full mt-1 break-words hyphens-auto"
                        >
                          ${translateText(`difficulty.${key.toLowerCase()}`)}
                        </div>
                      </button>
                    `,
                  )}
              </div>
            </div>

            <!-- Game Mode Selection -->
            <div class="space-y-6">
              <div
                class="flex items-center gap-4 pb-2 border-b border-white/10"
              >
                <div
                  class="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    class="w-5 h-5"
                  >
                    <path
                      d="M11.25 4.533A9.707 9.707 0 006 3a9.735 9.735 0 00-3.25.555.75.75 0 00-.5.707v14.25a.75.75 0 001 .707A8.237 8.237 0 016 18.75c1.995 0 3.823.707 5.25 1.886V4.533zM12.75 20.636A8.214 8.214 0 0118 18.75c.966 0 1.89.166 2.75.47a.75.75 0 001-.708V4.262a.75.75 0 00-.5-.707A9.735 9.735 0 0018 3a9.707 9.707 0 00-5.25 1.533v16.103z"
                    />
                  </svg>
                </div>
                <h3
                  class="text-lg font-bold text-white uppercase tracking-wider"
                >
                  ${translateText("host_modal.mode")}
                </h3>
              </div>

              <div class="grid grid-cols-2 gap-4">
                ${[GameMode.FFA, GameMode.Team].map((mode) => {
                  const isSelected = this.gameMode === mode;
                  const label =
                    mode === GameMode.FFA
                      ? translateText("game_mode.ffa")
                      : translateText("game_mode.teams");

                  return html`
                    <button
                      class="w-full py-6 rounded-xl border transition-all duration-200 flex flex-col items-center justify-center gap-3 ${isSelected
                        ? "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                        : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"}"
                      @click=${() => this.handleGameModeSelection(mode)}
                    >
                      <div
                        class="text-sm font-bold text-white uppercase tracking-widest break-words hyphens-auto"
                      >
                        ${label}
                      </div>
                    </button>
                  `;
                })}
              </div>
            </div>

            ${this.gameMode === GameMode.FFA
              ? ""
              : html`
                  <!-- Team Count Selection -->
                  <div class="space-y-6">
                    <div
                      class="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2"
                    >
                      ${translateText("host_modal.team_count")}
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
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
                          <button
                            class="w-full px-4 py-3 rounded-xl border transition-all duration-200 flex items-center justify-center ${this
                              .teamCount === o
                              ? "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                              : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"}"
                            @click=${() => this.handleTeamCountSelection(o)}
                          >
                            <div
                              class="text-xs font-bold text-white uppercase tracking-wider text-center break-words hyphens-auto"
                            >
                              ${typeof o === "string"
                                ? o === HumansVsNations
                                  ? translateText("public_lobby.teams_hvn")
                                  : translateText(`host_modal.teams_${o}`)
                                : translateText(`public_lobby.teams`, {
                                    num: o,
                                  })}
                            </div>
                          </button>
                        `,
                      )}
                    </div>
                  </div>
                `}

            <!-- Game Options -->
            <div class="space-y-6">
              <div
                class="flex items-center gap-4 pb-2 border-b border-white/10"
              >
                <div
                  class="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center text-orange-400"
                >
                  <svg
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
                  </svg>
                </div>
                <h3
                  class="text-lg font-bold text-white uppercase tracking-wider"
                >
                  ${translateText("single_modal.options_title")}
                </h3>
              </div>

              <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <!-- Bot Slider Card -->
                <div
                  class="col-span-2 rounded-xl p-4 flex flex-col justify-center min-h-[100px] border transition-all duration-200 ${this
                    .bots > 0
                    ? "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                    : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 opacity-80"}"
                >
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

                ${this.renderOptionToggle(
                  "single_modal.disable_nations",
                  this.disableNations,
                  (val) => (this.disableNations = val),
                  this.gameMode === GameMode.Team &&
                    this.teamCount === HumansVsNations,
                )}
                ${this.renderOptionToggle(
                  "single_modal.instant_build",
                  this.instantBuild,
                  (val) => (this.instantBuild = val),
                )}
                ${this.renderOptionToggle(
                  "single_modal.random_spawn",
                  this.randomSpawn,
                  (val) => (this.randomSpawn = val),
                )}
                ${this.renderOptionToggle(
                  "single_modal.infinite_gold",
                  this.infiniteGold,
                  (val) => (this.infiniteGold = val),
                )}
                ${this.renderOptionToggle(
                  "single_modal.infinite_troops",
                  this.infiniteTroops,
                  (val) => (this.infiniteTroops = val),
                )}
                ${this.renderOptionToggle(
                  "single_modal.compact_map",
                  this.compactMap,
                  (val) => (this.compactMap = val),
                )}

                <!-- Toggle with input support for Max Timer -->
                <div
                  class="relative p-3 rounded-xl border transition-all duration-200 flex flex-col items-center justify-between gap-2 h-full cursor-pointer min-h-[100px] ${this
                    .maxTimer
                    ? "bg-blue-500/20 border-blue-500/50"
                    : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"}"
                  @click=${(e: Event) => {
                    // Prevent toggling when clicking the input
                    if (
                      (e.target as HTMLElement).tagName.toLowerCase() ===
                      "input"
                    )
                      return;
                    this.maxTimer = !this.maxTimer;
                    if (!this.maxTimer) {
                      this.maxTimerValue = undefined;
                    } else {
                      // Set default value when enabling if not already set or invalid
                      if (!this.maxTimerValue || this.maxTimerValue <= 0) {
                        this.maxTimerValue = 30;
                      }
                      // Focus the input after render
                      setTimeout(() => {
                        const input = this.getEndTimerInput();
                        if (input) {
                          input.focus();
                          input.select();
                        }
                      }, 0);
                    }
                  }}
                >
                  <div class="flex items-center justify-center w-full mt-1">
                    <div
                      class="w-5 h-5 rounded border flex items-center justify-center transition-colors ${this
                        .maxTimer
                        ? "bg-blue-500 border-blue-500"
                        : "border-white/20 bg-white/5"}"
                    >
                      ${this.maxTimer
                        ? html`<svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-3 w-3 text-white"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fill-rule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clip-rule="evenodd"
                            />
                          </svg>`
                        : ""}
                    </div>
                  </div>

                  ${this.maxTimer
                    ? html`<input
                        type="number"
                        id="end-timer-value"
                        min="1"
                        max="120"
                        .value=${String(this.maxTimerValue ?? "")}
                        class="w-full text-center rounded bg-black/40 text-white text-sm font-bold border border-white/20 focus:outline-none focus:border-blue-500 p-1 my-1"
                        aria-label=${translateText("single_modal.max_timer")}
                        @input=${this.handleMaxTimerValueChanges}
                        @keydown=${this.handleMaxTimerValueKeyDown}
                        placeholder=${translateText(
                          "single_modal.max_timer_placeholder",
                        )}
                      />`
                    : html`<div
                        class="h-[2px] w-4 bg-white/10 rounded my-3"
                      ></div>`}
                  <!-- Spacer/Icon placeholder -->

                  <div
                    class="text-[10px] uppercase font-bold text-white/60 tracking-wider text-center w-full leading-tight break-words hyphens-auto"
                  >
                    ${translateText("single_modal.max_timer")}
                  </div>
                </div>
              </div>
            </div>

            <!-- Enable Settings -->
            <div class="space-y-6">
              <div
                class="flex items-center gap-4 pb-2 border-b border-white/10"
              >
                <div
                  class="w-8 h-8 rounded-lg bg-teal-500/20 flex items-center justify-center text-teal-400"
                >
                  <svg
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
                  </svg>
                </div>
                <h3
                  class="text-lg font-bold text-white uppercase tracking-wider"
                >
                  ${translateText("single_modal.enables_title")}
                </h3>
              </div>
              <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                ${renderUnitTypeOptions({
                  disabledUnits: this.disabledUnits,
                  toggleUnit: this.toggleUnit.bind(this),
                })}
              </div>
            </div>
          </div>
        </div>

        <!-- Footer Action -->
        <div class="p-6 pt-4 border-t border-white/10 bg-black/20">
          <button
            @click=${this.startGame}
            class="w-full py-4 text-sm font-bold text-white uppercase tracking-widest bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 hover:-translate-y-0.5 active:translate-y-0"
          >
            ${translateText("single_modal.start")}
          </button>
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        id="singlePlayerModal"
        title="${translateText("main.solo") || "Solo"}"
        ?inline=${this.inline}
        hideHeader
        hideCloseButton
      >
        ${content}
      </o-modal>
    `;
  }

  // Helper for consistent option buttons
  private renderOptionToggle(
    labelKey: string,
    checked: boolean,
    onChange: (val: boolean) => void,
    hidden: boolean = false,
  ): TemplateResult {
    if (hidden) return html``;

    return html`
      <button
        class="relative p-4 rounded-xl border transition-all duration-200 flex flex-col items-center justify-center gap-2 h-full min-h-[100px] w-full cursor-pointer ${checked
          ? "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
          : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 opacity-80"}"
        @click=${() => onChange(!checked)}
      >
        <div
          class="text-xs uppercase font-bold tracking-wider text-center w-full leading-tight break-words hyphens-auto ${checked
            ? "text-white"
            : "text-white/60"}"
        >
          ${translateText(labelKey)}
        </div>
      </button>
    `;
  }

  protected onClose(): void {
    // Reset all transient form state to ensure clean slate
    this.selectedMap = GameMapType.World;
    this.selectedDifficulty = Difficulty.Medium;
    this.gameMode = GameMode.FFA;
    this.useRandomMap = false;
    this.disableNations = false;
    this.bots = 400;
    this.infiniteGold = false;
    this.infiniteTroops = false;
    this.compactMap = false;
    this.maxTimer = false;
    this.maxTimerValue = undefined;
    this.instantBuild = false;
    this.randomSpawn = false;
    this.teamCount = 2;
    this.disabledUnits = [];
  }

  private handleSelectRandomMap() {
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

  private handleMaxTimerValueKeyDown(e: KeyboardEvent) {
    if (["-", "+", "e"].includes(e.key)) {
      e.preventDefault();
    }
  }

  private getEndTimerInput(): HTMLInputElement | null {
    return (
      (this.renderRoot.querySelector(
        "#end-timer-value",
      ) as HTMLInputElement | null) ??
      (this.querySelector("#end-timer-value") as HTMLInputElement | null)
    );
  }

  private handleMaxTimerValueChanges(e: Event) {
    const input = e.target as HTMLInputElement;
    input.value = input.value.replace(/[e+-]/gi, "");
    const value = parseInt(input.value);

    // Always update state to keep UI and internal state in sync
    if (isNaN(value) || value < 1 || value > 120) {
      // Set to undefined for invalid/empty/out-of-range values
      this.maxTimerValue = undefined;
    } else {
      this.maxTimerValue = value;
    }
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
    this.disabledUnits = checked
      ? [...this.disabledUnits, unit]
      : this.disabledUnits.filter((u) => u !== unit);
  }

  private async startGame() {
    // Validate and clamp maxTimer setting before starting
    let finalMaxTimerValue: number | undefined = undefined;
    if (this.maxTimer) {
      if (!this.maxTimerValue || this.maxTimerValue <= 0) {
        console.error("Max timer is enabled but no valid value is set");
        alert(
          translateText("single_modal.max_timer_invalid") ||
            "Please enter a valid max timer value (1-120 minutes)",
        );
        // Focus the input
        const input = this.getEndTimerInput();
        if (input) {
          input.focus();
          input.select();
        }
        return;
      }
      // Clamp value to valid range
      finalMaxTimerValue = Math.max(1, Math.min(120, this.maxTimerValue));
    }

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
              maxTimerValue: finalMaxTimerValue,
              bots: this.bots,
              infiniteGold: this.infiniteGold,
              donateGold: this.gameMode === GameMode.Team,
              donateTroops: this.gameMode === GameMode.Team,
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
