import { TemplateResult, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { copyToClipboard, translateText } from "../client/Utils";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { EventBus } from "../core/EventBus";
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
import { getCompactMapNationCount } from "../core/game/NationCreation";
import { UserSettings } from "../core/game/UserSettings";
import {
  ClientInfo,
  GameConfig,
  GameInfo,
  TeamCountConfig,
  isValidGameID,
} from "../core/Schemas";
import { generateID } from "../core/Util";
import "./components/baseComponents/Modal";
import { BaseModal } from "./components/BaseModal";
import "./components/Difficulties";
import "./components/FluentSlider";
import "./components/LobbyChatPanel";
import "./components/LobbyTeamView";
import "./components/Maps";
import { modalHeader } from "./components/ui/ModalHeader";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { JoinLobbyEvent } from "./Main";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { ReceiveLobbyChatEvent } from "./Transport";
import { renderUnitTypeOptions } from "./utilities/RenderUnitTypeOptions";
import randomMap from "/images/RandomMap.webp?url";
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
  @state() private chatVisible: boolean = true;
  @state() private hasUnreadMessages: boolean = false;
  @state() private lobbyId = "";
  @state() private copySuccess = false;
  @state() private lobbyUrlSuffix = "";
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
  private eventBus: EventBus | null = null;

  private leaveLobbyOnClose = true;

  connectedCallback() {
    super.connectedCallback();
    this.eventBus = window.__eventBus ?? null;
    if (this.eventBus) {
      this.eventBus.on(ReceiveLobbyChatEvent, this.onChatMessage);
    }
  }

  disconnectedCallback() {
    if (this.eventBus) {
      this.eventBus.off(ReceiveLobbyChatEvent, this.onChatMessage);
    }
    super.disconnectedCallback();
  }

  private onChatMessage = (event: ReceiveLobbyChatEvent) => {
    // Only set unread if chat is hidden
    if (!this.chatVisible) {
      this.hasUnreadMessages = true;
    }
  };

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
    const config = await getServerConfigFromClient();
    return `${window.location.origin}/${config.workerPath(this.lobbyId)}/game/${this.lobbyId}?lobby&s=${encodeURIComponent(this.lobbyUrlSuffix)}`;
  }

  private async constructUrl(): Promise<string> {
    this.lobbyUrlSuffix = this.getRandomString();
    return await this.buildLobbyUrl();
  }

  private updateHistory(url: string): void {
    history.replaceState(null, "", url);
  }

  render() {
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
            <!-- Lobby ID Box -->
            <div
              class="flex items-center gap-0.5 bg-white/5 rounded-lg px-2 py-1 border border-white/10 max-w-[220px] flex-nowrap"
            >
              <button
                @click=${() => {
                  this.lobbyIdVisible = !this.lobbyIdVisible;
                  this.requestUpdate();
                }}
                class="p-1.5 rounded-md hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                title="${translateText("user_setting.toggle_visibility")}"
              >
                ${this.lobbyIdVisible
                  ? html`<svg
                      viewBox="0 0 512 512"
                      height="16px"
                      width="16px"
                      fill="currentColor"
                    >
                      <path
                        d="M256 105c-101.8 0-188.4 62.7-224 151 35.6 88.3 122.2 151 224 151s188.4-62.7 224-151c-35.6-88.3-122.2-151-224-151zm0 251.7c-56 0-101.7-45.7-101.7-101.7S200 153.3 256 153.3 357.7 199 357.7 255 312 356.7 256 356.7zm0-161.1c-33 0-59.4 26.4-59.4 59.4s26.4 59.4 59.4 59.4 59.4-26.4 59.4-59.4-26.4-59.4-59.4-59.4z"
                      ></path>
                    </svg>`
                  : html`<svg
                      viewBox="0 0 512 512"
                      height="16px"
                      width="16px"
                      fill="currentColor"
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
                    </svg>`}
              </button>
              <button
                @click=${this.copyToClipboard}
                @dblclick=${(e: Event) => {
                  (e.currentTarget as HTMLElement).classList.add("select-all");
                }}
                @mouseleave=${(e: Event) => {
                  (e.currentTarget as HTMLElement).classList.remove(
                    "select-all",
                  );
                }}
                class="font-mono text-xs font-bold text-white px-2 cursor-pointer select-none min-w-[80px] text-center truncate tracking-wider bg-transparent border-0"
                title="${translateText("common.click_to_copy")}"
                aria-label="${translateText("common.click_to_copy")}"
                type="button"
              >
                ${this.copySuccess
                  ? translateText("common.copied")
                  : this.lobbyIdVisible
                    ? this.lobbyId
                    : "••••••••"}
              </button>
              <button
                @click=${this.copyToClipboard}
                class="p-1.5 rounded-md hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                title="${translateText("common.click_to_copy")}"
                aria-label="${translateText("common.click_to_copy")}"
                type="button"
              >
                <svg
                  viewBox="0 0 24 24"
                  height="16px"
                  width="16px"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    d="M16 1H4c-1.1 0-2 .9-2 2v12h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
                  />
                </svg>
              </button>
            </div>
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
              <div class="space-y-8">
                <!-- Use the imported mapCategories -->
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
                          const mapKey = Object.entries(GameMapType).find(
                            ([, v]) => v === mapValue,
                          )?.[0];
                          return html`
                            <div
                              @click=${() => this.handleMapSelection(mapValue)}
                              class="cursor-pointer transition-transform duration-200 active:scale-95"
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
                <!-- Random Map Card -->
                <div class="w-full pt-4 border-t border-white/5">
                  <h4
                    class="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2"
                  >
                    ${translateText("map_categories.special")}
                  </h4>
                  <div
                    class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
                  >
                    <button
                      class="relative group rounded-xl border transition-all duration-200 overflow-hidden flex flex-col items-stretch ${this
                        .useRandomMap
                        ? "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]"
                        : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"}"
                      @click=${this.handleSelectRandomMap}
                    >
                      <div
                        class="aspect-[2/1] w-full relative overflow-hidden bg-black/20"
                      >
                        <img
                          src=${randomMap}
                          alt=${translateText("map.random")}
                          class="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity"
                        />
                      </div>
                      <div class="p-3 text-center border-t border-white/5">
                        <div
                          class="text-xs font-bold text-white uppercase tracking-wider break-words hyphens-auto"
                        >
                          ${translateText("map.random")}
                        </div>
                      </div>
                    </button>
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
                <div
                  role="button"
                  tabindex="0"
                  @click=${this.createToggleHandlers(
                    () => this.maxTimer,
                    (val) => (this.maxTimer = val),
                    () => this.maxTimerValue,
                    (val) => (this.maxTimerValue = val),
                    30,
                  ).click}
                  @keydown=${this.createToggleHandlers(
                    () => this.maxTimer,
                    (val) => (this.maxTimer = val),
                    () => this.maxTimerValue,
                    (val) => (this.maxTimerValue = val),
                    30,
                  ).keydown}
                  class="relative p-3 rounded-xl border transition-all duration-200 flex flex-col items-center justify-between gap-2 h-full cursor-pointer min-h-[100px] ${this
                    .maxTimer
                    ? "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                    : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 opacity-80"}"
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
                    ? html`
                        <input
                          type="number"
                          min="0"
                          max="120"
                          .value=${String(this.maxTimerValue ?? 0)}
                          class="w-full text-center rounded bg-black/60 text-white text-sm font-bold border border-white/20 focus:outline-none focus:border-blue-500 p-1 my-1"
                          @click=${(e: Event) => e.stopPropagation()}
                          @input=${this.handleMaxTimerValueChanges}
                          @keydown=${this.handleMaxTimerValueKeyDown}
                          placeholder=${translateText(
                            "host_modal.mins_placeholder",
                          )}
                        />
                      `
                    : html`<div
                        class="h-[2px] w-4 bg-white/10 rounded my-3"
                      ></div>`}

                  <div
                    class="text-[10px] uppercase font-bold tracking-wider text-center w-full leading-tight ${this
                      .maxTimer
                      ? "text-white"
                      : "text-white/60"}"
                  >
                    ${translateText("host_modal.max_timer")}
                  </div>
                </div>

                <!-- Spawn Immunity -->
                <div
                  role="button"
                  tabindex="0"
                  @click=${this.createToggleHandlers(
                    () => this.spawnImmunity,
                    (val) => (this.spawnImmunity = val),
                    () => this.spawnImmunityDurationMinutes,
                    (val) => (this.spawnImmunityDurationMinutes = val),
                    5,
                  ).click}
                  @keydown=${this.createToggleHandlers(
                    () => this.spawnImmunity,
                    (val) => (this.spawnImmunity = val),
                    () => this.spawnImmunityDurationMinutes,
                    (val) => (this.spawnImmunityDurationMinutes = val),
                    5,
                  ).keydown}
                  class="relative p-3 rounded-xl border transition-all duration-200 flex flex-col items-center justify-between gap-2 h-full cursor-pointer min-h-[100px] ${this
                    .spawnImmunity
                    ? "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                    : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 opacity-80"}"
                >
                  <div class="flex items-center justify-center w-full mt-1">
                    <div
                      class="w-5 h-5 rounded border flex items-center justify-center transition-colors ${this
                        .spawnImmunity
                        ? "bg-blue-500 border-blue-500"
                        : "border-white/20 bg-white/5"}"
                    >
                      ${this.spawnImmunity
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

                  ${this.spawnImmunity
                    ? html`
                        <input
                          type="number"
                          min="0"
                          max="120"
                          step="1"
                          .value=${String(
                            this.spawnImmunityDurationMinutes ?? 0,
                          )}
                          class="w-full text-center rounded bg-black/60 text-white text-sm font-bold border border-white/20 focus:outline-none focus:border-blue-500 p-1 my-1"
                          @click=${(e: Event) => e.stopPropagation()}
                          @input=${this.handleSpawnImmunityDurationInput}
                          @keydown=${this.handleSpawnImmunityDurationKeyDown}
                          placeholder=${translateText(
                            "host_modal.mins_placeholder",
                          )}
                        />
                      `
                    : html`<div
                        class="h-[2px] w-4 bg-white/10 rounded my-3"
                      ></div>`}

                  <div
                    class="text-[10px] uppercase font-bold tracking-wider text-center w-full leading-tight ${this
                      .spawnImmunity
                      ? "text-white"
                      : "text-white/60"}"
                  >
                    ${translateText("host_modal.player_immunity_duration")}
                  </div>
                </div>
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
            <div class="border-t border-white/10 pt-6">
              <div class="flex justify-between items-center mb-4">
                <div
                  class="text-xs font-bold text-white/40 uppercase tracking-widest"
                >
                  ${this.clients.length}
                  ${this.clients.length === 1
                    ? translateText("host_modal.player")
                    : translateText("host_modal.players")}
                  <span style="margin: 0 8px;">•</span>
                  ${this.getEffectiveNationCount()}
                  ${this.getEffectiveNationCount() === 1
                    ? translateText("host_modal.nation_player")
                    : translateText("host_modal.nation_players")}
                </div>
              </div>

              <div class="flex justify-between items-center mb-4">
                <div
                  class="text-xs font-bold text-white/40 uppercase tracking-widest"
                >
                  <!-- Spacer -->
                </div>
                <button
                  @click=${() => {
                    this.chatVisible = !this.chatVisible;
                    this.userSettings.toggleLobbyChatVisibility();
                    // Clear unread indicator when opening chat
                    if (this.chatVisible) {
                      this.hasUnreadMessages = false;
                    }
                  }}
                  class="relative flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${this
                    .chatVisible
                    ? "bg-blue-600/20 text-blue-400 hover:bg-blue-600/30"
                    : "bg-white/5 text-white/60 hover:bg-white/10"}"
                  title="${translateText(
                    this.chatVisible ? "lobby_chat.hide" : "lobby_chat.show",
                  )}"
                >
                  <svg
                    viewBox="0 0 24 24"
                    height="14px"
                    width="14px"
                    fill="currentColor"
                  >
                    <path
                      d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"
                    />
                  </svg>
                  ${translateText(
                    this.chatVisible ? "lobby_chat.hide" : "lobby_chat.show",
                  )}
                  ${!this.chatVisible && this.hasUnreadMessages
                    ? html`<span
                        class="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-black animate-pulse"
                      ></span>`
                    : ""}
                </button>
              </div>

              <lobby-team-view
                class="block rounded-lg border border-white/10 bg-white/5 p-2"
                .gameMode=${this.gameMode}
                .clients=${this.clients}
                .lobbyCreatorClientID=${this.lobbyCreatorClientID}
                .teamCount=${this.teamCount}
                .nationCount=${this.getEffectiveNationCount()}
                .onKickPlayer=${(clientID: string) => this.kickPlayer(clientID)}
              ></lobby-team-view>

              <div
                class="mt-4 p-3 rounded-lg border border-white/10 bg-white/5 ${this
                  .chatVisible
                  ? ""
                  : "hidden"}"
              >
                <div class="text-sm font-semibold text-white/80 mb-2">
                  ${translateText("lobby_chat.title")}
                </div>
                <lobby-chat-panel></lobby-chat-panel>
              </div>
            </div>
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

  firstUpdated(): void {
    this.chatVisible = this.userSettings.get(
      "settings.lobbyChatVisibility",
      true,
    );

    this.updateComplete.then(() => {
      const chatPanel = this.renderRoot.querySelector("lobby-chat-panel");
      if (chatPanel && window.__eventBus) {
        (chatPanel as any).setEventBus(window.__eventBus);
      }
    });
  }

  updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);
  }

  protected onOpen(): void {
    this.lobbyCreatorClientID = generateID();
    this.lobbyIdVisible = this.userSettings.get(
      "settings.lobbyIdVisibility",
      true,
    );

    createLobby(this.lobbyCreatorClientID)
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
    this.copySuccess = false;
    this.clients = [];
    this.lobbyCreatorClientID = "";
    this.lobbyIdVisible = true;
    this.nationCount = 0;

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

  private async copyToClipboard() {
    const url = await this.buildLobbyUrl();
    await copyToClipboard(
      url,
      () => (this.copySuccess = true),
      () => (this.copySuccess = false),
    );
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

  /**
   * Returns the effective nation count for display purposes.
   * In HumansVsNations mode, this equals the number of human players.
   * For compact maps, only 25% of nations are used.
   * Otherwise, it uses the manifest nation count (or 0 if nations are disabled).
   */
  private getEffectiveNationCount(): number {
    if (this.disableNations) {
      return 0;
    }
    if (this.gameMode === GameMode.Team && this.teamCount === HumansVsNations) {
      return this.clients.length;
    }
    return getCompactMapNationCount(this.nationCount, this.compactMap);
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
