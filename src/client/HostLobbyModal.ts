import { html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { EventBus } from "../core/EventBus";
import {
  GameMapSize,
  GameMapType,
  GameMode,
  HumansVsNations,
} from "../core/game/Game";
import {
  ClientInfo,
  GameConfig,
  GameInfo,
  LobbyInfoEvent,
  isValidGameID,
} from "../core/Schemas";
import { generateID } from "../core/Util";
import { getPlayToken } from "./Auth";
import "./components/baseComponents/Modal";
import { BaseModal } from "./components/BaseModal";
import "./components/CopyButton";
import "./components/GameConfigForm";
import {
  GameConfigForm,
  GameConfigSnapshot,
} from "./components/GameConfigForm";
import "./components/LobbyPlayerView";
import { modalHeader } from "./components/ui/ModalHeader";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { JoinLobbyEvent } from "./Main";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { PRIMARY_BUTTON } from "./utilities/ConfigCards";

@customElement("host-lobby-modal")
export class HostLobbyModal extends BaseModal {
  @query("game-config-form") private configForm!: GameConfigForm;

  @state() private lobbyId = "";
  @state() private lobbyUrlSuffix = "";
  @state() private clients: ClientInfo[] = [];
  @state() private lobbyCreatorClientID: string = "";
  @state() private nationCount: number = 0;
  @state() private lastConfig: GameConfigSnapshot | null = null;

  private playersInterval: NodeJS.Timeout | null = null;
  private configUpdateTimer: number | null = null;
  private mapLoader = terrainMapFileLoader;
  private leaveLobbyOnClose = true;

  constructor() {
    super();
    this.id = "page-host-lobby";
  }
  @property({ attribute: false }) eventBus: EventBus | null = null;

  private readonly handleLobbyInfo = (event: LobbyInfoEvent) => {
    const lobby = event.lobby;
    if (!this.lobbyId || lobby.gameID !== this.lobbyId) {
      return;
    }
    this.lobbyCreatorClientID = event.myClientID;
    if (lobby.clients) {
      this.clients = lobby.clients;
    }
  };

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

  private startLobbyUpdates() {
    this.stopLobbyUpdates();
    if (!this.eventBus) {
      console.warn(
        "HostLobbyModal: eventBus not set, cannot subscribe to lobby updates",
      );
      return;
    }
    this.eventBus.on(LobbyInfoEvent, this.handleLobbyInfo);
  }

  private stopLobbyUpdates() {
    this.eventBus?.off(LobbyInfoEvent, this.handleLobbyInfo);
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
            <game-config-form
              variant="host"
              @config-changed=${this.handleConfigChanged}
            ></game-config-form>

            <!-- Player List -->
            <lobby-player-view
              .gameMode=${this.lastConfig?.gameMode ?? GameMode.FFA}
              .clients=${this.clients}
              .lobbyCreatorClientID=${this.lobbyCreatorClientID}
              .currentClientID=${this.lobbyCreatorClientID}
              .teamCount=${this.lastConfig?.teamCount ?? 2}
              .nationCount=${this.nationCount}
              .disableNations=${this.lastConfig?.disableNations ?? false}
              .isCompactMap=${this.lastConfig?.compactMap ?? false}
              .onKickPlayer=${(clientID: string) => this.kickPlayer(clientID)}
            ></lobby-player-view>
          </div>
        </div>

        <!-- Footer -->
        <div class="p-6 pt-4 border-t border-white/10 bg-black/20 shrink-0">
          <button
            class="${PRIMARY_BUTTON}"
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

  private handleConfigChanged = (e: Event) => {
    const config = (e as CustomEvent<GameConfigSnapshot>).detail;
    const mapChanged = this.lastConfig?.selectedMap !== config.selectedMap;
    this.lastConfig = config;

    if (mapChanged) {
      this.loadNationCount();
    }

    // Debounce config updates to avoid flooding the server during slider drags
    if (this.configUpdateTimer !== null) {
      clearTimeout(this.configUpdateTimer);
    }
    this.configUpdateTimer = window.setTimeout(() => {
      this.putGameConfig(config);
      this.configUpdateTimer = null;
    }, 300);
  };

  protected onOpen(): void {
    this.startLobbyUpdates();
    this.lobbyId = generateID();
    // Note: clientID will be assigned by server when we join the lobby
    // lobbyCreatorClientID stays empty until then

    // Pass auth token for creator identification (server extracts persistentID from it)
    createLobby(this.lobbyId)
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
              source: "host",
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

  private leaveLobby() {
    if (!this.lobbyId) return;
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
    this.stopLobbyUpdates();
    if (this.leaveLobbyOnClose) {
      this.leaveLobby();
      this.updateHistory("/");
    }
    crazyGamesSDK.hideInviteButton();

    if (this.playersInterval) {
      clearInterval(this.playersInterval);
      this.playersInterval = null;
    }
    if (this.configUpdateTimer !== null) {
      clearTimeout(this.configUpdateTimer);
      this.configUpdateTimer = null;
    }

    this.configForm?.reset();
    this.lobbyId = "";
    this.lobbyUrlSuffix = "";
    this.clients = [];
    this.lobbyCreatorClientID = "";
    this.nationCount = 0;
    this.lastConfig = null;
    this.leaveLobbyOnClose = true;
  }

  private async putGameConfig(config?: GameConfigSnapshot) {
    const c = config ?? this.configForm?.getConfig();
    if (!c) return;

    const spawnImmunityTicks = c.spawnImmunityDurationMinutes
      ? c.spawnImmunityDurationMinutes * 60 * 10
      : 0;
    const url = await this.constructUrl();
    this.updateHistory(url);
    this.dispatchEvent(
      new CustomEvent("update-game-config", {
        detail: {
          config: {
            gameMap: c.selectedMap,
            gameMapSize: c.compactMap
              ? GameMapSize.Compact
              : GameMapSize.Normal,
            difficulty: c.selectedDifficulty,
            bots: c.bots,
            infiniteGold: c.infiniteGold,
            donateGold: c.donateGold,
            infiniteTroops: c.infiniteTroops,
            donateTroops: c.donateTroops,
            instantBuild: c.instantBuild,
            randomSpawn: c.randomSpawn,
            gameMode: c.gameMode,
            disabledUnits: c.disabledUnits,
            spawnImmunityDuration: c.spawnImmunity
              ? spawnImmunityTicks
              : undefined,
            playerTeams: c.teamCount,
            ...(c.gameMode === GameMode.Team && c.teamCount === HumansVsNations
              ? { disableNations: false }
              : { disableNations: c.disableNations }),
            maxTimerValue: c.maxTimer ? c.maxTimerValue : undefined,
            goldMultiplier: c.goldMultiplier
              ? c.goldMultiplierValue
              : undefined,
            startingGold: c.startingGold ? c.startingGoldValue : undefined,
          } satisfies Partial<GameConfig>,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async startGame() {
    // Flush any pending debounced config update
    if (this.configUpdateTimer !== null) {
      clearTimeout(this.configUpdateTimer);
      this.configUpdateTimer = null;
    }
    await this.putGameConfig();

    const c = this.configForm?.getConfig();
    console.log(
      `Starting private game with map: ${c ? GameMapType[c.selectedMap as keyof typeof GameMapType] : "unknown"}${c?.useRandomMap ? " (Randomly selected)" : ""}`,
    );

    this.leaveLobbyOnClose = false;

    const serverConfig = await getServerConfigFromClient();
    const response = await fetch(
      `${window.location.origin}/${serverConfig.workerPath(this.lobbyId)}/api/start_game/${this.lobbyId}`,
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
    this.dispatchEvent(
      new CustomEvent("kick-player", {
        detail: { target: clientID },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async loadNationCount() {
    const currentMap = this.lastConfig?.selectedMap ?? GameMapType.World;
    try {
      const mapData = this.mapLoader.getMapData(currentMap);
      const manifest = await mapData.manifest();
      const latestMap = this.lastConfig?.selectedMap ?? GameMapType.World;
      if (latestMap === currentMap) {
        this.nationCount = manifest.nations.length;
      }
    } catch (error) {
      console.warn("Failed to load nation count", error);
      const latestMap = this.lastConfig?.selectedMap ?? GameMapType.World;
      if (latestMap === currentMap) {
        this.nationCount = 0;
      }
    }
  }
}

async function createLobby(gameID: string): Promise<GameInfo> {
  const config = await getServerConfigFromClient();
  // Send JWT token for creator identification - server extracts persistentID from it
  // persistentID should never be exposed to other clients
  const token = await getPlayToken();
  try {
    const response = await fetch(
      `/${config.workerPath(gameID)}/api/create_game/${gameID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
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
