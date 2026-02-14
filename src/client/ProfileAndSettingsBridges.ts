/**
 * Profile/settings/setup bridges consolidated in one module.
 */

import {
  ClanLeaderboardResponse,
  PlayerGame,
  PlayerStatsTree,
  UserMeResponse,
} from "../core/ApiSchemas";
import { renderPlayerFlag } from "../core/CustomFlag";
import type { Cosmetics, Pattern } from "../core/CosmeticSchemas";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import {
  Difficulty,
  Duos,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  HumansVsNations,
  hasUnusualThumbnailSize,
  Quads,
  Trios,
  UnitType,
  mapCategories,
} from "../core/game/Game";
import { UserSettings } from "../core/game/UserSettings";
import { PlayerPattern, TeamCountConfig, FlagSchema, GameEndInfo } from "../core/Schemas";
import {
  GOLD_INDEX_STEAL,
  GOLD_INDEX_TRADE,
  GOLD_INDEX_TRAIN_OTHER,
  GOLD_INDEX_TRAIN_SELF,
  GOLD_INDEX_WAR,
} from "../core/StatsSchemas";
import { generateID, getClanTagOriginalCase, sanitizeClanTag } from "../core/Util";
import {
  MIN_USERNAME_LENGTH,
  validateUsername,
} from "../core/validations/username";
import Countries from "resources/countries.json" with { type: "json" };
import { html, LitElement, render as litRender } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { v4 as uuidv4 } from "uuid";
import { fetchPlayerById, getUserMe, hasLinkedAccount } from "./Api";
import { discordLogin, logOut, tempTokenLogin } from "./Auth";
import {
  fetchCosmetics,
  handlePurchase,
  patternRelationship,
} from "./Cosmetics";
import { JoinLobbyEvent } from "./Main";
import "./profile/DioxusMatchmakingModal";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import {
  formatDebugTranslation,
  formatKeyForDisplay,
  renderDuration,
  translateText,
} from "./Utils";
import { renderPatternPreview } from "./utilities/PatternPreview";
import { PlayerInfo, Ranking, RankType } from "./ranking/GameInfoRanking";
import {
  dispatchUiAction,
  dispatchUiSnapshot,
  getUiRuntimeStats,
  initDioxusRuntime,
  type DioxusUiEvent,
} from "./UiRuntimeBridge";
import {
  ensureUiApiMutationRuntimeStarted,
  requestAccountMagicLink,
} from "./runtime/UiApiMutationRuntime";
import {
  startUiRuntimeEventRouter,
  subscribeUiRuntimeEvents,
  waitForUiRuntimeEvent,
} from "./runtime/UiRuntimeEventRouter";
import {
  UI_RUNTIME_ACTIONS,
  UI_RUNTIME_EVENTS,
  UI_RUNTIME_SNAPSHOTS,
} from "./runtime/UiRuntimeProtocol";
import {
  ensureUiApiReadRuntimeStarted,
  requestGameInfoRead,
  requestStatsRead,
  UI_API_RUNTIME_EVENTS,
  type UiApiGameInfoSuccessDetail,
  type UiApiReadErrorDetail,
  type UiApiReadLoadingDetail,
  type UiApiStatsSuccessDetail,
} from "./runtime/UiApiReadRuntime";
import {
  ensureUiSessionRuntimeStarted,
  readUiSessionStorage,
  reportUiModalState,
  requestUiModalClose,
  UI_SESSION_RUNTIME_EVENTS,
  type UiSessionKeyboardChangedDetail,
  writeUiSessionStorage,
  type UiSessionModalCloseDetail,
} from "./runtime/UiSessionRuntime";
import {
  renderChangelogAssetHtml,
  readLanguageBundle,
} from "./runtime/UiContentReadRuntime";

import en from "../../resources/lang/en.json";
import metadata from "../../resources/lang/metadata.json";
import changelog from "/changelog.md?url";

const SESSION_MODAL_IDS = {
  territoryPatterns: "territory-patterns",
  userSetting: "user-setting",
  matchmaking: "matchmaking",
  stats: "stats",
  gameInfo: "game-info",
  language: "language",
  flagInput: "flag-input",
  help: "help",
  tokenLogin: "token-login",
} as const;

function dispatchProfileRuntimeAction(
  actionType: string,
  payload: Record<string, unknown> = {},
): boolean {
  const dispatched = dispatchUiAction({
    type: actionType,
    payload,
  });
  if (!dispatched) {
    console.warn(
      "[ProfileAndSettingsBridges] Failed runtime action:",
      actionType,
    );
  }
  return dispatched;
}

function dispatchProfileRuntimeSnapshot(
  snapshotType: string,
  payload: Record<string, unknown>,
): boolean {
  const dispatched = dispatchUiSnapshot({
    type: snapshotType,
    payload,
  });
  if (!dispatched) {
    console.warn(
      "[ProfileAndSettingsBridges] Failed runtime snapshot:",
      snapshotType,
    );
  }
  return dispatched;
}

@customElement("dioxus-account-modal")
export class DioxusAccountModal extends LitElement {
  @state()
  private isLaunched: boolean = false;

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

  private userMeResponse: UserMeResponse | null = null;
  private statsTree: PlayerStatsTree | null = null;
  private recentGames: PlayerGame[] = [];

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener(
      "dioxus-modal-close",
      this.handleModalClose as EventListener,
    );
    this.addEventListener(
      "dioxus-account-discord-login",
      this.handleDiscordLogin as EventListener,
    );
    this.addEventListener(
      "dioxus-account-email-submit",
      this.handleEmailSubmit as EventListener,
    );
    this.addEventListener(
      "dioxus-account-logout",
      this.handleLogout as EventListener,
    );
    this.addEventListener(
      "dioxus-account-view-game",
      this.handleViewGame as EventListener,
    );

