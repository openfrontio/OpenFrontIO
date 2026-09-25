import { html, TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
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
import { GameMode, GameType, HumansVsNations } from "../core/game/Game";
import { getApiBase } from "./Api";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { PublicLobbySocket } from "./LobbySocket";
import { JoinLobbyEvent } from "./Main";
import { ensureServerList, redirectToGameVersion } from "./ServerList";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { SendSpectateEvent } from "./Transport";
import { normaliseMapKey } from "./Utils";
import { isReplayShellHost, versionedReplayUrl } from "./VersionedReplay";
import { BaseModal } from "./components/BaseModal";
import "./components/CopyButton";
import { GameStartAlertController } from "./components/GameStartAlertController";
import "./components/LobbyConfigItem";
import "./components/LobbyPlayerView";
import { inviteFriendsButton } from "./components/ui/InviteFriendsButton";
import { DEFAULT_TITLE_CLASS, modalHeader } from "./components/ui/ModalHeader";
import { nationsConfigToSlider } from "./utilities/GameConfigHelpers";
import { notableLobbySettings } from "./utilities/LobbySettingsSummary";

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
  // Subscriber-hosted private lobbies listed in the public browser, shown on
  // the pre-join form.
  @state() private hostedLobbies: PublicGameInfo[] = [];
  @state() private hostedLobbiesLoaded = false;
  // Clock offset for the hosted list's countdowns, kept apart from
  // serverTimeOffset (the joined lobby's).
  private hostedServerTimeOffset = 0;
  private readonly gameStartAlert = new GameStartAlertController(
    this,
    () => this.currentLobbyId !== "",
  );

  private leaveLobbyOnClose = true;
  private countdownTimerId: number | null = null;
  private handledJoinTimeout = false;

  private readonly hostedLobbySocket = new PublicLobbySocket((lobbies) => {
    this.hostedServerTimeOffset = calculateServerTimeOffset(lobbies.serverTime);
    // Re-assigned on every broadcast (~2/s), which also keeps the row
    // countdowns ticking.
    this.hostedLobbies = lobbies.games?.hosted ?? [];
    this.hostedLobbiesLoaded = true;
  });

  private isPrivateLobby(): boolean {
    return this.gameConfig?.gameType === GameType.Private;
  }

  // Read off the server's own view of us, so a switch it refused (lobby full,
  // game already started) shows the real state instead of what was asked for.
  private get isSpectating(): boolean {
    return (
      this.players.find((p) => p.clientID === this.currentClientID)
        ?.spectator === true
    );
  }

  private setSpectating(spectator: boolean) {
    this.eventBus?.emit(new SendSpectateEvent(spectator));
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

  protected renderHeaderSlot() {
    if (!this.currentLobbyId) {
      return modalHeader({
        title: translateText("private_lobby.title"),
        onBack: () => this.closeAndLeave(),
        ariaLabel: translateText("common.close"),
      });
    }
    // Both affordances answer "get my friends into this lobby", so they sit
    // together. Copy stays private-only (the ID is how a private lobby is
    // shared); the Steam invite works for either, because the shell keeps a
    // shadow lobby for any joined game.
    const copy =
      this.currentLobbyId && this.isPrivateLobby()
        ? html`<copy-button .lobbyId=${this.currentLobbyId}></copy-button>`
        : undefined;
    // Except public FFA: inviting Steam friends into an every-man-for-himself
    // public match encourages teaming, so the button stays off there. Public
    // team lobbies and private lobbies keep it. A config that has not arrived
    // yet counts as "off" too — the URL-join and accepted-invite paths render
    // this header before the first lobby_info, and that window must not show
    // a button the config may be about to forbid.
    const isPublicFfa =
      this.gameConfig?.gameType === GameType.Public &&
      this.gameConfig.gameMode !== GameMode.Team;
    const invite =
      this.gameConfig === null || isPublicFfa
        ? undefined
        : inviteFriendsButton();
    return modalHeader({
      // titleContent (not title) so the bell can sit at the right edge of the
      // title row via ml-auto, next to the copy/invite cluster.
      titleContent: html`<span class="${DEFAULT_TITLE_CLASS}"
          >${translateText("public_lobby.title")}</span
        >
        ${this.gameStartAlert.renderBell()}`,
      onBack: () => this.closeAndLeave(),
      ariaLabel: translateText("common.close"),
      // Only pair them behind a wrapper when both are present, so a browser --
      // which never gets the invite button -- renders exactly the markup it
      // rendered before this change.
      rightContent:
        copy && invite
          ? html`<div class="flex items-center gap-2">${copy}${invite}</div>`
          : (copy ?? invite),
    });
  }

  // Play/Spectate switch. Hidden once the game is running: the player list is
  // frozen at start, so the server would refuse to seat anyone new and the
  // control would do nothing.
  private renderSpectateToggle() {
    // Any joined lobby can be spectated — a host-started private lobby has no
    // scheduled start (lobbyStartAt null), and gating on it hid the toggle in
    // exactly the lobbies it exists for. The server still refuses seating after
    // start, so no client-side start check is needed here.
    if (this.isConnecting) return html``;
    const spectating = this.isSpectating;
    const cls = (on: boolean) =>
      `px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-widest transition ${
        on ? "bg-white text-black" : "text-white/60 hover:text-white"
      }`;
    return html`
      <div class="flex items-center gap-1 rounded-xl bg-white/5 p-1">
        <button
          class=${cls(!spectating)}
          ?disabled=${!spectating}
          @click=${() => this.setSpectating(false)}
        >
          ${translateText("private_lobby.play")}
        </button>
        <button
          class=${cls(spectating)}
          ?disabled=${spectating}
          @click=${() => this.setSpectating(true)}
        >
          ${translateText("private_lobby.spectate")}
        </button>
      </div>
    `;
  }

  protected renderBody() {
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
        ? this.isPrivateLobby()
          ? translateText("private_lobby.joined_waiting")
          : translateText("public_lobby.waiting_for_players")
        : secondsRemaining > 0
          ? translateText("public_lobby.starting_in", {
              time: renderDuration(secondsRemaining),
            })
          : translateText("public_lobby.started");
    const maxPlayers = this.gameConfig?.maxPlayers ?? 0;
    // Seats, not connections: spectators are in the roster but hold none.
    const playerCount = this.players?.filter((p) => !p.spectator).length ?? 0;
    const hostClientID = this.isPrivateLobby()
      ? (this.lobbyCreatorClientID ?? "")
      : "";
    return html`
      <div class="flex flex-col h-full">
        <div class="flex-1 custom-scrollbar p-6 space-y-4 mr-1">
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
                        .anonymizeNames=${this.gameConfig?.anonymizeNames ??
                        false}
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

        ${html`
          <div
            class="p-6 lg:p-6 border-t border-white/10 bg-black/60 backdrop-blur-md shrink-0 sticky bottom-0 z-10"
          >
            <div
              class="w-full px-4 py-3 rounded-xl border border-white/10 bg-white/5 flex items-center justify-between gap-3"
            >
              <div class="flex flex-col">
                <span
                  class="text-[10px] font-bold uppercase tracking-widest text-white/40"
                  >${translateText("public_lobby.status")}</span
                >
                <span class="text-sm font-bold text-white">${statusLabel}</span>
              </div>
              ${this.renderSpectateToggle()}
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
  }

  private renderJoinForm() {
    return html`
      <div class="custom-scrollbar p-6 space-y-4 mr-1">
        <form @submit=${this.joinLobbyFromInput}>
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
            <div class="flex gap-2">
              <div class="flex-[2]">
                <o-button
                  title=${translateText("private_lobby.join_lobby")}
                  width="block"
                  submit
                ></o-button>
              </div>
              <div class="flex-1">
                <o-button
                  variant="ghost"
                  title=${translateText("private_lobby.spectate")}
                  width="block"
                  @click=${this.spectateLobbyFromInput}
                ></o-button>
              </div>
            </div>
          </div>
        </form>
        ${this.renderHostedLobbies()}
      </div>
    `;
  }

  private renderHostedLobbies() {
    let content: TemplateResult;
    if (!this.hostedLobbiesLoaded) {
      content = html`<div class="flex justify-center py-3">
        <div
          class="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin"
        ></div>
      </div>`;
    } else if (this.hostedLobbies.length === 0) {
      content = html`<p class="text-sm text-white/50">
        ${translateText("private_lobby.no_open_lobbies")}
      </p>`;
    } else {
      content = html`<div class="flex flex-col gap-2">
        ${this.hostedLobbies.map((lobby) => this.renderHostedLobbyRow(lobby))}
      </div>`;
    }
    return html`
      <div class="pt-2">
        <div
          class="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-2"
        >
          ${translateText("private_lobby.open_lobbies")}
        </div>
        ${content}
      </div>
    `;
  }

  private renderHostedLobbyRow(lobby: PublicGameInfo) {
    const c = lobby.gameConfig;
    const mapName = c ? (getMapName(c.gameMap) ?? c.gameMap) : "";
    const thumbnailUrl = c
      ? assetUrl(
          `maps/${encodeURIComponent(normaliseMapKey(c.gameMap))}/thumbnail.webp`,
        )
      : "";
    // Nation count for this map isn't loaded pre-join, so the numeric-nations
    // default comparison is skipped in the row chips.
    const settings = c ? notableLobbySettings(c, null) : [];
    const disabledUnitCount = c?.disabledUnits?.length ?? 0;
    const enabled = translateText("common.enabled");
    // A featured lobby names itself; the map drops to the subtitle so nothing
    // is lost. Interpolated by lit as TEXT, never markup — emoji render because
    // they are ordinary codepoints, and the accent comes from a closed set so a
    // label can never restyle the rest of the list.
    const featuredLabel = lobby.featured ? lobby.label : undefined;
    const accentClass =
      featuredLabel === undefined
        ? "text-white"
        : {
            gold: "text-amber-300",
            blue: "text-sky-300",
            green: "text-emerald-300",
            red: "text-rose-300",
          }[lobby.accent ?? "gold"];
    const subtitle = c ? this.modeSubtitle(c) : "";
    // The map name only moves down here when a label has taken the title line.
    const subtitleLine = featuredLabel
      ? [mapName, subtitle].filter(Boolean).join(" · ")
      : subtitle;
    // The host's Start countdown once armed, otherwise the listing deadline.
    const startAt = lobby.startsAt ?? lobby.autoStartAt;
    const secondsToStart =
      startAt === undefined
        ? undefined
        : getSecondsUntilServerTimestamp(startAt, this.hostedServerTimeOffset);
    return html`
      <button
        type="button"
        @click=${() => this.joinHostedLobby(lobby)}
        class="w-full px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 active:bg-white/15 transition-all flex items-center gap-3 text-left"
      >
        <img
          src=${thumbnailUrl}
          alt=${mapName}
          class="w-12 h-12 rounded-lg object-cover border border-white/10 shrink-0"
          @error=${(e: Event) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <div class="flex flex-col flex-1 min-w-0">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-sm font-bold truncate ${accentClass}"
              >${featuredLabel ?? mapName}</span
            >
            ${lobby.custom
              ? html`<span
                  class="px-1.5 py-0.5 bg-orange-500 text-white text-[10px] rounded font-bold uppercase tracking-wider shrink-0"
                  >${translateText("public_lobby.custom")}</span
                >`
              : ""}
          </div>
          <span class="text-xs text-white/60">${subtitleLine}</span>
          ${settings.length > 0 || disabledUnitCount > 0
            ? html`<div class="flex flex-wrap gap-1 mt-1">
                ${settings.map((s) => {
                  // Some labels (e.g. game_settings.bots) already end with ": " or ": ".
                  const label = s.label.replace(/[:\uFF1A\s]+$/u, "");
                  return html`<span
                    class="px-1.5 py-0.5 bg-white/10 text-white/70 text-[10px] rounded font-bold"
                    >${s.value === enabled
                      ? label
                      : `${label}: ${s.value}`}</span
                  >`;
                })}
                ${disabledUnitCount > 0
                  ? html`<span
                      class="px-1.5 py-0.5 bg-red-500/20 text-red-200 text-[10px] rounded font-bold border border-red-500/30"
                      >${translateText("private_lobby.disabled_units")}:
                      ${disabledUnitCount}</span
                    >`
                  : ""}
              </div>`
            : ""}
        </div>
        <div class="flex flex-col items-end gap-1 shrink-0">
          <div class="flex items-center gap-1 text-white/80 text-xs font-bold">
            ${lobby.numClients}${c?.maxPlayers ? `/${c.maxPlayers}` : ""}
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.972 0 004 15v3H1v-3a3 3 0 013.75-2.906z"
              ></path>
            </svg>
          </div>
          ${secondsToStart === undefined
            ? ""
            : html`<span
                class="text-amber-300 text-xs font-bold tabular-nums"
                title=${translateText("host_modal.auto_start_timer")}
                >${secondsToStart > 0
                  ? renderDuration(secondsToStart)
                  : translateText("public_lobby.starting_game")}</span
              >`}
        </div>
      </button>
    `;
  }

  private async joinHostedLobby(lobby: PublicGameInfo) {
    const lobbyId = lobby.gameID;
    this.startTrackingLobby(lobbyId, lobby);
    try {
      const gameExists = await this.checkActiveLobby(lobbyId);
      if (!gameExists) {
        // The lobby vanished between the broadcast and the click.
        this.resetTrackingState();
        this.showMessage(translateText("private_lobby.not_found"), "red");
      }
    } catch (error) {
      console.error("Error joining hosted lobby:", error);
      this.resetTrackingState();
      this.showMessage(translateText("private_lobby.error"), "red");
    }
  }

  protected onOpen(args?: Record<string, unknown>): void {
    // Re-armed here (not in onClose's reset) so that once
    // disarmLeaveOnClose() runs, no close cascade can re-arm it and
    // disconnect the player mid game-start.
    this.leaveLobbyOnClose = true;
    this.hostedLobbiesLoaded = false;
    void this.hostedLobbySocket.start();
    const lobbyId = typeof args?.lobbyId === "string" ? args.lobbyId : "";
    const lobbyInfo = args?.lobbyInfo as GameInfo | PublicGameInfo | undefined;
    if (lobbyId) {
      this.startTrackingLobby(lobbyId, lobbyInfo);
      // If opened with lobbyId but no lobbyInfo (URL join case), auto-join the lobby
      if (!lobbyInfo) {
        this.handleUrlJoin(lobbyId, args?.spectate === true);
      }
    }
  }

  private async handleUrlJoin(
    lobbyId: string,
    spectator = false,
  ): Promise<void> {
    try {
      const gameExists = await this.checkActiveLobby(lobbyId, spectator);
      if (gameExists) return;

      // A finished game has no lobby to spectate, so both link forms fall
      // through to the same archive: the play link and the spectate link
      // become the same replay once the game is over.
      // Active lobby not found, check if it's an archived game
      switch (await this.checkArchivedGame(lobbyId)) {
        case "success":
          return;
        case "redirected":
          // Navigating to the versioned replay shell; leave state as-is.
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
    this.gameStartAlert.reset();
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

  public confirmBeforeClose(): boolean | Promise<boolean> {
    if (!this.currentLobbyId) return true;
    return this.confirmClose(translateText("host_modal.leave_confirmation"));
  }

  protected onClose(): void {
    this.hostedLobbySocket.stop();
    this.hostedLobbies = [];
    this.hostedLobbiesLoaded = false;
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
    this.gameStartAlert.reset();
    this.isConnecting = true;
  }

  disconnectedCallback() {
    this.hostedLobbySocket.stop();
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

  // Closing this modal is part of the game-start transition, not the player
  // leaving. Kept separate from closeWithoutLeaving because closing ANY
  // page-modal navigates via showPage, which force-closes the currently
  // visible page — so all lobby modals must be disarmed before any of them
  // is closed.
  public disarmLeaveOnClose() {
    this.leaveLobbyOnClose = false;
  }

  public closeWithoutLeaving() {
    this.disarmLeaveOnClose();
    this.close();
  }

  private updateHistory(url: string): void {
    if (!crazyGamesSDK.isOnCrazyGames()) {
      history.replaceState(null, "", url);
    }
  }

  // --- Game config rendering ---

  private modeSubtitle(c: GameConfig): string {
    if (c.gameMode !== GameMode.Team) {
      return translateText("game_mode.ffa");
    }
    if (c.playerTeams === HumansVsNations) {
      return translateText("host_modal.teams_Humans Vs Nations");
    }
    if (typeof c.playerTeams === "string") {
      return translateText("host_modal.teams_" + c.playerTeams);
    }
    if (typeof c.playerTeams === "number") {
      return translateText("public_lobby.teams", {
        num: c.playerTeams,
      });
    }
    return translateText("game_mode.ffa");
  }

  private renderGameConfig(): TemplateResult {
    if (!this.gameConfig) return html``;

    const c = this.gameConfig;
    const mapName = getMapName(c.gameMap);
    const normalizedMap = normaliseMapKey(c.gameMap);
    const thumbnailUrl = assetUrl(
      `maps/${encodeURIComponent(normalizedMap)}/thumbnail.webp`,
    );
    const modeSubtitle = this.modeSubtitle(c);

    const cards = notableLobbySettings(c, this.nationCount).map(
      (s) =>
        html`<lobby-config-item
          .label=${s.label}
          .value=${s.value}
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
          ${translateText("game_settings.infinite_gold")}
        </span>`,
      );
    if (hc.infiniteTroops)
      items.push(
        html`<span
          class="px-2 py-1 bg-yellow-500/20 text-yellow-200 text-xs rounded font-bold border border-yellow-500/30"
        >
          ${translateText("game_settings.infinite_troops")}
        </span>`,
      );
    if (hc.goldMultiplier)
      items.push(
        html`<span
          class="px-2 py-1 bg-yellow-500/20 text-yellow-200 text-xs rounded font-bold border border-yellow-500/30"
        >
          ${translateText("game_settings.gold_multiplier")}:
          x${hc.goldMultiplier}
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

  private joinLobbyFromInput(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    return this.enterLobbyFromInput(false);
  }

  private spectateLobbyFromInput(): Promise<void> {
    return this.enterLobbyFromInput(true);
  }

  private async enterLobbyFromInput(spectator: boolean): Promise<void> {
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
      const gameExists = await this.checkActiveLobby(lobbyId, spectator);
      if (gameExists) return;

      switch (await this.checkArchivedGame(lobbyId)) {
        case "success":
          return;
        case "redirected":
          // Navigating to the versioned replay shell; leave state as-is.
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

  private async checkActiveLobby(
    lobbyId: string,
    spectator = false,
  ): Promise<boolean> {
    // The id's letter names the game's server in the API's list
    // (multi-server v2); load it before resolving. No version check here:
    // the letter names the server whatever version it runs, and a mismatch
    // is answered at join time (version_mismatch), never by navigating a
    // page that may be mid-game.
    await ensureServerList();
    // The list also says which build the game's server runs. On the web,
    // open the game at THAT version's page rather than probing it with the
    // wrong bundle: true here means a navigation is under way, and the
    // caller should stop as it does for a game it joined. The desktop and
    // replay shells, and the loop-guarded cases, fall through -- the whole
    // rule lives in redirectToGameVersion.
    if (redirectToGameVersion(lobbyId, spectator)) return true;
    const url = `${ClientEnv.gameHttpBase(lobbyId)}/${ClientEnv.gameWorkerPath(lobbyId)}/api/game/${lobbyId}/exists`;

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
      // A spectator can enter a game that is already running, so the usual
      // "waiting for host to start" is wrong for them.
      this.showMessage(
        translateText(
          spectator
            ? "private_lobby.spectating"
            : "private_lobby.joined_waiting",
        ),
      );

      // Use the clientID that was already set by startTrackingLobby in open()
      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: lobbyId,
            source: "private",
            spectator,
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
  ): Promise<
    "success" | "redirected" | "not_found" | "version_mismatch" | "error"
  > {
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

    const gitCommit = ClientEnv.gitCommit();
    if (gitCommit !== "DEV" && parsed.data.gitCommit !== gitCommit) {
      const safeLobbyId = this.sanitizeForLog(lobbyId);
      console.warn(
        `Git commit hash mismatch for game ${safeLobbyId}`,
        archiveData.details,
      );
      if (await this.redirectToVersionedShell(lobbyId)) {
        return "redirected";
      }
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

  // The record was produced by a different build. replay.<domain>/<gameId>
  // serves the matching versioned shell (uploaded by update.sh on every
  // deploy); if it exists, navigate there and let that build replay the game
  // (#4934). The probe requires text/html so a misrouted host that answers
  // 200 with something else can't strand the player on a broken page.
  private async redirectToVersionedShell(lobbyId: string): Promise<boolean> {
    if (isReplayShellHost(window.location.hostname)) {
      return false;
    }
    const url = versionedReplayUrl(ClientEnv.jwtAudience(), lobbyId);
    if (url === null) {
      return false;
    }
    try {
      const probe = await fetch(url, { method: "HEAD" });
      if (!probe.ok) {
        return false;
      }
      const contentType = probe.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html")) {
        return false;
      }
    } catch {
      return false;
    }
    window.location.href = url;
    return true;
  }
}
