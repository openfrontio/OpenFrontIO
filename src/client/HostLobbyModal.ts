import { TemplateResult, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { copyToClipboard, translateText } from "../client/Utils";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  HumansVsNations,
  UnitType,
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
import "./components/LobbyTeamView";
import "./components/Maps";
import { renderDifficultySection } from "./components/ui/DifficultySection";
import { renderGameModeSection } from "./components/ui/GameModeSection";
import { renderGameOptionsSection } from "./components/ui/GameOptionsSection";
import { renderLobbyIdBox } from "./components/ui/LobbyIdBox";
import {
  lobbyModalShell,
  renderLobbyFooterButton,
} from "./components/ui/LobbyModalShell";
import { renderLobbyPlayerList } from "./components/ui/LobbyPlayerList";
import { renderMapSelection } from "./components/ui/MapSelection";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { JoinLobbyEvent } from "./Main";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { renderUnitTypeSection } from "./utilities/RenderUnitTypeOptions";
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

  private renderMaxTimerCard(): TemplateResult {
    const { click, keydown } = this.createToggleHandlers(
      () => this.maxTimer,
      (val) => (this.maxTimer = val),
      () => this.maxTimerValue,
      (val) => (this.maxTimerValue = val),
      30,
    );
    const cardClass = this.maxTimer
      ? "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
      : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 opacity-80";
    const checkClass = this.maxTimer
      ? "bg-blue-500 border-blue-500"
      : "border-white/20 bg-white/5";
    const labelClass = this.maxTimer ? "text-white" : "text-white/60";

    return html`
      <div
        role="button"
        tabindex="0"
        @click=${click}
        @keydown=${keydown}
        class="relative p-3 rounded-xl border transition-all duration-200 flex flex-col items-center justify-between gap-2 h-full cursor-pointer min-h-[100px] ${cardClass}"
      >
        <div class="flex items-center justify-center w-full mt-1">
          <div
            class="w-5 h-5 rounded border flex items-center justify-center transition-colors ${checkClass}"
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
                placeholder=${translateText("host_modal.mins_placeholder")}
              />
            `
          : html`<div class="h-[2px] w-4 bg-white/10 rounded my-3"></div>`}

        <div
          class="text-[10px] uppercase font-bold tracking-wider text-center w-full leading-tight ${labelClass}"
        >
          ${translateText("host_modal.max_timer")}
        </div>
      </div>
    `;
  }

  private renderSpawnImmunityCard(): TemplateResult {
    const { click, keydown } = this.createToggleHandlers(
      () => this.spawnImmunity,
      (val) => (this.spawnImmunity = val),
      () => this.spawnImmunityDurationMinutes,
      (val) => (this.spawnImmunityDurationMinutes = val),
      5,
    );
    const cardClass = this.spawnImmunity
      ? "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
      : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 opacity-80";
    const checkClass = this.spawnImmunity
      ? "bg-blue-500 border-blue-500"
      : "border-white/20 bg-white/5";
    const labelClass = this.spawnImmunity ? "text-white" : "text-white/60";

    return html`
      <div
        role="button"
        tabindex="0"
        @click=${click}
        @keydown=${keydown}
        class="relative p-3 rounded-xl border transition-all duration-200 flex flex-col items-center justify-between gap-2 h-full cursor-pointer min-h-[100px] ${cardClass}"
      >
        <div class="flex items-center justify-center w-full mt-1">
          <div
            class="w-5 h-5 rounded border flex items-center justify-center transition-colors ${checkClass}"
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
                .value=${String(this.spawnImmunityDurationMinutes ?? 0)}
                class="w-full text-center rounded bg-black/60 text-white text-sm font-bold border border-white/20 focus:outline-none focus:border-blue-500 p-1 my-1"
                @click=${(e: Event) => e.stopPropagation()}
                @input=${this.handleSpawnImmunityDurationInput}
                @keydown=${this.handleSpawnImmunityDurationKeyDown}
                placeholder=${translateText("host_modal.mins_placeholder")}
              />
            `
          : html`<div class="h-[2px] w-4 bg-white/10 rounded my-3"></div>`}

        <div
          class="text-[10px] uppercase font-bold tracking-wider text-center w-full leading-tight ${labelClass}"
        >
          ${translateText("host_modal.player_immunity_duration")}
        </div>
      </div>
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
    const isHumanVsNations =
      this.gameMode === GameMode.Team && this.teamCount === HumansVsNations;
    const maxTimerCard = this.renderMaxTimerCard();
    const spawnImmunityCard = this.renderSpawnImmunityCard();
    const playerCount = this.clients.length;
    const nationCount = this.getEffectiveNationCount();
    const canStart = playerCount >= 2;

    const content = html`
      <div class="max-w-5xl mx-auto space-y-10">
        <!-- Map Selection -->
        ${renderMapSelection({
          selectedMap: this.selectedMap,
          useRandomMap: this.useRandomMap,
          onSelectMap: (map) => this.handleMapSelection(map),
          onSelectRandomMap: this.handleSelectRandomMap,
          specialSectionClassName: "w-full pt-4 border-t border-white/5",
        })}

        <!-- Difficulty Selection -->
        ${renderDifficultySection({
          selectedDifficulty: this.selectedDifficulty,
          disableNations: this.disableNations,
          onSelectDifficulty: (difficulty) =>
            this.handleDifficultySelection(difficulty),
        })}

        <!-- Game Mode -->
        ${renderGameModeSection({
          gameMode: this.gameMode,
          teamCount: this.teamCount,
          onSelectMode: (mode) => this.handleGameModeSelection(mode),
          onSelectTeamCount: (count) => this.handleTeamCountSelection(count),
        })}

        <!-- Game Options -->
        ${renderGameOptionsSection({
          titleKey: "host_modal.options_title",
          botsValue: this.bots,
          botsMin: 0,
          botsMax: 400,
          botsStep: 1,
          botsLabelKey: "host_modal.bots",
          botsDisabledKey: "host_modal.bots_disabled",
          onBotsChange: this.handleBotsChange,
          toggles: [
            {
              labelKey: "host_modal.disable_nations",
              checked: this.disableNations,
              onToggle: this.handleDisableNationsChange,
              hidden: isHumanVsNations,
            },
            {
              labelKey: "host_modal.instant_build",
              checked: this.instantBuild,
              onToggle: this.handleInstantBuildChange,
            },
            {
              labelKey: "host_modal.random_spawn",
              checked: this.randomSpawn,
              onToggle: this.handleRandomSpawnChange,
            },
            {
              labelKey: "host_modal.donate_gold",
              checked: this.donateGold,
              onToggle: this.handleDonateGoldChange,
            },
            {
              labelKey: "host_modal.donate_troops",
              checked: this.donateTroops,
              onToggle: this.handleDonateTroopsChange,
            },
            {
              labelKey: "host_modal.infinite_gold",
              checked: this.infiniteGold,
              onToggle: this.handleInfiniteGoldChange,
            },
            {
              labelKey: "host_modal.infinite_troops",
              checked: this.infiniteTroops,
              onToggle: this.handleInfiniteTroopsChange,
            },
            {
              labelKey: "host_modal.compact_map",
              checked: this.compactMap,
              onToggle: this.handleCompactMapChange,
            },
          ],
          extraCards: [maxTimerCard, spawnImmunityCard],
        })}

        <!-- Enabled Items -->
        ${renderUnitTypeSection({
          titleKey: "host_modal.enables_title",
          disabledUnits: this.disabledUnits,
          toggleUnit: this.toggleUnit.bind(this),
        })}

        <!-- Player List -->
        ${renderLobbyPlayerList({
          count: {
            value: playerCount,
            singularKey: "host_modal.player",
            pluralKey: "host_modal.players",
          },
          secondary: {
            value: nationCount,
            singularKey: "host_modal.nation_player",
            pluralKey: "host_modal.nation_players",
          },
          teamList: {
            gameMode: this.gameMode,
            clients: this.clients,
            lobbyCreatorClientID: this.lobbyCreatorClientID,
            teamCount: this.teamCount,
            nationCount,
            onKickPlayer: (clientID) => this.kickPlayer(clientID),
          },
        })}
      </div>
    `;

    const footer = renderLobbyFooterButton({
      label:
        playerCount === 1
          ? translateText("host_modal.waiting")
          : translateText("host_modal.start"),
      disabled: !canStart,
      onClick: this.startGame,
    });

    return lobbyModalShell({
      header: {
        title: translateText("host_modal.title"),
        onBack: () => {
          this.leaveLobbyOnClose = true;
          this.close();
        },
        ariaLabel: translateText("common.back"),
        rightContent: renderLobbyIdBox({
          lobbyId: this.lobbyId,
          isVisible: this.lobbyIdVisible,
          copySuccess: this.copySuccess,
          onToggleVisibility: () => {
            this.lobbyIdVisible = !this.lobbyIdVisible;
            this.requestUpdate();
          },
          onCopy: this.copyToClipboard,
          toggleTitle: translateText("user_setting.toggle_visibility"),
          copyTitle: translateText("common.click_to_copy"),
          copiedLabel: translateText("common.copied"),
        }),
      },
      content,
      footer,
      inline: this.inline,
    });
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

  private toggleUnit(unit: UnitType, enabled: boolean): void {
    this.disabledUnits = enabled
      ? this.disabledUnits.filter((u) => u !== unit)
      : [...this.disabledUnits, unit];

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