    // Listen for userMeResponse events
    document.addEventListener(
      "userMeResponse",
      this.handleUserMeResponse as EventListener,
    );
    void ensureUiApiMutationRuntimeStarted();
  }

  disconnectedCallback() {
    this.removeEventListener(
      "dioxus-modal-close",
      this.handleModalClose as EventListener,
    );
    this.removeEventListener(
      "dioxus-account-discord-login",
      this.handleDiscordLogin as EventListener,
    );
    this.removeEventListener(
      "dioxus-account-email-submit",
      this.handleEmailSubmit as EventListener,
    );
    this.removeEventListener(
      "dioxus-account-logout",
      this.handleLogout as EventListener,
    );
    this.removeEventListener(
      "dioxus-account-view-game",
      this.handleViewGame as EventListener,
    );
    document.removeEventListener(
      "userMeResponse",
      this.handleUserMeResponse as EventListener,
    );
    super.disconnectedCallback();
  }

  private handleUserMeResponse = (event: Event) => {
    const customEvent = event as CustomEvent;
    if (customEvent.detail) {
      this.userMeResponse = customEvent.detail as UserMeResponse;
      if (this.userMeResponse?.player?.publicId === undefined) {
        this.statsTree = null;
        this.recentGames = [];
      }
    } else {
      this.statsTree = null;
      this.recentGames = [];
    }
  };

  private handleModalClose = () => {
    this.close();
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true }),
    );
  };

  private handleDiscordLogin = () => {
    discordLogin();
  };

  private handleEmailSubmit = async (e: CustomEvent) => {
    const email = e.detail as string;
    if (!email) {
      alert(translateText("account_modal.enter_email_address"));
      return;
    }
    try {
      const success = await requestAccountMagicLink(email, "open");
      if (success) {
        alert(
          translateText("account_modal.recovery_email_sent", { email }),
        );
      } else {
        alert(translateText("account_modal.failed_to_send_recovery_email"));
      }
    } catch (error) {
      console.warn("Failed to send account magic link:", error);
      const message =
        error instanceof Error && error.message.includes("unavailable")
          ? error.message
          : translateText("account_modal.failed_to_send_recovery_email");
      alert(message);
    }
  };

  private handleLogout = async () => {
    await logOut();
    this.close();
    window.location.reload();
  };

  private handleViewGame = async (e: CustomEvent) => {
    const gameId = e.detail as string;
    this.close();
    const config = await getServerConfigFromClient();
    const encodedGameId = encodeURIComponent(gameId);
    const newUrl = `/${config.workerPath(gameId)}/game/${encodedGameId}`;
    history.pushState({ join: gameId }, "", newUrl);
    window.dispatchEvent(
      new CustomEvent("join-changed", {
        detail: { gameId: encodedGameId },
      }),
    );
  };

  private getTranslations() {
    return {
      title: translateText("account_modal.title"),
      back: translateText("common.back"),
      fetchingAccount: translateText("account_modal.fetching_account"),
    };
  }

  private async ensureLaunched() {
    if (this.isLaunched) return;

    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      await this.updateComplete;

      const translations = this.getTranslations();
      dispatchProfileRuntimeAction(
        UI_RUNTIME_ACTIONS.uiProfileAccountModalLaunch,
        {
          translations,
        },
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));

      this.isLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error =
        err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusAccountModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  async open() {
    await this.ensureLaunched();
    dispatchProfileRuntimeSnapshot(
      UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileAccountModalState,
      {
        state: {
          loading: true,
        },
      },
    );
    dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileAccountModalOpen);

    // Fetch user data
    try {
      const userMe = await getUserMe();
      if (userMe) {
        this.userMeResponse = userMe;
        if (this.userMeResponse?.player?.publicId) {
          await this.loadPlayerProfile(this.userMeResponse.player.publicId);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch user info in AccountModal.open():", err);
    }

    dispatchProfileRuntimeSnapshot(
      UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileAccountModalState,
      {
        state: {
          loading: false,
        },
      },
    );
    this.updateContent();
  }

  close() {
    if (this.isLaunched) {
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileAccountModalClose);
    }
  }

  private async loadPlayerProfile(publicId: string): Promise<void> {
    try {
      const data = await fetchPlayerById(publicId);
      if (!data) return;
      this.recentGames = data.games;
      this.statsTree = data.stats;
    } catch (err) {
      console.warn("Failed to load player data:", err);
    }
  }

  private async updateContent() {
    const isLoggedIn = !!this.userMeResponse?.user;
    const me = this.userMeResponse?.user;
    const isLinked = me?.discord ?? me?.email;

    if (isLoggedIn && isLinked) {
      const contentHtml = this.renderAccountInfoHtml();

      // Update header right with player ID
      const publicId = this.userMeResponse?.player?.publicId ?? "";
      if (publicId) {
        dispatchProfileRuntimeSnapshot(
          UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileAccountModalState,
          {
            state: {
              contentHtml,
              headerRightHtml:
                `<div class="flex items-center gap-2">
            <span class="text-xs text-blue-400 font-bold uppercase tracking-wider">${translateText("account_modal.personal_player_id")}</span>
            <span class="text-xs text-white/60 font-mono">${this.escapeHtml(publicId)}</span>
          </div>`,
            },
          },
        );
      } else {
        dispatchProfileRuntimeSnapshot(
          UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileAccountModalState,
          {
            state: {
              contentHtml,
              headerRightHtml: "",
            },
          },
        );
      }
    } else {
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileAccountModalState,
        {
          state: {
            contentHtml: this.renderLoginOptionsHtml(),
            headerRightHtml: "",
          },
        },
      );
    }
  }

  private renderAccountInfoHtml(): string {
    const me = this.userMeResponse?.user;
    let html = `<div class="p-6"><div class="flex flex-col gap-6">`;

    // Connected As section
    html += `<div class="bg-white/5 rounded-xl border border-white/10 p-6">`;
    html += `<div class="flex flex-col items-center gap-4">`;
    html += `<div class="text-xs text-white/40 uppercase tracking-widest font-bold border-b border-white/5 pb-2 px-8">${translateText("account_modal.connected_as")}</div>`;
    html += `<div class="flex items-center gap-8 justify-center flex-wrap">`;

    if (me?.discord) {
      const d = me.discord;
      html += `<div class="flex items-center gap-3">`;
      if (d.avatar) {
        html += `<img src="https://cdn.discordapp.com/avatars/${this.escapeHtml(d.id)}/${this.escapeHtml(d.avatar)}.png?size=64" class="w-10 h-10 rounded-full" />`;
      }
      html += `<span class="text-white font-medium">${this.escapeHtml(d.username)}</span>`;
      html += `</div>`;
    } else if (me?.email) {
      html += `<div class="text-white text-lg font-medium">${translateText("account_modal.linked_account", { account_name: me.email })}</div>`;
    }

    // Logout button
    html += `<button onclick="document.getElementById('dioxus-account-modal-root').dispatchEvent(new CustomEvent('dioxus-account-logout', {bubbles:true,composed:true}))" class="px-6 py-2 text-sm font-bold text-white uppercase tracking-wider bg-red-600/80 hover:bg-red-600 border border-red-500/50 rounded-lg transition-all shadow-lg hover:shadow-red-900/40">${translateText("account_modal.log_out")}</button>`;

    html += `</div></div></div>`;

    // Stats section
    if (this.statsTree && this.hasAnyStats()) {
      html += `<div class="bg-white/5 rounded-xl border border-white/10 p-6">`;
      html += `<h3 class="text-lg font-bold text-white mb-4">${translateText("account_modal.stats_overview")}</h3>`;
      html += this.renderStatsTreeHtml();
      html += `</div>`;
    }

    // Recent games section
    html += `<div class="bg-white/5 rounded-xl border border-white/10 p-6">`;
    html += `<h3 class="text-lg font-bold text-white mb-4">${translateText("game_list.recent_games")}</h3>`;
    html += this.renderRecentGamesHtml();
    html += `</div>`;

    html += `</div></div>`;
    return html;
  }

  private renderLoginOptionsHtml(): string {
    let html = `<div class="flex items-center justify-center p-6 min-h-full">`;
    html += `<div class="w-full max-w-md bg-white/5 rounded-2xl border border-white/10 p-8">`;

    // Header
    html += `<div class="text-center mb-8">`;
    html += `<div class="w-16 h-16 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-white/10 shadow-inner">`;
    html += `<svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>`;
    html += `</div>`;
    html += `<p class="text-white/50 text-sm font-medium">${translateText("account_modal.sign_in_desc")}</p>`;
    html += `</div>`;

    // Login options
    html += `<div class="space-y-6">`;

    // Discord button
    html += `<button onclick="document.getElementById('dioxus-account-modal-root').dispatchEvent(new CustomEvent('dioxus-account-discord-login', {bubbles:true,composed:true}))" class="w-full px-6 py-4 text-white bg-[#5865F2] hover:bg-[#4752C4] border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#5865F2] transition-colors duration-200 flex items-center justify-center gap-3 group relative overflow-hidden shadow-lg hover:shadow-[#5865F2]/20">`;
    html += `<img src="/images/DiscordLogo.svg" alt="Discord" class="w-6 h-6 relative z-10" />`;
    html += `<span class="font-bold relative z-10 tracking-wide">${translateText("main.login_discord") || translateText("account_modal.link_discord")}</span>`;
    html += `</button>`;

    // Divider
    html += `<div class="flex items-center gap-4 py-2"><div class="h-px bg-white/10 flex-1"></div><span class="text-[10px] uppercase tracking-widest text-white/30 font-bold">${translateText("account_modal.or")}</span><div class="h-px bg-white/10 flex-1"></div></div>`;

    // Email input
    html += `<div class="space-y-3">`;
    html += `<div class="relative group">`;
    html += `<input type="email" id="account-email-input" class="w-full pl-4 pr-12 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all font-medium hover:bg-white/10" placeholder="${translateText("account_modal.email_placeholder")}" required />`;
    html += `</div>`;
    html += `<button onclick="var email=document.getElementById('account-email-input').value;document.getElementById('dioxus-account-modal-root').dispatchEvent(new CustomEvent('dioxus-account-email-submit',{bubbles:true,composed:true,detail:email}))" class="w-full px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 rounded-xl transition-all shadow-lg hover:shadow-blue-900/40 border border-white/5">${translateText("account_modal.get_magic_link")}</button>`;
    html += `</div>`;

    html += `</div>`;

    // Clear session link
    html += `<div class="mt-8 text-center border-t border-white/10 pt-6">`;
    html += `<button onclick="document.getElementById('dioxus-account-modal-root').dispatchEvent(new CustomEvent('dioxus-account-logout',{bubbles:true,composed:true}))" class="text-[10px] font-bold text-white/20 hover:text-red-400 transition-colors uppercase tracking-widest pb-0.5">${translateText("account_modal.clear_session")}</button>`;
    html += `</div>`;

    html += `</div></div>`;
    return html;
  }

  private hasAnyStats(): boolean {
    if (!this.statsTree) return false;
    return (
      Object.keys(this.statsTree).length > 0 &&
      Object.values(this.statsTree).some(
        (gameTypeStats) =>
          gameTypeStats && Object.keys(gameTypeStats).length > 0,
      )
    );
  }

  private renderStatsTreeHtml(): string {
    if (!this.statsTree) return `<p class="text-white/40 text-sm">No stats available</p>`;

    let html = `<div class="space-y-4">`;
    for (const [gameType, mapStats] of Object.entries(this.statsTree)) {
      if (!mapStats || Object.keys(mapStats).length === 0) continue;
      html += `<div class="bg-black/20 rounded-lg p-3">`;
      html += `<h4 class="text-sm font-bold text-blue-300 uppercase tracking-wider mb-2">${this.escapeHtml(gameType)}</h4>`;
      for (const [mapName, stats] of Object.entries(
        mapStats as Record<string, Record<string, number>>,
      )) {
        html += `<div class="mb-2">`;
        html += `<span class="text-xs text-white/60 font-medium">${this.escapeHtml(mapName)}</span>`;
        html += `<div class="flex flex-wrap gap-2 mt-1">`;
        for (const [stat, value] of Object.entries(stats)) {
          html += `<span class="px-2 py-1 bg-white/5 rounded text-xs text-white/80"><span class="text-white/40">${this.escapeHtml(stat)}:</span> ${value}</span>`;
        }
        html += `</div></div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
    return html;
  }

  private renderRecentGamesHtml(): string {
    if (!this.recentGames || this.recentGames.length === 0) {
      return `<p class="text-white/40 text-sm">No recent games</p>`;
    }

    let html = `<div class="space-y-2">`;
    for (const game of this.recentGames) {
      const startDate = new Date(game.start).toLocaleDateString();
      html += `<div class="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-white/5 hover:bg-white/5 transition-colors">`;
      html += `<div class="flex flex-col gap-1">`;
      html += `<span class="text-sm text-white font-medium">${this.escapeHtml(game.map)}</span>`;
      html += `<span class="text-xs text-white/40">${this.escapeHtml(game.mode)} - ${this.escapeHtml(game.difficulty)} - ${startDate}</span>`;
      html += `</div>`;
      html += `<div class="flex items-center gap-3">`;
      html += `<button onclick="document.getElementById('dioxus-account-modal-root').dispatchEvent(new CustomEvent('dioxus-account-view-game',{bubbles:true,composed:true,detail:'${this.escapeHtml(game.gameId)}'}))" class="px-3 py-1 text-xs font-bold text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-lg transition-all">View</button>`;
      html += `</div></div>`;
    }
    html += `</div>`;
    return html;
  }

  private escapeHtml(str: string): string {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-account-modal-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-account-modal": DioxusAccountModal;
  }
}

interface SinglePlayerFormState {
  selectedMap: string;
  selectedDifficulty: string;
  gameMode: string;
  teamCount: string;
  useRandomMap: boolean;
  disableNations: boolean;
  bots: number;
  infiniteGold: boolean;
  infiniteTroops: boolean;
  compactMap: boolean;
  maxTimer: boolean;
  maxTimerValue: number | null;
  instantBuild: boolean;
  randomSpawn: boolean;
  goldMultiplier: boolean;
  goldMultiplierValue: number | null;
  startingGold: boolean;
  startingGoldValue: number | null;
  disabledUnits: string[];
  showAchievements: boolean;
  hasLinkedAccount: boolean;
  isHvnTeamMode: boolean;
}

@customElement("dioxus-single-player-modal")
export class DioxusSinglePlayerModal extends LitElement {
  @state()
  private isLaunched: boolean = false;

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

  @state()
  isVisible = false;

  private userMeResponse: UserMeResponse | false = false;
  private userSettings: UserSettings = new UserSettings();
  private closeListener?: () => void;
  private startListener?: (event: Event) => void;
  private formChangeListener?: (event: Event) => void;
  private userMeListener?: EventListener;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.launchDioxusComponent();

    this.userMeListener = ((event: CustomEvent<UserMeResponse | false>) => {
      this.userMeResponse = event.detail;
    }) as EventListener;
    document.addEventListener("userMeResponse", this.userMeListener);
  }

  disconnectedCallback() {
    if (this.closeListener) {
      document.removeEventListener(
        "single-player-modal-close",
        this.closeListener,
      );
      this.closeListener = undefined;
    }
    if (this.startListener) {
      document.removeEventListener(
        "single-player-modal-start",
        this.startListener,
      );
      this.startListener = undefined;
    }
    if (this.formChangeListener) {
      document.removeEventListener(
        "single-player-modal-form-change",
        this.formChangeListener,
      );
      this.formChangeListener = undefined;
    }
    if (this.userMeListener) {
      document.removeEventListener("userMeResponse", this.userMeListener);
      this.userMeListener = undefined;
    }
    super.disconnectedCallback();
  }

  private getTranslations() {
    return {
      title: translateText("main.solo") || "Solo",
      mapTitle: translateText("map.map"),
      difficultyTitle: translateText("difficulty.difficulty"),
      modeTitle: translateText("host_modal.mode"),
      optionsTitle: translateText("single_modal.options_title"),
      enablesTitle: translateText("single_modal.enables_title"),
      teamCountTitle: translateText("host_modal.team_count"),
      ffa: translateText("game_mode.ffa"),
      teams: translateText("game_mode.teams"),
      botsLabel: translateText("single_modal.bots"),
      botsDisabled: translateText("single_modal.bots_disabled"),
      disableNations: translateText("single_modal.disable_nations"),
      instantBuild: translateText("single_modal.instant_build"),
      randomSpawn: translateText("single_modal.random_spawn"),
      infiniteGold: translateText("single_modal.infinite_gold"),
      infiniteTroops: translateText("single_modal.infinite_troops"),
      compactMap: translateText("single_modal.compact_map"),
      maxTimer: translateText("single_modal.max_timer"),
      maxTimerPlaceholder: translateText("single_modal.max_timer_placeholder"),
      goldMultiplier: translateText("single_modal.gold_multiplier"),
      goldMultiplierPlaceholder: translateText(
        "single_modal.gold_multiplier_placeholder",
      ),
      startingGold: translateText("single_modal.starting_gold"),
      startingGoldPlaceholder: translateText(
        "single_modal.starting_gold_placeholder",
      ),
      start: translateText("single_modal.start"),
      back: translateText("common.back"),
      special: translateText("map_categories.special"),
      randomMap: translateText("map.random"),
      signInForAchievements: translateText(
        "single_modal.sign_in_for_achievements",
      ),
      toggleAchievements: translateText(
        "single_modal.toggle_achievements",
      ),
    };
  }

  private async getMapCategories() {
    const categories: Array<{
      key: string;
      label: string;
      maps: Array<{
        key: string;
        value: GameMapType;
        label: string;
        imageUrl: string;
      }>;
    }> = [];
    for (const [categoryKey, maps] of Object.entries(mapCategories)) {
      const mapOptions: Array<{
        key: string;
        value: GameMapType;
        label: string;
        imageUrl: string;
      }> = [];
      for (const mapValue of maps) {
        const mapKey = Object.keys(GameMapType).find(
          (key) =>
            GameMapType[key as keyof typeof GameMapType] === mapValue,
        );
        let imageUrl = "";
        try {
          const data = terrainMapFileLoader.getMapData(mapValue);
          imageUrl = await data.webpPath();
        } catch {
          // ignore
        }
        mapOptions.push({
          key: mapKey ?? "",
          value: mapValue,
          label: translateText(`map.${mapKey?.toLowerCase()}`),
          imageUrl,
        });
      }
      categories.push({
        key: categoryKey,
        label: translateText(`map_categories.${categoryKey}`),
        maps: mapOptions,
      });
    }
    return categories;
  }

  private getDifficulties() {
    return Object.entries(Difficulty)
      .filter(([key]) => isNaN(Number(key)))
      .map(([key, value]) => ({
        key,
        value: value as string,
        label: translateText(`difficulty.${key.toLowerCase()}`),
        iconUrl: "", // Difficulty icons are rendered via difficulty-display component
      }));
  }

  private getUnitOptions() {
    const unitOptions = [
      { type: UnitType.City, translationKey: "unit_type.city" },
      { type: UnitType.DefensePost, translationKey: "unit_type.defense_post" },
      { type: UnitType.Port, translationKey: "unit_type.port" },
      { type: UnitType.Warship, translationKey: "unit_type.warship" },
      {
        type: UnitType.MissileSilo,
        translationKey: "unit_type.missile_silo",
      },
      { type: UnitType.SAMLauncher, translationKey: "unit_type.sam_launcher" },
      { type: UnitType.AtomBomb, translationKey: "unit_type.atom_bomb" },
      {
        type: UnitType.HydrogenBomb,
        translationKey: "unit_type.hydrogen_bomb",
      },
      { type: UnitType.MIRV, translationKey: "unit_type.mirv" },
      { type: UnitType.Factory, translationKey: "unit_type.factory" },
    ];
    return unitOptions.map((u) => ({
      unitType: u.type,
      label: translateText(u.translationKey),
    }));
  }

  private getTeamCountOptions(): {
    value: string;
    label: string;
    isString: boolean;
  }[] {
    const options: TeamCountConfig[] = [
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
    ];
    return options.map((o) => ({
      value: String(o),
      label:
        typeof o === "string"
          ? o === HumansVsNations
            ? translateText("public_lobby.teams_hvn")
            : translateText(`host_modal.teams_${o}`)
          : translateText("public_lobby.teams", { num: o }),
      isString: typeof o === "string",
    }));
  }

  private async launchDioxusComponent() {
    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      await this.updateComplete;

      const translations = this.getTranslations();
      const mapCategories = await this.getMapCategories();
      const difficulties = this.getDifficulties();
      const unitOptions = this.getUnitOptions();
      const teamCountOptions = this.getTeamCountOptions();

      dispatchProfileRuntimeAction(
        UI_RUNTIME_ACTIONS.uiProfileSinglePlayerModalLaunch,
        {
          translations,
          maps: mapCategories,
          difficulties,
          unitOptions,
          teamCountOptions,
        },
      );

      // Set up event listeners
      this.closeListener = () => {
        this.isVisible = false;
        this.requestUpdate();
      };
      document.addEventListener(
        "single-player-modal-close",
        this.closeListener,
      );

      this.startListener = (e: Event) => {
        const customEvent = e as CustomEvent;
        const formJson = customEvent.detail;
        if (typeof formJson === "string") {
          const form: SinglePlayerFormState = JSON.parse(formJson);
          this.handleStartGame(form);
        }
      };
      document.addEventListener(
        "single-player-modal-start",
        this.startListener,
      );

      this.formChangeListener = (_e: Event) => {
        // Form changes are tracked in WASM state, no TS sync needed
      };
      document.addEventListener(
        "single-player-modal-form-change",
        this.formChangeListener,
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error =
        err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusSinglePlayerModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  private getRandomMap(): GameMapType {
    const maps = Object.values(GameMapType);
    const randIdx = Math.floor(Math.random() * maps.length);
    return maps[randIdx] as GameMapType;
  }

  private async handleStartGame(form: SinglePlayerFormState) {
    // Validate max timer
    if (form.maxTimer && (!form.maxTimerValue || form.maxTimerValue <= 0)) {
      alert(
        translateText("single_modal.max_timer_invalid") ||
          "Please enter a valid max timer value (1-120 minutes)",
      );
      return;
    }

    const finalMaxTimerValue = form.maxTimer
      ? Math.max(1, Math.min(120, form.maxTimerValue ?? 30))
      : undefined;

    // Resolve random map
    const selectedMap = form.useRandomMap
      ? this.getRandomMap()
      : (form.selectedMap as GameMapType);

    const clientID = generateID();
    const gameID = generateID();

    const usernameInput = document.querySelector(
      "username-input",
    ) as DioxusUsernameInput | null;
    const flagInput = document.querySelector(
      "flag-input",
    ) as DioxusFlagInput | null;

    const cosmetics = await fetchCosmetics();
    let selectedPattern =
      this.userSettings.getSelectedPatternName(cosmetics);
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
                username: usernameInput?.getCurrentUsername() ?? "",
                cosmetics: {
                  flag:
                    flagInput?.getCurrentFlag() === "xx"
                      ? ""
                      : (flagInput?.getCurrentFlag() ?? ""),
                  pattern: selectedPattern ?? undefined,
                  color: selectedColor
                    ? { color: selectedColor }
                    : undefined,
                },
              },
            ],
            config: {
              gameMap: selectedMap,
              gameMapSize: form.compactMap
                ? GameMapSize.Compact
                : GameMapSize.Normal,
              gameType: GameType.Singleplayer,
              gameMode: form.gameMode as GameMode,
              playerTeams: this.parseTeamCount(form.teamCount),
              difficulty: form.selectedDifficulty as Difficulty,
              maxTimerValue: finalMaxTimerValue,
              bots: form.bots,
              infiniteGold: form.infiniteGold,
              donateGold: form.gameMode === GameMode.Team,
              donateTroops: form.gameMode === GameMode.Team,
              infiniteTroops: form.infiniteTroops,
              instantBuild: form.instantBuild,
              randomSpawn: form.randomSpawn,
              disabledUnits: form.disabledUnits
                .map((u) =>
                  Object.values(UnitType).find((ut) => ut === u),
                )
                .filter((ut): ut is UnitType => ut !== undefined),
              ...(form.gameMode === GameMode.Team &&
              form.teamCount === HumansVsNations
                ? { disableNations: false }
                : { disableNations: form.disableNations }),
              ...(form.goldMultiplier && form.goldMultiplierValue
                ? { goldMultiplier: form.goldMultiplierValue }
                : {}),
              ...(form.startingGold &&
              form.startingGoldValue !== null
                ? { startingGold: form.startingGoldValue }
                : {}),
            },
            lobbyCreatedAt: Date.now(),
          },
        } satisfies JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );

    this.hide();
  }

  private parseTeamCount(tc: string): TeamCountConfig {
    const num = parseInt(tc, 10);
    if (!isNaN(num)) return num;
    return tc as TeamCountConfig;
  }

  async show() {
    this.isVisible = true;

    // Update has_linked_account and achievements in form state
    const hasAccount = hasLinkedAccount(this.userMeResponse);
    if (this.isLaunched) {
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileSinglePlayerModalState,
        {
          state: {
            form: {
              selectedMap: "World",
              selectedDifficulty: "Easy",
              gameMode: "Free For All",
              teamCount: "2",
              useRandomMap: false,
              disableNations: false,
              bots: 400,
              infiniteGold: false,
              infiniteTroops: false,
              compactMap: false,
              maxTimer: false,
              maxTimerValue: null,
              instantBuild: false,
              randomSpawn: false,
              goldMultiplier: false,
              goldMultiplierValue: null,
              startingGold: false,
              startingGoldValue: null,
              disabledUnits: [],
              showAchievements: false,
              hasLinkedAccount: hasAccount,
              isHvnTeamMode: false,
            },
          },
        },
      );

      // Update achievements
      if (this.userMeResponse) {
        this.updateAchievements(this.userMeResponse);
      }

      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileSinglePlayerModalShow);
    }

    this.requestUpdate();
  }

  async open() {
    await this.show();
  }

  private async updateAchievements(userMe: UserMeResponse) {
    const achievements = Array.isArray(userMe.player.achievements)
      ? userMe.player.achievements
      : [];

    const completions =
      achievements.find(
        (achievement) => achievement?.type === "singleplayer-map",
      )?.data ?? [];

    const mapWins: { mapValue: string; difficulties: string[] }[] = [];
    const winsMap = new Map<string, Set<string>>();

    for (const entry of completions) {
      const { mapName, difficulty } = entry ?? {};
      if (typeof mapName !== "string" || typeof difficulty !== "string")
        continue;
      const set = winsMap.get(mapName) ?? new Set<string>();
      set.add(difficulty);
      winsMap.set(mapName, set);
    }

    for (const [mapValue, diffs] of winsMap) {
      mapWins.push({ mapValue, difficulties: Array.from(diffs) });
    }

    if (this.isLaunched) {
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileSinglePlayerModalState,
        {
          state: {
            achievements: {
              mapWins,
            },
          },
        },
      );
    }
  }

  async hide() {
    this.isVisible = false;
    if (this.isLaunched) {
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileSinglePlayerModalHide);
    }
    this.requestUpdate();
  }

  close() {
    void this.hide();
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-single-player-modal-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-single-player-modal": DioxusSinglePlayerModal;
  }
}

interface DioxusTerritoryPatternsState {
  isVisible: boolean;
  activeTab: string;
  showOnlyOwned: boolean;
  isLoggedIn: boolean;
  patterns: DioxusPatternButtonData[];
  colors: string[];
  selectedPatternName: string | null;
  selectedColor: string | null;
}

interface DioxusPatternButtonData {
  id: string;
  name: string | null;
  colorPaletteName: string | null;
  previewUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  requiresPurchase: boolean;
  isSelected: boolean;
  isDefault: boolean;
  price: string | null;
}

interface DioxusTerritoryPatternsTranslations {
  title: string;
  colors: string;
  notLoggedIn: string;
  showOnlyOwned: string;
  allOwned: string;
  patternDefault: string;
  back: string;
}

@customElement("dioxus-territory-patterns-modal")
export class DioxusTerritoryPatternsModal extends LitElement {
  public previewButton: HTMLElement | null = null;

  @state() private isVisible = false;
  @state() private loading = false;
  @state() private error: string | null = null;

  private selectedPattern: PlayerPattern | null = null;
  private selectedColor: string | null = null;
  private activeTab: "patterns" | "colors" = "patterns";
  private showOnlyOwned = false;
  private cosmetics: Cosmetics | null = null;
  private userSettings: UserSettings = new UserSettings();
  private affiliateCode: string | null = null;
  private userMeResponse: UserMeResponse | false = false;

  private isWasmLaunched = false;

  private _onPatternSelected = () => {
    this.updateFromSettings();
    this.pushStateToWasm();
  };

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void ensureUiSessionRuntimeStarted();
    document.addEventListener(
      "userMeResponse",
      (event: Event) => {
        const customEvent = event as CustomEvent<UserMeResponse | false>;
        this.onUserMe(customEvent.detail);
      },
    );
    window.addEventListener("pattern-selected", this._onPatternSelected);

    document.addEventListener(
      "dioxus-territory-patterns-close",
      this.handleClose,
    );
    document.addEventListener(
      "dioxus-territory-patterns-select",
      this.handleSelect,
    );
    document.addEventListener(
      "dioxus-territory-patterns-purchase",
      this.handlePurchase,
    );
    document.addEventListener(
      "dioxus-territory-patterns-select-color",
      this.handleSelectColor,
    );
    document.addEventListener(
      "dioxus-territory-patterns-toggle-owned",
      this.handleToggleOwned,
    );
    window.addEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );

    this.launchDioxus();
  }

  disconnectedCallback() {
    if (this.isVisible) {
      reportUiModalState(SESSION_MODAL_IDS.territoryPatterns, false);
    }
    window.removeEventListener("pattern-selected", this._onPatternSelected);
    document.removeEventListener(
      "dioxus-territory-patterns-close",
      this.handleClose,
    );
    document.removeEventListener(
      "dioxus-territory-patterns-select",
      this.handleSelect,
    );
    document.removeEventListener(
      "dioxus-territory-patterns-purchase",
      this.handlePurchase,
    );
    document.removeEventListener(
      "dioxus-territory-patterns-select-color",
      this.handleSelectColor,
    );
    document.removeEventListener(
      "dioxus-territory-patterns-toggle-owned",
      this.handleToggleOwned,
    );
    window.removeEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
    super.disconnectedCallback();
  }

  private handleSessionModalClose = (
    event: CustomEvent<UiSessionModalCloseDetail>,
  ) => {
    if (
      !this.isVisible ||
      event.detail?.modal !== SESSION_MODAL_IDS.territoryPatterns
    ) {
      return;
    }
    this.closeModal();
  };

  private handleClose = () => {
    requestUiModalClose(
      SESSION_MODAL_IDS.territoryPatterns,
      "component",
    );
  };

  private handleSelect = (event: Event) => {
    const patternId = (event as CustomEvent<string>).detail;
    this.selectPatternById(patternId);
  };

  private handlePurchase = (event: Event) => {
    const patternId = (event as CustomEvent<string>).detail;
    this.purchasePatternById(patternId);
  };

  private handleSelectColor = (event: Event) => {
    const hex = (event as CustomEvent<string>).detail;
    this.selectColor(hex);
  };

  private handleToggleOwned = () => {
    this.showOnlyOwned = !this.showOnlyOwned;
    this.pushStateToWasm();
  };

  private updateFromSettings() {
    this.selectedPattern =
      this.cosmetics !== null
        ? this.userSettings.getSelectedPatternName(this.cosmetics)
        : null;
    this.selectedColor = this.userSettings.getSelectedColor() ?? null;
  }

  async onUserMe(userMeResponse: UserMeResponse | false) {
    if (!hasLinkedAccount(userMeResponse)) {
      this.userSettings.setSelectedPatternName(undefined);
      this.userSettings.setSelectedColor(undefined);
      this.selectedPattern = null;
      this.selectedColor = null;
    }
    this.userMeResponse = userMeResponse;
    this.cosmetics = await fetchCosmetics();
    this.updateFromSettings();
    this.pushStateToWasm();
  }

  private getTranslations(): DioxusTerritoryPatternsTranslations {
    return {
      title: translateText("territory_patterns.title"),
      colors: translateText("territory_patterns.colors"),
      notLoggedIn: translateText("territory_patterns.not_logged_in"),
      showOnlyOwned: translateText("territory_patterns.show_only_owned"),
      allOwned: translateText("territory_patterns.all_owned"),
      patternDefault: translateText("territory_patterns.pattern.default"),
      back: translateText("common.back"),
    };
  }

  private buildPatternButtons(): DioxusPatternButtonData[] {
    const buttons: DioxusPatternButtonData[] = [];
    const patterns: (Pattern | null)[] = [
      null,
      ...Object.values(this.cosmetics?.patterns ?? {}),
    ];

    for (const pattern of patterns) {
      const colorPalettes = pattern
        ? [...(pattern.colorPalettes ?? []), null]
        : [null];
      for (const colorPalette of colorPalettes) {
        let rel = "owned";
        if (pattern) {
          rel = patternRelationship(
            pattern,
            colorPalette,
            this.userMeResponse,
            this.affiliateCode,
          );
        }
        if (rel === "blocked") continue;

        if (this.showOnlyOwned) {
          if (rel !== "owned") continue;
        } else {
          if (rel === "owned") continue;
        }

        const isDefaultPattern = pattern === null;
        const isSelected =
          (isDefaultPattern && this.selectedPattern === null) ||
          (!isDefaultPattern &&
            this.selectedPattern !== null &&
            this.selectedPattern.name === pattern?.name &&
            (this.selectedPattern.colorPalette?.name ?? null) ===
              (colorPalette?.name ?? null));

        const fullPalette = colorPalette
          ? this.cosmetics?.colorPalettes?.[colorPalette.name]
          : null;

        const id = isDefaultPattern
          ? "__default__"
          : `${pattern!.name}:${colorPalette?.name ?? "default"}`;

        buttons.push({
          id,
          name: pattern?.name ?? null,
          colorPaletteName: colorPalette?.name ?? null,
          previewUrl: null, // pattern previews are CSS-rendered
          primaryColor: fullPalette?.primaryColor ?? null,
          secondaryColor: fullPalette?.secondaryColor ?? null,
          requiresPurchase: rel === "purchasable",
          isSelected,
          isDefault: isDefaultPattern,
          price: pattern?.product?.price ?? null,
        });
      }
    }

    return buttons;
  }

  private buildColors(): string[] {
    if (this.userMeResponse === false) return [];
    return (this.userMeResponse.player.flares ?? [])
      .filter((flare: string) => flare.startsWith("color:"))
      .map((flare: string) => flare.split(":")[1]);
  }

  private buildState(): DioxusTerritoryPatternsState {
    return {
      isVisible: this.isVisible,
      activeTab: this.activeTab,
      showOnlyOwned: this.showOnlyOwned,
      isLoggedIn: hasLinkedAccount(this.userMeResponse),
      patterns: this.buildPatternButtons(),
      colors: this.buildColors(),
      selectedPatternName: this.selectedPattern?.name ?? null,
      selectedColor: this.selectedColor,
    };
  }

  private async launchDioxus() {
    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();
      await this.updateComplete;

      dispatchProfileRuntimeAction(
        UI_RUNTIME_ACTIONS.uiProfileTerritoryPatternsModalLaunch,
        {
          state: this.buildState(),
          translations: this.getTranslations(),
        },
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isWasmLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error = err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusTerritoryPatternsModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  private pushStateToWasm() {
    if (!this.isWasmLaunched) return;
    try {
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileTerritoryPatternsModalState,
        {
          state: this.buildState(),
        },
      );
    } catch (e) {
      console.warn(
        "[DioxusTerritoryPatternsModal] Failed to update state:",
        e,
      );
    }
  }

  public async open(
    options?: string | { affiliateCode?: string; showOnlyOwned?: boolean },
  ) {
    await ensureUiSessionRuntimeStarted();
    if (typeof options === "string") {
      this.affiliateCode = options;
      this.showOnlyOwned = false;
    } else if (
      options !== null &&
      typeof options === "object" &&
      !Array.isArray(options)
    ) {
      this.affiliateCode = options.affiliateCode ?? null;
      this.showOnlyOwned = options.showOnlyOwned ?? false;
    } else {
      this.affiliateCode = null;
      this.showOnlyOwned = false;
    }

    this.isVisible = true;
    reportUiModalState(SESSION_MODAL_IDS.territoryPatterns, true);
    this.pushStateToWasm();
  }

  public refresh() {
    void (async () => {
      this.cosmetics = await fetchCosmetics();
      this.updateFromSettings();
      this.pushStateToWasm();
    })();
  }

  public close() {
    this.closeModal();
  }

  private closeModal() {
    reportUiModalState(SESSION_MODAL_IDS.territoryPatterns, false);
    this.isVisible = false;
    this.affiliateCode = null;
    this.pushStateToWasm();
    this.requestUpdate();
  }

  private selectPatternById(id: string) {
    if (id === "__default__") {
      // Select default (no pattern)
      this.selectedColor = null;
      this.userSettings.setSelectedColor(undefined);
      this.userSettings.setSelectedPatternName(undefined);
      this.selectedPattern = null;
    } else {
      const parts = id.split(":");
      const patternName = parts[0];
      const colorPaletteName =
        parts[1] !== "default" ? parts[1] : undefined;

      this.selectedColor = null;
      this.userSettings.setSelectedColor(undefined);

      const name =
        colorPaletteName === undefined
          ? patternName
          : `${patternName}:${colorPaletteName}`;
      this.userSettings.setSelectedPatternName(`pattern:${name}`);
      this.selectedPattern = {
        name: patternName,
        colorPalette: colorPaletteName
          ? { name: colorPaletteName }
          : undefined,
      } as PlayerPattern;
    }

    this.showSkinSelectedPopup();
    this.dispatchEvent(
      new CustomEvent("pattern-selected", { bubbles: true }),
    );
    this.closeModal();
  }

  private purchasePatternById(id: string) {
    const parts = id.split(":");
    const patternName = parts[0];
    const colorPaletteName =
      parts[1] !== "default" ? parts[1] : undefined;

    const pattern = this.cosmetics?.patterns
      ? Object.values(this.cosmetics.patterns).find(
          (p) => p.name === patternName,
        )
      : undefined;

    if (pattern) {
      const colorPalette = colorPaletteName
        ? this.cosmetics?.colorPalettes?.[colorPaletteName] ?? null
        : null;
      handlePurchase(pattern, colorPalette);
    }
  }

  private selectColor(hexCode: string) {
    this.selectedPattern = null;
    this.userSettings.setSelectedPatternName(undefined);
    this.selectedColor = hexCode;
    this.userSettings.setSelectedColor(hexCode);
    this.dispatchEvent(
      new CustomEvent("pattern-selected", { bubbles: true }),
    );
    this.closeModal();
  }

  private showSkinSelectedPopup() {
    let skinName = translateText("territory_patterns.pattern.default");
    if (this.selectedPattern && this.selectedPattern.name) {
      skinName = this.selectedPattern.name
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      if (
        this.selectedPattern.colorPalette &&
        this.selectedPattern.colorPalette.name
      ) {
        skinName += ` (${this.selectedPattern.colorPalette.name})`;
      }
    }
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: `${skinName} ${translateText("territory_patterns.selected")}`,
          duration: 2000,
        },
      }),
    );
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-territory-patterns-modal-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-territory-patterns-modal": DioxusTerritoryPatternsModal;
  }
}

interface FlagInputModalElement extends HTMLElement {
  open(): void;
  returnTo?: string;
}

const isMac =
  typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

const DefaultKeybinds: Record<string, string> = {
  toggleView: "Space",
  buildCity: "Digit1",
  buildFactory: "Digit2",
  buildPort: "Digit3",
  buildDefensePost: "Digit4",
  buildMissileSilo: "Digit5",
  buildSamLauncher: "Digit6",
  buildWarship: "Digit7",
  buildAtomBomb: "Digit8",
  buildHydrogenBomb: "Digit9",
  buildMIRV: "Digit0",
  attackRatioDown: "KeyT",
  attackRatioUp: "KeyY",
  boatAttack: "KeyB",
  groundAttack: "KeyG",
  swapDirection: "KeyU",
  zoomOut: "KeyQ",
  zoomIn: "KeyE",
  centerCamera: "KeyC",
  moveUp: "KeyW",
  moveLeft: "KeyA",
  moveDown: "KeyS",
  moveRight: "KeyD",
  modifierKey: isMac ? "MetaLeft" : "ControlLeft",
  altKey: "AltLeft",
};

interface DioxusToggleSetting {
  id: string;
  label: string;
  description: string;
  checked: boolean;
}

interface DioxusSliderSetting {
  id: string;
  label: string;
  description: string;
  min: number;
  max: number;
  value: number;
  isEaster: boolean;
}

interface DioxusKeybindSetting {
  action: string;
  label: string;
  description: string;
  defaultKey: string;
  currentKey: string;
  displayKey: string;
  section: string;
}

interface DioxusKeybindSection {
  id: string;
  title: string;
}

interface DioxusUserSettingState {
  isVisible: boolean;
  activeTab: string;
  showEasterEgg: boolean;
  toggles: DioxusToggleSetting[];
  sliders: DioxusSliderSetting[];
  keybinds: DioxusKeybindSetting[];
  keybindSections: DioxusKeybindSection[];
}

interface DioxusUserSettingTranslations {
  title: string;
  tabBasic: string;
  tabKeybinds: string;
  flagTitle: string;
  flagButtonTitle: string;
  back: string;
  pressKey: string;
  reset: string;
  clear: string;
}

@customElement("dioxus-user-setting-modal")
export class DioxusUserSettingModal extends LitElement {
  @state() private isVisible = false;
  @state() private activeTab: "basic" | "keybinds" = "basic";
  @state() private loading = false;
  @state() private error: string | null = null;

  private showEasterEgg = false;
  private keySequence: string[] = [];
  private userSettings: UserSettings = new UserSettings();
  private attackRatioValue = 0.2;
  private keybinds: Record<string, { value: string | string[]; key: string }> =
    {};

  private isWasmLaunched = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void this.loadSettingsFromSessionStorage();
    void ensureUiSessionRuntimeStarted();

    document.addEventListener("dioxus-user-setting-close", this.handleClose);
    document.addEventListener("dioxus-user-setting-tab", this.handleTab);
    document.addEventListener(
      "dioxus-user-setting-toggle",
      this.handleToggle,
    );
    document.addEventListener(
      "dioxus-user-setting-slider",
      this.handleSlider,
    );
    document.addEventListener(
      "dioxus-user-setting-keybind",
      this.handleKeybind,
    );
    document.addEventListener(
      "dioxus-user-setting-open-flag",
      this.handleOpenFlag,
    );
    window.addEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
    window.addEventListener(
      UI_SESSION_RUNTIME_EVENTS.keyboardChanged,
      this.handleEasterEggKey as EventListener,
    );

    this.launchDioxus();
  }

  disconnectedCallback() {
    if (this.isVisible) {
      reportUiModalState(SESSION_MODAL_IDS.userSetting, false);
    }
    document.removeEventListener(
      "dioxus-user-setting-close",
      this.handleClose,
    );
    document.removeEventListener("dioxus-user-setting-tab", this.handleTab);
    document.removeEventListener(
      "dioxus-user-setting-toggle",
      this.handleToggle,
    );
    document.removeEventListener(
      "dioxus-user-setting-slider",
      this.handleSlider,
    );
    document.removeEventListener(
      "dioxus-user-setting-keybind",
      this.handleKeybind,
    );
    document.removeEventListener(
      "dioxus-user-setting-open-flag",
      this.handleOpenFlag,
    );
    window.removeEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
    window.removeEventListener(
      UI_SESSION_RUNTIME_EVENTS.keyboardChanged,
      this.handleEasterEggKey as EventListener,
    );
    super.disconnectedCallback();
  }

  private handleSessionModalClose = (
    event: CustomEvent<UiSessionModalCloseDetail>,
  ) => {
    if (!this.isVisible || event.detail?.modal !== SESSION_MODAL_IDS.userSetting) {
      return;
    }
    this.closeModal();
  };

  private handleClose = () => {
    requestUiModalClose(
      SESSION_MODAL_IDS.userSetting,
      "component",
    );
  };

  private handleTab = (event: Event) => {
    const tab = (event as CustomEvent<string>).detail;
    this.activeTab = tab as "basic" | "keybinds";
    this.pushStateToWasm();
  };

  private handleToggle = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    const id = detail.id as string;
    const checked = detail.checked as boolean;
    this.applyToggle(id, checked);
  };

  private handleSlider = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    const id = detail.id as string;
    const value = detail.value as number;
    this.applySlider(id, value);
  };

  private handleKeybind = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    const action = detail.action as string;
    const value = detail.value as string;
    const key = detail.key as string;
    this.applyKeybind(action, value, key);
  };

  private handleOpenFlag = () => {
    const flagInputModal =
      document.querySelector<FlagInputModalElement>("#flag-input-modal");
    if (flagInputModal?.open) {
      this.closeModal();
      flagInputModal.returnTo = "#" + (this.id || "page-settings");
      flagInputModal.open();
    }
  };

  private handleEasterEggKey = (
    event: CustomEvent<UiSessionKeyboardChangedDetail>,
  ) => {
    if (!this.isVisible || this.showEasterEgg) return;
    if (!event.detail?.isDown) return;
    const key = event.detail.key.toLowerCase();
    const nextSequence = [...this.keySequence, key].slice(-4);
    this.keySequence = nextSequence;
    if (nextSequence.join("") === "evan") {
      this.showEasterEgg = true;
      this.keySequence = [];
      this.pushStateToWasm();
    }
  };

  private async loadSettingsFromSessionStorage() {
    const [savedKeybinds, savedAttackRatio] = await Promise.all([
      readUiSessionStorage(SETTINGS_KEYBINDS_STORAGE_KEY),
      readUiSessionStorage(SETTINGS_ATTACK_RATIO_STORAGE_KEY),
    ]);

    if (typeof savedKeybinds === "string" && savedKeybinds.length > 0) {
      try {
        const parsed = JSON.parse(savedKeybinds);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          !Array.isArray(parsed)
        ) {
          this.keybinds = parsed;
        }
      } catch (e) {
        console.warn("Invalid keybinds JSON:", e);
      }
    }

    if (typeof savedAttackRatio === "string") {
      const parsedAttackRatio = Number(savedAttackRatio);
      if (
        Number.isFinite(parsedAttackRatio) &&
        parsedAttackRatio >= 0.01 &&
        parsedAttackRatio <= 1
      ) {
        this.attackRatioValue = parsedAttackRatio;
      }
    }

    this.pushStateToWasm();
  }

  private applyToggle(id: string, checked: boolean) {
    switch (id) {
      case "darkMode":
        this.userSettings.set("settings.darkMode", checked);
        if (checked) {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
        this.dispatchEvent(
          new CustomEvent("dark-mode-changed", {
            detail: { darkMode: checked },
            bubbles: true,
            composed: true,
          }),
        );
        break;
      case "emojis":
        this.userSettings.set("settings.emojis", checked);
        break;
      case "alertFrame":
        this.userSettings.set("settings.alertFrame", checked);
        break;
      case "specialEffects":
        this.userSettings.set("settings.specialEffects", checked);
        break;
      case "structureSprites":
        this.userSettings.set("settings.structureSprites", checked);
        break;
      case "cursorCostLabel":
        this.userSettings.set("settings.cursorCostLabel", checked);
        break;
      case "leftClickOpensMenu":
        this.userSettings.set("settings.leftClickOpensMenu", checked);
        break;
      case "anonymousNames":
        this.userSettings.set("settings.anonymousNames", checked);
        break;
      case "lobbyIdVisibility":
        this.userSettings.set("settings.lobbyIdVisibility", !checked);
        break;
      case "territoryPatterns":
        this.userSettings.set("settings.territoryPatterns", checked);
        break;
      case "performanceOverlay":
        this.userSettings.set("settings.performanceOverlay", checked);
        break;
    }
  }

  private applySlider(id: string, value: number) {
    switch (id) {
      case "attackRatio": {
        const ratio = value / 100;
        this.attackRatioValue = ratio;
        void writeUiSessionStorage(SETTINGS_ATTACK_RATIO_STORAGE_KEY, ratio.toString());
        break;
      }
    }
  }

  private applyKeybind(action: string, value: string, key: string) {
    // Check for conflicts
    const activeKeybinds: Record<string, string> = { ...DefaultKeybinds };
    for (const [k, v] of Object.entries(this.keybinds)) {
      const normalizedValue = Array.isArray(v.value)
        ? v.value[0] || ""
        : v.value;
      if (normalizedValue === "Null") {
        delete activeKeybinds[k];
      } else {
        activeKeybinds[k] = normalizedValue;
      }
    }

    const values = Object.entries(activeKeybinds)
      .filter(([k]) => k !== action)
      .map(([, v]) => v);

    if (values.includes(value) && value !== "Null") {
      const displayKey = formatKeyForDisplay(key || value);
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("user_setting.keybind_conflict_error", {
              key: displayKey,
            }),
            color: "red",
            duration: 3000,
          },
        }),
      );
      // Refresh state to revert the keybind
      this.pushStateToWasm();
      return;
    }

    this.keybinds = {
      ...this.keybinds,
      [action]: { value: value, key: key },
    };
    void writeUiSessionStorage(
      SETTINGS_KEYBINDS_STORAGE_KEY,
      JSON.stringify(this.keybinds),
    );
    this.pushStateToWasm();
  }

  private getKeyValue(action: string): string {
    const entry = this.keybinds[action];
    if (!entry) return DefaultKeybinds[action] ?? "";
    const normalizedValue = Array.isArray(entry.value)
      ? entry.value[0] || ""
      : entry.value;
    if (normalizedValue === "Null") return "";
    return normalizedValue || DefaultKeybinds[action] || "";
  }

  private getKeyDisplay(action: string): string {
    const entry = this.keybinds[action];
    if (entry?.key) return entry.key;
    const code = this.getKeyValue(action);
    return formatKeyForDisplay(code);
  }

  private getTranslations(): DioxusUserSettingTranslations {
    return {
      title: translateText("user_setting.title"),
      tabBasic: translateText("user_setting.tab_basic"),
      tabKeybinds: translateText("user_setting.tab_keybinds"),
      flagTitle: translateText("flag_input.title"),
      flagButtonTitle: translateText("flag_input.button_title"),
      back: translateText("common.back"),
      pressKey: translateText("user_setting.press_key"),
      reset: translateText("user_setting.reset"),
      clear: translateText("user_setting.clear"),
    };
  }

  private buildToggles(): DioxusToggleSetting[] {
    return [
      {
        id: "darkMode",
        label: translateText("user_setting.dark_mode_label"),
        description: translateText("user_setting.dark_mode_desc"),
        checked: this.userSettings.darkMode(),
      },
      {
        id: "emojis",
        label: translateText("user_setting.emojis_label"),
        description: translateText("user_setting.emojis_desc"),
        checked: this.userSettings.emojis(),
      },
      {
        id: "alertFrame",
        label: translateText("user_setting.alert_frame_label"),
        description: translateText("user_setting.alert_frame_desc"),
        checked: this.userSettings.alertFrame(),
      },
      {
        id: "specialEffects",
        label: translateText("user_setting.special_effects_label"),
        description: translateText("user_setting.special_effects_desc"),
        checked: this.userSettings.fxLayer(),
      },
      {
        id: "structureSprites",
        label: translateText("user_setting.structure_sprites_label"),
        description: translateText("user_setting.structure_sprites_desc"),
        checked: this.userSettings.structureSprites(),
      },
      {
        id: "cursorCostLabel",
        label: translateText("user_setting.cursor_cost_label_label"),
        description: translateText("user_setting.cursor_cost_label_desc"),
        checked: this.userSettings.cursorCostLabel(),
      },
      {
        id: "leftClickOpensMenu",
        label: translateText("user_setting.left_click_label"),
        description: translateText("user_setting.left_click_desc"),
        checked: this.userSettings.leftClickOpensMenu(),
      },
      {
        id: "anonymousNames",
        label: translateText("user_setting.anonymous_names_label"),
        description: translateText("user_setting.anonymous_names_desc"),
        checked: this.userSettings.anonymousNames(),
      },
      {
        id: "lobbyIdVisibility",
        label: translateText("user_setting.lobby_id_visibility_label"),
        description: translateText("user_setting.lobby_id_visibility_desc"),
        checked: !this.userSettings.get("settings.lobbyIdVisibility", true),
      },
      {
        id: "territoryPatterns",
        label: translateText("user_setting.territory_patterns_label"),
        description: translateText("user_setting.territory_patterns_desc"),
        checked: this.userSettings.territoryPatterns(),
      },
      {
        id: "performanceOverlay",
        label: translateText("user_setting.performance_overlay_label"),
        description: translateText("user_setting.performance_overlay_desc"),
        checked: this.userSettings.performanceOverlay(),
      },
    ];
  }

  private buildSliders(): DioxusSliderSetting[] {
    const sliders: DioxusSliderSetting[] = [
      {
        id: "attackRatio",
        label: translateText("user_setting.attack_ratio_label"),
        description: translateText("user_setting.attack_ratio_desc"),
        min: 1,
        max: 100,
        value: this.attackRatioValue * 100,
        isEaster: false,
      },
    ];

    if (this.showEasterEgg) {
      sliders.push(
        {
          id: "easterWritingSpeed",
          label: translateText("user_setting.easter_writing_speed_label"),
          description: translateText("user_setting.easter_writing_speed_desc"),
          min: 0,
          max: 100,
          value: 40,
          isEaster: true,
        },
      );
    }

    return sliders;
  }

  private buildKeybindSections(): DioxusKeybindSection[] {
    return [
      {
        id: "view",
        title: translateText("user_setting.view_options"),
      },
      {
        id: "build",
        title: translateText("user_setting.build_controls"),
      },
      {
        id: "menu",
        title: translateText("user_setting.menu_shortcuts"),
      },
      {
        id: "attackRatio",
        title: translateText("user_setting.attack_ratio_controls"),
      },
      {
        id: "attack",
        title: translateText("user_setting.attack_keybinds"),
      },
      {
        id: "zoom",
        title: translateText("user_setting.zoom_controls"),
      },
      {
        id: "camera",
        title: translateText("user_setting.camera_movement"),
      },
    ];
  }

  private buildKeybinds(): DioxusKeybindSetting[] {
    const keybindDefs: {
      action: string;
      labelKey: string;
      descKey: string;
      section: string;
    }[] = [
      {
        action: "toggleView",
        labelKey: "user_setting.toggle_view",
        descKey: "user_setting.toggle_view_desc",
        section: "view",
      },
      {
        action: "buildCity",
        labelKey: "user_setting.build_city",
        descKey: "user_setting.build_city_desc",
        section: "build",
      },
      {
        action: "buildFactory",
        labelKey: "user_setting.build_factory",
        descKey: "user_setting.build_factory_desc",
        section: "build",
      },
      {
        action: "buildPort",
        labelKey: "user_setting.build_port",
        descKey: "user_setting.build_port_desc",
        section: "build",
      },
      {
        action: "buildDefensePost",
        labelKey: "user_setting.build_defense_post",
        descKey: "user_setting.build_defense_post_desc",
        section: "build",
      },
      {
        action: "buildMissileSilo",
        labelKey: "user_setting.build_missile_silo",
        descKey: "user_setting.build_missile_silo_desc",
        section: "build",
      },
      {
        action: "buildSamLauncher",
        labelKey: "user_setting.build_sam_launcher",
        descKey: "user_setting.build_sam_launcher_desc",
        section: "build",
      },
      {
        action: "buildWarship",
        labelKey: "user_setting.build_warship",
        descKey: "user_setting.build_warship_desc",
        section: "build",
      },
      {
        action: "buildAtomBomb",
        labelKey: "user_setting.build_atom_bomb",
        descKey: "user_setting.build_atom_bomb_desc",
        section: "build",
      },
      {
        action: "buildHydrogenBomb",
        labelKey: "user_setting.build_hydrogen_bomb",
        descKey: "user_setting.build_hydrogen_bomb_desc",
        section: "build",
      },
      {
        action: "buildMIRV",
        labelKey: "user_setting.build_mirv",
        descKey: "user_setting.build_mirv_desc",
        section: "build",
      },
      {
        action: "modifierKey",
        labelKey: "user_setting.build_menu_modifier",
        descKey: "user_setting.build_menu_modifier_desc",
        section: "menu",
      },
      {
        action: "altKey",
        labelKey: "user_setting.emoji_menu_modifier",
        descKey: "user_setting.emoji_menu_modifier_desc",
        section: "menu",
      },
      {
        action: "attackRatioDown",
        labelKey: "user_setting.attack_ratio_down",
        descKey: "user_setting.attack_ratio_down_desc",
        section: "attackRatio",
      },
      {
        action: "attackRatioUp",
        labelKey: "user_setting.attack_ratio_up",
        descKey: "user_setting.attack_ratio_up_desc",
        section: "attackRatio",
      },
      {
        action: "boatAttack",
        labelKey: "user_setting.boat_attack",
        descKey: "user_setting.boat_attack_desc",
        section: "attack",
      },
      {
        action: "groundAttack",
        labelKey: "user_setting.ground_attack",
        descKey: "user_setting.ground_attack_desc",
        section: "attack",
      },
      {
        action: "swapDirection",
        labelKey: "user_setting.swap_direction",
        descKey: "user_setting.swap_direction_desc",
        section: "attack",
      },
      {
        action: "zoomOut",
        labelKey: "user_setting.zoom_out",
        descKey: "user_setting.zoom_out_desc",
        section: "zoom",
      },
      {
        action: "zoomIn",
        labelKey: "user_setting.zoom_in",
        descKey: "user_setting.zoom_in_desc",
        section: "zoom",
      },
      {
        action: "centerCamera",
        labelKey: "user_setting.center_camera",
        descKey: "user_setting.center_camera_desc",
        section: "camera",
      },
      {
        action: "moveUp",
        labelKey: "user_setting.move_up",
        descKey: "user_setting.move_up_desc",
        section: "camera",
      },
      {
        action: "moveLeft",
        labelKey: "user_setting.move_left",
        descKey: "user_setting.move_left_desc",
        section: "camera",
      },
      {
        action: "moveDown",
        labelKey: "user_setting.move_down",
        descKey: "user_setting.move_down_desc",
        section: "camera",
      },
      {
        action: "moveRight",
        labelKey: "user_setting.move_right",
        descKey: "user_setting.move_right_desc",
        section: "camera",
      },
    ];

    return keybindDefs.map((def) => ({
      action: def.action,
      label: translateText(def.labelKey),
      description: translateText(def.descKey),
      defaultKey: DefaultKeybinds[def.action] ?? "",
      currentKey: this.getKeyValue(def.action),
      displayKey: this.getKeyDisplay(def.action),
      section: def.section,
    }));
  }

  private buildState(): DioxusUserSettingState {
    return {
      isVisible: this.isVisible,
      activeTab: this.activeTab,
      showEasterEgg: this.showEasterEgg,
      toggles: this.buildToggles(),
      sliders: this.buildSliders(),
      keybinds: this.buildKeybinds(),
      keybindSections: this.buildKeybindSections(),
    };
  }

  private async launchDioxus() {
    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();
      await this.updateComplete;

      dispatchProfileRuntimeAction(
        UI_RUNTIME_ACTIONS.uiProfileUserSettingModalLaunch,
        {
          state: this.buildState(),
          translations: this.getTranslations(),
        },
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isWasmLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error = err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusUserSettingModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  private pushStateToWasm() {
    if (!this.isWasmLaunched) return;
    try {
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileUserSettingModalState,
        {
          state: this.buildState(),
        },
      );
    } catch (e) {
      console.warn("[DioxusUserSettingModal] Failed to update state:", e);
    }
  }

  public open() {
    void ensureUiSessionRuntimeStarted();
    this.isVisible = true;
    reportUiModalState(SESSION_MODAL_IDS.userSetting, true);
    void this.loadSettingsFromSessionStorage();
    this.pushStateToWasm();
  }

  public close() {
    this.closeModal();
  }

  private closeModal() {
    reportUiModalState(SESSION_MODAL_IDS.userSetting, false);
    this.isVisible = false;
    this.pushStateToWasm();
    this.requestUpdate();
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-user-setting-modal-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-user-setting-modal": DioxusUserSettingModal;
  }
}


type LanguageMetadata = {
  code: string;
  native: string;
  en: string;
  svg: string;
};

const LANGUAGE_STORAGE_KEY = "lang";
const SETTINGS_KEYBINDS_STORAGE_KEY = "settings.keybinds";
const SETTINGS_ATTACK_RATIO_STORAGE_KEY = "settings.attackRatio";
const RUNTIME_ACTION_LANGUAGE_READ = UI_RUNTIME_ACTIONS.sessionLanguageRead;
const RUNTIME_ACTION_LANGUAGE_WRITE = UI_RUNTIME_ACTIONS.sessionLanguageWrite;
const RUNTIME_EVENT_LANGUAGE_READ_RESULT =
  UI_RUNTIME_EVENTS.sessionLanguageReadResult;
const RUNTIME_EVENT_LANGUAGE_CHANGED = UI_RUNTIME_EVENTS.sessionLanguageChanged;

@customElement("lang-selector")
export class DioxusLangSelector extends LitElement {
  @state() public translations: Record<string, string> | undefined;
  @state() public defaultTranslations: Record<string, string> | undefined;
  @state() public currentLang: string = "en";
  @state() private languageList: any[] = [];
  @state() private debugMode: boolean = false;
  @state() isVisible = true;

  @state()
  private isLaunched: boolean = false;

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

  private debugKeyPressed: boolean = false;
  private languageMetadata: LanguageMetadata[] = metadata;
  private languageCache = new Map<string, Record<string, string>>();
  private unsubscribeRuntimeLanguageEvents: (() => void) | null = null;

  createRenderRoot() {
    return this;
  }

  async connectedCallback() {
    super.connectedCallback();
    void ensureUiSessionRuntimeStarted();
    void this.initializeLanguage();
    startUiRuntimeEventRouter();
    this.unsubscribeRuntimeLanguageEvents = subscribeUiRuntimeEvents(
      [RUNTIME_EVENT_LANGUAGE_CHANGED],
      async (event) => {
        const lang = this.extractRuntimeLang(event.payload);
        if (typeof lang === "string") {
          await this.changeLanguage(lang);
        }
      },
    );
    window.addEventListener(
      "language-selected",
      this.handleLanguageSelected as EventListener,
    );
    window.addEventListener(
      UI_SESSION_RUNTIME_EVENTS.keyboardChanged,
      this.handleSessionKeyboardChanged as EventListener,
    );

    await this.ensureLaunched();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribeRuntimeLanguageEvents?.();
    this.unsubscribeRuntimeLanguageEvents = null;
    window.removeEventListener(
      "language-selected",
      this.handleLanguageSelected as EventListener,
    );
    window.removeEventListener(
      UI_SESSION_RUNTIME_EVENTS.keyboardChanged,
      this.handleSessionKeyboardChanged as EventListener,
    );
  }

  private handleLanguageSelected = (e: CustomEvent) => {
    if (e.detail && e.detail.lang) {
      void this.handleLanguageSelection(String(e.detail.lang));
    }
  };

  private async handleLanguageSelection(lang: string) {
    const appliedFromRuntime = await this.dispatchRuntimeLanguageWrite(lang);
    if (appliedFromRuntime) {
      return;
    }

    const errorCode = getUiRuntimeStats().lastErrorCode;
    console.error(
      `[DioxusLangSelector] Runtime language write failed (code: ${errorCode ?? "unknown"}).`,
    );
  }

  private extractRuntimeLang(payload: unknown): string | null | undefined {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return undefined;
    }

    const lang = (payload as Record<string, unknown>).lang;
    if (lang === null) {
      return null;
    }
    if (typeof lang === "string") {
      const trimmed = lang.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }

    return undefined;
  }

  private async dispatchRuntimeLanguageAction(
    actionType: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      await initDioxusRuntime();
      return dispatchUiAction({
        type: actionType,
        target: "runtime.session.language",
        payload,
      });
    } catch (error) {
      console.warn(
        "[DioxusLangSelector] Failed to initialize runtime language action:",
        error,
      );
      return false;
    }
  }

  private async readLanguageFromRuntime(): Promise<string | null | undefined> {
    const dispatched = await this.dispatchRuntimeLanguageAction(
      RUNTIME_ACTION_LANGUAGE_READ,
      { storageKey: LANGUAGE_STORAGE_KEY },
    );
    if (!dispatched) {
      return undefined;
    }
    const event = await waitForUiRuntimeEvent(RUNTIME_EVENT_LANGUAGE_READ_RESULT, {
      timeoutMs: 500,
    });
    if (!event) {
      return undefined;
    }
    return this.extractRuntimeLang(event.payload);
  }

  private async dispatchRuntimeLanguageWrite(lang: string): Promise<boolean> {
    const dispatched = await this.dispatchRuntimeLanguageAction(
      RUNTIME_ACTION_LANGUAGE_WRITE,
      {
        storageKey: LANGUAGE_STORAGE_KEY,
        lang,
      },
    );
    if (!dispatched) {
      return false;
    }
    const event = await waitForUiRuntimeEvent(RUNTIME_EVENT_LANGUAGE_CHANGED, {
      timeoutMs: 500,
      predicate: (runtimeEvent: DioxusUiEvent) =>
        this.extractRuntimeLang(runtimeEvent.payload) === lang,
    });
    return Boolean(event);
  }

  private async resolveSavedLanguage(): Promise<string | null> {
    const runtimeLang = await this.readLanguageFromRuntime();
    if (runtimeLang !== undefined) {
      return runtimeLang;
    }

    const errorCode = getUiRuntimeStats().lastErrorCode;
    console.error(
      `[DioxusLangSelector] Runtime language read failed (code: ${errorCode ?? "unknown"}).`,
    );
    return null;
  }

  private handleSessionKeyboardChanged = (
    event: CustomEvent<UiSessionKeyboardChangedDetail>,
  ) => {
    const detail = event.detail;
    if (!detail?.key || detail.key.toLowerCase() !== "t") {
      return;
    }

    this.debugKeyPressed = detail.isDown;
  };

  private getClosestSupportedLang(lang: string): string {
    if (!lang) return "en";
    if (lang === "debug") return "debug";
    const supported = new Set(this.languageMetadata.map((entry) => entry.code));
    if (supported.has(lang)) return lang;

    const base = lang.slice(0, 2);
    const candidates = Array.from(supported).filter((key) =>
      key.startsWith(base),
    );
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.length - a.length);
      return candidates[0];
    }

    return "en";
  }

  private async initializeLanguage() {
    const browserLocale = navigator.language;
    const savedLang = await this.resolveSavedLanguage();
    const userLang = this.getClosestSupportedLang(savedLang ?? browserLocale);

    const [defaultTranslations, translations] = await Promise.all([
      this.loadLanguage("en"),
      this.loadLanguage(userLang),
    ]);

    this.defaultTranslations = defaultTranslations;
    this.translations = translations;
    this.currentLang = userLang;

    await this.loadLanguageList();
    this.applyTranslation();
    this.updateDioxusFlag();
  }

  private async loadLanguage(lang: string): Promise<Record<string, string>> {
    if (!lang) return {};
    const cached = this.languageCache.get(lang);
    if (cached) return cached;

    if (lang === "debug") {
      const empty: Record<string, string> = {};
      this.languageCache.set(lang, empty);
      return empty;
    }

    if (lang === "en") {
      const flat = flattenTranslations(en);
      this.languageCache.set(lang, flat);
      return flat;
    }

    try {
      const language = await readLanguageBundle(lang);
      if (!language) {
        throw new Error(`Failed to fetch language ${lang}`);
      }
      const flat = flattenTranslations(language);
      this.languageCache.set(lang, flat);
      return flat;
    } catch (err) {
      console.error(`Failed to load language ${lang}:`, err);
      return {};
    }
  }

  private async loadLanguageList() {
    try {
      let list: any[] = [];

      const browserLang = new Intl.Locale(navigator.language).language;

      let debugLang: any = null;
      if (this.debugKeyPressed || this.currentLang === "debug") {
        debugLang = {
          code: "debug",
          native: "Debug",
          en: "Debug",
          svg: "xx",
        };
        this.debugMode = true;
      }

      for (const langData of this.languageMetadata) {
        if (langData.code === "debug" && !debugLang) continue;
        list.push({
          code: langData.code,
          native: langData.native,
          en: langData.en,
          svg: langData.svg,
        });
      }

      const currentLangEntry = list.find((l) => l.code === this.currentLang);
      const browserLangEntry =
        browserLang !== this.currentLang && browserLang !== "en"
          ? list.find((l) => l.code === browserLang)
          : undefined;
      const englishEntry =
        this.currentLang !== "en"
          ? list.find((l) => l.code === "en")
          : undefined;

      list = list.filter(
        (l) =>
          l.code !== this.currentLang &&
          l.code !== browserLang &&
          l.code !== "en" &&
          l.code !== "debug",
      );

      list.sort((a, b) => a.en.localeCompare(b.en));

      const finalList: any[] = [];
      if (currentLangEntry) finalList.push(currentLangEntry);
      if (englishEntry) finalList.push(englishEntry);
      if (browserLangEntry) finalList.push(browserLangEntry);
      finalList.push(...list);
      if (debugLang) finalList.push(debugLang);

      this.languageList = finalList;
    } catch (err) {
      console.error("Failed to load language list:", err);
    }
  }

  private async changeLanguage(lang: string) {
    this.translations = await this.loadLanguage(lang);
    this.currentLang = lang;
    this.applyTranslation();
    this.updateDioxusFlag();
  }

  private applyTranslation() {
    const components = [
      "dioxus-single-player-modal",
      "dioxus-host-lobby-modal",
      "dioxus-join-private-lobby-modal",
      "dioxus-emoji-table",
      "dioxus-leader-board",
      "dioxus-build-menu",
      "dioxus-win-modal",
      "dioxus-game-starting-modal",
      "top-bar",
      "dioxus-player-panel",
      "dioxus-replay-panel",
      "dioxus-help-modal",
      "dioxus-settings-modal",
      "username-input",
      "dioxus-public-lobby",
      "dioxus-user-setting-modal",
      "dioxus-territory-patterns-modal",
      "pattern-input",
      "dioxus-news-modal",
      "news-button",
      "dioxus-account-modal",
      "dioxus-stats-modal",
      "dioxus-flag-input-modal",
      "flag-input",
      "dioxus-token-login-modal",
    ];

    document.title = this.translateText("main.title") ?? document.title;

    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.getAttribute("data-i18n");
      if (key === null) return;
      const text = this.translateText(key);
      if (text === null) {
        console.warn(`Translation key not found: ${key}`);
        return;
      }
      element.textContent = text;
    });

    const applyAttributeTranslation = (
      dataAttr: string,
      targetAttr: string,
    ): void => {
      document.querySelectorAll(`[${dataAttr}]`).forEach((element) => {
        const key = element.getAttribute(dataAttr);
        if (key === null) return;
        const text = this.translateText(key);
        if (text === null) {
          console.warn(`Translation key not found: ${key}`);
          return;
        }
        element.setAttribute(targetAttr, text);
      });
    };

    applyAttributeTranslation("data-i18n-title", "title");
    applyAttributeTranslation("data-i18n-alt", "alt");
    applyAttributeTranslation("data-i18n-aria-label", "aria-label");
    applyAttributeTranslation("data-i18n-placeholder", "placeholder");

    components.forEach((tag) => {
      document.querySelectorAll(tag).forEach((el) => {
        if (typeof (el as any).requestUpdate === "function") {
          (el as any).requestUpdate();
        }
      });
    });
  }

  public translateText(
    key: string,
    params: Record<string, string | number> = {},
  ): string {
    if (this.currentLang === "debug") {
      return formatDebugTranslation(key, params);
    }

    let text: string | undefined;
    if (this.translations && key in this.translations) {
      text = this.translations[key];
    } else if (this.defaultTranslations && key in this.defaultTranslations) {
      text = this.defaultTranslations[key];
    } else {
      console.warn(`Translation key not found: ${key}`);
      return key;
    }

    for (const param in params) {
      const value = params[param];
      text = text.replace(`{${param}}`, String(value));
    }

    return text;
  }

  private async openModal() {
    this.debugMode = this.debugKeyPressed;
    await this.loadLanguageList();

    const languageModal = document.getElementById(
      "page-language",
    ) as DioxusLanguageModal;

    if (languageModal) {
      languageModal.languageList = [...this.languageList];
      languageModal.currentLang = this.currentLang;
      languageModal.open();
    }
  }

  public close() {
    this.isVisible = false;
    this.updateDioxusVisibility();
    this.requestUpdate();
  }

  private onDioxusLangSelectorClick = () => {
    this.openModal();
  };

  private async ensureLaunched() {
    if (this.isLaunched) return;

    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      // Wait for mount point to be rendered
      await this.updateComplete;

      // Determine initial flag SVG
      const currentLangData = this.languageMetadata.find(
        (l) => l.code === this.currentLang,
      );
      const initialFlagSvg = currentLangData?.svg ?? "uk_us_flag";

      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileLangSelectorLaunch, {
        initialFlagSvg,
      });

      // Give Dioxus time to mount and store the signal
      await new Promise((resolve) => requestAnimationFrame(resolve));

      this.isLaunched = true;

      // Set initial visibility
      this.updateDioxusVisibility();

      // Listen for Dioxus events on the mount point
      const root = this.querySelector("#dioxus-lang-selector-root");
      if (root) {
        root.addEventListener(
          "dioxus-lang-selector-click",
          this.onDioxusLangSelectorClick as EventListener,
        );
      }
    } catch (err) {
      this.loading = false;
      this.error =
        err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusLangSelector] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  private async updateDioxusFlag() {
    if (!this.isLaunched) return;
    try {
      const currentLangData =
        this.languageList.find((l) => l.code === this.currentLang) ??
        (this.currentLang === "debug"
          ? { svg: "xx" }
          : { svg: "uk_us_flag" });
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileLangSelectorState,
        {
          state: {
            flagSvg: currentLangData.svg,
          },
        },
      );
    } catch {
      // WASM not ready
    }
  }

  private async updateDioxusVisibility() {
    if (!this.isLaunched) return;
    try {
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileLangSelectorState,
        {
          state: {
            isVisible: this.isVisible,
          },
        },
      );
    } catch {
      // WASM not ready
    }
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-lang-selector-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

function flattenTranslations(
  obj: Record<string, any>,
  parentKey = "",
  result: Record<string, string> = {},
): Record<string, string> {
  for (const key in obj) {
    const value = obj[key];
    const fullKey = parentKey ? `${parentKey}.${key}` : key;

    if (typeof value === "string") {
      result[fullKey] = value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenTranslations(value, fullKey, result);
    } else {
      console.warn("Unknown type", typeof value, value);
    }
  }

  return result;
}

// Export as LangSelector for backward compatibility with existing imports
export { DioxusLangSelector as LangSelector };


@customElement("dioxus-footer")
export class DioxusFooter extends LitElement {
  @state() private isLaunched = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.launchDioxusComponent();
  }

  private async launchDioxusComponent() {
    try {
      await initDioxusRuntime();
      await this.updateComplete;
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiLayoutFooterLaunch);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
      this.sendState();
    } catch (err) {
      console.error("[DioxusFooter] Failed to launch:", err);
    }
  }

  private sendState() {
    if (!this.isLaunched) return;
    const state = {
      isVisible: true,
      termsText: translateText("main.terms_of_service"),
      copyrightText: translateText("main.copyright"),
      privacyText: translateText("main.privacy_policy"),
      githubAlt: translateText("news.github_link"),
      wikiAlt: translateText("main.wiki"),
    };
    dispatchProfileRuntimeSnapshot(UI_RUNTIME_SNAPSHOTS.uiSnapshotLayoutFooterState, {
      state,
    });
  }

  render() {
    return html`
      <div
        id="dioxus-footer-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

@customElement("dioxus-main-layout")
export class DioxusMainLayout extends LitElement {
  @state() private isLaunched = false;

  private _initialChildren: Node[] = [];

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    if (this._initialChildren.length === 0 && this.childNodes.length > 0) {
      this._initialChildren = Array.from(this.childNodes);
    }
    super.connectedCallback();
    this.launchDioxusComponent();
  }

  private async launchDioxusComponent() {
    try {
      await initDioxusRuntime();
      await this.updateComplete;
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiLayoutMainLayoutLaunch);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;

      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotLayoutMainLayoutState,
        {
          state: { isVisible: true },
        },
      );

      await this.updateComplete;
      const slot = this.querySelector("#dioxus-main-layout-content-slot");
      if (slot) {
        for (const child of this._initialChildren) {
          slot.appendChild(child);
        }
      }
    } catch (err) {
      console.error("[DioxusMainLayout] Failed to launch:", err);
    }
  }

  render() {
    return html`
      <div
        id="dioxus-main-layout-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

@customElement("dioxus-mobile-nav-bar")
export class DioxusMobileNavBar extends LitElement {
  @state() private isLaunched = false;
  private activePage = "page-play";
  private _initialChildren: Node[] = [];

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    if (this._initialChildren.length === 0 && this.childNodes.length > 0) {
      this._initialChildren = Array.from(this.childNodes);
    }
    super.connectedCallback();
    this.launchDioxusComponent();

    window.addEventListener("showPage", this.onShowPage);
    document.addEventListener("dioxus-nav-click", this.onNavClick);

    const current = (window as { currentPageId?: string }).currentPageId;
    if (current) {
      this.activePage = current;
    }
  }

  disconnectedCallback() {
    window.removeEventListener("showPage", this.onShowPage);
    document.removeEventListener("dioxus-nav-click", this.onNavClick);
    super.disconnectedCallback();
  }

  private async launchDioxusComponent() {
    try {
      await initDioxusRuntime();
      await this.updateComplete;
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiLayoutMobileNavBarLaunch);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
      this.sendState();
      this.mountInitialChildrenIntoSlots();
    } catch (err) {
      console.error("[DioxusMobileNavBar] Failed to launch:", err);
    }
  }

  private mountInitialChildrenIntoSlots() {
    const slot = this.querySelector("#dioxus-mobile-nav-lang-selector-slot");
    if (!slot) return;
    for (const child of this._initialChildren) {
      if (child instanceof HTMLElement) {
        slot.appendChild(child);
      }
    }
  }

  private sendState() {
    if (!this.isLaunched) return;
    const state = {
      isVisible: true,
      gameVersion: "",
      activePage: this.activePage,
      navItems: [
        { pageId: "page-play", label: translateText("main.play") },
        { pageId: "page-news", label: translateText("main.news") },
        { pageId: "page-stats", label: translateText("main.stats") },
        { pageId: "page-item-store", label: translateText("main.store") },
        { pageId: "page-settings", label: translateText("main.settings") },
        { pageId: "page-account", label: translateText("main.account") },
        { pageId: "page-help", label: translateText("main.help") },
      ],
    };
    dispatchProfileRuntimeSnapshot(
      UI_RUNTIME_SNAPSHOTS.uiSnapshotLayoutMobileNavBarState,
      { state },
    );
  }

  updateNavState(patch: Record<string, unknown>) {
    if (!this.isLaunched) return;
    const state = {
      isVisible: true,
      gameVersion: "",
      activePage: this.activePage,
      navItems: [
        { pageId: "page-play", label: translateText("main.play") },
        { pageId: "page-news", label: translateText("main.news") },
        { pageId: "page-stats", label: translateText("main.stats") },
        { pageId: "page-item-store", label: translateText("main.store") },
        { pageId: "page-settings", label: translateText("main.settings") },
        { pageId: "page-account", label: translateText("main.account") },
        { pageId: "page-help", label: translateText("main.help") },
      ],
      ...patch,
    };
    dispatchProfileRuntimeSnapshot(
      UI_RUNTIME_SNAPSHOTS.uiSnapshotLayoutMobileNavBarState,
      { state },
    );
  }

  private onShowPage = (e: Event) => {
    const pageId = (e as CustomEvent).detail;
    this.activePage = pageId;
    this.sendState();
  };

  private onNavClick = (e: Event) => {
    const pageId = (e as CustomEvent).detail;
    this.dispatchEvent(
      new CustomEvent("nav-click", {
        detail: pageId,
        bubbles: true,
        composed: true,
      }),
    );
  };

  render() {
    return html`
      <div
        id="dioxus-mobile-nav-bar-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

@customElement("dioxus-desktop-nav-bar")
export class DioxusDesktopNavBar extends LitElement {
  @state() private isLaunched = false;
  private activePage = "page-play";
  private _initialChildren: Node[] = [];

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    if (this._initialChildren.length === 0 && this.childNodes.length > 0) {
      this._initialChildren = Array.from(this.childNodes);
    }
    super.connectedCallback();
    this.launchDioxusComponent();

    window.addEventListener("showPage", this.onShowPage);
    document.addEventListener("dioxus-nav-click", this.onNavClick);

    const current = (window as { currentPageId?: string }).currentPageId;
    if (current) {
      this.activePage = current;
    }
  }

  disconnectedCallback() {
    window.removeEventListener("showPage", this.onShowPage);
    document.removeEventListener("dioxus-nav-click", this.onNavClick);
    super.disconnectedCallback();
  }

  private async launchDioxusComponent() {
    try {
      await initDioxusRuntime();
      await this.updateComplete;
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiLayoutDesktopNavBarLaunch);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
      this.sendState();
      this.mountInitialChildrenIntoSlots();
    } catch (err) {
      console.error("[DioxusDesktopNavBar] Failed to launch:", err);
    }
  }

  private mountInitialChildrenIntoSlots() {
    const slot = this.querySelector("#dioxus-desktop-nav-lang-selector-slot");
    if (!slot) return;
    for (const child of this._initialChildren) {
      if (child instanceof HTMLElement) {
        slot.appendChild(child);
      }
    }
  }

  private sendState() {
    if (!this.isLaunched) return;
    const state = {
      isVisible: true,
      gameVersion: "",
      activePage: this.activePage,
      navItems: [
        { pageId: "page-play", label: translateText("main.play") },
        { pageId: "page-news", label: translateText("main.news") },
        { pageId: "page-item-store", label: translateText("main.store") },
        { pageId: "page-settings", label: translateText("main.settings") },
        { pageId: "page-stats", label: translateText("main.stats") },
        { pageId: "page-help", label: translateText("main.help") },
      ],
      signInText: translateText("main.sign_in"),
      showAvatar: false,
      avatarUrl: "",
      showEmailBadge: false,
    };
    dispatchProfileRuntimeSnapshot(
      UI_RUNTIME_SNAPSHOTS.uiSnapshotLayoutDesktopNavBarState,
      { state },
    );
  }

  updateNavState(patch: Record<string, unknown>) {
    if (!this.isLaunched) return;
    const state = {
      isVisible: true,
      gameVersion: "",
      activePage: this.activePage,
      navItems: [
        { pageId: "page-play", label: translateText("main.play") },
        { pageId: "page-news", label: translateText("main.news") },
        { pageId: "page-item-store", label: translateText("main.store") },
        { pageId: "page-settings", label: translateText("main.settings") },
        { pageId: "page-stats", label: translateText("main.stats") },
        { pageId: "page-help", label: translateText("main.help") },
      ],
      signInText: translateText("main.sign_in"),
      showAvatar: false,
      avatarUrl: "",
      showEmailBadge: false,
      ...patch,
    };
    dispatchProfileRuntimeSnapshot(
      UI_RUNTIME_SNAPSHOTS.uiSnapshotLayoutDesktopNavBarState,
      { state },
    );
  }

  private onShowPage = (e: Event) => {
    const pageId = (e as CustomEvent).detail;
    this.activePage = pageId;
    this.sendState();
  };

  private onNavClick = (e: Event) => {
    const pageId = (e as CustomEvent).detail;
    this.dispatchEvent(
      new CustomEvent("nav-click", {
        detail: pageId,
        bubbles: true,
        composed: true,
      }),
    );
  };

  render() {
    return html`
      <div
        id="dioxus-desktop-nav-bar-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

@customElement("dioxus-play-page")
export class DioxusPlayPage extends LitElement {
  @state() private isLaunched = false;
  private _initialChildren: Node[] = [];

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    if (this._initialChildren.length === 0 && this.childNodes.length > 0) {
      this._initialChildren = Array.from(this.childNodes);
    }
    super.connectedCallback();
    this.launchDioxusComponent();

    document.addEventListener(
      "dioxus-play-page-hamburger",
      this.handleHamburger,
    );
    document.addEventListener("dioxus-play-page-solo", this.handleSolo);
    document.addEventListener("dioxus-play-page-create", this.handleCreate);
    document.addEventListener("dioxus-play-page-join", this.handleJoin);
    document.addEventListener(
      "dioxus-play-page-matchmaking",
      this.handleMatchmaking,
    );
    document.addEventListener(
      "dioxus-play-page-matchmaking-logged-out",
      this.handleMatchmakingLoggedOut,
    );
  }

  disconnectedCallback() {
    document.removeEventListener(
      "dioxus-play-page-hamburger",
      this.handleHamburger,
    );
    document.removeEventListener("dioxus-play-page-solo", this.handleSolo);
    document.removeEventListener("dioxus-play-page-create", this.handleCreate);
    document.removeEventListener("dioxus-play-page-join", this.handleJoin);
    document.removeEventListener(
      "dioxus-play-page-matchmaking",
      this.handleMatchmaking,
    );
    document.removeEventListener(
      "dioxus-play-page-matchmaking-logged-out",
      this.handleMatchmakingLoggedOut,
    );
    super.disconnectedCallback();
  }

  private async launchDioxusComponent() {
    try {
      await initDioxusRuntime();
      await this.updateComplete;
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiLayoutPlayPageLaunch);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
      this.sendState();
      this.mountInitialChildrenIntoSlots();
    } catch (err) {
      console.error("[DioxusPlayPage] Failed to launch:", err);
    }
  }

  private mountInitialChildrenIntoSlots() {
    const slotByNode = (node: Node): string | null => {
      if (!(node instanceof HTMLElement)) return null;
      if (node.id === "username-input") return "dioxus-play-page-username-slot";
      if (node.id === "pattern-input-mobile") {
        return "dioxus-play-page-pattern-mobile-slot";
      }
      if (node.id === "pattern-input-desktop") {
        return "dioxus-play-page-pattern-desktop-slot";
      }
      if (node.id === "flag-input-desktop") {
        return "dioxus-play-page-flag-desktop-slot";
      }
      if (node.id === "public-lobby") {
        return "dioxus-play-page-public-lobby-slot";
      }
      const tag = node.tagName.toLowerCase();
      if (tag === "dioxus-token-login-modal" || tag === "token-login") {
        return "dioxus-play-page-token-login-slot";
      }
      return null;
    };

    for (const child of this._initialChildren) {
      const slotId = slotByNode(child);
      if (!slotId) continue;
      const slot = this.querySelector(`#${slotId}`);
      if (slot) {
        slot.appendChild(child);
      }
    }
  }

  private sendState() {
    if (!this.isLaunched) return;
    const state = {
      isVisible: true,
      hostLabel: translateText("host_modal.label"),
      soloText: translateText("main.solo"),
      createText: translateText("main.create"),
      joinText: translateText("main.join"),
      playRankedText: translateText("matchmaking_button.play_ranked"),
      playRankedDesc: translateText("matchmaking_button.description"),
      loginRequiredText: translateText("matchmaking_button.login_required"),
      isLoggedIn: false,
    };
    dispatchProfileRuntimeSnapshot(
      UI_RUNTIME_SNAPSHOTS.uiSnapshotLayoutPlayPageState,
      { state },
    );
  }

  updateState(patch: Record<string, unknown>) {
    if (!this.isLaunched) return;
    const state = {
      isVisible: true,
      hostLabel: translateText("host_modal.label"),
      soloText: translateText("main.solo"),
      createText: translateText("main.create"),
      joinText: translateText("main.join"),
      playRankedText: translateText("matchmaking_button.play_ranked"),
      playRankedDesc: translateText("matchmaking_button.description"),
      loginRequiredText: translateText("matchmaking_button.login_required"),
      isLoggedIn: false,
      ...patch,
    };
    dispatchProfileRuntimeSnapshot(
      UI_RUNTIME_SNAPSHOTS.uiSnapshotLayoutPlayPageState,
      { state },
    );
  }

  private handleHamburger = () => {
    this.dispatchEvent(
      new CustomEvent("hamburger-click", { bubbles: true, composed: true }),
    );
  };

  private handleSolo = () => {
    this.dispatchEvent(
      new CustomEvent("solo-click", { bubbles: true, composed: true }),
    );
  };

  private handleCreate = () => {
    this.dispatchEvent(
      new CustomEvent("create-click", { bubbles: true, composed: true }),
    );
  };

  private handleJoin = () => {
    this.dispatchEvent(
      new CustomEvent("join-click", { bubbles: true, composed: true }),
    );
  };

  private handleMatchmaking = () => {
    this.dispatchEvent(
      new CustomEvent("matchmaking-click", { bubbles: true, composed: true }),
    );
  };

  private handleMatchmakingLoggedOut = () => {
    this.dispatchEvent(
      new CustomEvent("matchmaking-logged-out-click", {
        bubbles: true,
        composed: true,
      }),
    );
  };

  render() {
    return html`
      <div
        id="dioxus-play-page-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-footer": DioxusFooter;
    "dioxus-main-layout": DioxusMainLayout;
    "dioxus-mobile-nav-bar": DioxusMobileNavBar;
    "dioxus-desktop-nav-bar": DioxusDesktopNavBar;
    "dioxus-play-page": DioxusPlayPage;
  }
}

@customElement("dioxus-game-starting-modal")
export class DioxusGameStartingModal extends LitElement {
  @state() private isLaunched = false;
  @state() private loading = false;
  @state() private error: string | null = null;

  @state()
  isVisible = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.launchDioxusComponent();
  }

  private getTranslations() {
    return {
      credits: translateText("game_starting_modal.credits"),
      codeLicense: translateText("game_starting_modal.code_license"),
      title: translateText("game_starting_modal.title"),
    };
  }

  private async launchDioxusComponent() {
    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      await this.updateComplete;

      const translations = this.getTranslations();
      dispatchProfileRuntimeAction(
        UI_RUNTIME_ACTIONS.uiProfileGameStartingModalLaunch,
        {
          translations,
        },
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));

      this.isLaunched = true;

      if (this.isVisible) {
        dispatchProfileRuntimeAction(
          UI_RUNTIME_ACTIONS.uiProfileGameStartingModalShow,
        );
      }
    } catch (err) {
      this.loading = false;
      this.error = err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusGameStartingModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  async show() {
    this.isVisible = true;
    if (this.isLaunched) {
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileGameStartingModalShow);
    }
    this.requestUpdate();
  }

  async hide() {
    this.isVisible = false;
    if (this.isLaunched) {
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileGameStartingModalHide);
    }
    this.requestUpdate();
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-game-starting-modal-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-game-starting-modal": DioxusGameStartingModal;
  }
}

interface LanguageOption {
  code: string;
  svg: string;
  native: string;
  en: string;
}

@customElement("dioxus-language-modal")
export class DioxusLanguageModal extends LitElement {
  @property({ type: Array }) languageList: LanguageOption[] = [];
  @property({ type: String }) currentLang = "en";

  @state() private isLaunched = false;
  @state() private isVisible = false;
  @state() private loading = false;
  @state() private error: string | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void ensureUiSessionRuntimeStarted();
    this.addEventListener(
      "dioxus-language-selected",
      this.handleLanguageSelected as EventListener,
    );
    this.addEventListener(
      "dioxus-modal-close",
      this.handleModalClose as EventListener,
    );
    window.addEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
  }

  disconnectedCallback() {
    if (this.isVisible) {
      reportUiModalState(SESSION_MODAL_IDS.language, false);
    }
    this.removeEventListener(
      "dioxus-language-selected",
      this.handleLanguageSelected as EventListener,
    );
    this.removeEventListener(
      "dioxus-modal-close",
      this.handleModalClose as EventListener,
    );
    window.removeEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
    super.disconnectedCallback();
  }

  private handleLanguageSelected = (e: CustomEvent) => {
    const lang = e.detail;
    this.dispatchEvent(
      new CustomEvent("language-selected", {
        detail: { lang },
        bubbles: true,
        composed: true,
      }),
    );
    requestUiModalClose(SESSION_MODAL_IDS.language, "selected");
  };

  private handleModalClose = () => {
    requestUiModalClose(SESSION_MODAL_IDS.language, "component");
  };

  private handleSessionModalClose = (
    event: CustomEvent<UiSessionModalCloseDetail>,
  ) => {
    if (!this.isVisible || event.detail?.modal !== SESSION_MODAL_IDS.language) {
      return;
    }
    this.closeModal();
  };

  private getTranslations() {
    return {
      title: translateText("select_lang.title"),
      back: translateText("common.back"),
    };
  }

  private async ensureLaunched() {
    if (this.isLaunched) return;

    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      await this.updateComplete;

      const translations = this.getTranslations();
      dispatchProfileRuntimeAction(
        UI_RUNTIME_ACTIONS.uiProfileLanguageModalLaunch,
        {
          languageList: this.languageList,
          currentLang: this.currentLang,
          translations,
        },
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));

      this.isLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error = err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusLanguageModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  async open() {
    await ensureUiSessionRuntimeStarted();
    await this.ensureLaunched();
    this.isVisible = true;
    reportUiModalState(SESSION_MODAL_IDS.language, true);
    dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileLanguageModalOpen);
  }

  close() {
    this.closeModal();
  }

  private closeModal() {
    reportUiModalState(SESSION_MODAL_IDS.language, false);
    this.isVisible = false;
    if (this.isLaunched) {
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileLanguageModalClose);
    }
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-language-modal-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

@customElement("dioxus-flag-input-modal")
export class DioxusFlagInputModal extends LitElement {
  public returnTo = "";

  @state() private isLaunched = false;
  @state() private isVisible = false;
  @state() private loading = false;
  @state() private error: string | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void ensureUiSessionRuntimeStarted();
    this.addEventListener(
      "dioxus-flag-selected",
      this.handleFlagSelected as EventListener,
    );
    this.addEventListener(
      "dioxus-modal-close",
      this.handleModalClose as EventListener,
    );
    window.addEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
  }

  disconnectedCallback() {
    if (this.isVisible) {
      reportUiModalState(SESSION_MODAL_IDS.flagInput, false);
    }
    this.removeEventListener(
      "dioxus-flag-selected",
      this.handleFlagSelected as EventListener,
    );
    this.removeEventListener(
      "dioxus-modal-close",
      this.handleModalClose as EventListener,
    );
    window.removeEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
    super.disconnectedCallback();
  }

  private handleFlagSelected = (e: CustomEvent) => {
    const flag = e.detail;
    if (typeof flag === "string") {
      void writeUiSessionStorage(flagKey, flag);
    }
    this.dispatchEvent(
      new CustomEvent("flag-change", {
        detail: { flag },
        bubbles: true,
        composed: true,
      }),
    );
    requestUiModalClose(SESSION_MODAL_IDS.flagInput, "selected");
  };

  private handleModalClose = () => {
    requestUiModalClose(SESSION_MODAL_IDS.flagInput, "component");
  };

  private handleSessionModalClose = (
    event: CustomEvent<UiSessionModalCloseDetail>,
  ) => {
    if (!this.isVisible || event.detail?.modal !== SESSION_MODAL_IDS.flagInput) {
      return;
    }
    this.closeModal();
  };

  private getTranslations() {
    return {
      title: translateText("flag_input.title"),
      searchFlag: translateText("flag_input.search_flag"),
      back: translateText("common.back"),
    };
  }

  private async ensureLaunched() {
    if (this.isLaunched) return;

    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      await this.updateComplete;

      const translations = this.getTranslations();
      dispatchProfileRuntimeAction(
        UI_RUNTIME_ACTIONS.uiProfileFlagInputModalLaunch,
        {
          countries: Countries,
          translations,
        },
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));

      this.isLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error = err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusFlagInputModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  async open() {
    await ensureUiSessionRuntimeStarted();
    await this.ensureLaunched();
    this.isVisible = true;
    reportUiModalState(SESSION_MODAL_IDS.flagInput, true);
    dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileFlagInputModalOpen);
  }

  close() {
    this.closeModal();
  }

  private closeModal() {
    reportUiModalState(SESSION_MODAL_IDS.flagInput, false);
    this.isVisible = false;
    if (this.isLaunched) {
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileFlagInputModalClose);
    }

    if (this.returnTo) {
      const returnEl = document.querySelector(this.returnTo) as
        | { open?: () => void }
        | null;
      returnEl?.open?.();
      this.returnTo = "";
    }
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-flag-input-modal-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

@customElement("dioxus-token-login-modal")
export class DioxusTokenLoginModal extends LitElement {
  @state() private isLaunched = false;
  @state() private isVisible = false;
  @state() private loading = false;
  @state() private error: string | null = null;

  private token: string | null = null;
  private email: string | null = null;
  private isAttemptingLogin = false;
  private attemptCount = 0;
  private retryInterval: ReturnType<typeof setInterval> | undefined = undefined;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void ensureUiSessionRuntimeStarted();
    this.addEventListener(
      "dioxus-modal-close",
      this.handleModalClose as EventListener,
    );
    window.addEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
  }

  disconnectedCallback() {
    if (this.isVisible) {
      reportUiModalState(SESSION_MODAL_IDS.tokenLogin, false);
    }
    this.removeEventListener(
      "dioxus-modal-close",
      this.handleModalClose as EventListener,
    );
    window.removeEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
    clearInterval(this.retryInterval);
    super.disconnectedCallback();
  }

  private handleModalClose = () => {
    requestUiModalClose(
      SESSION_MODAL_IDS.tokenLogin,
      "component",
    );
  };

  private handleSessionModalClose = (
    event: CustomEvent<UiSessionModalCloseDetail>,
  ) => {
    if (!this.isVisible || event.detail?.modal !== SESSION_MODAL_IDS.tokenLogin) {
      return;
    }
    this.closeModal();
  };

  private getTranslations() {
    return {
      title: translateText("token_login_modal.title"),
      loggingIn: translateText("token_login_modal.logging_in"),
      success: translateText("token_login_modal.success", { email: "" }),
      back: translateText("common.back"),
    };
  }

  private async ensureLaunched() {
    if (this.isLaunched) return;

    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      await this.updateComplete;

      const translations = this.getTranslations();
      dispatchProfileRuntimeAction(
        UI_RUNTIME_ACTIONS.uiProfileTokenLoginModalLaunch,
        {
          translations,
        },
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));

      this.isLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error =
        err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusTokenLoginModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  async openWithToken(token: string) {
    this.token = token;
    this.email = null;
    this.attemptCount = 0;
    this.isAttemptingLogin = false;
    await this.open();
  }

  async open() {
    if (!this.token) return;

    await ensureUiSessionRuntimeStarted();
    await this.ensureLaunched();
    this.isVisible = true;
    reportUiModalState(SESSION_MODAL_IDS.tokenLogin, true);
    dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileTokenLoginModalOpen);

    clearInterval(this.retryInterval);
    this.retryInterval = setInterval(() => this.tryLogin(), 3000);
  }

  close() {
    this.closeModal();
  }

  private closeModal() {
    reportUiModalState(SESSION_MODAL_IDS.tokenLogin, false);
    this.isVisible = false;
    this.token = null;
    clearInterval(this.retryInterval);
    this.attemptCount = 0;
    this.isAttemptingLogin = false;

    if (this.isLaunched) {
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileTokenLoginModalClose);
    }
  }

  private async tryLogin() {
    if (this.isAttemptingLogin) return;
    if (this.attemptCount > 3) {
      this.close();
      alert("Login failed. Please try again later.");
      return;
    }
    this.attemptCount++;
    this.isAttemptingLogin = true;
    if (this.token === null) {
      this.close();
      return;
    }
    try {
      this.email = await tempTokenLogin(this.token);
      if (!this.email) return;
      clearInterval(this.retryInterval);

      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileTokenLoginModalState,
        {
          state: {
            email: this.email,
          },
        },
      );

      setTimeout(() => {
        this.close();
        window.location.reload();
      }, 1000);
    } catch (e) {
      console.error(e);
    } finally {
      this.isAttemptingLogin = false;
    }
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-token-login-modal-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-language-modal": DioxusLanguageModal;
    "dioxus-flag-input-modal": DioxusFlagInputModal;
    "dioxus-token-login-modal": DioxusTokenLoginModal;
  }
}

@customElement("dioxus-news-modal")
export class DioxusNewsModal extends LitElement {
  @state()
  private isLaunched: boolean = false;

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

  private initialized: boolean = false;
  private markdownHtml: string = "";

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener(
      "dioxus-modal-close",
      this.handleModalClose as EventListener,
    );
  }

  disconnectedCallback() {
    this.removeEventListener(
      "dioxus-modal-close",
      this.handleModalClose as EventListener,
    );
    super.disconnectedCallback();
  }

  private handleModalClose = () => {
    this.close();
  };

  private getTranslations() {
    return {
      title: translateText("news.title"),
      back: translateText("common.back"),
      loading: "Loading...",
    };
  }

  private async ensureLaunched() {
    if (this.isLaunched) return;

    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      await this.updateComplete;

      const translations = this.getTranslations();
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileNewsModalLaunch, {
        translations,
      });

      await new Promise((resolve) => requestAnimationFrame(resolve));

      this.isLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error =
        err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusNewsModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  private async fetchAndRenderMarkdown() {
    if (this.initialized) return;
    this.initialized = true;

    try {
      this.markdownHtml = await renderChangelogAssetHtml(changelog);

      // Update the Rust component
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileNewsModalState,
        {
          state: {
            contentHtml: this.markdownHtml,
          },
        },
      );
      // Re-emit on the next frame in case the WASM signal wasn't ready yet.
      requestAnimationFrame(() => {
        dispatchProfileRuntimeSnapshot(
          UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileNewsModalState,
          {
            state: {
              contentHtml: this.markdownHtml,
            },
          },
        );
      });
    } catch (err) {
      console.error("[DioxusNewsModal] Failed to fetch changelog:", err);
    }
  }

  async open() {
    await this.ensureLaunched();
    dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileNewsModalOpen);

    // Fetch markdown content on first open
    this.fetchAndRenderMarkdown();
  }

  close() {
    if (this.isLaunched) {
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileNewsModalClose);
    }
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-news-modal-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-news-modal": DioxusNewsModal;
  }
}

@customElement("dioxus-help-modal")
export class DioxusHelpModal extends LitElement {
  @state()
  private isLaunched: boolean = false;

  @state()
  private isVisible: boolean = false;

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void ensureUiSessionRuntimeStarted();
    this.addEventListener(
      "dioxus-modal-close",
      this.handleModalClose as EventListener,
    );
    window.addEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
  }

  disconnectedCallback() {
    if (this.isVisible) {
      reportUiModalState(SESSION_MODAL_IDS.help, false);
    }
    this.removeEventListener(
      "dioxus-modal-close",
      this.handleModalClose as EventListener,
    );
    window.removeEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
    super.disconnectedCallback();
  }

  private handleModalClose = () => {
    requestUiModalClose(SESSION_MODAL_IDS.help, "component");
  };

  private handleSessionModalClose = (
    event: CustomEvent<UiSessionModalCloseDetail>,
  ) => {
    if (!this.isVisible || event.detail?.modal !== SESSION_MODAL_IDS.help) {
      return;
    }
    this.closeModal();
  };

  private getTranslations() {
    return {
      title: translateText("main.instructions"),
      back: translateText("common.back"),
    };
  }

  private async ensureLaunched() {
    if (this.isLaunched) return;

    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      await this.updateComplete;

      const translations = this.getTranslations();
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileHelpModalLaunch, {
        translations,
      });

      await new Promise((resolve) => requestAnimationFrame(resolve));

      this.isLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error =
        err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusHelpModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  private isKeybindObject(v: unknown): v is { value: string } {
    return (
      typeof v === "object" &&
      v !== null &&
      "value" in v &&
      typeof (v as Record<string, unknown>).value === "string"
    );
  }

  private async getKeybinds(): Promise<Record<string, string>> {
    let saved: Record<string, string> = {};
    const keybindStorage = await readUiSessionStorage(
      SETTINGS_KEYBINDS_STORAGE_KEY,
    );
    if (typeof keybindStorage === "string" && keybindStorage.length > 0) {
      try {
        const parsed = JSON.parse(keybindStorage);
        saved = Object.fromEntries(
          Object.entries(parsed)
            .map(([k, v]) => {
              if (this.isKeybindObject(v)) return [k, v.value];
              if (typeof v === "string") return [k, v];
              return [k, undefined];
            })
            .filter(([, v]) => typeof v === "string" && v !== "Null"),
        ) as Record<string, string>;
      } catch (e) {
        console.warn("Invalid keybinds JSON:", e);
      }
    }

    const isMac = /Mac/.test(navigator.userAgent);
    return {
      toggleView: "Space",
      centerCamera: "KeyC",
      moveUp: "KeyW",
      moveDown: "KeyS",
      moveLeft: "KeyA",
      moveRight: "KeyD",
      zoomOut: "KeyQ",
      zoomIn: "KeyE",
      attackRatioDown: "KeyT",
      attackRatioUp: "KeyY",
      swapDirection: "KeyU",
      shiftKey: "ShiftLeft",
      modifierKey: isMac ? "MetaLeft" : "ControlLeft",
      altKey: "AltLeft",
      resetGfx: "KeyR",
      ...saved,
    };
  }

  private getKeyLabel(code: string): string {
    if (!code) return "";
    const specialLabels: Record<string, string> = {
      ShiftLeft: "Shift",
      ShiftRight: "Shift",
      ControlLeft: "Ctrl",
      ControlRight: "Ctrl",
      AltLeft: "Alt",
      AltRight: "Alt",
      MetaLeft: "Cmd",
      MetaRight: "Cmd",
      Space: "Space",
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
    };
    if (specialLabels[code]) return specialLabels[code];
    if (code.startsWith("Key") && code.length === 4) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
    return code;
  }

  private renderKey(code: string): string {
    const label = this.getKeyLabel(code);
    return `<span class="inline-block min-w-[32px] text-center px-2 py-1 rounded bg-[#2a2a2a] border-b-2 border-[#1a1a1a] text-white font-mono text-xs font-bold mx-0.5">${label}</span>`;
  }

  private mouseIcon(): string {
    return `<div class="w-5 h-8 border border-white/40 rounded-full relative">
      <div class="absolute top-0 left-0 w-1/2 h-1/2 bg-red-500/80 rounded-tl-full"></div>
      <div class="w-0.5 h-1.5 bg-white/40 rounded-full absolute top-1.5 left-1/2 -translate-x-1/2"></div>
    </div>`;
  }

  private scrollIcon(): string {
    return `<div class="flex items-center gap-1">
      <div class="w-5 h-8 border border-white/40 rounded-full relative">
        <div class="w-0.5 h-2 bg-red-400 rounded-full absolute top-1.5 left-1/2 -translate-x-1/2"></div>
      </div>
      <div class="flex flex-col text-[10px] text-white/50"><span>Up</span><span>Down</span></div>
    </div>`;
  }

  private async renderHelpContent(): Promise<string> {
    const kb = await this.getKeybinds();

    const row = (keys: string, action: string) =>
      `<tr class="hover:bg-white/5 transition-colors">
        <td class="py-3 pl-4 border-b border-white/5">${keys}</td>
        <td class="py-3 border-b border-white/5 text-white/70">${action}</td>
      </tr>`;

    const combo = (key: string, icon: string) =>
      `<div class="inline-flex items-center gap-2">${key}<span class="text-white/40 font-bold">+</span>${icon}</div>`;

    const sectionHeader = (svgPath: string, title: string) =>
      `<div class="flex items-center gap-3 mb-3">
        <div class="text-blue-400">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>
        </div>
        <h3 class="text-xl font-bold uppercase tracking-widest text-white/90">${title}</h3>
        <div class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"></div>
      </div>`;

    const uiCard = (label: string, imgHtml: string, desc: string) =>
      `<div class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors">
        <div class="flex flex-col items-center gap-3 shrink-0">
          <span class="text-xs font-bold uppercase tracking-wider text-blue-300">${label}</span>
          ${imgHtml}
        </div>
        <div class="flex items-center text-white/70 text-sm leading-relaxed">${desc}</div>
      </div>`;

    const buildRow = (name: string, icon: string, desc: string) =>
      `<tr class="bg-white/5 hover:bg-white/10 transition-colors">
        <td class="py-3 pl-4 border-b border-white/5 font-medium">${name}</td>
        <td class="py-3 border-b border-white/5"><img src="${icon}" class="w-8 h-8 scale-75 origin-left" /></td>
        <td class="py-3 border-b border-white/5 text-white/60 text-sm">${desc}</td>
      </tr>`;

    const iconCard = (imgSrc: string, alt: string, label: string) =>
      `<div class="bg-black/20 rounded-xl border border-white/10 p-4 flex flex-col items-center gap-3 hover:bg-white/5 transition-colors">
        <img src="${imgSrc}" alt="${alt}" class="rounded shadow-lg border border-white/10 h-24 w-auto object-contain" loading="lazy" />
        <span class="text-xs font-bold uppercase tracking-wider text-white text-center">${label}</span>
      </div>`;

    let content = "";

    // Hotkeys Section
    const kbSvg = `<rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect><path d="M6 8h.001"></path><path d="M10 8h.001"></path><path d="M14 8h.001"></path><path d="M18 8h.001"></path><path d="M6 12h.001"></path><path d="M10 12h.001"></path><path d="M14 12h.001"></path><path d="M18 12h.001"></path><path d="M6 16h12"></path>`;
    content += sectionHeader(kbSvg, translateText("help_modal.hotkeys"));
    content += `<section class="bg-white/5 rounded-xl border border-white/10 overflow-hidden"><div class="pt-2 pb-4 px-4 overflow-x-auto"><table class="w-full text-sm border-separate border-spacing-y-1"><thead><tr class="text-white/40 text-xs uppercase tracking-wider text-left"><th class="pb-2 pl-4">${translateText("help_modal.table_key")}</th><th class="pb-2">${translateText("help_modal.table_action")}</th></tr></thead><tbody class="text-white/80">`;
    content += row(this.renderKey(kb.toggleView), translateText("help_modal.action_alt_view"));
    content += row(this.renderKey(kb.swapDirection), translateText("help_modal.bomb_direction"));
    content += row(combo(this.renderKey(kb.shiftKey), this.mouseIcon()), translateText("help_modal.action_attack_altclick"));
    content += row(combo(this.renderKey(kb.modifierKey), this.mouseIcon()), translateText("help_modal.action_build"));
    content += row(combo(this.renderKey(kb.altKey), this.mouseIcon()), translateText("help_modal.action_emote"));
    content += row(this.renderKey(kb.centerCamera), translateText("help_modal.action_center"));
    content += row(`<div class="flex flex-wrap gap-2">${this.renderKey(kb.zoomOut)}${this.renderKey(kb.zoomIn)}</div>`, translateText("help_modal.action_zoom"));
    content += row(`<div class="flex flex-wrap gap-1 max-w-[200px]">${this.renderKey(kb.moveUp)}${this.renderKey(kb.moveLeft)}${this.renderKey(kb.moveDown)}${this.renderKey(kb.moveRight)}</div>`, translateText("help_modal.action_move_camera"));
    content += row(`<div class="flex flex-wrap gap-2">${this.renderKey(kb.attackRatioDown)}${this.renderKey(kb.attackRatioUp)}</div>`, translateText("help_modal.action_ratio_change"));
    content += row(combo(this.renderKey(kb.shiftKey), this.scrollIcon()), translateText("help_modal.action_ratio_change"));
    content += row(combo(this.renderKey(kb.altKey), this.renderKey(kb.resetGfx)), translateText("help_modal.action_reset_gfx"));
    content += row(`<div class="w-5 h-8 border border-white/40 rounded-full relative"><div class="w-0.5 h-2 bg-red-400 rounded-full absolute top-1.5 left-1/2 -translate-x-1/2"></div></div>`, translateText("help_modal.action_auto_upgrade"));
    content += `</tbody></table></div></section>`;

    // UI Interface Section
    const uiSvg = `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line>`;
    content += `<section class="mb-8 mt-8">`;
    content += sectionHeader(uiSvg, translateText("help_modal.ui_section"));
    content += `<div class="grid grid-cols-1 gap-6">`;
    content += uiCard(translateText("help_modal.ui_leaderboard"), `<img src="/images/helpModal/leaderboard2.webp" alt="Leaderboard" class="rounded-lg shadow-lg border border-white/20 max-w-[200px]" loading="lazy" />`, `<p>${translateText("help_modal.ui_leaderboard_desc")}</p>`);
    content += uiCard(translateText("help_modal.ui_control"), `<img src="/images/helpModal/controlPanel.webp" alt="Control Panel" class="rounded-lg shadow-lg border border-white/20 max-w-[200px]" loading="lazy" />`, `<div class="flex flex-col justify-center text-white/70 text-sm"><p class="mb-4 leading-relaxed">${translateText("help_modal.ui_control_desc")}</p><ul class="space-y-2 list-disc pl-4 text-white/60"><li>${translateText("help_modal.ui_gold")}</li><li>${translateText("help_modal.ui_attack_ratio")}</li></ul></div>`);
    content += uiCard(translateText("help_modal.ui_events"), `<div class="flex flex-col gap-2"><img src="/images/helpModal/eventsPanel.webp" alt="Events" class="rounded-lg shadow-lg border border-white/20 max-w-[200px]" loading="lazy" /><img src="/images/helpModal/eventsPanelAttack.webp" alt="Events Attack" class="rounded-lg shadow-lg border border-white/20 max-w-[200px]" loading="lazy" /></div>`, `<div class="flex flex-col justify-center text-white/70 text-sm"><p class="mb-4 leading-relaxed">${translateText("help_modal.ui_events_desc")}</p><ul class="space-y-2 list-disc pl-4 text-white/60"><li>${translateText("help_modal.ui_events_alliance")}</li><li>${translateText("help_modal.ui_events_attack")}</li><li>${translateText("help_modal.ui_events_quickchat")}</li></ul></div>`);
    content += uiCard(translateText("help_modal.ui_options"), `<img src="/images/helpModal/options2.webp" alt="Options" class="rounded-lg shadow-lg border border-white/20 max-w-[200px]" loading="lazy" />`, `<div class="flex flex-col justify-center text-white/70 text-sm"><p class="mb-4 leading-relaxed">${translateText("help_modal.ui_options_desc")}</p><ul class="space-y-2 list-disc pl-4 text-white/60"><li>${translateText("help_modal.option_pause")}</li><li>${translateText("help_modal.option_timer")}</li><li>${translateText("help_modal.option_exit")}</li><li>${translateText("help_modal.option_settings")}</li></ul></div>`);
    content += uiCard(translateText("help_modal.ui_playeroverlay"), `<img src="/images/helpModal/playerInfoOverlay.webp" alt="Player Info" class="rounded-lg shadow-lg border border-white/20 max-w-[200px]" loading="lazy" />`, `<p>${translateText("help_modal.ui_playeroverlay_desc")}</p>`);
    content += `</div></section>`;

    // Radial Menu Section
    const radialSvg = `<circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle>`;
    content += `<section class="mb-8">`;
    content += sectionHeader(radialSvg, translateText("help_modal.radial_title"));
    content += `<div class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors">`;
    content += `<div class="flex flex-col gap-4 shrink-0"><img src="/images/helpModal/radialMenu2.webp" alt="Radial Menu" class="rounded-lg shadow-lg border border-white/20 max-w-[200px]" loading="lazy" /><img src="/images/helpModal/radialMenuAlly.webp" alt="Radial Menu Ally" class="rounded-lg shadow-lg border border-white/20 max-w-[200px]" loading="lazy" /></div>`;
    content += `<div class="text-white/70 text-sm"><p class="mb-4 leading-relaxed">${translateText("help_modal.radial_desc")}</p><ul class="space-y-3">`;
    content += `<li class="flex items-center gap-3"><img src="/images/BuildIconWhite.svg" class="w-8 h-8 scale-75 origin-left" /><span>${translateText("help_modal.radial_build")}</span></li>`;
    content += `<li class="flex items-center gap-3"><img src="/images/InfoIcon.svg" class="w-5 h-5 opacity-80" loading="lazy" /><span>${translateText("help_modal.radial_info")}</span></li>`;
    content += `<li class="flex items-center gap-3"><img src="/images/BoatIconWhite.svg" class="w-8 h-8 scale-75 origin-left" /><span>${translateText("help_modal.radial_boat")}</span></li>`;
    content += `<li class="flex items-center gap-3"><img src="/images/AllianceIconWhite.svg" class="w-8 h-8 scale-75 origin-left" /><span>${translateText("help_modal.info_alliance")}</span></li>`;
    content += `<li class="flex items-center gap-3"><img src="/images/TraitorIconWhite.svg" class="w-8 h-8 scale-75 origin-left" /><span>${translateText("help_modal.ally_betray")}</span></li>`;
    content += `<li class="flex items-center gap-3"><img src="/images/DonateTroopIconWhite.svg" class="w-8 h-8 scale-75 origin-left" /><span>${translateText("help_modal.radial_donate_troops")}</span></li>`;
    content += `<li class="flex items-center gap-3"><img src="/images/DonateGoldIconWhite.svg" class="w-8 h-8 scale-75 origin-left" /><span>${translateText("help_modal.radial_donate_gold")}</span></li>`;
    content += `</ul></div></div></section>`;

    // Info/Ally Panels Section
    const infoSvg = `<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>`;
    content += `<section class="mb-8">`;
    content += sectionHeader(infoSvg, translateText("help_modal.info_title"));
    content += `<div class="grid grid-cols-1 md:grid-cols-2 gap-6">`;

    // Enemy info panel
    content += `<div class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col gap-6 hover:bg-white/5 transition-colors">`;
    content += `<div class="flex flex-col items-center gap-3"><span class="text-xs font-bold uppercase tracking-wider text-blue-300">${translateText("help_modal.info_enemy_panel")}</span><img src="/images/helpModal/infoMenu2.webp" alt="Enemy Info" class="rounded-lg shadow-lg border border-white/20 max-w-[240px]" loading="lazy" /></div>`;
    content += `<div class="text-white/70 text-sm"><p class="mb-4 leading-relaxed">${translateText("help_modal.info_enemy_desc")}</p><ul class="space-y-3">`;
    content += `<li class="flex items-center gap-3"><img src="/images/ChatIconWhite.svg" class="w-8 h-8 scale-75 origin-left" /><span>${translateText("help_modal.info_chat")}</span></li>`;
    content += `<li class="flex items-center gap-3"><img src="/images/TargetIconWhite.svg" class="w-8 h-8 scale-75 origin-left" /><span>${translateText("help_modal.info_target")}</span></li>`;
    content += `<li class="flex items-center gap-3"><img src="/images/AllianceIconWhite.svg" class="w-8 h-8 scale-75 origin-left" /><span>${translateText("help_modal.info_alliance")}</span></li>`;
    content += `<li class="flex items-center gap-3"><img src="/images/EmojiIconWhite.svg" class="w-8 h-8 scale-75 origin-left" /><span>${translateText("help_modal.info_emoji")}</span></li>`;
    content += `<li class="flex items-center gap-3"><div class="flex items-center justify-center w-8 h-8 opacity-80"><img src="/images/helpModal/stopTrading.webp" class="w-full h-full object-contain" /></div><span>${translateText("help_modal.info_trade")}</span></li>`;
    content += `</ul></div></div>`;

    // Ally info panel
    content += `<div class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col gap-6 hover:bg-white/5 transition-colors">`;
    content += `<div class="flex flex-col items-center gap-3"><span class="text-xs font-bold uppercase tracking-wider text-blue-300">${translateText("help_modal.info_ally_panel")}</span><img src="/images/helpModal/infoMenu2Ally.webp" alt="Ally Info" class="rounded-lg shadow-lg border border-white/20 max-w-[240px]" loading="lazy" /></div>`;
    content += `<div class="text-white/70 text-sm"><p class="mb-4 leading-relaxed">${translateText("help_modal.info_ally_desc")}</p><ul class="space-y-3">`;
    content += `<li class="flex items-center gap-3"><img src="/images/TraitorIconWhite.svg" class="w-8 h-8 scale-75 origin-left" /><span>${translateText("help_modal.ally_betray")}</span></li>`;
    content += `<li class="flex items-center gap-3"><img src="/images/DonateTroopIconWhite.svg" class="w-8 h-8 scale-75 origin-left" /><span>${translateText("help_modal.ally_donate")}</span></li>`;
    content += `<li class="flex items-center gap-3"><img src="/images/DonateGoldIconWhite.svg" class="w-8 h-8 scale-75 origin-left" /><span>${translateText("help_modal.ally_donate_gold")}</span></li>`;
    content += `</ul></div></div>`;
    content += `</div></section>`;

    // Build Menu Section
    const buildSvg = `<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"></path><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"></path>`;
    content += `<section class="mb-8">`;
    content += sectionHeader(buildSvg, translateText("help_modal.build_menu_title"));
    content += `<p class="mb-4 text-white/70 text-sm">${translateText("help_modal.build_menu_desc")}</p>`;
    content += `<div class="overflow-hidden rounded-xl border border-white/10"><table class="w-full border-collapse"><thead class="bg-white/10"><tr><th class="py-3 pl-4 text-left text-xs font-bold uppercase tracking-wider text-blue-300 w-[20%]">${translateText("help_modal.build_name")}</th><th class="py-3 text-left text-xs font-bold uppercase tracking-wider text-blue-300 w-[8%]">${translateText("help_modal.build_icon")}</th><th class="py-3 text-left text-xs font-bold uppercase tracking-wider text-blue-300">${translateText("help_modal.build_desc")}</th></tr></thead><tbody class="text-white/80">`;
    content += buildRow(translateText("help_modal.build_city"), "/images/CityIconWhite.svg", translateText("help_modal.build_city_desc"));
    content += buildRow(translateText("help_modal.build_defense"), "/images/ShieldIconWhite.svg", translateText("help_modal.build_defense_desc"));
    content += buildRow(translateText("help_modal.build_port"), "/images/PortIcon.svg", translateText("help_modal.build_port_desc"));
    content += buildRow(translateText("help_modal.build_factory"), "/images/FactoryIconWhite.svg", translateText("help_modal.build_factory_desc"));
    content += buildRow(translateText("help_modal.build_warship"), "/images/BattleshipIconWhite.svg", translateText("help_modal.build_warship_desc"));
    content += buildRow(translateText("help_modal.build_silo"), "/images/MissileSiloIconWhite.svg", translateText("help_modal.build_silo_desc"));
    content += buildRow(translateText("help_modal.build_sam"), "/images/SamLauncherIconWhite.svg", translateText("help_modal.build_sam_desc"));
    content += buildRow(translateText("help_modal.build_atom"), "/images/NukeIconWhite.svg", translateText("help_modal.build_atom_desc"));
    content += buildRow(translateText("help_modal.build_hydrogen"), "/images/MushroomCloudIconWhite.svg", translateText("help_modal.build_hydrogen_desc"));
    content += buildRow(translateText("help_modal.build_mirv"), "/images/MIRVIcon.svg", translateText("help_modal.build_mirv_desc"));
    content += `</tbody></table></div></section>`;

    // Player Icons Section
    const playerSvg = `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>`;
    content += `<section class="mb-4">`;
    content += sectionHeader(playerSvg, translateText("help_modal.player_icons"));
    content += `<p class="mb-6 text-white/70 text-sm">${translateText("help_modal.icon_desc")}</p>`;
    content += `<div class="grid grid-cols-2 md:grid-cols-3 gap-6">`;
    content += iconCard("/images/helpModal/crown.webp", "Rank 1", translateText("help_modal.icon_crown"));
    content += iconCard("/images/helpModal/traitor2.webp", "Traitor", translateText("help_modal.icon_traitor"));
    content += iconCard("/images/helpModal/ally2.webp", "Ally", translateText("help_modal.icon_ally"));
    content += iconCard("/images/helpModal/embargo.webp", "Embargo", translateText("help_modal.icon_embargo"));
    content += iconCard("/images/helpModal/allianceRequest.webp", "Request", translateText("help_modal.icon_request"));
    content += `</div></section>`;

    return content;
  }

  async open() {
    await ensureUiSessionRuntimeStarted();
    await this.ensureLaunched();
    this.isVisible = true;
    reportUiModalState(SESSION_MODAL_IDS.help, true);

    // Render content and pass to Rust
    const contentHtml = await this.renderHelpContent();
    dispatchProfileRuntimeSnapshot(
      UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileHelpModalState,
      {
        state: {
          contentHtml,
        },
      },
    );

    dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileHelpModalOpen);
  }

  close() {
    this.closeModal();
  }

  private closeModal() {
    reportUiModalState(SESSION_MODAL_IDS.help, false);
    this.isVisible = false;
    if (this.isLaunched) {
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileHelpModalClose);
    }
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-help-modal-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-help-modal": DioxusHelpModal;
  }
}

