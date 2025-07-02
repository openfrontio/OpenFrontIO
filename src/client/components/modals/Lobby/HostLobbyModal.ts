import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getServerConfigFromClient } from "../../../../core/configuration/ConfigLoader";
import { consolex } from "../../../../core/Consolex";
import { GameMapType } from "../../../../core/game/Game";
import { GameInfo } from "../../../../core/Schemas";
import { generateID } from "../../../../core/Util";
import { JoinLobbyEvent } from "../../../Main";
import { translateText } from "../../../Utils";
import { BaseGameSetupModal } from "./BaseGameSetupModal";
import { Step } from "./GameSetupComponents";

@customElement("host-lobby-modal")
export class HostLobbyModal extends BaseGameSetupModal {
  @state() private lobbyId = "";
  @state() private copySuccess = false;
  @state() private players: string[] = [];
  private playersInterval: NodeJS.Timeout | null = null;

  protected steps: Step[] = ["map", "difficulty", "mode", "options", "waiting"];
  protected isSinglePlayer = false;

  protected getModalTitle(): string {
    return translateText("host_modal.title");
  }

  protected initialize() {
    createLobby().then((lobby) => {
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
    });
    this.playersInterval = setInterval(() => this.pollPlayers(), 1000);
  }

  protected cleanup() {
    this.copySuccess = false;
    if (this.playersInterval) {
      clearInterval(this.playersInterval);
      this.playersInterval = null;
    }
  }

  protected async onConfigChange() {
    const config = await getServerConfigFromClient();
    await fetch(
      `${window.location.origin}/${config.workerPath(this.lobbyId)}/api/game/${this.lobbyId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gameMap: this.gameSetupConfig.selectedMap,
          difficulty: this.gameSetupConfig.selectedDifficulty,
          disableNPCs: this.gameSetupConfig.disableNPCs,
          bots: this.gameSetupConfig.bots,
          infiniteGold: this.gameSetupConfig.infiniteGold,
          infiniteTroops: this.gameSetupConfig.infiniteTroops,
          instantBuild: this.gameSetupConfig.instantBuild,
          gameMode: this.gameSetupConfig.gameMode,
          disabledUnits: this.gameSetupConfig.disabledUnits,
          playerTeams: this.gameSetupConfig.teamCount,
        }),
      },
    );
  }

  protected async handleStartGame() {
    if (this.gameSetupConfig.useRandomMap) {
      this.gameSetupConfig.selectedMap = this.getRandomMap();
    }
    await this.onConfigChange();
    consolex.log(
      `Starting private game with map: ${GameMapType[this.gameSetupConfig.selectedMap]} ${this.gameSetupConfig.useRandomMap ? " (Randomly selected)" : ""}`,
    );
    this.close();
    const config = await getServerConfigFromClient();
    await fetch(
      `${window.location.origin}/${config.workerPath(this.lobbyId)}/api/start_game/${this.lobbyId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }

  protected isStartGameDisabled(): boolean {
    return this.currentStep === "waiting" && this.players.length < 2;
  }

  protected getPlayers(): string[] {
    return this.players;
  }

  protected renderLobbyIdSection() {
    return html`
      <div class="flex items-center gap-2">
        <div class="px-4 py-2 background-panel flex items-center gap-2">
          <span class="text-textLight font-base">${this.lobbyId}</span>
          <button
            @click=${this.copyToClipboard}
            class="flex text-textGrey hover:text-textLight transition-colors"
            ?disabled=${this.copySuccess}
          >
            ${this.copySuccess
              ? html`<span class="text-green">✓</span>`
              : html`<o-icon
                  src="icons/copy.svg"
                  size="medium"
                  color="var(--text-color-grey)"
                ></o-icon>`}
          </button>
        </div>
      </div>
    `;
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
      consolex.error(`Failed to copy text: ${err}`);
    }
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
        console.log(`got game info response: ${JSON.stringify(data)}`);
        this.players = data.clients?.map((p) => p.username) ?? [];
      });
  }
}

async function createLobby(): Promise<GameInfo> {
  const config = await getServerConfigFromClient();
  try {
    const id = generateID();
    const response = await fetch(
      `/${config.workerPath(id)}/api/create_game/${id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    consolex.log("Success:", data);
    return data as GameInfo;
  } catch (error) {
    consolex.error("Error creating lobby:", error);
    throw error;
  }
}
