import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { consolex } from "../core/Consolex";
import { GameConfig, GameInfo } from "../core/Schemas";
import { generateID } from "../core/Util";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { GameMapType } from "../core/game/Game";
import { JoinLobbyEvent } from "./Main";
import { translateText } from "./Utils";
import { BaseGameModal } from "./components/baseComponents/BaseGameModal";

@customElement("host-lobby-modal")
export class HostLobbyModal extends BaseGameModal {
  @state() private lobbyId = "";
  @state() private players: string[] = [];
  @state() private copySuccess = false;

  private playersInterval: NodeJS.Timeout | null = null;

  protected getTranslationPrefix(): string {
    return "host_modal";
  }

  public override async open() {
    try {
      const lobby = await this.createLobby();
      this.lobbyId = lobby.gameID;

      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: this.lobbyId,
            clientID: generateID(),
          } as JoinLobbyEvent,
          bubbles: true,
          composed: true,
        }),
      );

      super.open();
      this.startPolling();
    } catch (error) {
      consolex.error("Failed to create/join lobby:", error);
    }
  }

  public override close() {
    super.close();
    this.copySuccess = false;
    this.stopPolling();
  }

  protected override render() {
    return html`
      <o-modal title=${translateText("host_modal.title")}>
        ${this.renderLobbyIdBox()}
        <div class="options-layout">
          ${this.renderMapSelection()} ${this.renderDifficultySelection()}
          ${this.renderGameModeSelection()}
          ${this.renderTeamSelectionIfApplicable()} ${this.renderGameOptions()}
        </div>

        ${this.renderPlayerList()} ${this.renderStartButton()}
      </o-modal>
    `;
  }

  private renderLobbyIdBox() {
    return html`
      <div class="lobby-id-box">
        <button
          class="lobby-id-button"
          @click=${this.copyToClipboard}
          ?disabled=${this.copySuccess}
        >
          <span class="lobby-id">${this.lobbyId}</span>
          ${this.copySuccess
            ? html`<span class="copy-success-icon">✓</span>`
            : html`
                <svg
                  class="clipboard-icon"
                  stroke="currentColor"
                  fill="currentColor"
                  stroke-width="0"
                  viewBox="0 0 512 512"
                  height="18px"
                  width="18px"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M296 48H176.5C154.4 48 136 65.4 136 87.5V96h-7.5C106.4 
                    96 88 113.4 88 135.5v288c0 22.1 18.4 40.5 40.5 40.5h208c22.1
                     0 39.5-18.4 39.5-40.5V416h8.5c22.1 0 39.5-18.4 
                     39.5-40.5V176L296 48zm0 
                     44.6l83.4 83.4H296V92.6zm48 
                     330.9c0 4.7-3.4 8.5-7.5 8.5h-208c-4.4 
                     0-8.5-4.1-8.5-8.5v-288c0-4.1 3.8-7.5 8.5-7.5h7.5v255.5c0 
                     22.1 10.4 32.5 32.5 32.5H344v7.5zm48-48c0 4.7-3.4 8.5-7.5 
                     8.5h-208c-4.4 0-8.5-4.1-8.5-8.5v-288c0-4.1 3.8-7.5 
                     8.5-7.5H264v128h128v167.5z"
                  ></path>
                </svg>
              `}
        </button>
      </div>
    `;
  }

  private renderPlayerList() {
    return html`
      <div class="options-section">
        <div class="option-title">
          ${this.players.length}
          ${this.players.length === 1
            ? translateText("host_modal.player")
            : translateText("host_modal.players")}
        </div>
        <div class="players-list">
          ${this.players.map((p) => html`<span class="player-tag">${p}</span>`)}
        </div>
      </div>
    `;
  }

  private renderStartButton() {
    return html`
      <div class="start-game-button-container">
        <button
          class="start-game-button"
          ?disabled=${this.players.length < 2}
          @click=${this.startGame}
        >
          ${this.players.length === 1
            ? translateText("host_modal.waiting")
            : translateText("host_modal.start")}
        </button>
      </div>
    `;
  }

  protected override async startGame() {
    if (this.useRandomMap) {
      this.selectedMap = this.getRandomMap();
    }

    await this.putGameConfig();

    consolex.log(
      `Starting private game with map: ${GameMapType[this.selectedMap]}${this.useRandomMap ? " (random)" : ""}`,
    );

    this.close();

    const config = await getServerConfigFromClient();
    await fetch(
      `${window.location.origin}/${config.workerPath(this.lobbyId)}/api/start_game/${this.lobbyId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  private async createLobby(): Promise<GameInfo> {
    const config = await getServerConfigFromClient();
    const id = generateID();
    const res = await fetch(`/${config.workerPath(id)}/api/create_game/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} - Failed to create lobby`);
    }

    return await res.json();
  }

  private async pollPlayers() {
    if (this.lobbyId) {
      const config = await getServerConfigFromClient();
      fetch(`/${config.workerPath(this.lobbyId)}/api/game/${this.lobbyId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      })
        .then((response) => response.json())
        .then((data: GameInfo) => {
          console.log(`got game info response: ${JSON.stringify(data)}`);
          this.players = data.clients?.map((p) => p.username) ?? [];
        });
    }
  }

  private async copyToClipboard() {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/join/${this.lobbyId}`,
      );
      this.copySuccess = true;
      setTimeout(() => {
        this.copySuccess = false;
      }, 2000);
    } catch (err) {
      consolex.error("Clipboard failed:", err);
    }
  }

  private async putGameConfig() {
    const config = await getServerConfigFromClient();
    await fetch(
      `${window.location.origin}/${config.workerPath(this.lobbyId)}/api/game/${this.lobbyId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameMap: this.selectedMap,
          difficulty: this.selectedDifficulty,
          disableNPCs: this.gameOptions["disableNPCs"],
          bots: this.gameOptions["bots"],
          infiniteGold: this.gameOptions["infiniteGold"],
          infiniteTroops: this.gameOptions["infiniteTroops"],
          instantBuild: this.gameOptions["instantBuild"],
          gameMode: this.gameMode,
          playerTeams: this.teamCount,
          disabledUnits: this.disabledUnits,
        } satisfies Partial<GameConfig>),
      },
    );
  }

  protected override botsChangeTimer() {
    this.botsUpdateTimer = window.setTimeout(() => {
      this.putGameConfig();
      this.botsUpdateTimer = null;
    }, 300);
  }

  // Override all toggles to sync with server
  protected override handleMapSelection(value) {
    super.handleMapSelection(value);
    this.putGameConfig();
  }

  protected override handleDifficultySelection(value) {
    super.handleDifficultySelection(value);
    this.putGameConfig();
  }

  protected override handleGameModeSelection(value) {
    super.handleGameModeSelection(value);
    this.putGameConfig();
  }

  protected override handleTeamCountSelection(value) {
    super.handleTeamCountSelection(value);
    this.putGameConfig();
  }

  protected override handleToggleOption(
    option: keyof typeof this.gameOptions,
    e: Event,
  ) {
    super.handleToggleOption(option, e);
    this.putGameConfig();
  }

  protected override toggleUnit(unit, checked) {
    super.toggleUnit(unit, checked);
    this.putGameConfig();
  }

  protected override createRenderRoot() {
    return this;
  }

  private startPolling() {
    if (!this.playersInterval) {
      this.playersInterval = setInterval(() => this.pollPlayers(), 1000);
    }
  }

  private stopPolling() {
    if (this.playersInterval) {
      clearInterval(this.playersInterval);
      this.playersInterval = null;
    }
  }

  connectedCallback() {
    super.connectedCallback?.();
    this.startPolling();
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    this.stopPolling();
  }
}
