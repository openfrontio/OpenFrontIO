import { LitElement, css, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { consolex } from "../core/Consolex";
import { GameMapType, GameType } from "../core/game/Game";

@customElement("join-private-lobby-modal")
export class JoinPrivateLobbyModal extends LitElement {
  @state() private isModalOpen = false;
  @state() private message: string = "";
  @query("#lobbyIdInput") private lobbyIdInput!: HTMLInputElement;
  @state() private hasJoined = false;
  @state() private players: string[] = [];

  private playersInterval = null;

  static styles = css`
    .modal-overlay {
      display: none;
      position: fixed;
      z-index: 1000;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      overflow-y: auto;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .modal-content {
      background-color: rgb(35 35 35 / 0.8);
      -webkit-backdrop-filter: blur(12px);
      backdrop-filter: blur(12px);
      color: white;
      padding: 20px;
      border-radius: 8px;
      width: 80%;
      max-width: 500px;
      max-height: 80vh;
      overflow-y: auto;
      text-align: center;
      box-shadow: 0 0 40px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(8px);
      position: relative;
    }

    /* Add custom scrollbar styles */
    .modal-content::-webkit-scrollbar {
      width: 8px;
    }

    .modal-content::-webkit-scrollbar-track {
      background: rgba(0, 0, 0, 0.1);
      border-radius: 4px;
    }

    .modal-content::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 4px;
    }

    .modal-content::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    .title {
      font-size: 28px;
      color: #fff;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 0 0 20px;
    }

    .close {
      color: #aaa;
      float: right;
      font-size: 28px;
      font-weight: bold;
      cursor: pointer;
    }

    .close:hover,
    .close:focus {
      color: white;
      text-decoration: none;
      cursor: pointer;
    }

    .start-game-button {
      width: 100%;
      max-width: 300px;
      padding: 15px 20px;
      font-size: 16px;
      cursor: pointer;
      background-color: #007bff;
      color: white;
      border: none;
      border-radius: 8px;
      transition: background-color 0.3s;
      display: inline-block;
      margin: 0 0 20px 0;
    }

    .start-game-button:not(:disabled):hover {
      background-color: #0056b3;
    }

    .start-game-button:disabled {
      background: linear-gradient(to right, #4a4a4a, #3d3d3d);
      opacity: 0.7;
      cursor: not-allowed;
    }

    /* JoinPrivateLobbyModal css */

    .message-area {
      margin-top: 10px;
      padding: 10px;
      border-radius: 4px;
      font-size: 14px;
      transition: opacity 0.3s ease;
      opacity: 0;
      height: 0;
      overflow: hidden;
    }

    .message-area.show {
      opacity: 1;
      height: auto;
      margin-bottom: 10px;
    }

    .message-area.error {
      background-color: #ffebee;
      color: #c62828;
    }

    .message-area.success {
      background-color: #e8f5e9;
      color: #2e7d32;
    }

    .lobby-id-box {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      margin: 40px 0px 0px 0px;
    }
    .lobby-id-box input {
      flex-grow: 1;
      max-width: 200px;
      padding: 10px;
      font-size: 16px;
      border: 1px solid #ccc;
      border-radius: 8px;
    }

    .lobby-id-paste-button {
      display: flex;
      align-items: center;
      background: rgba(0, 0, 0, 0.2);
      padding: 10px 16px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      cursor: pointer;
      transition: all 0.2s ease-in-out;
    }

    .lobby-id-paste-button:hover {
      background: rgba(0, 0, 0, 0.3);
      border-color: rgba(255, 255, 255, 0.2);
      transform: translateY(-1px);
    }

    .lobby-id-paste-button-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
    }

    .options-section {
      background: rgba(0, 0, 0, 0.2);
      padding: 12px 24px 24px 24px;
      border-radius: 12px;
    }

    .option-title {
      margin: 0 0 16px 0;
      font-size: 20px;
      color: #fff;
      text-align: center;
    }

    .players-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
      padding: 0 16px;
    }

    .player-tag {
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.1);
      padding: 4px 16px;
      border-radius: 16px;
      font-size: 14px;
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    @media screen and (max-width: 768px) {
      .modal-content {
        max-height: calc(90vh - 42px);
        max-width: 100vw;
        width: 100%;
      }
  `;

  render() {
    return html`
      <div
        class="modal-overlay"
        style="display: ${this.isModalOpen ? "flex" : "none"}"
      >
        <div class="modal-content">
          <span class="close" @click=${this.closeAndLeave}>&times;</span>
          <div class="title">Join Private Lobby</div>
          <div class="lobby-id-box">
            <input
              type="text"
              id="lobbyIdInput"
              placeholder="Enter Lobby ID"
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
            <!-- Lobby Selection -->
            ${this.hasJoined && this.players.length > 0
              ? html`<div class="options-section">
                  <div class="option-title">
                    ${this.players.length}
                    ${this.players.length === 1 ? "Player" : "Players"}
                  </div>

                  <div class="players-list">
                    ${this.players.map(
                      (player) =>
                        html`<span class="player-tag">${player}</span>`,
                    )}
                  </div>
                </div>`
              : ""}
          </div>
          ${!this.hasJoined
            ? html`<button class="start-game-button" @click=${this.joinLobby}>
                Join Lobby
              </button>`
            : ""}
        </div>
      </div>
    `;
  }

  public open(id: string = "") {
    this.isModalOpen = true;

    if (id) {
      this.setLobbyId(id);
      this.joinLobby();
    }
  }

  public close() {
    this.isModalOpen = false;
    this.lobbyIdInput.value = null;
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
      consolex.error("Failed to read clipboard contents: ", err);
    }
  }

  private joinLobby() {
    const lobbyId = this.lobbyIdInput.value;
    consolex.log(`Joining lobby with ID: ${lobbyId}`);
    this.message = "Checking lobby..."; // Set initial message

    fetch(`/lobby/${lobbyId}/exists`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.exists) {
          this.message = "Joined successfully! Waiting for game to start...";
          this.hasJoined = true;
          this.dispatchEvent(
            new CustomEvent("join-lobby", {
              detail: {
                lobby: { id: lobbyId },
                gameType: GameType.Private,
                map: GameMapType.World,
              },
              bubbles: true,
              composed: true,
            }),
          );
          this.playersInterval = setInterval(() => this.pollPlayers(), 1000);
        } else {
          this.message = "Lobby not found. Please check the ID and try again.";
        }
      })
      .catch((error) => {
        consolex.error("Error checking lobby existence:", error);
        this.message = "An error occurred. Please try again.";
      });
  }

  private async pollPlayers() {
    if (!this.lobbyIdInput?.value) return;

    fetch(`/lobby/${this.lobbyIdInput.value}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((response) => response.json())
      .then((data) => {
        this.players = data.players.map((p) => p.username);
      })
      .catch((error) => {
        consolex.error("Error polling players:", error);
      });
  }
}
