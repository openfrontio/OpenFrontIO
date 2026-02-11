import { html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { EventBus } from "../core/EventBus";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  HumansVsNations,
  UnitType,
} from "../core/game/Game";
import {
  ClientInfo,
  GameConfig,
  GameInfo,
  LobbyInfoEvent,
  TeamCountConfig,
  isValidGameID,
} from "../core/Schemas";
import { generateID } from "../core/Util";
import { getPlayToken } from "./Auth";
import "./components/baseComponents/Modal";
import { BaseModal } from "./components/BaseModal";
import "./components/CopyButton";
import "./components/LobbyPlayerView";
import { modalHeader } from "./components/ui/ModalHeader";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { JoinLobbyEvent } from "./Main";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import {
  renderGameConfigSettings,
  renderToggleInputCard,
  renderToggleInputCardInput,
} from "./utilities/RenderGameConfigSettings";
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

  @property({ attribute: false }) eventBus: EventBus | null = null;

  private playersInterval: NodeJS.Timeout | null = null;
  // Add a new timer for debouncing bot changes
  private botsUpdateTimer: number | null = null;
  private mapLoader = terrainMapFileLoader;

  private leaveLobbyOnClose = true;

  private readonly handleLobbyInfo = (event: LobbyInfoEvent) => {
    const lobby = event.lobby;
    this.lobbyCreatorClientID = lobby.lobbyCreatorClientID ?? "";
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

    const inputCards = [
      renderToggleInputCard({
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
      }),
      renderToggleInputCard({
        labelKey: "host_modal.player_immunity_duration",
        checked: this.spawnImmunity,
        onClick: spawnImmunityHandlers.click,
        input: renderToggleInputCardInput({
          min: 0,
          max: 120,
          step: 1,
          value: this.spawnImmunityDurationMinutes ?? 0,
          ariaLabel: translateText("host_modal.player_immunity_duration"),
          placeholder: translateText("host_modal.mins_placeholder"),
          onInput: this.handleSpawnImmunityDurationInput,
          onKeyDown: this.handleSpawnImmunityDurationKeyDown,
        }),
      }),
      renderToggleInputCard({
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
      }),
      renderToggleInputCard({
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
          placeholder: translateText("single_modal.starting_gold_placeholder"),
          onInput: this.handleStartingGoldValueChanges,
          onKeyDown: this.handleStartingGoldValueKeyDown,
        }),
      }),
    ];

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

        <div
          class="flex-1 overflow-y-auto custom-scrollbar p-6 mr-1 mx-auto w-full max-w-5xl space-y-10"
        >
          ${renderGameConfigSettings({
            map: {
              selected: this.selectedMap,
              useRandom: this.useRandomMap,
              randomMapDivider: true,
              onSelectMap: (mapValue: GameMapType) =>
                this.handleMapSelection(mapValue),
              onSelectRandom: () => this.handleSelectRandomMap(),
            },
            difficulty: {
              selected: this.selectedDifficulty,
              disabled: this.disableNations,
              onSelect: (value: Difficulty) =>
                this.handleDifficultySelection(value),
            },
            gameMode: {
              selected: this.gameMode,
              onSelect: (mode: GameMode) => this.handleGameModeSelection(mode),
            },
            teamCount: {
              selected: this.teamCount,
              onSelect: (count: TeamCountConfig) =>
                this.handleTeamCountSelection(count),
            },
            options: {
              titleKey: "host_modal.options_title",
              bots: {
                value: this.bots,
                labelKey: "host_modal.bots",
                disabledKey: "host_modal.bots_disabled",
                onChange: this.handleBotsChange,
              },
              toggles: [
                {
                  labelKey: "host_modal.disable_nations",
                  checked: this.disableNations,
                  onChange: this.handleDisableNationsChange,
                  hidden:
                    this.gameMode === GameMode.Team &&
                    this.teamCount === HumansVsNations,
                },
                {
                  labelKey: "host_modal.instant_build",
                  checked: this.instantBuild,
                  onChange: this.handleInstantBuildChange,
                },
                {
                  labelKey: "host_modal.random_spawn",
                  checked: this.randomSpawn,
                  onChange: this.handleRandomSpawnChange,
                },
                {
                  labelKey: "host_modal.donate_gold",
                  checked: this.donateGold,
                  onChange: this.handleDonateGoldChange,
                },
                {
                  labelKey: "host_modal.donate_troops",
                  checked: this.donateTroops,
                  onChange: this.handleDonateTroopsChange,
                },
                {
                  labelKey: "host_modal.infinite_gold",
                  checked: this.infiniteGold,
                  onChange: this.handleInfiniteGoldChange,
                },
                {
                  labelKey: "host_modal.infinite_troops",
                  checked: this.infiniteTroops,
                  onChange: this.handleInfiniteTroopsChange,
                },
                {
                  labelKey: "host_modal.compact_map",
                  checked: this.compactMap,
                  onChange: this.handleCompactMapChange,
                },
              ],
              inputCards,
            },
            unitTypes: {
              titleKey: "host_modal.enables_title",
              disabledUnits: this.disabledUnits,
              toggleUnit: this.toggleUnit.bind(this),
            },
          })}

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
    this.stopLobbyUpdates();
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