const flagKey: string = "flag";

@customElement("flag-input")
export class DioxusFlagInput extends LitElement {
  @state() public flag: string = "";

  @property({ type: Boolean, attribute: "show-select-label" })
  public showSelectLabel: boolean = false;

  @state()
  private isLaunched: boolean = false;

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

  createRenderRoot() {
    return this;
  }

  private isDefaultFlagValue(flag: string): boolean {
    return !flag || flag === "xx";
  }

  public getCurrentFlag(): string {
    return this.flag;
  }

  private async getStoredFlag(): Promise<string> {
    const storedFlag = await readUiSessionStorage(flagKey);
    return typeof storedFlag === "string" ? storedFlag : "";
  }

  private dispatchFlagEvent() {
    this.dispatchEvent(
      new CustomEvent("flag-change", {
        detail: { flag: this.flag },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private updateFlag = (ev: Event) => {
    const e = ev as CustomEvent<{ flag: string }>;
    if (!FlagSchema.safeParse(e.detail.flag).success) return;
    if (this.flag !== e.detail.flag) {
      this.flag = e.detail.flag;
      this.syncFlagToDioxus();
    }
  };

  private onDioxusFlagInputClick = () => {
    this.dispatchEvent(
      new CustomEvent("flag-input-click", {
        bubbles: true,
        composed: true,
      }),
    );
  };

  async connectedCallback() {
    super.connectedCallback();
    this.flag = await this.getStoredFlag();
    this.dispatchFlagEvent();
    window.addEventListener("flag-change", this.updateFlag as EventListener);

    await this.ensureLaunched();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("flag-change", this.updateFlag as EventListener);
  }

  private getTranslations() {
    return {
      title: translateText("flag_input.title"),
      buttonTitle: translateText("flag_input.button_title"),
    };
  }

  private async ensureLaunched() {
    if (this.isLaunched) return;

    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      // Wait for mount point to be rendered
      await this.updateComplete;

      const translations = this.getTranslations();
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileFlagInputLaunch, {
        translations,
      });

      // Give Dioxus time to mount and store the signal
      await new Promise((resolve) => requestAnimationFrame(resolve));

      this.isLaunched = true;

      // Set initial state
      this.syncFlagToDioxus();
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileFlagInputState,
        {
          state: {
            showSelectLabel: this.showSelectLabel,
          },
        },
      );

      // Listen for Dioxus events on the mount point
      const root = this.querySelector("#dioxus-flag-input-root");
      if (root) {
        root.addEventListener(
          "dioxus-flag-input-click",
          this.onDioxusFlagInputClick as EventListener,
        );
      }
    } catch (err) {
      this.loading = false;
      this.error =
        err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusFlagInput] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  private async syncFlagToDioxus() {
    if (!this.isLaunched) return;
    try {
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileFlagInputState,
        {
          state: {
            flag: this.flag,
          },
        },
      );

      // Handle custom flag rendering on TS side
      if (this.flag?.startsWith("!")) {
        requestAnimationFrame(() => {
          const customPreview = this.querySelector(
            "#dioxus-flag-preview-custom",
          ) as HTMLElement;
          if (customPreview) {
            customPreview.innerHTML = "";
            renderPlayerFlag(this.flag, customPreview);
          }
        });
      }
    } catch {
      // WASM not ready yet
    }
  }

  updated(_changedProperties: Map<string | number | symbol, unknown>) {
    if (this.isLaunched) {
      const translations = this.getTranslations();
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileFlagInputState,
        {
          state: {
            showSelectLabel: this.showSelectLabel,
            translations,
          },
        },
      );
    }
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-flag-input-root"
        class="w-full h-full"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

// Export as FlagInput for backward compatibility with existing imports
export { DioxusFlagInput as FlagInput };

declare global {
  interface HTMLElementTagNameMap {
    "flag-input": DioxusFlagInput;
  }
}

// Module-level cosmetics cache to avoid refetching on every component mount
let cosmeticsCache: Promise<Cosmetics | null> | null = null;

function getCachedCosmetics(): Promise<Cosmetics | null> {
  if (!cosmeticsCache) {
    const fetchPromise = fetchCosmetics();
    cosmeticsCache = fetchPromise.catch((err) => {
      cosmeticsCache = null;
      throw err;
    });
  }
  return cosmeticsCache;
}

@customElement("pattern-input")
export class DioxusPatternInput extends LitElement {
  @state() public pattern: PlayerPattern | null = null;
  @state() public selectedColor: string | null = null;

  @property({ type: Boolean, attribute: "show-select-label" })
  public showSelectLabel: boolean = false;

  @state()
  private isLaunched: boolean = false;

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

  private userSettings = new UserSettings();
  private cosmetics: Cosmetics | null = null;
  private _abortController: AbortController | null = null;

  createRenderRoot() {
    return this;
  }

  private _onPatternSelected = () => {
    this.updateFromSettings();
  };

  private onDioxusPatternInputClick = () => {
    this.dispatchEvent(
      new CustomEvent("pattern-input-click", {
        bubbles: true,
        composed: true,
      }),
    );
  };

  private updateFromSettings() {
    this.selectedColor = this.userSettings.getSelectedColor() ?? null;

    if (this.cosmetics) {
      this.pattern = this.userSettings.getSelectedPatternName(this.cosmetics);
    } else {
      this.pattern = null;
    }

    this.syncPreviewToDioxus();
  }

  private getTranslations() {
    return {
      title: translateText("territory_patterns.title"),
      selectSkin: translateText("territory_patterns.select_skin"),
    };
  }

  async connectedCallback() {
    super.connectedCallback();
    this._abortController = new AbortController();

    // Start loading cosmetics in parallel with WASM init
    const cosmeticsPromise = getCachedCosmetics();

    await this.ensureLaunched();

    // Now wait for cosmetics
    const cosmetics = await cosmeticsPromise;
    if (!this.isConnected) return;
    this.cosmetics = cosmetics;
    this.updateFromSettings();
    if (!this.isConnected) return;

    // Tell Dioxus loading is done
    try {
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfilePatternInputState,
        {
          state: {
            loading: false,
          },
        },
      );
    } catch {
      // WASM not ready
    }

    window.addEventListener("pattern-selected", this._onPatternSelected, {
      signal: this._abortController.signal,
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  private async ensureLaunched() {
    if (this.isLaunched) return;

    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      // Wait for mount point to be rendered
      await this.updateComplete;

      const translations = this.getTranslations();
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfilePatternInputLaunch, {
        translations,
      });

      // Give Dioxus time to mount and store the signal
      await new Promise((resolve) => requestAnimationFrame(resolve));

      this.isLaunched = true;

      // Set initial state
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfilePatternInputState,
        {
          state: {
            showSelectLabel: this.showSelectLabel,
          },
        },
      );

      // Listen for Dioxus events on the mount point
      const root = this.querySelector("#dioxus-pattern-input-root");
      if (root) {
        root.addEventListener(
          "dioxus-pattern-input-click",
          this.onDioxusPatternInputClick as EventListener,
        );
      }
    } catch (err) {
      this.loading = false;
      this.error =
        err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusPatternInput] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  private async syncPreviewToDioxus() {
    if (!this.isLaunched) return;
    try {
      // Use renderPatternPreview to generate the preview, then render it
      // into the Dioxus preview container via Lit's render
      const previewTemplate = renderPatternPreview(
        this.pattern,
        128,
        128,
      );

      // Render the Lit template into the Dioxus preview container
      requestAnimationFrame(() => {
          const container = this.querySelector(
            "#dioxus-pattern-preview-container",
          ) as HTMLElement | null;
          if (container) {
            litRender(previewTemplate, container);
          }
        });

      // Tell Dioxus whether we have a pattern (to show/hide the select label)
      const hasPattern = this.pattern !== null || this.selectedColor !== null;
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfilePatternInputState,
        {
          state: {
            previewUrl: hasPattern ? "has-pattern" : "",
          },
        },
      );
    } catch {
      // WASM not ready yet
    }
  }

  updated(_changedProperties: Map<string | number | symbol, unknown>) {
    if (this.isLaunched) {
      const translations = this.getTranslations();
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfilePatternInputState,
        {
          state: {
            showSelectLabel: this.showSelectLabel,
            translations,
          },
        },
      );
    }
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-pattern-input-root"
        class="w-full h-full"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pattern-input": DioxusPatternInput;
  }
}

