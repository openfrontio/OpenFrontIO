import { html, TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import {
  calculateServerTimeOffset,
  getMapName,
  getSecondsUntilServerTimestamp,
  getServerNow,
  renderDuration,
  translateText,
} from "../client/Utils";
import { assetUrl } from "../core/AssetUrls";
import { EventBus } from "../core/EventBus";
import {
  ClientInfo,
  GAME_ID_REGEX,
  GameConfig,
  GameInfo,
  GameRecordSchema,
  LobbyInfoEvent,
  PublicGameInfo,
} from "../core/Schemas";
import { getRuntimeClientServerConfig } from "../core/configuration/ConfigLoader";
import {
  Difficulty,
  GameMapSize,
  GameMode,
  GameType,
  HumansVsNations,
} from "../core/game/Game";
import { getApiBase } from "./Api";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { JoinLobbyEvent } from "./Main";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { normaliseMapKey } from "./Utils";
import { BaseModal } from "./components/BaseModal";
import "./components/CopyButton";
import "./components/LobbyConfigItem";
import "./components/LobbyPlayerView";
import { modalHeader } from "./components/ui/ModalHeader";
import { nationsConfigToSlider } from "./utilities/GameConfigHelpers";

@customElement("join-lobby-modal")
export class JoinLobbyModal extends BaseModal {
  @query("#lobbyIdInput") private lobbyIdInput!: HTMLInputElement;

  @property({ attribute: false }) eventBus: EventBus | null = null;

  @state() private players: ClientInfo[] = [];
  @state() private playerCount: number = 0;
  @state() private gameConfig: GameConfig | null = null;
  @state() private currentLobbyId: string = "";
  @state() private currentClientID: string = "";
  @state() private nationCount: number = 0;
  @state() private lobbyStartAt: number | null = null;
  @state() private serverTimeOffset: number = 0;
  @state() private isConnecting: boolean = true;
  @state() private lobbyCreatorClientID: string | null = null;

  private leaveLobbyOnClose = true;
  private countdownTimerId: number | null = null;
  private handledJoinTimeout = false;

  private isPrivateLobby(): boolean {
    return this.gameConfig?.gameType === GameType.Private;
  }

  private readonly handleLobbyInfo = (event: LobbyInfoEvent) => {
    const lobby = event.lobby;
    this.currentClientID = event.myClientID;
    // Only stop showing spinner when we have player info
    if (this.isConnecting && lobby.clients) {
      this.isConnecting = false;
    }
    this.updateFromLobby({
      ...lobby,
      startsAt: lobby.startsAt ?? undefined,
    });
  };

  render() {
    // Pre-join state: show lobby ID input form
    if (!this.currentLobbyId) {
      return this.renderJoinForm();
    }

    // Post-join state: show lobby info (identical for public & private)
    const secondsRemaining =
      this.lobbyStartAt !== null
        ? getSecondsUntilServerTimestamp(
            this.lobbyStartAt,
            this.serverTimeOffset,
          )
        : null;
    const statusLabel =
      secondsRemaining === null
        ? translateText("public_lobby.waiting_for_players")
        : secondsRemaining > 0
          ? translateText("public_lobby.starting_in", {
              time: renderDuration(secondsRemaining),
            })
          : translateText("public_lobby.started");
    const maxPlayers = this.gameConfig?.maxPlayers ?? 0;
    const playerCount = this.players?.length ?? 0;
    const hostClientID = this.isPrivateLobby()
      ? (this.lobbyCreatorClientID ?? "")
      : "";
    const content = html`
      <div class="${this.modalContainerClass}">
        ${modalHeader({
          title: translateText("public_lobby.title"),
          onBack: () => this.closeAndLeave(),
          ariaLabel: translateText("common.close"),
          rightContent:
            this.currentLobbyId && this.isPrivateLobby()
              ? html`
                  <copy-button .lobbyId=${this.currentLobbyId}></copy-button>
                `
              : undefined,
        })}
        <div class="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4 mr-1">
          ${this.isConnecting
            ? html`
                <div
                  class="min-h-[240px] flex flex-col items-center justify-center gap-4"
                >
                  <div
                    class="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin"
                  ></div>
                  <p class="text-center text-white/80 text-sm">
                    ${translateText("public_lobby.connecting")}
                  </p>
                </div>
              `
            : html`
                ${this.gameConfig ? this.renderGameConfig() : html``}
                ${this.players.length > 0
                  ? html`
                      <lobby-player-view
                        class="mt-6"
                        .gameMode=${this.gameConfig?.gameMode ?? GameMode.FFA}
                        .clients=${this.players}
                        .lobbyCreatorClientID=${hostClientID}
                        .currentClientID=${this.currentClientID}
                        .teamCount=${this.gameConfig?.playerTeams ?? 2}
                        .isPublicGame=${this.gameConfig?.gameType ===
                        GameType.Public}
                        .nationCount=${nationsConfigToSlider(
                          this.gameConfig?.nations ?? "default",
                          this.nationCount,
                        )}
                      ></lobby-player-view>
                    `
                  : ""}
              `}
        </div>

        ${this.isPrivateLobby()
          ? html`
              <div
                class="p-6 lg:p-6 border-t border-white/10 bg-black/20 shrink-0"
              >
                <button
                  class="w-full py-4 text-sm font-bold text-white uppercase tracking-widest bg-malibu-blue hover:bg-aquarius disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all shadow-lg shadow-sky-900/20 hover:shadow-sky-900/40 hover:-translate-y-0.5 active:translate-y-0 disabled:transform-none"
                  disabled
                >
                  ${translateText("private_lobby.joined_waiting")}
                </button>
              </div>
            `
          : html`
              <div
                class="p-6 lg:p-6 border-t border-white/10 bg-black/20 shrink-0"
              >
                <div
                  class="w-full px-4 py-3 rounded-xl border border-white/10 bg-white/5 flex items-center justify-between gap-3"
                >
                  <div class="flex flex-col">
                    <span
                      class="text-[10px] font-bold uppercase tracking-widest text-white/40"
                      >${translateText("public_lobby.status")}</span
                    >
                    <span class="text-sm font-bold text-white"
                      >${statusLabel}</span
                    >
                  </div>
                  ${maxPlayers > 0
                    ? html`
                        <div
                          class="flex items-center gap-2 text-white/80 text-xs font-bold uppercase tracking-widest"
                        >
                          <span>${playerCount}/${maxPlayers}</span>
                          <svg
                            class="w-4 h-4 text-white"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.972 0 004 15v3H1v-3a3 3 0 013.75-2.906z"
                            ></path>
                          </svg>
                        </div>
                      `
                    : html``}
                </div>
              </div>
            `}
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        ?hideHeader=${true}
        ?hideCloseButton=${true}
        ?inline=${this.inline}
      >
        ${content}
      </o-modal>
    `;
  }

  private renderJoinForm() {
    const content = html`
      <div class="${this.modalContainerClass}">
        ${modalHeader({
          title: translateText("private_lobby.title"),
          onBack: () => this.closeAndLeave(),
          ariaLabel: translateText("common.close"),
        })}
        <form @submit=${this.joinLobbyFromInput} class="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4 mr-1">
          <div class="flex flex-col gap-3">
            <div class="flex gap-2">
              <input
                type="text"
                id="lobbyIdInput"
                placeholder=${translateText("private_lobby.enter_id")}
                @keyup=${this.handleChange}
                class="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-mono text-sm tracking-wider"
              />
              <o-button
                variant="ghost"
                size="md"
                iconPosition="only"
                .title=${translateText("common.paste")}
                .icon=${html`<svg
                  stroke="currentColor"
                  fill="currentColor"
                  stroke-width="0"
                  viewBox="0 0 32 32"
                  height="18px"
                  width="18px"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M 15 3 C 13.742188 3 12.847656 3.890625 12.40625 5 L 5 5 L 5 28 L 13 28 L 13 30 L 27 30 L 27 14 L 25 14 L 25 5 L 17.59375 5 C 17.152344 3.890625 16.257813 3 15 3 Z M 15 5 C 15.554688 5 16 5.445313 16 6 L 16 7 L 19 7 L 19 9 L 11 9 L 11 7 L 14 7 L 14 6 C 14 5.445313 14.445313 5 15 5 Z M 7 7 L 9 7 L 9 11 L 21 11 L 21 7 L 23 7 L 23 14 L 13 14 L 13 26 L 7 26 Z M 15 16 L 25 16 L 25 28 L 15 28 Z"
                  ></path>
                </svg>`}
                @click=${this.pasteFromClipboard}
              ></o-button>
            </div>
            <o-button
              title=${translateText("private_lobby.join_lobby")}
              width="block"
              submit
            ></o-button>
          </div>
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        ?hideHeader=${true}
        ?hideCloseButton=${true}
        ?inline=${this.inline}
      >
        ${content}
      </o-modal>
    `;
  }

  public open(lobbyId: string = "", lobbyInfo?: GameInfo | PublicGameInfo) {
    super.open();
    if (lobbyId) {
      this.startTrackingLobby(lobbyId, lobbyInfo);
      // If opened with lobbyId but no lobbyInfo (URL join case), auto-join the lobby
      if (!lobbyInfo) {
        this.handleUrlJoin(lobbyId);
      }
    }
  }

  private async handleUrlJoin(lobbyId: string): Promise<void> {
    try {
      const gameExists = await this.checkActiveLobby(lobbyId);
      if (gameExists) return;

      // Active lobby not found, check if it's an archived game
      switch (await this.checkArchivedGame(lobbyId)) {
        case "success":
          return;
        case "not_found":
          this.resetTrackingState();
          this.showMessage(translateText("private_lobby.not_found"), "red");
          return;
        case "version_mismatch":
          this.resetTrackingState();
          this.showMessage(
            translateText("private_lobby.version_mismatch"),
            "red",
          );
          return;
        case "error":
          this.resetTrackingState();
          this.showMessage(translateText("private_lobby.error"), "red");
          return;
      }
    } catch (error) {
      console.error("Error checking lobby from URL:", error);
      this.resetTrackingState();
      this.showMessage(translateText("private_lobby.error"), "red");
    }
  }

  private startTrackingLobby(
    lobbyId: string,
    lobbyInfo?: GameInfo | PublicGameInfo,
  ) {
    this.currentLobbyId = lobbyId;
    // clientID will be assigned by server via lobby_info message
    this.currentClientID = "";
    this.gameConfig = null;
    this.players = [];
    this.nationCount = 0;
    this.lobbyStartAt = null;
    this.serverTimeOffset = 0;
    this.lobbyCreatorClientID = null;
    this.isConnecting = true;
    this.handledJoinTimeout = false;
    this.startLobbyUpdates();
    if (lobbyInfo) {
      this.updateFromLobby(lobbyInfo);
      // Only stop showing spinner when we have player info
      if ("clients" in lobbyInfo && lobbyInfo.clients) {
        this.isConnecting = false;
      }
    }
  }

  private resetTrackingState() {
    this.stopLobbyUpdates();
    this.currentLobbyId = "";
    this.currentClientID = "";
    this.isConnecting = false;
  }

  private leaveLobby() {
    if (!this.currentLobbyId) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("leave-lobby", {
        detail: { lobby: this.currentLobbyId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  public confirmBeforeClose(): boolean {
    if (!this.currentLobbyId) return true;
    return confirm(translateText("host_modal.leave_confirmation"));
  }

  protected onClose(): void {
    this.clearCountdownTimer();
    this.stopLobbyUpdates();

    if (this.leaveLobbyOnClose) {
      this.leaveLobby();
      this.updateHistory("/");
    }

    if (this.lobbyIdInput) this.lobbyIdInput.value = "";
    this.gameConfig = null;
    this.players = [];
    this.currentLobbyId = "";
    this.currentClientID = "";
    this.nationCount = 0;
    this.lobbyStartAt = null;
    this.serverTimeOffset = 0;
    this.lobbyCreatorClientID = null;
    this.isConnecting = true;
    this.leaveLobbyOnClose = true;
  }

  disconnectedCallback() {
    this.clearCountdownTimer();
    this.stopLobbyUpdates();
    super.disconnectedCallback();
  }

  public closeAndLeave() {
    this.leaveLobby();
    try {
      this.updateHistory("/");
    } catch (error) {
      console.warn("Failed to restore URL on leave:", error);
    }
    this.leaveLobbyOnClose = false;
    this.close();
  }

  public closeWithoutLeaving() {
    this.leaveLobbyOnClose = false;
    this.close();
  }

  private updateHistory(url: string): void {
    if (!crazyGamesSDK.isOnCrazyGames()) {
      history.replaceState(null, "", url);
    }
  }

  // --- Game config rendering ---

  private renderGameConfig(): TemplateResult {
    if (!this.gameConfig) return html``;

    const c = this.gameConfig;
    const mapName = getMapName(c.gameMap);
    const normalizedMap = normaliseMapKey(c.gameMap);
    const thumbnailUrl = assetUrl(
      `maps/${encodeURIComponent(normalizedMap)}/thumbnail.webp`,
    );
    const isTeam = c.gameMode === GameMode.Team;

    let modeSubtitle: string;
    if (!isTeam) {
      modeSubtitle = translateText("game_mode.ffa");
    } else if (c.playerTeams === HumansVsNations) {
      modeSubtitle = translateText("host_modal.teams_Humans Vs Nations");
    } else if (typeof c.playerTeams === "string") {
      modeSubtitle = translateText("host_modal.teams_" + c.playerTeams);
    } else if (typeof c.playerTeams === "number") {
      modeSubtitle = translateText("public_lobby.teams", {
        num: c.playerTeams,
      });
    } else {
      modeSubtitle = translateText("game_mode.ffa");
    }

    const pm = c.publicGameModifiers;
    const cards: TemplateResult[] = [];
    if (pm?.isCrowded)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.crowded")}
          .value=${translateText("common.enabled")}
        ></lobby-config-item>`,
      );
    if (
      pm?.isHardNations ||
      (c.gameType === GameType.Private && c.difficulty !== Difficulty.Easy)
    )
      cards.push(
        html`<lobby-config-item
          .label=${translateText("difficulty.difficulty")}
          .value=${translateText(`difficulty.${c.difficulty.toLowerCase()}`)}
        ></lobby-config-item>`,
      );
    if (c.infiniteTroops)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.infinite_troops")}
          .value=${translateText("common.enabled")}
        ></lobby-config-item>`,
      );
    if (c.infiniteGold)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.infinite_gold")}
          .value=${translateText("common.enabled")}
        ></lobby-config-item>`,
      );
    if (c.instantBuild)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.instant_build")}
          .value=${translateText("common.enabled")}
        ></lobby-config-item>`,
      );
    if (c.randomSpawn)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.random_spawn")}
          .value=${translateText("common.enabled")}
        ></lobby-config-item>`,
      );
    if (c.maxTimerValue)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("private_lobby.game_length")}
          .value=${`${c.maxTimerValue} min`}
        ></lobby-config-item>`,
      );
    if (
      c.spawnImmunityDuration &&
      Math.round(c.spawnImmunityDuration / 10) !== 5
    ) {
      const totalSeconds = Math.round(c.spawnImmunityDuration / 10);
      const immunityValue =
        totalSeconds < 60
          ? `${totalSeconds}s`
          : totalSeconds % 60 > 0
            ? `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`
            : `${Math.floor(totalSeconds / 60)} min`;
      cards.push(
        html`<lobby-config-item
          .label=${translateText("private_lobby.pvp_immunity")}
          .value=${immunityValue}
        ></lobby-config-item>`,
      );
    }
    if (c.startingGold)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("private_lobby.starting_gold")}
          .value=${`${parseFloat((c.startingGold / 1_000_000).toPrecision(12))}M`}
        ></lobby-config-item>`,
      );
    if (c.goldMultiplier)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.gold_multiplier")}
          .value=${`x${c.goldMultiplier}`}
        ></lobby-config-item>`,
      );
    if (c.disableAlliances)
      cards.push(
        html`<lobby-config-item
          .label=${translateText(
            "public_game_modifier.disable_alliances_label",
          )}
          .value=${translateText("common.disabled")}
        ></lobby-config-item>`,
      );
    if (c.waterNukes)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("public_game_modifier.water_nukes_label")}
          .value=${translateText("common.enabled")}
        ></lobby-config-item>`,
      );
    if ((isTeam && !c.donateGold) || (!isTeam && c.donateGold))
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.donate_gold")}
          .value=${translateText(
            c.donateGold ? "common.enabled" : "common.disabled",
          )}
        ></lobby-config-item>`,
      );
    if ((isTeam && !c.donateTroops) || (!isTeam && c.donateTroops))
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.donate_troops")}
          .value=${translateText(
            c.donateTroops ? "common.enabled" : "common.disabled",
          )}
        ></lobby-config-item>`,
      );
    const isCompact =
      c.gameMapSize === GameMapSize.Compact || c.publicGameModifiers?.isCompact;
    if (isCompact)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.compact_map")}
          .value=${translateText("common.enabled")}
        ></lobby-config-item>`,
      );
    {
      const defaultBots = isCompact ? 100 : 400;
      if (c.bots !== defaultBots)
        cards.push(
          html`<lobby-config-item
            .label=${translateText("host_modal.bots")}
            .value=${String(c.bots)}
          ></lobby-config-item>`,
        );
    }
    {
      const defaultNations = isCompact
        ? Math.max(0, Math.floor(this.nationCount * 0.25))
        : this.nationCount;
      if (typeof c.nations === "number" && c.nations !== defaultNations)
        cards.push(
          html`<lobby-config-item
            .label=${translateText("host_modal.nations")}
            .value=${String(c.nations)}
          ></lobby-config-item>`,
        );
    }
    if (c.nations === "disabled" && !(c.gameType === GameType.Public && isTeam))
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.nations")}
          .value=${translateText("common.disabled")}
        ></lobby-config-item>`,
      );

    return html`
      <div class="flex items-center gap-3 mb-6">
        <img
          src=${thumbnailUrl}
          alt=${mapName ?? c.gameMap}
          class="w-20 h-20 rounded-lg object-cover border border-white/10 shrink-0"
          @error=${(e: Event) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <div class="flex flex-col gap-1">
          <span class="text-lg font-bold text-white">${mapName}</span>
          <span class="text-sm text-white/60">${modeSubtitle}</span>
        </div>
      </div>
      ${cards.length > 0
        ? html`<div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-6">
            ${cards}
          </div>`
        : html``}
      ${this.renderDisabledUnits()} ${this.renderHostCheats()}
    `;
  }

  private renderDisabledUnits(): TemplateResult {
    if (
      !this.gameConfig ||
      !this.gameConfig.disabledUnits ||
      this.gameConfig.disabledUnits.length === 0
    ) {
      return html``;
    }

    const unitKeys: Record<string, string> = {
      City: "unit_type.city",
      Port: "unit_type.port",
      "Defense Post": "unit_type.defense_post",
      "SAM Launcher": "unit_type.sam_launcher",
      "Missile Silo": "unit_type.missile_silo",
      Warship: "unit_type.warship",
      Factory: "unit_type.factory",
      "Atom Bomb": "unit_type.atom_bomb",
      "Hydrogen Bomb": "unit_type.hydrogen_bomb",
      MIRV: "unit_type.mirv",
      "Trade Ship": "player_stats_table.unit.trade",
      Transport: "player_stats_table.unit.trans",
      "MIRV Warhead": "player_stats_table.unit.mirvw",
    };

    return html`
      <div
        class="mt-4 mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-lg"
      >
        <div
          class="text-xs font-bold text-red-400 uppercase tracking-widest mb-2"
        >
          ${translateText("private_lobby.disabled_units")}
        </div>
        <div class="flex flex-wrap gap-2">
          ${this.gameConfig.disabledUnits.map((unit) => {
            const key = unitKeys[unit];
            const name = key ? translateText(key) : unit;
            return html`
              <span
                class="px-2 py-1 bg-red-500/20 text-red-200 text-xs rounded font-bold border border-red-500/30"
              >
                ${name}
              </span>
            `;
          })}
        </div>
      </div>
    `;
  }

  private renderHostCheats(): TemplateResult {
    if (!this.gameConfig?.hostCheats) {
      return html``;
    }

    const hc = this.gameConfig.hostCheats;
    const items: TemplateResult[] = [];

    if (hc.infiniteGold)
      items.push(
        html`<span
          class="px-2 py-1 bg-yellow-500/20 text-yellow-200 text-xs rounded font-bold border border-yellow-500/30"
        >
          ${translateText("host_modal.infinite_gold")}
        </span>`,
      );
    if (hc.infiniteTroops)
      items.push(
        html`<span
          class="px-2 py-1 bg-yellow-500/20 text-yellow-200 text-xs rounded font-bold border border-yellow-500/30"
        >
          ${translateText("host_modal.infinite_troops")}
        </span>`,
      );
    if (hc.goldMultiplier)
      items.push(
        html`<span
          class="px-2 py-1 bg-yellow-500/20 text-yellow-200 text-xs rounded font-bold border border-yellow-500/30"
        >
          ${translateText("host_modal.gold_multiplier")}: x${hc.goldMultiplier}
        </span>`,
      );
    if (hc.startingGold)
      items.push(
        html`<span
          class="px-2 py-1 bg-yellow-500/20 text-yellow-200 text-xs rounded font-bold border border-yellow-500/30"
        >
          ${translateText("private_lobby.starting_gold")}:
          ${parseFloat((hc.startingGold / 1_000_000).toPrecision(12))}M
        </span>`,
      );

    if (items.length === 0) return html``;

    return html`
      <div
        class="mt-4 mb-6 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg"
      >
        <div
          class="text-xs font-bold text-yellow-400 uppercase tracking-widest mb-2"
        >
          ${translateText("private_lobby.host_cheats")}
        </div>
        <div class="flex flex-wrap gap-2">${items}</div>
      </div>
    `;
  }

  // --- Lobby event handling ---

  private updateFromLobby(lobby: GameInfo | PublicGameInfo) {
    this.players = "clients" in lobby ? (lobby.clients ?? []) : [];
    if ("serverTime" in lobby && typeof lobby.serverTime === "number") {
      this.serverTimeOffset = calculateServerTimeOffset(lobby.serverTime);
    }
    this.lobbyStartAt = lobby.startsAt ?? null;
    this.syncCountdownTimer();
    if (lobby.gameConfig) {
      const mapChanged = this.gameConfig?.gameMap !== lobby.gameConfig.gameMap;
      this.gameConfig = lobby.gameConfig;
      if (mapChanged) {
        this.loadNationCount();
      }
    }

    this.lobbyCreatorClientID =
      "lobbyCreatorClientID" in lobby
        ? (lobby.lobbyCreatorClientID ?? null)
        : null;
  }

  private startLobbyUpdates() {
    this.stopLobbyUpdates();
    if (!this.eventBus) {
      console.warn(
        "JoinLobbyModal: eventBus not set, cannot subscribe to lobby updates",
      );
      return;
    }
    this.eventBus.on(LobbyInfoEvent, this.handleLobbyInfo);
  }

  private stopLobbyUpdates() {
    this.eventBus?.off(LobbyInfoEvent, this.handleLobbyInfo);
  }

  // --- Countdown timer ---

  private syncCountdownTimer() {
    if (this.lobbyStartAt === null) {
      this.clearCountdownTimer();
      return;
    }
    if (this.countdownTimerId !== null) {
      return;
    }
    this.countdownTimerId = window.setInterval(() => {
      this.checkForJoinTimeout();
      this.requestUpdate();
    }, 1000);
  }

  private clearCountdownTimer() {
    if (this.countdownTimerId === null) {
      return;
    }
    clearInterval(this.countdownTimerId);
    this.countdownTimerId = null;
  }

  private checkForJoinTimeout() {
    if (
      this.handledJoinTimeout ||
      !this.isConnecting ||
      this.lobbyStartAt === null ||
      !this.isModalOpen
    ) {
      return;
    }
    if (getServerNow(this.serverTimeOffset) < this.lobbyStartAt) {
      return;
    }
    this.handledJoinTimeout = true;
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: translateText("public_lobby.join_timeout"),
          color: "red",
          duration: 3500,
        },
      }),
    );
    this.closeAndLeave();
  }

  // --- Nation count ---

  private async loadNationCount() {
    if (!this.gameConfig) {
      this.nationCount = 0;
      return;
    }
    const currentMap = this.gameConfig.gameMap;
    try {
      const mapData = terrainMapFileLoader.getMapData(currentMap);
      const manifest = await mapData.manifest();
      if (this.gameConfig?.gameMap === currentMap) {
        this.nationCount = manifest.nations.length;
      }
    } catch (error) {
      console.warn("Failed to load nation count", error);
      if (this.gameConfig?.gameMap === currentMap) {
        this.nationCount = 0;
      }
    }
  }

  // --- Private lobby join flow (lobby ID input) ---

  private isValidLobbyId(value: string): boolean {
    return GAME_ID_REGEX.test(value);
  }

  private normalizeLobbyId(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const extracted = this.extractLobbyIdFromUrl(trimmed).trim();
    if (!this.isValidLobbyId(extracted)) return null;
    return extracted;
  }

  private sanitizeForLog(value: string): string {
    return value.replace(/[\r\n]/g, "");
  }

  private extractLobbyIdFromUrl(input: string): string {
    if (!input.startsWith("http")) {
      return input;
    }

    try {
      const url = new URL(input);
      const match = url.pathname.match(/game\/([^/]+)/);
      const candidate = match?.[1];
      if (candidate && GAME_ID_REGEX.test(candidate)) return candidate;

      return input;
    } catch (error) {
      console.warn("Failed to parse lobby URL", error);
      return input;
    }
  }

  private setLobbyId(id: string) {
    if (this.lobbyIdInput) {
      this.lobbyIdInput.value = this.extractLobbyIdFromUrl(id);
    }
  }

  private handleChange(e: Event) {
    const value = (e.target as HTMLInputElement).value.trim();
    this.setLobbyId(value);
  }

  private async pasteFromClipboard() {
    try {
      const clipText = await navigator.clipboard.readText();
      this.setLobbyId(clipText);
    } catch (err) {
      console.error("Failed to read clipboard contents: ", err);
    }
  }

  private async joinLobbyFromInput(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const lobbyId = this.normalizeLobbyId(this.lobbyIdInput.value);
    if (!lobbyId) {
      this.showMessage(translateText("private_lobby.not_found"), "red");
      return;
    }

    this.lobbyIdInput.value = lobbyId;
    console.log(`Joining lobby with ID: ${this.sanitizeForLog(lobbyId)}`);

    // Initialize tracking state before checking/joining
    this.startTrackingLobby(lobbyId);

    try {
      const gameExists = await this.checkActiveLobby(lobbyId);
      if (gameExists) return;

      switch (await this.checkArchivedGame(lobbyId)) {
        case "success":
          return;
        case "not_found":
          this.resetTrackingState();
          this.showMessage(translateText("private_lobby.not_found"), "red");
          return;
        case "version_mismatch":
          this.resetTrackingState();
          this.showMessage(
            translateText("private_lobby.version_mismatch"),
            "red",
          );
          return;
        case "error":
          this.resetTrackingState();
          this.showMessage(translateText("private_lobby.error"), "red");
          return;
      }
    } catch (error) {
      console.error("Error checking lobby existence:", error);
      this.resetTrackingState();
      this.showMessage(translateText("private_lobby.error"), "red");
    }
  }

  private showMessage(message: string, color: "green" | "red" = "green") {
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: { message, duration: 3000, color },
      }),
    );
  }

  private async checkActiveLobby(lobbyId: string): Promise<boolean> {
    const config = await getRuntimeClientServerConfig();
    const url = `/${config.workerPath(lobbyId)}/api/game/${lobbyId}/exists`;

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      return false;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return false;
    }

    let gameInfo: { exists?: boolean };
    try {
      gameInfo = await response.json();
    } catch (error) {
      console.warn("Failed to parse active lobby response", error);
      return false;
    }

    if (gameInfo.exists) {
      this.showMessage(translateText("private_lobby.joined_waiting"));

      // Use the clientID that was already set by startTrackingLobby in open()
      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: lobbyId,
            source: "private",
          } as JoinLobbyEvent,
          bubbles: true,
          composed: true,
        }),
      );

      // Event tracking is already started by open() -> startTrackingLobby()
      // LobbyInfoEvents will update the UI as they arrive
      return true;
    }

    return false;
  }

  private async checkArchivedGame(
    lobbyId: string,
  ): Promise<"success" | "not_found" | "version_mismatch" | "error"> {
    const archiveResponse = await fetch(`${getApiBase()}/game/${lobbyId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (archiveResponse.status === 404) {
      return "not_found";
    }
    if (archiveResponse.status !== 200) {
      return "error";
    }

    const archiveData = await archiveResponse.json();
    const parsed = GameRecordSchema.safeParse(archiveData);
    if (!parsed.success) {
      return "version_mismatch";
    }

    if (
      window.GIT_COMMIT !== "DEV" &&
      parsed.data.gitCommit !== window.GIT_COMMIT
    ) {
      const safeLobbyId = this.sanitizeForLog(lobbyId);
      console.warn(
        `Git commit hash mismatch for game ${safeLobbyId}`,
        archiveData.details,
      );
      return "version_mismatch";
    }

    // If the modal closes as part of joining the replay, do not leave/reset URL
    this.leaveLobbyOnClose = false;

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: lobbyId,
          gameRecord: parsed.data,
          source: "private",
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    return "success";
  }
}
