import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { renderDuration, renderNumber, translateText } from "../client/Utils";
import { ClientInfo, GameConfig, GameInfo } from "../core/Schemas";
import { GameMapSize, GameMode, HumansVsNations } from "../core/game/Game";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { BaseModal } from "./components/BaseModal";
import "./components/LobbyPlayerView";
import { modalHeader } from "./components/ui/ModalHeader";

@customElement("join-public-lobby-modal")
export class JoinPublicLobbyModal extends BaseModal {
  @state() private players: ClientInfo[] = [];
  @state() private playerCount: number = 0;
  @state() private gameConfig: GameConfig | null = null;
  @state() private currentLobbyId: string = "";
  @state() private nationCount: number = 0;
  @state() private lobbyStartAt: number | null = null;
  @state() private isConnecting: boolean = true;

  private mapLoader = terrainMapFileLoader;
  private leaveLobbyOnClose = true;
  private countdownTimerId: number | null = null;
  private handledJoinTimeout = false;
  private readonly handleLobbyInfo = (event: Event) => {
    const lobby = (event as CustomEvent<GameInfo>).detail;
    if (!this.currentLobbyId || lobby.gameID !== this.currentLobbyId) {
      return;
    }
    if (this.isConnecting) {
      this.isConnecting = false;
    }
    const msUntilStart = lobby.msUntilStart;
    this.updateFromLobby({
      ...lobby,
      msUntilStart:
        msUntilStart !== undefined
          ? Math.max(0, msUntilStart - Date.now())
          : undefined,
    });
  };

