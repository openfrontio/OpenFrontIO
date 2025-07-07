import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";

import { GameInfo, GameRecord } from "../../../core/Schemas";
import { generateID } from "../../../core/Util";
import { getServerConfigFromClient } from "../../../core/configuration/ConfigLoader";
import { JoinLobbyEvent } from "../../Main";
import { translateText } from "../../Utils";

@customElement("join-private-lobby-modal")
export class JoinPrivateLobbyModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };
  @query("#lobbyIdInput") private lobbyIdInput!: HTMLInputElement;
  @state() private message: string = "";
  @state() private messageType: "success" | "error" | "" = "";
  @state() private hasJoined = false;
  @state() private players: string[] = [];

  private playersInterval: NodeJS.Timeout | null = null;

  createRenderRoot() {
    return this;
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
    this.messageType = ""; // Reset messageType
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
    this.messageType = "";

    try {
      const gameExists = await this.checkActiveLobby(lobbyId);
      if (gameExists) return;

      const archivedGame = await this.checkArchivedGame(lobbyId);
      if (archivedGame) return;

      this.message = `${translateText("private_lobby.not_found")}`;
      this.messageType = "error";
    } catch (error) {
      console.error("Error checking lobby existence:", error);
      this.message = `${translateText("private_lobby.error")}`;
      this.messageType = "error";
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
      this.messageType = "success";
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
      this.messageType = "error";
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
  render() {
    return html`
      <o-modal
        disableContentScroll
        width="small"
        title=${translateText("private_lobby.title")}
      >
        <div class="space-y-6">
          <div class="background-panel p-4 mb-6">
            <div class="relative">
              <label
                for="lobbyIdInput"
                class="block font-title text-textLight mb-2"
              >
                ${translateText("private_lobby.enter_id")}
              </label>
              <div class="relative">
                <input
                  type="text"
                  id="lobbyIdInput"
                  placeholder=${translateText("private_lobby.enter_id")}
                  @keyup=${this.handleChange}
                  class="w-full px-4 py-3 bg-backgroundDark border-2 border-borderBase font-title text-textLight placeholder-textGrey focus:outline-none focus:border-primary"
                />
                <button
                  @click=${this.pasteFromClipboard}
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-textGrey hover:text-textLight transition-colors p-0 h-auto leading-none inline-flex items-center"
                >
                  <o-icon
                    src="icons/copy.svg"
                    size="medium"
                    color="var(--text-color-grey)"
                  ></o-icon>
                </button>
              </div>
            </div>
            <div
              class="${this.message
                ? `block mt-4 text-sm ${this.messageType === "success" ? "text-green" : "text-red"}`
                : "hidden"}"
            >
              ${this.message}
            </div>
            ${this.hasJoined && this.players?.length > 0
              ? html`
                  <div class="grid grid-cols-1 gap-6 my-6">
                    <div class="background-panel px-6 py-3">
                      <div
                        class="font-title mb-4 text-large text-textLight text-center"
                      >
                        ${this.players.length}
                        ${this.players.length === 1
                          ? translateText("private_lobby.player")
                          : translateText("private_lobby.players")}
                      </div>
                      <div class="flex flex-wrap gap-2 justify-center px-4">
                        ${this.players.map(
                          (player) =>
                            html`<span
                              class="background-panel flex items-center justify-center px-4 py-1 text-small"
                              >${player}</span
                            >`,
                        )}
                      </div>
                    </div>
                  </div>
                `
              : ""}
          </div>

          ${!this.hasJoined
            ? html`
                <o-button
                  title="Join Lobby"
                  translationKey="main.join_lobby"
                  icon="icons/users.svg"
                  @click=${this.joinLobby}
                ></o-button>
              `
            : ""}
        </div>
      </o-modal>
    `;
  }
}
