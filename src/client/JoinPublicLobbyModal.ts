import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { ClientInfo, GameConfig, GameInfo } from "../core/Schemas";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { GameMapSize, GameMode } from "../core/game/Game";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { BaseModal } from "./components/BaseModal";
import "./components/LobbyPlayerView";
import { modalHeader } from "./components/ui/ModalHeader";

@customElement("join-public-lobby-modal")
export class JoinPublicLobbyModal extends BaseModal {
  @state() private players: ClientInfo[] = [];
  @state() private gameConfig: GameConfig | null = null;
  @state() private lobbyCreatorClientID: string | null = null;
  @state() private currentLobbyId: string = "";
  @state() private nationCount: number = 0;
  @state() private msUntilStart: number | null = null;

  private playersInterval: NodeJS.Timeout | null = null;
  private mapLoader = terrainMapFileLoader;
  private leaveLobbyOnClose = true;

  render() {
    const content = html`
      <div
        class="h-full flex flex-col bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden select-none"
      >
        ${modalHeader({
          title: translateText("public_lobby.title"),
          onBack: this.closeAndLeave,
          ariaLabel: translateText("common.close"),
        })}
        <div class="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4 mr-1">
          ${this.gameConfig ? this.renderGameConfig() : html``}
          ${this.players.length > 0
            ? html`
                <lobby-player-view
                  class="mt-6"
                  .gameMode=${this.gameConfig?.gameMode ?? GameMode.FFA}
                  .clients=${this.players}
                  .lobbyCreatorClientID=${this.lobbyCreatorClientID}
                  .teamCount=${this.gameConfig?.playerTeams ?? 2}
                  .nationCount=${this.nationCount}
                  .disableNations=${this.gameConfig?.disableNations ?? false}
                  .isCompactMap=${this.gameConfig?.gameMapSize ===
                  GameMapSize.Compact}
                ></lobby-player-view>
              `
            : ""}
        </div>

        <div class="p-6 pt-4 border-t border-white/10 bg-black/20 shrink-0">
          <button
            class="w-full py-4 text-sm font-bold text-white uppercase tracking-widest bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 hover:-translate-y-0.5 active:translate-y-0 disabled:transform-none"
            disabled
          >
            ${this.getStatusLabel()}
          </button>
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

  public open(lobbyId: string = "") {
    super.open();
    if (lobbyId) {
      this.startTrackingLobby(lobbyId);
    }
  }

  private startTrackingLobby(lobbyId: string) {
    this.currentLobbyId = lobbyId;
    this.leaveLobbyOnClose = false;
    this.gameConfig = null;
    this.players = [];
    this.lobbyCreatorClientID = null;
    this.nationCount = 0;
    this.msUntilStart = null;

    if (this.playersInterval) {
      clearInterval(this.playersInterval);
    }
    this.pollPlayers();
    this.playersInterval = setInterval(() => this.pollPlayers(), 1000);
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
    if (this.playersInterval) {
      clearInterval(this.playersInterval);
      this.playersInterval = null;
    }

    if (this.leaveLobbyOnClose) {
      this.leaveLobby();
      history.replaceState(null, "", window.location.origin + "/");
    }

    this.gameConfig = null;
    this.players = [];
    this.lobbyCreatorClientID = null;
    this.currentLobbyId = "";
    this.nationCount = 0;
    this.msUntilStart = null;
    this.leaveLobbyOnClose = true;
  }

  public closeAndLeave() {
    this.leaveLobbyOnClose = true;
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
      c.gameMode === "Free For All"
        ? translateText("game_mode.ffa")
        : translateText("game_mode.teams");
    const diffName = translateText(
      "difficulty." + c.difficulty.toLowerCase().replace(/ /g, ""),
    );

    return html`
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
        ${this.renderConfigItem(translateText("map.map"), mapName)}
        ${this.renderConfigItem(translateText("host_modal.mode"), modeName)}
        ${this.renderConfigItem(
          translateText("difficulty.difficulty"),
          diffName,
        )}
        ${this.renderConfigItem(
          translateText("host_modal.bots"),
          c.bots.toString(),
        )}
        ${c.gameMode !== "Free For All" && c.playerTeams
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

  private getStatusLabel(): string {
    if (this.msUntilStart !== null && this.msUntilStart <= 2000) {
      return translateText("public_lobby.starting_game");
    }
    return translateText("public_lobby.waiting_for_players");
  }

  private async pollPlayers() {
    const lobbyId = this.currentLobbyId;
    if (!lobbyId) return;
    const config = await getServerConfigFromClient();

    fetch(`/${config.workerPath(lobbyId)}/api/game/${lobbyId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((response) => response.json())
      .then((data: GameInfo) => {
        this.lobbyCreatorClientID = data.clients?.[0]?.clientID ?? null;
        this.players = data.clients ?? [];
        this.msUntilStart = data.msUntilStart ?? null;
        if (data.gameConfig) {
          const mapChanged =
            this.gameConfig?.gameMap !== data.gameConfig.gameMap;
          this.gameConfig = data.gameConfig;
          if (mapChanged) {
            this.loadNationCount();
          }
        }
      })
      .catch((error) => {
        console.error("Error polling players:", error);
      });
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
