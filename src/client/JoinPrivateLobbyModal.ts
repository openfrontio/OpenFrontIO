import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import { ClientInfo, GameInfo, GameInfoSchema } from "../core/Schemas";
import { LitElement, html } from "lit";
import {
  WorkerApiArchivedGameLobbySchema,
  WorkerApiGameIdExistsSchema,
} from "../core/WorkerSchemas";
import { customElement, query, state } from "lit/decorators.js";
import { JoinLobbyEvent } from "./Main";
import { getClientID } from "../core/Util";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { translateText } from "../client/Utils";

@customElement("join-private-lobby-modal")
export class JoinPrivateLobbyModal extends LitElement {
  @query("o-modal") private readonly modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };
  @query("#lobbyIdInput") private readonly lobbyIdInput!: HTMLInputElement;
  @state() private message = "";
  @state() private hasJoined = false;
  @state() private players: string[] = [];
  @state() private clients: ClientInfo[] = [];
  @state() private lobbyCreatorClientID = "";
  @state() private currentClientID = "";

  private playersInterval: ReturnType<typeof setTimeout> | null = null;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("lobby-creator-changed", this.handleLobbyCreatorChanged as EventListener);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("lobby-creator-changed", this.handleLobbyCreatorChanged as EventListener);
    super.disconnectedCallback();
  }

  private readonly handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      e.preventDefault();
      this.close();
    }
  };

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
                d="M 15 3 C 13.742188 3 12.847656 3.890625 12.40625 5 L 5 5 L 5
                28 L 13 28 L 13 30 L 27 30 L 27 14 L 25 14 L 25 5 L 17.59375 5
                C 17.152344 3.890625 16.257813 3 15 3 Z M 15 5 C 15.554688 5 16
                5.445313 16 6 L 16 7 L 19 7 L 19 9 L 11 9 L 11 7 L 14 7 L 14 6
                C 14 5.445313 14.445313 5 15 5 Z M 7 7 L 9 7 L 9 11 L 21 11 L
                21 7 L 23 7 L 23 14 L 13 14 L 13 26 L 7 26 Z M 15 16 L 25 16 L
                25 28 L 15 28 Z"
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
        <!-- Show message when user becomes lobby creator -->
        ${this.hasJoined && this.isLobbyCreator
          ? html`
            <div class="bg-gray-200 border border-gray-400 rounded p-4 mt-4 text-center">
              <p class="text-gray-800 font-medium mb-2">You are now the lobby host</p>
              <p class="text-gray-700 text-sm">Loading host controls...</p>
            </div>
          `
          : ""}

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

  private readonly handleLobbyCreatorChanged = (e: Event) => {
    const { newCreatorID, newCreatorUsername } = (e as CustomEvent).detail;
    console.log(`Lobby creator changed to ${newCreatorUsername} (${newCreatorID})`);

    // Update the lobby creator ID
    this.lobbyCreatorClientID = newCreatorID;

    // Show notification to user
    this.showLobbyCreatorChangeNotification(newCreatorUsername);

    // Check if current user is now the lobby creator
    if (this.currentClientID === newCreatorID) {
      console.log("Current user is now the lobby creator!");
      // Show additional notification for the new creator
      setTimeout(() => {
        this.showNewCreatorNotification();
      }, 3500); // Show after the first notification

      // Switch to the existing host lobby modal
      setTimeout(() => {
        this.switchToExistingHostModal();
      }, 4000); // Switch after notifications
    }

    // Trigger re-render to update UI
    this.requestUpdate();
  };

  private showLobbyCreatorChangeNotification(newCreatorUsername: string) {
    // Create a temporary notification element
    const notification = document.createElement('div');
    notification.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 transition-opacity duration-300';
    notification.textContent = `${newCreatorUsername} is now the lobby host`;

    document.body.appendChild(notification);

    // Remove notification after 3 seconds
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => {
        document.body.removeChild(notification);
      }, 300);
    }, 3000);
  }

  private showNewCreatorNotification() {
    // Create a temporary notification element for the new creator
    const notification = document.createElement('div');
    notification.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 transition-opacity duration-300';
    notification.textContent = 'You are now the lobby host! Loading host menu...';

    document.body.appendChild(notification);

    // Remove notification after 4 seconds
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => {
        document.body.removeChild(notification);
      }, 300);
    }, 4000);
  }

  private showHostInstructions() {
    // Create a helpful instruction notification
    const notification = document.createElement('div');
    notification.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 transition-opacity duration-300 max-w-md text-center';
    notification.innerHTML = `
      <div class="font-semibold mb-1">You're the new lobby host!</div>
      <div class="text-sm">Close this window and click "Create Lobby" to access admin controls</div>
    `;

    document.body.appendChild(notification);

    // Remove notification after 8 seconds
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => {
        if (document.body.contains(notification)) {
          document.body.removeChild(notification);
        }
      }, 300);
    }, 8000);
  }

  private switchToHostModal() {
    console.log("Switching to host modal as new lobby creator");

    try {
      // Get the host lobby modal and open it with the current lobby
      const hostModal = document.querySelector('host-lobby-modal') as any;
      if (hostModal) {
        // Set the lobby ID and creator ID on the host modal
        hostModal.lobbyId = this.lobbyIdInput.value;
        hostModal.lobbyCreatorClientID = this.currentClientID;

        console.log(`Setting host modal: lobbyId=${hostModal.lobbyId}, creatorID=${hostModal.lobbyCreatorClientID}`);

        // Close the current join modal first
        this.close();

        // Small delay to ensure the join modal is closed before opening host modal
        setTimeout(() => {
          try {
            // Open the host modal
            hostModal.openExistingLobby();
          } catch (error) {
            console.error("Error opening host modal:", error);
            // Fallback: just show a notification that they are now the host
            this.showFallbackHostNotification();
          }
        }, 100);
      } else {
        console.error("Host lobby modal not found");
        this.showFallbackHostNotification();
      }
    } catch (error) {
      console.error("Error in switchToHostModal:", error);
      this.showFallbackHostNotification();
    }
  }

  private showFallbackHostNotification() {
    // Create a fallback notification if modal switching fails
    const notification = document.createElement('div');
    notification.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 bg-orange-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 transition-opacity duration-300';
    notification.textContent = 'You are now the lobby host! Please refresh the page to access admin controls.';

    document.body.appendChild(notification);

    // Remove notification after 6 seconds
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => {
        if (document.body.contains(notification)) {
          document.body.removeChild(notification);
        }
      }, 300);
    }, 6000);
  }

  private get isLobbyCreator(): boolean {
    return !!(this.currentClientID && this.lobbyCreatorClientID &&
              this.currentClientID === this.lobbyCreatorClientID);
  }

  private switchToExistingHostModal() {
    console.log("Switching to existing host lobby modal");

    try {
      // Get the host lobby modal element
      const hostModal = document.querySelector('host-lobby-modal') as any;
      if (!hostModal) {
        console.error("Host lobby modal not found");
        return;
      }

      // Set the properties needed for the existing lobby
      hostModal.lobbyId = this.lobbyIdInput.value;
      hostModal.lobbyCreatorClientID = this.currentClientID;

      console.log(`Switching to host modal with lobbyId: ${hostModal.lobbyId}, creatorID: ${hostModal.lobbyCreatorClientID}`);

      // Close this modal first
      this.close();

      // Small delay to ensure clean transition
      setTimeout(() => {
        try {
          // Open the existing host lobby modal
          hostModal.openExistingLobby();
        } catch (error) {
          console.error("Error opening existing host modal:", error);
        }
      }, 200);

    } catch (error) {
      console.error("Error in switchToExistingHostModal:", error);
    }
  }

  private async startGame() {
    if (!this.isLobbyCreator) {
      console.error("Only the lobby creator can start the game");
      return;
    }

    const lobbyId = this.lobbyIdInput.value;
    console.log(`Starting private game with lobby ID: ${lobbyId}`);

    try {
      const config = await getServerConfigFromClient();
      const response = await fetch(
        `${window.location.origin}/${config.workerPath(lobbyId)}/api/start_game/${lobbyId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to start game: ${response.statusText}`);
      }

      console.log("Game started successfully");
      this.close();
    } catch (error) {
      console.error("Error starting game:", error);
    }
  }

  public open(id = "") {
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

  private extractLobbyIdFromUrl(input: string): string {
    if (input.startsWith("http")) {
      if (input.includes("#join=")) {
        const params = new URLSearchParams(input.split("#")[1]);
        return params.get("join") ?? input;
      } else if (input.includes("join/")) {
        return input.split("join/")[1];
      } else {
        return input;
      }
    } else {
      return input;
    }
  }

  private setLobbyId(id: string) {
    this.lobbyIdInput.value = this.extractLobbyIdFromUrl(id);
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

    const json = await response.json();
    const gameInfo = WorkerApiGameIdExistsSchema.parse(json);

    if (gameInfo.exists) {
      this.message = translateText("private_lobby.joined_waiting");
      this.hasJoined = true;

      // Store the current client ID so we can check if we become the lobby creator
      this.currentClientID = getClientID(lobbyId);

      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: lobbyId,
            clientID: this.currentClientID,
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

    const json = await archiveResponse.json();
    const archiveData = WorkerApiArchivedGameLobbySchema.parse(json);

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
      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: lobbyId,
            gameRecord: archiveData.gameRecord,
            clientID: getClientID(lobbyId),
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
      .then(GameInfoSchema.parse)
      .then((data: GameInfo) => {
        this.players = data.clients?.map((p) => p.username) ?? [];
        this.clients = data.clients ?? [];

        // Update lobby creator ID from server response
        if (data.lobbyCreatorID && !this.lobbyCreatorClientID) {
          this.lobbyCreatorClientID = data.lobbyCreatorID;
          console.log(`Lobby creator ID from server: ${this.lobbyCreatorClientID}`);
        }
      })
      .catch((error) => {
        console.error("Error polling players:", error);
      });
  }
}