  render() {
    const secondsRemaining =
      this.lobbyStartAt !== null
        ? Math.max(0, Math.floor((this.lobbyStartAt - Date.now()) / 1000))
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
    const playerCount = this.playerCount;
    const content = html`
      <div
        class="h-full flex flex-col bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden select-none"
      >
        ${modalHeader({
          title: translateText("public_lobby.title"),
          onBack: () => this.closeAndLeave(),
          ariaLabel: translateText("common.close"),
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
                        .teamCount=${this.gameConfig?.playerTeams ?? 2}
                        .nationCount=${this.nationCount}
                        .disableNations=${this.gameConfig?.disableNations ??
                        false}
                        .isCompactMap=${this.gameConfig?.gameMapSize ===
                        GameMapSize.Compact}
                      ></lobby-player-view>
                    `
                  : ""}
              `}
        </div>

        <div class="p-6 pt-4 border-t border-white/10 bg-black/20 shrink-0">
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

  public open(lobbyId: string = "", lobbyInfo?: GameInfo) {
    super.open();
    if (lobbyId) {
      this.startTrackingLobby(lobbyId, lobbyInfo);
    }
  }

  private startTrackingLobby(lobbyId: string, lobbyInfo?: GameInfo) {
    this.currentLobbyId = lobbyId;
    this.gameConfig = null;
    this.players = [];
    this.playerCount = 0;
    this.nationCount = 0;
    this.lobbyStartAt = null;
    this.isConnecting = true;
    this.handledJoinTimeout = false;
    this.startLobbyUpdates();
    if (lobbyInfo) {
      this.updateFromLobby(lobbyInfo);
    }
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

  protected onClose(): void {
    this.clearCountdownTimer();
    this.stopLobbyUpdates();

    if (this.leaveLobbyOnClose) {
      this.leaveLobby();
      history.replaceState(null, "", window.location.origin + "/");
    }

    this.gameConfig = null;
    this.players = [];
    this.playerCount = 0;
    this.currentLobbyId = "";
    this.nationCount = 0;
    this.lobbyStartAt = null;
    this.isConnecting = true;
    this.leaveLobbyOnClose = true;
  }

  disconnectedCallback() {
    this.onClose();
    super.disconnectedCallback();
  }

  public closeAndLeave() {
    this.leaveLobby();
    try {
      history.replaceState(null, "", window.location.origin + "/");
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

  private renderConfigItem(
    label: string,
    value: string | TemplateResult,
  ): TemplateResult {
    return html`
      <div
        class="bg-white/5 border border-white/10 rounded-lg p-3 flex flex-col items-center justify-center gap-1 text-center min-w-[100px]"
      >
        <span
          class="text-white/40 text-[10px] font-bold uppercase tracking-wider"
          >${label}</span
        >
        <span
          class="text-white font-bold text-sm w-full break-words hyphens-auto"
          >${value}</span
        >
      </div>
    `;
  }

  private renderGameConfig(): TemplateResult {
    if (!this.gameConfig) return html``;

    const c = this.gameConfig;
    const mapName = translateText(
      "map." + c.gameMap.toLowerCase().replace(/ /g, ""),
    );
    const modeName =
      c.playerTeams === HumansVsNations
        ? translateText("game_mode.humans_vs_nations")
        : c.gameMode === GameMode.FFA
          ? translateText("game_mode.ffa")
          : translateText("game_mode.teams");
    return html`
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
        ${this.renderConfigItem(translateText("map.map"), mapName)}
        ${this.renderConfigItem(translateText("host_modal.mode"), modeName)}
        ${c.publicGameModifiers?.isRandomSpawn
          ? this.renderConfigItem(
              translateText("host_modal.random_spawn"),
              translateText("common.enabled"),
            )
          : html``}
        ${c.publicGameModifiers?.isCompact
          ? this.renderConfigItem(
              translateText("host_modal.compact_map"),
              translateText("common.enabled"),
            )
          : html``}
        ${c.publicGameModifiers?.startingGold !== undefined
          ? this.renderConfigItem(
              translateText("host_modal.starting_gold"),
              renderNumber(c.publicGameModifiers.startingGold),
            )
          : html``}
        ${c.gameMode !== GameMode.FFA &&
        c.playerTeams &&
        c.playerTeams !== HumansVsNations
          ? this.renderConfigItem(
              typeof c.playerTeams === "string"
                ? translateText("host_modal.team_type")
                : translateText("host_modal.team_count"),
              typeof c.playerTeams === "string"
                ? translateText("host_modal.teams_" + c.playerTeams)
                : c.playerTeams.toString(),
            )
          : html``}
      </div>
      ${this.renderDisabledUnits()}
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
      "Trade Ship": "stats_modal.unit.trade",
      Transport: "stats_modal.unit.trans",
      "MIRV Warhead": "stats_modal.unit.mirvw",
    };

    return html`
      <div class="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
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

  private updateFromLobby(lobby: GameInfo) {
    if (lobby.clients) {
      this.players = lobby.clients;
      this.playerCount = lobby.clients.length;
    } else {
      this.players = [];
      this.playerCount = lobby.numClients ?? 0;
    }
    if (lobby.msUntilStart !== undefined) {
      this.lobbyStartAt = lobby.msUntilStart + Date.now();
    } else {
      this.lobbyStartAt = null;
    }
    this.syncCountdownTimer();
    if (lobby.gameConfig) {
      const mapChanged = this.gameConfig?.gameMap !== lobby.gameConfig.gameMap;
      this.gameConfig = lobby.gameConfig;
      if (mapChanged) {
        this.loadNationCount();
      }
    }
  }

  private startLobbyUpdates() {
    this.stopLobbyUpdates();
    document.addEventListener(
      "lobby-info",
      this.handleLobbyInfo as EventListener,
    );
  }

  private stopLobbyUpdates() {
    document.removeEventListener(
      "lobby-info",
      this.handleLobbyInfo as EventListener,
    );
  }

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
    if (Date.now() < this.lobbyStartAt) {
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

  private async loadNationCount() {
    if (!this.gameConfig) {
      this.nationCount = 0;
      return;
    }
    const currentMap = this.gameConfig.gameMap;
    try {
      const mapData = this.mapLoader.getMapData(currentMap);
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
}
