import { TemplateResult, html } from "lit";
import { customElement, state } from "lit/decorators.js";
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
} from "../core/game/Game";
import {
  ClientInfo,
  GameConfig,
  GameInfo,
  TeamCountConfig,
  isValidGameID,
} from "../core/Schemas";
import { generateID } from "../core/Util";
import { getClientIDForGame } from "./Auth";
import "./components/baseComponents/Modal";
import { BaseModal } from "./components/BaseModal";
import "./components/CopyButton";
import "./components/Difficulties";
import "./components/FluentSlider";
import "./components/LobbyPlayerView";
import "./components/map/MapPicker";
import { modalHeader } from "./components/ui/ModalHeader";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { JoinLobbyEvent } from "./Main";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import {
  renderToggleInputCard,
  renderToggleInputCardInput,
} from "./utilities/RenderToggleInputCard";
import { renderUnitTypeOptions } from "./utilities/RenderUnitTypeOptions";
@customElement("host-lobby-modal")
export class HostLobbyModal extends BaseModal {
  @state() private selectedMap: GameMapType = GameMapType.World;
  @state() private selectedDifficulty: Difficulty = Difficulty.Easy;
  @state() private disableNations = false;
  @state() private gameMode: GameMode = GameMode.FFA;
  @state() private teamCount: TeamCountConfig = 2;

  constructor() {
    super();
    this.id = "page-host-lobby";
  }
  @state() private bots: number = 400;
  @state() private spawnImmunity: boolean = false;
  @state() private spawnImmunityDurationMinutes: number | undefined = undefined;
  @state() private infiniteGold: boolean = false;
  @state() private donateGold: boolean = false;
  @state() private infiniteTroops: boolean = false;
  @state() private donateTroops: boolean = false;
  @state() private maxTimer: boolean = false;
  @state() private maxTimerValue: number | undefined = undefined;
  @state() private instantBuild: boolean = false;
  @state() private randomSpawn: boolean = false;
  @state() private compactMap: boolean = false;
  @state() private goldMultiplier: boolean = false;
  @state() private goldMultiplierValue: number | undefined = undefined;
  @state() private startingGold: boolean = false;
  @state() private startingGoldValue: number | undefined = undefined;
  @state() private lobbyId = "";
  @state() private lobbyUrlSuffix = "";
  @state() private clients: ClientInfo[] = [];
  @state() private useRandomMap: boolean = false;
  @state() private disabledUnits: UnitType[] = [];
  @state() private lobbyCreatorClientID: string = "";
  @state() private nationCount: number = 0;

  private playersInterval: NodeJS.Timeout | null = null;
  // Add a new timer for debouncing bot changes
  private botsUpdateTimer: number | null = null;
  private mapLoader = terrainMapFileLoader;

  private leaveLobbyOnClose = true;

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