const usernameKey: string = "username";

@customElement("username-input")
export class DioxusUsernameInput extends LitElement {
  @state() private baseUsername: string = "";
  @state() private clanTag: string = "";

  @property({ type: String }) validationError: string = "";
  private _isValid: boolean = true;

  @state()
  private isLaunched: boolean = false;

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

  createRenderRoot() {
    return this;
  }

  public getCurrentUsername(): string {
    return this.constructFullUsername();
  }

  private constructFullUsername(): string {
    if (this.clanTag.length >= 2) {
      return `[${this.clanTag}] ${this.baseUsername}`;
    }
    return this.baseUsername;
  }

  public isValid(): boolean {
    return this._isValid;
  }

  async connectedCallback() {
    super.connectedCallback();
    const stored = await this.getStoredUsername();
    this.parseAndSetUsername(stored);
    await this.ensureLaunched();
  }

  private parseAndSetUsername(fullUsername: string) {
    const tag = getClanTagOriginalCase(fullUsername);
    if (tag) {
      this.clanTag = tag.toUpperCase();
      this.baseUsername = fullUsername.replace(`[${tag}]`, "").trim();
    } else {
      this.clanTag = "";
      this.baseUsername = fullUsername;
    }
  }

  private getTranslations() {
    return {
      tagPlaceholder: translateText("username.tag"),
      usernamePlaceholder: translateText("username.enter_username"),
    };
  }

