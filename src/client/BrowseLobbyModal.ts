import "./components/baseComponents/Modal";
import "./BrowseLobbyModal.css";
import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import {
  getAllPublicLobbiesWithDetails,
  joinLobby,
  connectWallet,
  GameStatus,
  type PublicLobbyInfo,
  type JoinLobbyParams,
  type JoinLobbyResult
} from "./contract";
import { JoinLobbyEvent } from "./Main";
import { translateText } from "../client/Utils";
import { getClientID } from "../core/Util";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { apiFetch } from "./ApiClient";

@customElement("browse-lobby-modal")
export class BrowseLobbyModal extends LitElement {
  @query("o-modal") private readonly modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private lobbies: PublicLobbyInfo[] = [];
  @state() private isLoading = false;
  @state() private error = "";
  @state() private joiningLobbyId = "";
  @state() private joinError = "";
  @state() private hasJoined = false;
  @state() private players: string[] = [];
  @state() private showLobbyInfo = false;
  @state() private currentLobby: PublicLobbyInfo | null = null;

  private playersInterval: ReturnType<typeof setTimeout> | null = null;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.handleKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleKeyDown);
    if (this.playersInterval) {
      clearInterval(this.playersInterval);
    }
    super.disconnectedCallback();
  }

  private readonly handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      e.preventDefault();
      this.close();
    }
  };

  createRenderRoot() {
    return this;
  }

  public open() {
    this.modalEl?.open();
    this.fetchPublicLobbies();
  }

  public close() {
    this.modalEl?.close();
    this.error = "";
    this.joinError = "";
    this.joiningLobbyId = "";
  }

  private async fetchPublicLobbies() {
    try {
      this.isLoading = true;
      this.error = "";

      const lobbies = await getAllPublicLobbiesWithDetails();
      this.lobbies = lobbies;

      console.log(`Fetched ${lobbies.length} public lobbies`);
    } catch (error) {
      console.error('Error fetching public lobbies:', error);
      this.error = error instanceof Error ? error.message : 'Failed to fetch lobbies';
    } finally {
      this.isLoading = false;
    }
  }

  private async refreshLobbies() {
    await this.fetchPublicLobbies();
  }

  private async joinLobbyAction(lobby: PublicLobbyInfo) {
    if (this.joiningLobbyId) return; // Prevent double-clicking

    try {
      this.joiningLobbyId = lobby.lobbyId;
      this.joinError = "";

      console.log(`Joining lobby ${lobby.lobbyId} with bet amount ${lobby.formattedBetAmount} ETH`);

      // First, join the blockchain lobby (pays the betting fee)
      const result = await joinLobby({
        lobbyId: lobby.lobbyId
      });

      console.log('Successfully joined blockchain lobby:', result);

      // After successful on-chain join, proceed with regular lobby join
      await this.proceedWithLobbyJoin(lobby);

    } catch (error) {
      console.error('Error joining lobby:', error);
      this.joinError = error instanceof Error ? error.message : 'Failed to join lobby';
    } finally {
      this.joiningLobbyId = "";
    }
  }

  private async proceedWithLobbyJoin(lobby: PublicLobbyInfo): Promise<void> {
    try {
      // Store current lobby info
      this.currentLobby = lobby;
      this.hasJoined = true;
      this.showLobbyInfo = true;

      // Show success message and lobby participants
      this.joinError = "";
      console.log("Successfully joined blockchain lobby, showing lobby info...");

      // Start polling for players/participants from blockchain
      this.playersInterval = setInterval(() => this.pollPlayers(), 2000);

      // Try to check if server game exists and join it
      await this.tryJoinServerGame(lobby);

    } catch (error) {
      console.error("Error in lobby join process:", error);
      this.joinError = "Failed to complete lobby join";
    }
  }

  private async tryJoinServerGame(lobby: PublicLobbyInfo): Promise<void> {
    try {
      // Check if the game exists in active lobbies (use lobbyId directly as gameID)
      console.log(`Checking if server game exists for lobby: ${lobby.lobbyId}`);
      const gameExists = await this.checkActiveLobby(lobby.lobbyId);
      
      if (gameExists) {
        console.log(`Server game found for lobby ${lobby.lobbyId}, checking if it has started...`);
        
        // Check if the game has already started to prevent late joining
        const gameStarted = await this.checkGameStarted(lobby.lobbyId);
        
        if (gameStarted) {
          console.warn(`Game ${lobby.lobbyId} has already started - late joining not allowed`);
          this.joinError = "This game has already started. Late joining is not allowed.";
          return;
        }
        
        const clientID = getClientID(lobby.lobbyId);
        console.log(`Generated clientID: ${clientID} for gameID: ${lobby.lobbyId}`);
        
        // Dispatch event to join the game
        this.dispatchEvent(
          new CustomEvent("join-lobby", {
            detail: {
              gameID: lobby.lobbyId, // Use lobbyId directly as gameID
              clientID: clientID,
              bettingAmount: lobby.formattedBetAmount,
              walletAddress: await this.getCurrentWalletAddress(),
            } as JoinLobbyEvent,
            bubbles: true,
            composed: true,
          }),
        );

        console.log("Successfully dispatched join-lobby event, modal stays open");
        return;
      }

      // If server game doesn't exist yet, that's okay - show lobby info for now
      console.log(`Server game not available yet for lobby ${lobby.lobbyId}, showing lobby participants...`);

    } catch (error) {
      console.error(`Error checking/joining server game for lobby ${lobby.lobbyId}:`, error);
      // Don't show error - just continue showing lobby info
    }
  }

  private async checkActiveLobby(lobbyId: string): Promise<boolean> {
    const config = await getServerConfigFromClient();
    const url = `/${config.workerPath(lobbyId)}/api/game/${lobbyId}/exists`;

    console.log(`Checking active lobby at URL: ${url}`);

    const response = await apiFetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    console.log(`Response status: ${response.status} for lobby ${lobbyId}`);

    if (!response.ok) {
      console.log(`Response not ok for lobby ${lobbyId}: ${response.statusText}`);
      return false;
    }

    const json = await response.json() as { exists: boolean };
    console.log(`Game exists response for lobby ${lobbyId}:`, json);
    
    return json.exists === true;
  }

  private async checkGameStarted(lobbyId: string): Promise<boolean> {
    try {
      const config = await getServerConfigFromClient();
      const url = `/${config.workerPath(lobbyId)}/api/game/${lobbyId}/info`;

      console.log(`Checking if game has started at URL: ${url}`);

      const response = await apiFetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        console.log(`Could not get game info for lobby ${lobbyId}: ${response.statusText}`);
        return false; // If we can't get game info, assume it hasn't started
      }

      const gameInfo = await response.json() as { turns?: any[]; [key: string]: any };
      console.log(`Game info for lobby ${lobbyId}:`, gameInfo);
      
      // Check if the game has started based on having turns or being in active state
      const hasStarted = !!(gameInfo.turns && gameInfo.turns.length > 0);
      console.log(`Game ${lobbyId} has started: ${hasStarted}`);
      
      return hasStarted;
    } catch (error) {
      console.error(`Error checking if game has started for lobby ${lobbyId}:`, error);
      return false; // If there's an error, allow joining (safer default)
    }
  }

  private async checkArchivedGame(lobbyId: string): Promise<boolean> {
    // For now, we don't support archived games for public lobbies
    // This could be implemented later if needed
    return false;
  }

  private async pollPlayers() {
    if (!this.currentLobby) return;

    try {
      // Import the getLobbyInfo function to get updated participant list
      const { getLobbyInfo } = await import("./contract");
      const lobbyInfo = await getLobbyInfo(this.currentLobby.lobbyId);

      if (lobbyInfo && lobbyInfo.exists) {
        // Update players list with participant addresses (formatted)
        this.players = lobbyInfo.participants.map(address =>
          `${address.slice(0, 6)}...${address.slice(-4)}`
        );

        // Update current lobby info
        this.currentLobby = {
          ...this.currentLobby,
          participants: lobbyInfo.participants,
          participantCount: lobbyInfo.participants.length,
          status: lobbyInfo.status
        };

        // Try to join server game again in case it became available
        // But first check if it hasn't started yet
        if (this.currentLobby.status === GameStatus.Created) {
          await this.tryJoinServerGame(this.currentLobby);
        }
      }
    } catch (error) {
      console.error("Error polling players:", error);
    }
  }

  private copyLobbyId(lobbyId: string) {
    navigator.clipboard.writeText(lobbyId).then(() => {
      console.log('Lobby ID copied to clipboard');
    }).catch(err => {
      console.error('Failed to copy lobby ID:', err);
    });
  }

  private leaveLobby() {
    // Clear lobby state
    this.hasJoined = false;
    this.currentLobby = null;
    this.players = [];
    this.joinError = "";

    // Clear polling interval
    if (this.playersInterval) {
      clearInterval(this.playersInterval);
      this.playersInterval = null;
    }

    // Refresh lobbies to show updated state
    this.refreshLobbies();
  }

  private formatAddress(address: string): string {
    if (address.length <= 10) return address;
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  }

  private formatLobbyId(lobbyId: string): string {
    // For blockchain hashes (0x followed by 64 hex chars), show a shorter representation
    if (lobbyId.startsWith('0x') && lobbyId.length === 66) {
      return `${lobbyId.substring(0, 8)}...${lobbyId.substring(lobbyId.length - 4)}`;
    }
    // For regular IDs, show as-is if short enough
    if (lobbyId.length <= 12) return lobbyId;
    return `${lobbyId.substring(0, 8)}...${lobbyId.substring(lobbyId.length - 4)}`;
  }

  private getStatusText(status: GameStatus): string {
    switch (status) {
      case GameStatus.Created:
        return "Open";
      case GameStatus.InProgress:
        return "In Progress";
      case GameStatus.Finished:
        return "Finished";
      case GameStatus.Claimed:
        return "Claimed";
      default:
        return "Unknown";
    }
  }

  private getStatusColor(status: GameStatus): string {
    switch (status) {
      case GameStatus.Created:
        return "#4CAF50"; // Green
      case GameStatus.InProgress:
        return "#FF9800"; // Orange
      case GameStatus.Finished:
        return "#2196F3"; // Blue
      case GameStatus.Claimed:
        return "#9E9E9E"; // Grey
      default:
        return "#9E9E9E";
    }
  }

  private canJoinLobby(lobby: PublicLobbyInfo): boolean {
    return lobby.status === GameStatus.Created;
  }

  private async getCurrentWalletAddress(): Promise<string | undefined> {
    try {
      const { getCurrentWalletAddress } = await import("./wallet");
      const address = getCurrentWalletAddress();
      console.log("BrowseLobbyModal: Getting current wallet address:", address);
      return address;
    } catch (error) {
      console.warn("BrowseLobbyModal: Failed to get wallet address:", error);
      return undefined;
    }
  }

  render() {
    return html`
      <o-modal title="Browse Public Lobbies">
        <!-- Header (always visible) -->
        <div class="browse-header">
          <div class="lobby-count">
            ${this.lobbies.length} public ${this.lobbies.length === 1 ? 'lobby' : 'lobbies'}
          </div>
          <button 
            class="refresh-button" 
            @click=${this.refreshLobbies}
            ?disabled=${this.isLoading}
          >
            <span class="refresh-icon ${this.isLoading ? 'spinning' : ''}">↻</span>
            Refresh
          </button>
        </div>

        <!-- Message area (always present) -->
        <div class="message-area ${this.joinError ? "show" : ""}">
          ${this.joinError}
        </div>


        <!-- Options layout -->
        <div class="options-layout">
          ${this.hasJoined && this.players.length > 0
            ? html` <div class="options-section">
                <div class="option-title">
                  ${this.players.length}
                  ${this.players.length === 1
                    ? 'Player'
                    : 'Players'}
                </div>

                <div class="players-list">
                  ${this.players.map(
                    (player) => html`<span class="player-tag">${player}</span>`,
                  )}
                </div>
              </div>`
            : ""}
        </div>

        <!-- Lobby browser content (when not joined) -->
        ${!this.hasJoined ? html`
          <div class="browse-lobby-container">
            <!-- Loading state -->
            ${this.isLoading ? html`
              <div class="loading-container">
                <div class="loading-spinner"></div>
                <div class="loading-text">Loading lobbies...</div>
              </div>
            ` : ''}

            <!-- Error state -->
            ${this.error ? html`
              <div class="error-container">
                <div class="error-message">
                  <strong>Error:</strong> ${this.error}
                </div>
                <button class="retry-button" @click=${this.refreshLobbies}>
                  Try Again
                </button>
              </div>
            ` : ''}

            <!-- Empty state -->
            ${!this.isLoading && !this.error && this.lobbies.length === 0 ? html`
              <div class="empty-state">
                <div class="empty-icon">🎮</div>
                <div class="empty-title">No Public Lobbies Found</div>
                <div class="empty-description">
                  No public lobbies are currently available. Try creating one or check back later!
                </div>
              </div>
            ` : ''}

            <!-- Lobbies grid -->
            ${!this.isLoading && !this.error && this.lobbies.length > 0 ? html`
              <div class="lobbies-grid">
                ${this.lobbies.map(lobby => this.renderLobbyCard(lobby))}
              </div>
            ` : ''}
          </div>
        ` : ''}

        <div class="flex justify-center">
          ${this.hasJoined ? html`
            <o-button
              title="Leave Lobby"
              block
              @click=${this.leaveLobby}
            ></o-button>
          ` : ''}
        </div>
      </o-modal>
    `;
  }

  private renderLobbyCard(lobby: PublicLobbyInfo) {
    const canJoin = this.canJoinLobby(lobby);
    const isJoining = this.joiningLobbyId === lobby.lobbyId;

    return html`
      <div class="lobby-card ${canJoin ? 'joinable' : 'not-joinable'}">
        <!-- Lobby header -->
        <div class="lobby-header">
          <div class="lobby-id-container">
            <span class="lobby-id" title=${lobby.lobbyId}>
              ${this.formatLobbyId(lobby.lobbyId)}
            </span>
            <button 
              class="copy-button" 
              @click=${() => this.copyLobbyId(lobby.lobbyId)}
              title="Copy Lobby ID"
            >
              📋
            </button>
          </div>
          <div class="lobby-status" style="color: ${this.getStatusColor(lobby.status)}">
            ${this.getStatusText(lobby.status)}
          </div>
        </div>

        <!-- Lobby details -->
        <div class="lobby-details">
          <div class="detail-row">
            <span class="detail-label">Host:</span>
            <span class="detail-value" title=${lobby.host}>
              ${this.formatAddress(lobby.host)}
            </span>
          </div>
          
          <div class="detail-row">
            <span class="detail-label">Bet Amount:</span>
            <span class="detail-value bet-amount">
              ${lobby.formattedBetAmount} ETH
            </span>
          </div>
          
          <div class="detail-row">
            <span class="detail-label">Players:</span>
            <span class="detail-value">
              ${lobby.participantCount} participant${lobby.participantCount === 1 ? '' : 's'}
            </span>
          </div>

          <div class="detail-row">
            <span class="detail-label">Prize Pool:</span>
            <span class="detail-value prize-amount">
              ${(parseFloat(lobby.formattedBetAmount) * lobby.participantCount).toFixed(4)} ETH
            </span>
          </div>
        </div>

        <!-- Join button -->
        <div class="lobby-actions">
          <button 
            class="join-button ${canJoin ? 'enabled' : 'disabled'}"
            @click=${() => canJoin ? this.joinLobbyAction(lobby) : null}
            ?disabled=${!canJoin || isJoining}
          >
            ${isJoining ? 'Joining...' : canJoin ? 'Join Lobby' : this.getStatusText(lobby.status)}
          </button>
        </div>
      </div>
    `;
  }
}
