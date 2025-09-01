import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import { GameInfo, GameInfoSchema } from "../core/Schemas";
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
import { isLobbyOnChain, joinLobby as joinLobbyOnChain } from "./contract";
import { formatEther } from "viem";

@customElement("join-private-lobby-modal")
export class JoinPrivateLobbyModal extends LitElement {
  @query("o-modal") private readonly modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };
  @query("#lobbyIdInput") private readonly lobbyIdInput!: HTMLInputElement;
  @query("#bettingAmountInput") private readonly bettingAmountInput!: HTMLInputElement;
  @state() private message = "";
  @state() private hasJoined = false;
  @state() private players: string[] = [];
  @state() private bettingAmount = "0.001";
  @state() private showLobbyInfo = false;
  @state() private lobbyHost = "";
  @state() private lobbyBetAmount = "";
  @state() private lobbyParticipants: string[] = [];
  @state() private onChainJoinLoading = false;
  @state() private onChainJoinError = "";

  private playersInterval: ReturnType<typeof setTimeout> | null = null;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.handleKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleKeyDown);
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
          ${this.showLobbyInfo && !this.hasJoined
            ? html`
                <div class="options-section">
                  <div class="option-title">Lobby Information</div>
                  <div class="lobby-info-container" style="margin: 1rem 0; padding: 1rem; border: 1px solid #ccc; border-radius: 8px; background-color: #f9f9f9; color: #000 !important;">
                    <div class="lobby-info-item" style="margin-bottom: 0.5rem; color: #000 !important;">
                      <strong style="color: #000 !important;">Host:</strong> ${this.lobbyHost}
                    </div>
                    <div class="lobby-info-item" style="margin-bottom: 0.5rem; color: #000 !important;">
                      <strong style="color: #000 !important;">Bet Amount:</strong> ${this.lobbyBetAmount} ETH
                    </div>
                    <div class="lobby-info-item" style="margin-bottom: 0.5rem; color: #000 !important;">
                      <strong style="color: #000 !important;">Participants:</strong> ${this.lobbyParticipants.length}
                      ${this.lobbyParticipants.length > 0
                        ? html`
                            <div class="participants-list" style="margin-top: 0.5rem;">
                              ${this.lobbyParticipants.map(
                                (participant) =>
                                  html`<span class="participant-tag" style="display: inline-block; margin: 0.2rem; padding: 0.3rem 0.6rem; background-color: #e0e0e0; border-radius: 4px; font-size: 0.9rem; color: #000 !important;">${participant.slice(0, 6)}...${participant.slice(-4)}</span>`,
                              )}
                            </div>
                          `
                        : ""}
                    </div>
                    ${this.onChainJoinError
                      ? html`
                          <div style="margin-top: 0.5rem; padding: 0.5rem; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; color: #721c24;">
                            <strong>Error:</strong> ${this.onChainJoinError}
                          </div>
                        `
                      : ""}
                  </div>
                </div>
              `
            : ""}
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
          ${!this.hasJoined && !this.showLobbyInfo
            ? html` <o-button
                title=${translateText("private_lobby.join_lobby")}
                block
                @click=${this.joinLobby}
              ></o-button>`
            : ""}
          ${this.showLobbyInfo && !this.hasJoined
            ? html` <o-button
                title=${this.onChainJoinLoading ? "Joining On-Chain..." : "Join Lobby On-Chain"}
                block
                ?disable=${this.onChainJoinLoading}
                @click=${this.joinOnChain}
              ></o-button>`
            : ""}
        </div>
      </o-modal>
    `;
  }

  createRenderRoot() {
    return this; // light DOM
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
    this.bettingAmount = "0.001";
    this.showLobbyInfo = false;
    this.lobbyHost = "";
    this.lobbyBetAmount = "";
    this.lobbyParticipants = [];
    this.onChainJoinLoading = false;
    this.onChainJoinError = "";
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

  private handleBettingAmountChange(e: Event) {
    const { value } = e.target as HTMLInputElement;
    this.bettingAmount = value;
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
    console.log(`Checking lobby with ID: ${lobbyId}`);
    this.message = `${translateText("private_lobby.checking")}`;

    try {
      // First, check if the lobby is deployed on-chain
      console.log("Checking if lobby is deployed on-chain...");
      const isOnChain = await isLobbyOnChain(lobbyId);
      
      if (!isOnChain) {
        this.message = "This lobby has not been deployed on-chain. Please ask the host to deploy it first.";
        return;
      }

      console.log("Lobby is deployed on-chain, fetching lobby information...");

      // Fetch and display lobby information
      await this.fetchLobbyInfo(lobbyId);

    } catch (error) {
      console.error("Error checking lobby existence:", error);
      this.message = `${translateText("private_lobby.error")}`;
    }
  }

  private async fetchLobbyInfo(lobbyId: string): Promise<void> {
    try {
      // Import the readContract function to get lobby details
      const { readContract } = await import("@wagmi/core");
      const { wagmiConfig } = await import("./wallet");

      // Import the contract functions that handle ID conversion properly
      const { getLobbyInfo } = await import("./contract");
      
      // Use the contract function which handles the ID conversion internally
      const lobbyInfo = await getLobbyInfo(lobbyId);
      
      if (!lobbyInfo || !lobbyInfo.exists) {
        this.message = "Lobby not found or doesn't exist on-chain.";
        return;
      }

      const { host, betAmount, participants, status, winner, totalPrize } = lobbyInfo;

      // Display lobby information
      this.lobbyHost = `${host.slice(0, 6)}...${host.slice(-4)}`;
      this.lobbyBetAmount = formatEther(betAmount);
      this.lobbyParticipants = participants;
      this.showLobbyInfo = true;
      this.message = `Lobby found! Review the information below and click "Join Lobby On-Chain" to participate.`;

    } catch (error) {
      console.error("Error fetching lobby info:", error);
      this.message = "Error fetching lobby information. Please try again.";
    }
  }

  private async joinOnChain(): Promise<void> {
    const lobbyId = this.lobbyIdInput.value;
    
    this.onChainJoinLoading = true;
    this.onChainJoinError = "";

    try {
      console.log("Joining lobby on-chain...");
      
      // Call the joinLobby function from contract.ts
      const result = await joinLobbyOnChain({ lobbyId });
      
      console.log("Successfully joined lobby on-chain:", result);
      
      this.message = "Successfully joined on-chain! Now joining the game lobby...";

      // After successful on-chain join, proceed with regular lobby join
      await this.proceedWithLobbyJoin(lobbyId);

    } catch (error: any) {
      console.error("Error joining lobby on-chain:", error);
      this.onChainJoinError = error.message || "Failed to join lobby on-chain";
    } finally {
      this.onChainJoinLoading = false;
    }
  }

  private async getCurrentWalletAddress(): Promise<string | undefined> {
    try {
      const { getCurrentWalletAddress } = await import("./wallet");
      const address = getCurrentWalletAddress();
      console.log("JoinPrivateLobbyModal: Getting current wallet address:", address);
      return address;
    } catch (error) {
      console.warn("JoinPrivateLobbyModal: Failed to get wallet address:", error);
      return undefined;
    }
  }

  private async proceedWithLobbyJoin(lobbyId: string): Promise<void> {
    try {
      // Check if the game exists in active lobbies
      const gameExists = await this.checkActiveLobby(lobbyId);
      if (gameExists) return;

      // If not active, check archived games
      const archivedGame = await this.checkArchivedGame(lobbyId);
      if (archivedGame) return;

      this.message = `${translateText("private_lobby.not_found")}`;
    } catch (error) {
      console.error("Error joining lobby:", error);
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

      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: lobbyId,
            clientID: getClientID(lobbyId),
            bettingAmount: this.bettingAmount,
            walletAddress: await this.getCurrentWalletAddress(),
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
            bettingAmount: this.bettingAmount,
            walletAddress: await this.getCurrentWalletAddress(),
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
      })
      .catch((error) => {
        console.error("Error polling players:", error);
      });
  }
}