  private getRandomString(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from(
      { length: 5 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
  }

  private async buildLobbyUrl(): Promise<string> {
    if (crazyGamesSDK.isOnCrazyGames()) {
      const link = crazyGamesSDK.createInviteLink(this.lobbyId);
      if (link !== null) {
        return link;
      }
    }
    const config = await getServerConfigFromClient();
    return `${window.location.origin}/${config.workerPath(this.lobbyId)}/game/${this.lobbyId}?lobby&s=${encodeURIComponent(this.lobbyUrlSuffix)}`;
  }

  private async constructUrl(): Promise<string> {
    this.lobbyUrlSuffix = this.getRandomString();
    return await this.buildLobbyUrl();
  }

  private updateHistory(url: string): void {
    if (!crazyGamesSDK.isOnCrazyGames()) {
      history.replaceState(null, "", url);
    }
  }

  render() {
    const maxTimerHandlers = this.createToggleHandlers(
      () => this.maxTimer,
      (val) => (this.maxTimer = val),
      () => this.maxTimerValue,
      (val) => (this.maxTimerValue = val),
      30,
    );
    const spawnImmunityHandlers = this.createToggleHandlers(
      () => this.spawnImmunity,
      (val) => (this.spawnImmunity = val),
      () => this.spawnImmunityDurationMinutes,
      (val) => (this.spawnImmunityDurationMinutes = val),
      5,
    );
    const goldMultiplierHandlers = this.createToggleHandlers(
      () => this.goldMultiplier,
      (val) => (this.goldMultiplier = val),
      () => this.goldMultiplierValue,
      (val) => (this.goldMultiplierValue = val),
      2,
    );
    const startingGoldHandlers = this.createToggleHandlers(
      () => this.startingGold,
      (val) => (this.startingGold = val),
      () => this.startingGoldValue,
      (val) => (this.startingGoldValue = val),
      5000000,
    );

    const content = html`
      <div
        class="h-full flex flex-col bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden select-none"
      >
        <!-- Header -->
        ${modalHeader({
          title: translateText("host_modal.title"),
          onBack: () => {
            this.leaveLobbyOnClose = true;
            this.close();
          },
          ariaLabel: translateText("common.back"),
          rightContent: html`
            <copy-button
              .lobbyId=${this.lobbyId}
              .lobbySuffix=${this.lobbyUrlSuffix}
              include-lobby-query
            ></copy-button>
          `,
        })}

        <!-- Scrollable Content -->
        <div class="flex-1 overflow-y-auto custom-scrollbar p-6 mr-1">
          <div class="max-w-5xl mx-auto space-y-10">
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
              <map-picker
                .selectedMap=${this.selectedMap}
                .useRandomMap=${this.useRandomMap}
                .randomMapDivider=${true}
                .onSelectMap=${(mapValue: GameMapType) =>
                  this.handleMapSelection(mapValue)}
                .onSelectRandom=${() => this.handleSelectRandomMap()}
              ></map-picker>
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
                  .map(([key, value]) => {
                    const isSelected = this.selectedDifficulty === value;
                    const isDisabled = this.disableNations;
                    return html`
                      <button
                        ?disabled=${isDisabled}
                        @click=${() =>
                          !isDisabled && this.handleDifficultySelection(value)}
                        class="relative group rounded-xl border transition-all duration-200 w-full overflow-hidden flex flex-col items-center p-4 gap-3 ${isDisabled
                          ? "opacity-30 grayscale cursor-not-allowed bg-white/5 border-white/5"
                          : isSelected
                            ? "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                            : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"}"
                      >
                        <difficulty-display
                          .difficultyKey=${key}
                          class="transform scale-125 origin-center ${isDisabled
                            ? "pointer-events-none"
                            : ""}"
                        ></difficulty-display>
                        <div
                          class="text-xs font-bold text-white uppercase tracking-wider text-center w-full mt-1 break-words hyphens-auto"
                        >
                          ${translateText(`difficulty.${key.toLowerCase()}`)}
                        </div>
                      </button>
                    `;
                  })}
              </div>
            </div>

            <!-- Game Mode -->
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
                  return html`
                    <button
                      class="w-full py-6 rounded-xl border transition-all duration-200 flex flex-col items-center justify-center gap-3 ${isSelected
                        ? "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                        : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"}"
                      @click=${() => this.handleGameModeSelection(mode)}
                    >
                      <span
                        class="text-sm font-bold text-white uppercase tracking-widest break-words hyphens-auto"
                      >
                        ${mode === GameMode.FFA
                          ? translateText("game_mode.ffa")
                          : translateText("game_mode.teams")}
                      </span>
                    </button>
                  `;
                })}
              </div>
            </div>

            ${this.gameMode === GameMode.FFA
              ? ""
              : html`
                  <!-- Team Count -->
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
                      ].map((o) => {
                        const isSelected = this.teamCount === o;
                        return html`
                          <button
                            @click=${() => this.handleTeamCountSelection(o)}
                            class="w-full px-4 py-3 rounded-xl border transition-all duration-200 flex items-center justify-center ${isSelected
                              ? "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                              : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"}"
                          >
                            <span
                              class="text-xs font-bold uppercase tracking-wider text-center text-white break-words hyphens-auto"
                            >
                              ${typeof o === "string"
                                ? o === HumansVsNations
                                  ? translateText("public_lobby.teams_hvn")
                                  : translateText(`host_modal.teams_${o}`)
                                : translateText("public_lobby.teams", {
                                    num: o,
                                  })}
                            </span>
                          </button>
                        `;
                      })}
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
                  ${translateText("host_modal.options_title")}
                </h3>
              </div>
              <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <!-- Bots Slider -->
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
                    labelKey="host_modal.bots"
                    disabledKey="host_modal.bots_disabled"
                    @value-changed=${this.handleBotsChange}
                  ></fluent-slider>
                </div>

                ${!(
                  this.gameMode === GameMode.Team &&
                  this.teamCount === HumansVsNations
                )
                  ? this.renderOptionToggle(
                      "host_modal.disable_nations",
                      this.disableNations,
                      this.handleDisableNationsChange,
                    )
                  : ""}
                ${this.renderOptionToggle(
                  "host_modal.instant_build",
                  this.instantBuild,
                  this.handleInstantBuildChange,
                )}
                ${this.renderOptionToggle(
                  "host_modal.random_spawn",
                  this.randomSpawn,
                  this.handleRandomSpawnChange,
                )}
                ${this.renderOptionToggle(
                  "host_modal.donate_gold",
                  this.donateGold,
                  this.handleDonateGoldChange,
                )}
                ${this.renderOptionToggle(
                  "host_modal.donate_troops",
                  this.donateTroops,
                  this.handleDonateTroopsChange,
                )}
                ${this.renderOptionToggle(
                  "host_modal.infinite_gold",
                  this.infiniteGold,
                  this.handleInfiniteGoldChange,
                )}
                ${this.renderOptionToggle(
                  "host_modal.infinite_troops",
                  this.infiniteTroops,
                  this.handleInfiniteTroopsChange,
                )}
                ${this.renderOptionToggle(
                  "host_modal.compact_map",
                  this.compactMap,
                  this.handleCompactMapChange,
                )}

                <!-- Max Timer -->
                ${renderToggleInputCard({
                  labelKey: "host_modal.max_timer",
                  checked: this.maxTimer,
                  onClick: maxTimerHandlers.click,
                  input: renderToggleInputCardInput({
                    min: 0,
                    max: 120,
                    value: this.maxTimerValue ?? 0,
                    ariaLabel: translateText("host_modal.max_timer"),
                    placeholder: translateText("host_modal.mins_placeholder"),
                    onInput: this.handleMaxTimerValueChanges,
                    onKeyDown: this.handleMaxTimerValueKeyDown,
                  }),
                })}

                <!-- Spawn Immunity -->
                ${renderToggleInputCard({
                  labelKey: "host_modal.player_immunity_duration",
                  checked: this.spawnImmunity,
                  onClick: spawnImmunityHandlers.click,
                  input: renderToggleInputCardInput({
                    min: 0,
                    max: 120,
                    step: 1,
                    value: this.spawnImmunityDurationMinutes ?? 0,
                    ariaLabel: translateText(
                      "host_modal.player_immunity_duration",
                    ),
                    placeholder: translateText("host_modal.mins_placeholder"),
                    onInput: this.handleSpawnImmunityDurationInput,
                    onKeyDown: this.handleSpawnImmunityDurationKeyDown,
                  }),
                })}

                <!-- Gold Multiplier -->
                ${renderToggleInputCard({
                  labelKey: "single_modal.gold_multiplier",
                  checked: this.goldMultiplier,
                  onClick: goldMultiplierHandlers.click,
                  input: renderToggleInputCardInput({
                    id: "gold-multiplier-value",
                    min: 0.1,
                    max: 1000,
                    step: "any",
                    value: this.goldMultiplierValue ?? "",
                    ariaLabel: translateText("single_modal.gold_multiplier"),
                    placeholder: translateText(
                      "single_modal.gold_multiplier_placeholder",
                    ),
                    onChange: this.handleGoldMultiplierValueChanges,
                    onKeyDown: this.handleGoldMultiplierValueKeyDown,
                  }),
                })}

                <!-- Starting Gold -->
                ${renderToggleInputCard({
                  labelKey: "single_modal.starting_gold",
                  checked: this.startingGold,
                  onClick: startingGoldHandlers.click,
                  input: renderToggleInputCardInput({
                    id: "starting-gold-value",
                    min: 0,
                    max: 1000000000,
                    step: 100000,
                    value: this.startingGoldValue ?? "",
                    ariaLabel: translateText("single_modal.starting_gold"),
                    placeholder: translateText(
                      "single_modal.starting_gold_placeholder",
                    ),
                    onInput: this.handleStartingGoldValueChanges,
                    onKeyDown: this.handleStartingGoldValueKeyDown,
                  }),
                })}
              </div>
            </div>

            <!-- Enabled Items -->
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
                  ${translateText("host_modal.enables_title")}
                </h3>
              </div>
              <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                ${renderUnitTypeOptions({
                  disabledUnits: this.disabledUnits,
                  toggleUnit: this.toggleUnit.bind(this),
                })}
              </div>
            </div>

            <!-- Player List -->
            <lobby-player-view
              .gameMode=${this.gameMode}
              .clients=${this.clients}
              .lobbyCreatorClientID=${this.lobbyCreatorClientID}
              .currentClientID=${this.lobbyCreatorClientID}
              .teamCount=${this.teamCount}
              .nationCount=${this.nationCount}
              .disableNations=${this.disableNations}
              .isCompactMap=${this.compactMap}
              .onKickPlayer=${(clientID: string) => this.kickPlayer(clientID)}
            ></lobby-player-view>
          </div>
        </div>

        <!-- Player List / footer -->
        <div class="p-6 pt-4 border-t border-white/10 bg-black/20 shrink-0">
          <button
            class="w-full py-4 text-sm font-bold text-white uppercase tracking-widest bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 hover:-translate-y-0.5 active:translate-y-0 disabled:transform-none"
            @click=${this.startGame}
            ?disabled=${this.clients.length < 2}
          >
            ${this.clients.length === 1
              ? translateText("host_modal.waiting")
              : translateText("host_modal.start")}
          </button>
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        title=""
        ?hideCloseButton=${true}
        ?inline=${this.inline}
        hideHeader
      >
        ${content}
      </o-modal>
    `;
  }

  protected onOpen(): void {
    this.lobbyId = generateID();
    this.lobbyCreatorClientID = getClientIDForGame(this.lobbyId);

    createLobby(this.lobbyCreatorClientID, this.lobbyId)
      .then(async (lobby) => {
        this.lobbyId = lobby.gameID;
        if (!isValidGameID(this.lobbyId)) {
          throw new Error(`Invalid lobby ID format: ${this.lobbyId}`);
        }
        crazyGamesSDK.showInviteButton(this.lobbyId);
        const url = await this.constructUrl();
        this.updateHistory(url);
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
    if (this.modalEl) {
      this.modalEl.onClose = () => {
        this.close();
      };
    }
    this.playersInterval = setInterval(() => this.pollPlayers(), 1000);
    this.loadNationCount();
  }

  private createToggleHandlers(
    toggleStateGetter: () => boolean,
    toggleStateSetter: (val: boolean) => void,
    valueGetter: () => number | undefined,
    valueSetter: (val: number | undefined) => void,
    defaultValue: number = 0,
  ) {
    const toggleLogic = () => {
      const newState = !toggleStateGetter();
      toggleStateSetter(newState);
      if (newState) {
        valueSetter(valueGetter() ?? defaultValue);
      } else {
        valueSetter(undefined);
      }
      this.putGameConfig();
      this.requestUpdate();
    };

    return {
      click: (e: Event) => {
        if ((e.target as HTMLElement).tagName.toLowerCase() === "input") return;
        toggleLogic();
      },
      keydown: (e: KeyboardEvent) => {
        if ((e.target as HTMLElement).tagName.toLowerCase() === "input") return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleLogic();
        }
      },
    };
  }

  private leaveLobby() {
    if (!this.lobbyId) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("leave-lobby", {
        detail: { lobby: this.lobbyId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  protected onClose(): void {
    console.log("Closing host lobby modal");
    if (this.leaveLobbyOnClose) {
      this.leaveLobby();
      this.updateHistory("/"); // Reset URL to base
    }
    crazyGamesSDK.hideInviteButton();

    // Clean up timers and resources
    if (this.playersInterval) {
      clearInterval(this.playersInterval);
      this.playersInterval = null;
    }
    if (this.botsUpdateTimer !== null) {
      clearTimeout(this.botsUpdateTimer);
      this.botsUpdateTimer = null;
    }

    // Reset all transient form state to ensure clean slate
    this.selectedMap = GameMapType.World;
    this.selectedDifficulty = Difficulty.Easy;
    this.disableNations = false;
    this.gameMode = GameMode.FFA;
    this.teamCount = 2;
    this.bots = 400;
    this.spawnImmunity = false;
    this.spawnImmunityDurationMinutes = undefined;
    this.infiniteGold = false;
    this.donateGold = false;
    this.infiniteTroops = false;
    this.donateTroops = false;
    this.maxTimer = false;
    this.maxTimerValue = undefined;
    this.instantBuild = false;
    this.randomSpawn = false;
    this.compactMap = false;
    this.useRandomMap = false;
    this.disabledUnits = [];
    this.lobbyId = "";
    this.clients = [];
    this.lobbyCreatorClientID = "";
    this.nationCount = 0;
    this.goldMultiplier = false;
    this.goldMultiplierValue = undefined;
    this.startingGold = false;
    this.startingGoldValue = undefined;

    this.leaveLobbyOnClose = true;
  }

  private async handleSelectRandomMap() {
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

  private handleInstantBuildChange = (val: boolean) => {
    this.instantBuild = val;
    this.putGameConfig();
  };

  private handleSpawnImmunityDurationKeyDown(e: KeyboardEvent) {
    if (["-", "+", "e", "E"].includes(e.key)) {
      e.preventDefault();
    }
  }

  private handleSpawnImmunityDurationInput(e: Event) {
    const input = e.target as HTMLInputElement;
    input.value = input.value.replace(/[eE+-]/g, "");
    const value = parseInt(input.value, 10);
    if (Number.isNaN(value) || value < 0 || value > 120) {
      return;
    }
    this.spawnImmunityDurationMinutes = value;
    this.putGameConfig();
  }

  private handleGoldMultiplierValueKeyDown(e: KeyboardEvent) {
    if (["+", "-", "e", "E"].includes(e.key)) {
      e.preventDefault();
    }
  }

  private handleGoldMultiplierValueChanges(e: Event) {
    const input = e.target as HTMLInputElement;
    const value = parseFloat(input.value);

    if (isNaN(value) || value < 0.1 || value > 1000) {
      this.goldMultiplierValue = undefined;
      input.value = "";
    } else {
      this.goldMultiplierValue = value;
    }
    this.putGameConfig();
  }

  private handleStartingGoldValueKeyDown(e: KeyboardEvent) {
    if (["-", "+", "e", "E"].includes(e.key)) {
      e.preventDefault();
    }
  }

  private handleStartingGoldValueChanges(e: Event) {
    const input = e.target as HTMLInputElement;
    input.value = input.value.replace(/[eE+-]/g, "");
    const value = parseInt(input.value);

    if (isNaN(value) || value < 0 || value > 1000000000) {
      this.startingGoldValue = undefined;
    } else {
      this.startingGoldValue = value;
    }
    this.putGameConfig();
  }

  private handleRandomSpawnChange = (val: boolean) => {
    this.randomSpawn = val;
    this.putGameConfig();
  };

  private handleInfiniteGoldChange = (val: boolean) => {
    this.infiniteGold = val;
    this.putGameConfig();
  };

  private handleDonateGoldChange = (val: boolean) => {
    this.donateGold = val;
    this.putGameConfig();
  };

  private handleInfiniteTroopsChange = (val: boolean) => {
    this.infiniteTroops = val;
    this.putGameConfig();
  };

  private handleCompactMapChange = (val: boolean) => {
    this.compactMap = val;
    if (val && this.bots === 400) {
      this.bots = 100;
    } else if (!val && this.bots === 100) {
      this.bots = 400;
    }
    this.putGameConfig();
  };

  private handleDonateTroopsChange = (val: boolean) => {
    this.donateTroops = val;
    this.putGameConfig();
  };

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

  private handleDisableNationsChange = async (val: boolean) => {
    this.disableNations = val;
    console.log(`updating disable nations to ${this.disableNations}`);
    this.putGameConfig();
  };

  private async handleGameModeSelection(value: GameMode) {
    this.gameMode = value;
    if (this.gameMode === GameMode.Team) {
      this.donateGold = true;
      this.donateTroops = true;
    } else {
      this.donateGold = false;
      this.donateTroops = false;
    }
    this.putGameConfig();
  }

  private async handleTeamCountSelection(value: TeamCountConfig) {
    this.teamCount = value;
    this.putGameConfig();
  }

  private async putGameConfig() {
    const spawnImmunityTicks = this.spawnImmunityDurationMinutes
      ? this.spawnImmunityDurationMinutes * 60 * 10
      : 0;
    const url = await this.constructUrl();
    this.updateHistory(url);
    this.dispatchEvent(
      new CustomEvent("update-game-config", {
        detail: {
          config: {
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
            spawnImmunityDuration: this.spawnImmunity
              ? spawnImmunityTicks
              : undefined,
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
            goldMultiplier:
              this.goldMultiplier === true
                ? this.goldMultiplierValue
                : undefined,
            startingGold:
              this.startingGold === true ? this.startingGoldValue : undefined,
          } satisfies Partial<GameConfig>,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private toggleUnit(unit: UnitType, checked: boolean): void {
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

    // If the modal closes as part of starting the game, do not leave the lobby
    this.leaveLobbyOnClose = false;

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

    if (!response.ok) {
      this.leaveLobbyOnClose = true;
    }
    return response;
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
    const currentMap = this.selectedMap;
    try {
      const mapData = this.mapLoader.getMapData(currentMap);
      const manifest = await mapData.manifest();
      // Only update if the map hasn't changed
      if (this.selectedMap === currentMap) {
        this.nationCount = manifest.nations.length;
      }
    } catch (error) {
      console.warn("Failed to load nation count", error);
      // Only update if the map hasn't changed
      if (this.selectedMap === currentMap) {
        this.nationCount = 0;
      }
    }
  }
}

async function createLobby(
  creatorClientID: string,
  gameID: string,
): Promise<GameInfo> {
  const config = await getServerConfigFromClient();
  try {
    const response = await fetch(
      `/${config.workerPath(gameID)}/api/create_game/${gameID}?creatorClientID=${encodeURIComponent(creatorClientID)}`,
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