  private async ensureLaunched() {
    if (this.isLaunched) return;

    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      // Wait for mount point to be rendered
      await this.updateComplete;

      const translations = this.getTranslations();
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileUsernameInputLaunch, {
        translations,
      });

      // Give Dioxus time to mount and store the signal
      await new Promise((resolve) => requestAnimationFrame(resolve));

      this.isLaunched = true;

      // Set initial values
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileUsernameInputState,
        {
          state: {
            clanTag: this.clanTag,
            username: this.baseUsername,
          },
        },
      );

      // Listen for Dioxus events on the mount point
      const root = this.querySelector("#dioxus-username-input-root");
      if (root) {
        root.addEventListener(
          "dioxus-clan-tag-change",
          this.handleDioxusClanTagChange as EventListener,
        );
        root.addEventListener(
          "dioxus-username-change",
          this.handleDioxusUsernameChange as EventListener,
        );
      }
    } catch (err) {
      this.loading = false;
      this.error =
        err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusUsernameInput] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  private handleDioxusClanTagChange = (e: CustomEvent) => {
    const originalValue = e.detail as string;
    const val = sanitizeClanTag(originalValue);
    // Only show toast if characters were actually removed (not just uppercased)
    if (originalValue.toUpperCase() !== val) {
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("username.tag_invalid_chars"),
            color: "red",
            duration: 2000,
          },
        }),
      );
    }
    this.clanTag = val;
    // Update Dioxus with sanitized value
    this.syncClanTagToDioxus(val);
    this.validateAndStore();
  };

  private handleDioxusUsernameChange = (e: CustomEvent) => {
    const originalValue = e.detail as string;
    const val = originalValue.replace(/[[\]]/g, "");
    if (originalValue !== val) {
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("username.invalid_chars"),
            color: "red",
            duration: 2000,
          },
        }),
      );
    }
    this.baseUsername = val;
    // Update Dioxus with sanitized value
    this.syncUsernameToDioxus(val);
    this.validateAndStore();
  };

  private async syncClanTagToDioxus(val: string) {
    if (!this.isLaunched) return;
    try {
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileUsernameInputState,
        {
          state: {
            clanTag: val,
          },
        },
      );
    } catch {
      // WASM not ready
    }
  }

  private async syncUsernameToDioxus(val: string) {
    if (!this.isLaunched) return;
    try {
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileUsernameInputState,
        {
          state: {
            username: val,
          },
        },
      );
    } catch {
      // WASM not ready
    }
  }

  private validateAndStore() {
    // Prevent empty username even if clan tag is present
    if (!this.baseUsername.trim()) {
      this._isValid = false;
      this.validationError = translateText("username.too_short", {
        min: MIN_USERNAME_LENGTH,
      });
      this.syncValidationError();
      return;
    }

    // Validate clan tag if present
    if (this.clanTag.length > 0 && this.clanTag.length < 2) {
      this._isValid = false;
      this.validationError = translateText("username.tag_too_short");
      this.syncValidationError();
      return;
    }

    const full = this.constructFullUsername();
    const trimmedFull = full.trim();

    const result = validateUsername(trimmedFull);
    this._isValid = result.isValid;
    if (result.isValid) {
      void this.storeUsername(trimmedFull);
      this.validationError = "";
    } else {
      this.validationError = result.error ?? "";
    }
    this.syncValidationError();
  }

  private async syncValidationError() {
    if (!this.isLaunched) return;
    try {
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileUsernameInputState,
        {
          state: {
            validationError: this.validationError,
          },
        },
      );
    } catch {
      // WASM not ready
    }
  }

  private async getStoredUsername(): Promise<string> {
    const storedUsername = await readUiSessionStorage(usernameKey);
    if (typeof storedUsername === "string" && storedUsername.length > 0) {
      return storedUsername;
    }
    return this.generateNewUsername();
  }

  private async storeUsername(username: string): Promise<void> {
    if (username) {
      await writeUiSessionStorage(usernameKey, username);
    }
  }

  private async generateNewUsername(): Promise<string> {
    const newUsername = "Anon" + this.uuidToThreeDigits();
    await this.storeUsername(newUsername);
    return newUsername;
  }

  private uuidToThreeDigits(): string {
    const uuid = uuidv4();
    const cleanUuid = uuid.replace(/-/g, "").toLowerCase();
    const decimal = BigInt(`0x${cleanUuid}`);
    const threeDigits = decimal % 1000n;
    return threeDigits.toString().padStart(3, "0");
  }

  updated(_changedProperties: Map<string | number | symbol, unknown>) {
    if (this.isLaunched) {
      const translations = this.getTranslations();
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileUsernameInputState,
        {
          state: {
            translations,
          },
        },
      );
    }
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-username-input-root"
        class="w-full h-full"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

