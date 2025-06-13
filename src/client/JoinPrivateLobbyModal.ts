import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { GameInfo, GameRecord } from "../core/Schemas";
import { generateID } from "../core/Util";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { JoinLobbyEvent } from "./Main";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
@customElement("join-private-lobby-modal")
export class JoinPrivateLobbyModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };
  @query("#lobbyIdInput") private lobbyIdInput!: HTMLInputElement;
  @state() private message: string = "";
  @state() private hasJoined = false;
  @state() private players: string[] = [];

  private playersInterval: NodeJS.Timeout | null = null;

  render() {
    return html`
      <o-modal title=${translateText("private_lobby.title")}>
        <div class="lobby-id-box">
          <input
            type="text"
            id="lobbyIdInput"
            placeholder=${translateText("private_lobby.enter_id")}
            @keyup=${this.handleChange}
          />
          <button
            @click=${this.pasteFromClipboard}
            class="lobby-id-paste-button"
          >
            <svg
              class="lobby-id-paste-button-icon"
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
            </svg>
          </button>
        </div>
        <div class="message-area ${this.message ? "show" : ""}">
          ${this.message}
        </div>
        <div class="options-layout">
          ${this.hasJoined && this.players.length > 0
            ? html` <div class="options-section">
                <div class="option-title">
                  ${this.players.length}
                  ${this.players.length === 1
                    ? translateText("private_lobby.player")
                    : translateText("private_lobby.players")}
                </div>

                <div class="players-list">
                  ${this.players.map(
                    (player) => html`<span class="player-tag">${player}</span>`,
                  )}
                </div>
              </div>`
            : ""}
        </div>
        <div class="flex justify-center">
          ${!this.hasJoined
            ? html` <o-button
                title=${translateText("private_lobby.join_lobby")}
                block
                @click=${this.joinLobby}
              ></o-button>`
            : ""}
        </div>
      </o-modal>
    `;
  }

  createRenderRoot() {
    return this; // light DOM
  }

  public open(id: string = "") {
    this.modalEl?.open();
    if (id) {
      this.setLobbyId(id);
      this.joinLobby();
    }
  }

  public close() {
    this.lobbyIdInput.value = "";
    this.modalEl?.close();
    if (this.playersInterval) {
      clearInterval(this.playersInterval);
      this.playersInterval = null;
    }
  }

  public closeAndLeave() {
    this.close();
    this.hasJoined = false;
    this.message = "";
    this.dispatchEvent(
      new CustomEvent("leave-lobby", {
        detail: { lobby: this.lobbyIdInput.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private setLobbyId(id: string) {
    if (id.startsWith("http")) {
      this.lobbyIdInput.value = id.split("join/")[1];
    } else {
      this.lobbyIdInput.value = id;
    }
  }

  private handleChange(e: Event) {
    const value = (e.target as HTMLInputElement).value.trim();
    this.setLobbyId(value);
  }

  private async pasteFromClipboard() {
    try {
      const clipText = await navigator.clipboard.readText();

      let lobbyId: string;
      if (clipText.startsWith("http")) {
        lobbyId = clipText.split("join/")[1];
      } else {
        lobbyId = clipText;
      }

      this.lobbyIdInput.value = lobbyId;
    } catch (err) {
      console.error("Failed to read clipboard contents: ", err);
    }
  }

  private async joinLobby(): Promise<void> {
    const lobbyId = this.lobbyIdInput.value;
    console.log(`Joining lobby with ID: ${lobbyId}`);
    this.message = `${translateText("private_lobby.checking")}`;

    try {
      // First, check if the game exists in active lobbies
      const gameExists = await this.checkActiveLobby(lobbyId);
      if (gameExists) return;

      // If not active, check archived games
      const archivedGame = await this.checkArchivedGame(lobbyId);
      if (archivedGame) return;

      this.message = `${translateText("private_lobby.not_found")}`;
    } catch (error) {
      console.error("Error checking lobby existence:", error);
      this.message = `${translateText("private_lobby.error")}`;
    }
  }

  private async checkActiveLobby(lobbyId: string): Promise<boolean> {
    const config = await getServerConfigFromClient();
    const url = `/${config.workerPath(lobbyId)}/api/game/${lobbyId}/exists`;

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const gameInfo = await response.json();

    if (gameInfo.exists) {
      this.message = translateText("private_lobby.joined_waiting");
      this.hasJoined = true;

      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: lobbyId,
            clientID: generateID(),
          } as JoinLobbyEvent,
          bubbles: true,
          composed: true,
        }),
      );

      this.playersInterval = setInterval(() => this.pollPlayers(), 1000);
      return true;
    }

    return false;
  }

  private async checkArchivedGame(lobbyId: string): Promise<boolean> {
    const config = await getServerConfigFromClient();
    const archiveUrl = `/${config.workerPath(lobbyId)}/api/archived_game/${lobbyId}`;

    const archiveResponse = await fetch(archiveUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const archiveData = await archiveResponse.json();

    if (
      archiveData.success === false &&
      archiveData.error === "Version mismatch"
    ) {
      console.warn(
        `Git commit hash mismatch for game ${lobbyId}`,
        archiveData.details,
      );
      this.message =
        "This game was created with a different version. Cannot join.";
      return true;
    }

    if (archiveData.exists) {
      const gameRecord = archiveData.gameRecord as GameRecord;

      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: lobbyId,
            gameRecord: gameRecord,
            clientID: generateID(),
          } as JoinLobbyEvent,
          bubbles: true,
          composed: true,
        }),
      );

      return true;
    }

    return false;
  }

  private async pollPlayers() {
    if (!this.lobbyIdInput?.value) return;
    const config = await getServerConfigFromClient();

    fetch(
      `/${config.workerPath(this.lobbyIdInput.value)}/api/game/${this.lobbyIdInput.value}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
    )
      .then((response) => response.json())
      .then((data: GameInfo) => {
        this.players = data.clients?.map((p) => p.username) ?? [];
      })
      .catch((error) => {
        console.error("Error polling players:", error);
      });
  }
}