// Export as UsernameInput for backward compatibility with existing imports
export { DioxusUsernameInput as UsernameInput };

declare global {
  interface HTMLElementTagNameMap {
    "username-input": DioxusUsernameInput;
  }
}

interface DioxusStatsState {
  isVisible: boolean;
  isLoading: boolean;
  error: string | null;
  dateRange: string | null;
  sortBy: string;
  sortOrder: string;
  clans: DioxusClanEntry[];
}

interface DioxusClanEntry {
  clanTag: string;
  games: number;
  weightedWins: number;
  weightedLosses: number;
  weightedWLRatio: number;
}

interface DioxusStatsTranslations {
  clanStats: string;
  loading: string;
  errorText: string;
  tryAgain: string;
  noDataYet: string;
  noStats: string;
  rank: string;
  clan: string;
  games: string;
  winScore: string;
  winScoreTooltip: string;
  lossScore: string;
  lossScoreTooltip: string;
  winLossRatio: string;
  ratio: string;
  close: string;
}

@customElement("dioxus-stats-modal")
export class DioxusStatsModal extends LitElement {
  @state() private isVisible = false;
  @state() private isLoading = false;
  @state() private error: string | null = null;
  @state() private loading = false;
  @state() private wasmError: string | null = null;

  private data: ClanLeaderboardResponse | null = null;
  private sortBy: "rank" | "games" | "wins" | "losses" | "ratio" = "rank";
  private sortOrder: "asc" | "desc" = "asc";
  private hasLoaded = false;
  private isWasmLaunched = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void ensureUiSessionRuntimeStarted();
    document.addEventListener("dioxus-stats-modal-close", this.handleClose);
    document.addEventListener("dioxus-stats-modal-sort", this.handleSort);
    document.addEventListener("dioxus-stats-modal-retry", this.handleRetry);
    window.addEventListener(
      UI_API_RUNTIME_EVENTS.statsLoading,
      this.handleRuntimeLoading as EventListener,
    );
    window.addEventListener(
      UI_API_RUNTIME_EVENTS.statsSuccess,
      this.handleRuntimeSuccess as EventListener,
    );
    window.addEventListener(
      UI_API_RUNTIME_EVENTS.statsError,
      this.handleRuntimeError as EventListener,
    );
    window.addEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
    void ensureUiApiReadRuntimeStarted();
    this.launchDioxus();
  }

  disconnectedCallback() {
    if (this.isVisible) {
      reportUiModalState(SESSION_MODAL_IDS.stats, false);
    }
    document.removeEventListener("dioxus-stats-modal-close", this.handleClose);
    document.removeEventListener("dioxus-stats-modal-sort", this.handleSort);
    document.removeEventListener("dioxus-stats-modal-retry", this.handleRetry);
    window.removeEventListener(
      UI_API_RUNTIME_EVENTS.statsLoading,
      this.handleRuntimeLoading as EventListener,
    );
    window.removeEventListener(
      UI_API_RUNTIME_EVENTS.statsSuccess,
      this.handleRuntimeSuccess as EventListener,
    );
    window.removeEventListener(
      UI_API_RUNTIME_EVENTS.statsError,
      this.handleRuntimeError as EventListener,
    );
    window.removeEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
    super.disconnectedCallback();
  }

  private handleSessionModalClose = (
    event: CustomEvent<UiSessionModalCloseDetail>,
  ) => {
    if (!this.isVisible || event.detail?.modal !== SESSION_MODAL_IDS.stats) {
      return;
    }
    this.closeModal();
  };

  private handleClose = () => {
    requestUiModalClose(SESSION_MODAL_IDS.stats, "component");
  };

  private handleSort = (event: Event) => {
    const column = (event as CustomEvent<string>).detail as
      | "games"
      | "wins"
      | "losses"
      | "ratio";
    if (this.sortBy === column) {
      this.sortOrder = this.sortOrder === "asc" ? "desc" : "asc";
    } else {
      this.sortBy = column;
      this.sortOrder = "desc";
    }
    this.pushStateToWasm();
  };

  private handleRetry = () => {
    void requestStatsRead("retry");
  };

  private handleRuntimeLoading = () => {
    this.isLoading = true;
    this.error = null;
    this.pushStateToWasm();
  };

  private handleRuntimeSuccess = (event: Event) => {
    const detail = (event as CustomEvent<UiApiStatsSuccessDetail>).detail;
    this.data = detail.data;
    this.error = null;
    this.hasLoaded = true;
    this.isLoading = false;
    this.pushStateToWasm();
  };

  private handleRuntimeError = (event: Event) => {
    const detail = (event as CustomEvent<UiApiReadErrorDetail>).detail;
    console.warn("StatsModal: runtime read failed", detail.message);
    this.error = detail.message.includes("unavailable")
      ? detail.message
      : translateText("stats_modal.error");
    this.isLoading = false;
    this.pushStateToWasm();
  };

  private getTranslations(): DioxusStatsTranslations {
    return {
      clanStats: translateText("stats_modal.clan_stats"),
      loading: translateText("stats_modal.loading"),
      errorText: translateText("stats_modal.error"),
      tryAgain: translateText("stats_modal.try_again"),
      noDataYet: translateText("stats_modal.no_data_yet"),
      noStats: translateText("stats_modal.no_stats"),
      rank: translateText("stats_modal.rank"),
      clan: translateText("stats_modal.clan"),
      games: translateText("stats_modal.games"),
      winScore: translateText("stats_modal.win_score"),
      winScoreTooltip: translateText("stats_modal.win_score_tooltip"),
      lossScore: translateText("stats_modal.loss_score"),
      lossScoreTooltip: translateText("stats_modal.loss_score_tooltip"),
      winLossRatio: translateText("stats_modal.win_loss_ratio"),
      ratio: translateText("stats_modal.ratio"),
      close: translateText("common.close"),
    };
  }

  private getSortedClans(): DioxusClanEntry[] {
    if (!this.data) return [];

    const clans = [...this.data.clans];
    clans.sort((a, b) => {
      let aVal: number;
      let bVal: number;

      switch (this.sortBy) {
        case "games":
          aVal = a.games;
          bVal = b.games;
          break;
        case "wins":
          aVal = a.weightedWins;
          bVal = b.weightedWins;
          break;
        case "losses":
          aVal = a.weightedLosses;
          bVal = b.weightedLosses;
          break;
        case "ratio":
          aVal = a.weightedWLRatio;
          bVal = b.weightedWLRatio;
          break;
        case "rank":
        default:
          return 0;
      }
      return this.sortOrder === "asc" ? aVal - bVal : bVal - aVal;
    });

    return clans.map((c) => ({
      clanTag: c.clanTag,
      games: c.games,
      weightedWins: c.weightedWins,
      weightedLosses: c.weightedLosses,
      weightedWLRatio: c.weightedWLRatio,
    }));
  }

  private buildState(): DioxusStatsState {
    let dateRange: string | null = null;
    if (this.data) {
      const start = new Date(this.data.start).toLocaleDateString();
      const end = new Date(this.data.end).toLocaleDateString();
      dateRange = `${start} - ${end}`;
    }

    return {
      isVisible: this.isVisible,
      isLoading: this.isLoading,
      error: this.error,
      dateRange,
      sortBy: this.sortBy,
      sortOrder: this.sortOrder,
      clans: this.getSortedClans(),
    };
  }

  private async launchDioxus() {
    try {
      this.loading = true;
      this.wasmError = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();
      await this.updateComplete;

      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileStatsModalLaunch, {
        state: this.buildState(),
        translations: this.getTranslations(),
      });

      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isWasmLaunched = true;
    } catch (err) {
      this.loading = false;
      this.wasmError =
        err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusStatsModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  private pushStateToWasm() {
    if (!this.isWasmLaunched) return;
    try {
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileStatsModalState,
        {
          state: this.buildState(),
        },
      );
    } catch (e) {
      console.warn("[DioxusStatsModal] Failed to update state:", e);
    }
  }

  public open() {
    void ensureUiSessionRuntimeStarted();
    this.isVisible = true;
    reportUiModalState(SESSION_MODAL_IDS.stats, true);
    if (!this.hasLoaded && !this.isLoading) {
      void requestStatsRead("open");
    }
    this.pushStateToWasm();
  }

  public close() {
    this.closeModal();
  }

  private closeModal() {
    reportUiModalState(SESSION_MODAL_IDS.stats, false);
    this.isVisible = false;
    this.pushStateToWasm();
    this.requestUpdate();
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.wasmError) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.wasmError}</div>
      `;
    }

    return html`
      <div
        id="dioxus-stats-modal-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

interface DioxusGameInfoState {
  isVisible: boolean;
  isLoading: boolean;
  rankType: string;
  mapImage: string | null;
  gameMode: string;
  gameMap: string;
  duration: string;
  playerCount: number;
  hasUnusualThumbnail: boolean;
  currentUsername: string | null;
  players: DioxusPlayerInfo[];
}

interface DioxusPlayerInfo {
  id: string;
  rawUsername: string;
  username: string;
  tag: string | null;
  killedAt: number | null;
  conquests: number;
  flag: string | null;
  winner: boolean;
  atoms: number;
  hydros: number;
  mirv: number;
  score: number;
  totalGold: number;
  stolenGold: number;
  navalTrade: number;
  conqueredGold: number;
  trainTrade: number;
}

interface DioxusGameInfoTranslations {
  title: string;
  noWinner: string;
  loading: string;
  playersLabel: string;
  durationLabel: string;
  war: string;
  economy: string;
  bombs: string;
  conquests: string;
  trade: string;
  pirate: string;
  conquered: string;
  totalGold: string;
  survivalTime: string;
  numOfConquests: string;
  atoms: string;
  hydros: string;
  mirvLabel: string;
  allGold: string;
  trainTrade: string;
  navalTrade: string;
  conquestGold: string;
  stolenGold: string;
  close: string;
}

@customElement("dioxus-game-info-modal")
export class DioxusGameInfoModal extends LitElement {
  @state() private isVisible = false;
  @state() private isLoading = true;
  @state() private loading = false;
  @state() private error: string | null = null;

  private gameInfo: GameEndInfo | null = null;
  private ranking: Ranking | null = null;
  private rankType: RankType = RankType.Lifetime;
  private rankedPlayers: PlayerInfo[] = [];
  private mapImage: string | null = null;
  private username: string | null = null;
  private isWasmLaunched = false;
  private currentGameId: string | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void ensureUiSessionRuntimeStarted();
    document.addEventListener("dioxus-game-info-close", this.handleClose);
    document.addEventListener("dioxus-game-info-sort", this.handleSort);
    window.addEventListener(
      UI_API_RUNTIME_EVENTS.gameInfoLoading,
      this.handleRuntimeLoading as EventListener,
    );
    window.addEventListener(
      UI_API_RUNTIME_EVENTS.gameInfoSuccess,
      this.handleRuntimeSuccess as EventListener,
    );
    window.addEventListener(
      UI_API_RUNTIME_EVENTS.gameInfoError,
      this.handleRuntimeError as EventListener,
    );
    window.addEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
    void ensureUiApiReadRuntimeStarted();
    this.launchDioxus();
  }

  disconnectedCallback() {
    if (this.isVisible) {
      reportUiModalState(SESSION_MODAL_IDS.gameInfo, false);
    }
    document.removeEventListener("dioxus-game-info-close", this.handleClose);
    document.removeEventListener("dioxus-game-info-sort", this.handleSort);
    window.removeEventListener(
      UI_API_RUNTIME_EVENTS.gameInfoLoading,
      this.handleRuntimeLoading as EventListener,
    );
    window.removeEventListener(
      UI_API_RUNTIME_EVENTS.gameInfoSuccess,
      this.handleRuntimeSuccess as EventListener,
    );
    window.removeEventListener(
      UI_API_RUNTIME_EVENTS.gameInfoError,
      this.handleRuntimeError as EventListener,
    );
    window.removeEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
    super.disconnectedCallback();
  }

  private handleSessionModalClose = (
    event: CustomEvent<UiSessionModalCloseDetail>,
  ) => {
    if (!this.isVisible || event.detail?.modal !== SESSION_MODAL_IDS.gameInfo) {
      return;
    }
    this.closeModal();
  };

  private handleClose = () => {
    requestUiModalClose(
      SESSION_MODAL_IDS.gameInfo,
      "component",
    );
  };

  private handleSort = (event: Event) => {
    const detail = (event as CustomEvent<string>).detail;
    this.rankType = detail as RankType;
    this.updateRanking();
    this.pushStateToWasm();
  };

  private handleRuntimeLoading = (event: Event) => {
    const detail = (event as CustomEvent<UiApiReadLoadingDetail>).detail;
    if (!this.currentGameId || detail.gameId !== this.currentGameId) {
      return;
    }

    this.isLoading = true;
    this.pushStateToWasm();
  };

  private handleRuntimeSuccess = (event: Event) => {
    const detail = (event as CustomEvent<UiApiGameInfoSuccessDetail>).detail;
    if (!this.currentGameId || detail.gameId !== this.currentGameId) {
      return;
    }

    this.gameInfo = detail.session.info;
    this.ranking = new Ranking(detail.session);
    this.updateRanking();
    this.isLoading = false;
    this.pushStateToWasm();
    void this.loadMapImage(detail.session.info.config.gameMap);
  };

  private handleRuntimeError = (event: Event) => {
    const detail = (event as CustomEvent<UiApiReadErrorDetail>).detail;
    if (!this.currentGameId || detail.gameId !== this.currentGameId) {
      return;
    }

    console.warn("[DioxusGameInfoModal] Runtime load failed:", detail.message);
    this.isLoading = false;
    this.pushStateToWasm();
  };

  private updateRanking() {
    if (this.ranking) {
      this.rankedPlayers = this.ranking.sortedBy(this.rankType);
    }
  }

  private getTranslations(): DioxusGameInfoTranslations {
    return {
      title: translateText("game_info_modal.title"),
      noWinner: translateText("game_info_modal.no_winner"),
      loading: translateText("game_info_modal.loading_game_info"),
      playersLabel: translateText("game_info_modal.players"),
      durationLabel: translateText("game_info_modal.duration"),
      war: translateText("game_info_modal.war"),
      economy: translateText("game_info_modal.economy"),
      bombs: translateText("game_info_modal.bombs"),
      conquests: translateText("game_info_modal.conquests"),
      trade: translateText("game_info_modal.trade"),
      pirate: translateText("game_info_modal.pirate"),
      conquered: translateText("game_info_modal.conquered"),
      totalGold: translateText("game_info_modal.total_gold"),
      survivalTime: translateText("game_info_modal.survival_time"),
      numOfConquests: translateText("game_info_modal.num_of_conquests"),
      atoms: translateText("game_info_modal.atoms"),
      hydros: translateText("game_info_modal.hydros"),
      mirvLabel: translateText("game_info_modal.mirv"),
      allGold: translateText("game_info_modal.all_gold"),
      trainTrade: translateText("game_info_modal.train_trade"),
      navalTrade: translateText("game_info_modal.naval_trade"),
      conquestGold: translateText("game_info_modal.conquest_gold"),
      stolenGold: translateText("game_info_modal.stolen_gold"),
      close: translateText("common.close"),
    };
  }

  private buildState(): DioxusGameInfoState {
    const info = this.gameInfo;
    return {
      isVisible: this.isVisible,
      isLoading: this.isLoading,
      rankType: this.rankType,
      mapImage: this.mapImage,
      gameMode: info?.config?.gameMode ?? "",
      gameMap: info?.config?.gameMap ?? "",
      duration: info ? renderDuration(info.duration) : "",
      playerCount: info?.players?.length ?? 0,
      hasUnusualThumbnail: info
        ? hasUnusualThumbnailSize(info.config.gameMap)
        : false,
      currentUsername: this.username,
      players: this.rankedPlayers.map((p) => this.mapPlayer(p)),
    };
  }

  private mapPlayer(p: PlayerInfo): DioxusPlayerInfo {
    const score = this.ranking?.score(p, this.rankType) ?? 0;
    return {
      id: p.id,
      rawUsername: p.rawUsername,
      username: p.username,
      tag: p.tag ?? null,
      killedAt: p.killedAt ?? null,
      conquests: p.conquests,
      flag: p.flag ?? null,
      winner: p.winner,
      atoms: p.atoms,
      hydros: p.hydros,
      mirv: p.mirv,
      score,
      totalGold: Number(p.gold.reduce((sum, g) => sum + g, 0n)),
      stolenGold: Number(p.gold[GOLD_INDEX_STEAL] ?? 0n),
      navalTrade: Number(p.gold[GOLD_INDEX_TRADE] ?? 0n),
      conqueredGold: Number(p.gold[GOLD_INDEX_WAR] ?? 0n),
      trainTrade: Number(
        (p.gold[GOLD_INDEX_TRAIN_SELF] ?? 0n) +
          (p.gold[GOLD_INDEX_TRAIN_OTHER] ?? 0n),
      ),
    };
  }

  private async launchDioxus() {
    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();
      await this.updateComplete;

      dispatchProfileRuntimeAction(
        UI_RUNTIME_ACTIONS.uiProfileGameInfoModalLaunch,
        {
          state: this.buildState(),
          translations: this.getTranslations(),
        },
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isWasmLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error = err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusGameInfoModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  private pushStateToWasm() {
    if (!this.isWasmLaunched) return;
    try {
      dispatchProfileRuntimeSnapshot(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileGameInfoModalState,
        {
          state: this.buildState(),
        },
      );
    } catch (e) {
      console.warn("[DioxusGameInfoModal] Failed to update state:", e);
    }
  }

  public open() {
    void ensureUiSessionRuntimeStarted();
    this.isVisible = true;
    reportUiModalState(SESSION_MODAL_IDS.gameInfo, true);
    this.requestUpdate();
    this.pushStateToWasm();
  }

  public close() {
    this.closeModal();
  }

  private closeModal() {
    reportUiModalState(SESSION_MODAL_IDS.gameInfo, false);
    this.isVisible = false;
    this.requestUpdate();
    if (this.isWasmLaunched) {
      dispatchProfileRuntimeAction(UI_RUNTIME_ACTIONS.uiProfileGameInfoModalHide);
    }
  }

  public loadUserName() {
    const usernameInput = document.querySelector(
      "username-input",
    ) as DioxusUsernameInput | null;
    if (usernameInput) {
      this.username = usernameInput.getCurrentUsername();
    }
  }

  public async loadGame(gameId: string) {
    this.currentGameId = gameId;
    this.isLoading = true;
    this.mapImage = null;
    this.pushStateToWasm();
    this.loadUserName();
    await requestGameInfoRead(gameId, "open");
  }

  private async loadMapImage(gameMap: string) {
    try {
      const mapType = gameMap as GameMapType;
      const data = terrainMapFileLoader.getMapData(mapType);
      this.mapImage = await data.webpPath();
      this.pushStateToWasm();
    } catch (error) {
      console.error("[DioxusGameInfoModal] Failed to load map image:", error);
    }
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-game-info-modal-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-stats-modal": DioxusStatsModal;
    "dioxus-game-info-modal": DioxusGameInfoModal;
  }
}
