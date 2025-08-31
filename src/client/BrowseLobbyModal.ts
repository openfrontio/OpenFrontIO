import "./components/baseComponents/Modal";
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

@customElement("browse-lobby-modal")
export class BrowseLobbyModal extends LitElement {
  @query("o-modal") private readonly modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private lobbies: PublicLobbyInfo[] = [];
  @state() private isLoading = false;
  @state() private error = "";
  @state() private refreshInterval: ReturnType<typeof setInterval> | null = null;
  @state() private joiningLobbyId = "";
  @state() private joinError = "";

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.handleKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleKeyDown);
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
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
    // Start auto-refresh every 5 seconds
    this.refreshInterval = setInterval(() => {
      this.fetchPublicLobbies();
    }, 5000);
  }

  public close() {
    this.modalEl?.close();
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
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

      const result = await joinLobby({
        lobbyId: lobby.lobbyId
      });

      console.log('Successfully joined lobby:', result);

      // Dispatch event to main component
      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: lobby.lobbyId,
            clientID: "", // Will be set by the server
            betAmount: lobby.formattedBetAmount,
          } as JoinLobbyEvent,
          bubbles: true,
          composed: true,
        }),
      );

      // Close modal on success
      this.close();

    } catch (error) {
      console.error('Error joining lobby:', error);
      this.joinError = error instanceof Error ? error.message : 'Failed to join lobby';
    } finally {
      this.joiningLobbyId = "";
    }
  }

  private copyLobbyId(lobbyId: string) {
    navigator.clipboard.writeText(lobbyId).then(() => {
      console.log('Lobby ID copied to clipboard');
    }).catch(err => {
      console.error('Failed to copy lobby ID:', err);
    });
  }

  private formatAddress(address: string): string {
    if (address.length <= 10) return address;
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  }

  private formatLobbyId(lobbyId: string): string {
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

  render() {
    return html`
      <o-modal title="Browse Public Lobbies">
        <div class="browse-lobby-container">
          <!-- Header with refresh button -->
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

          <!-- Join error -->
          ${this.joinError ? html`
            <div class="join-error-container">
              <div class="join-error-message">
                <strong>Join Error:</strong> ${this.joinError}
              </div>
              <button class="close-error-button" @click=${() => this.joinError = ""}>
                ×
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
              <button class="refresh-button" @click=${this.refreshLobbies}>
                Refresh
              </button>
            </div>
          ` : ''}

          <!-- Lobbies grid -->
          ${!this.isLoading && !this.error && this.lobbies.length > 0 ? html`
            <div class="lobbies-grid">
              ${this.lobbies.map(lobby => this.renderLobbyCard(lobby))}
            </div>
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

// Add CSS styles for the BrowseLobbyModal
const style = document.createElement('style');
style.textContent = `
  .browse-lobby-container {
    max-width: 800px;
    width: 100%;
    max-height: 600px;
    overflow-y: auto;
    padding: 1rem;
  }

  .browse-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid #ddd;
  }

  .lobby-count {
    font-size: 1.1rem;
    font-weight: bold;
    color: #333;
  }

  .refresh-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: #4CAF50;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
    transition: background-color 0.2s;
  }

  .refresh-button:hover:not(:disabled) {
    background: #45a049;
  }

  .refresh-button:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  .refresh-icon {
    transition: transform 0.2s;
  }

  .refresh-icon.spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem 1rem;
    color: #666;
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 4px solid #f3f3f3;
    border-top: 4px solid #4CAF50;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 1rem;
  }

  .loading-text {
    font-size: 1.1rem;
  }

  .error-container, .join-error-container {
    background: #f8d7da;
    border: 1px solid #f5c6cb;
    border-radius: 4px;
    padding: 1rem;
    margin-bottom: 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .error-message, .join-error-message {
    color: #721c24;
    flex: 1;
  }

  .retry-button, .close-error-button {
    background: #dc3545;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 0.5rem 1rem;
    cursor: pointer;
    margin-left: 1rem;
  }

  .retry-button:hover, .close-error-button:hover {
    background: #c82333;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem 1rem;
    text-align: center;
    color: #666;
  }

  .empty-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
  }

  .empty-title {
    font-size: 1.3rem;
    font-weight: bold;
    margin-bottom: 0.5rem;
    color: #333;
  }

  .empty-description {
    margin-bottom: 1.5rem;
    line-height: 1.5;
  }

  .lobbies-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 1rem;
  }

  .lobby-card {
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 1rem;
    background: white;
    transition: transform 0.2s, box-shadow 0.2s;
  }

  .lobby-card.joinable {
    border-color: #4CAF50;
  }

  .lobby-card.joinable:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
  }

  .lobby-card.not-joinable {
    border-color: #ccc;
    background: #f9f9f9;
  }

  .lobby-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid #eee;
  }

  .lobby-id-container {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .lobby-id {
    font-family: monospace;
    background: #f0f0f0;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.9rem;
  }

  .copy-button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 4px;
    opacity: 0.7;
  }

  .copy-button:hover {
    background: #f0f0f0;
    opacity: 1;
  }

  .lobby-status {
    font-weight: bold;
    font-size: 0.9rem;
  }

  .lobby-details {
    margin-bottom: 1rem;
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .detail-label {
    font-weight: bold;
    color: #666;
  }

  .detail-value {
    color: #333;
  }

  .bet-amount, .prize-amount {
    font-weight: bold;
    color: #4CAF50;
  }

  .lobby-actions {
    display: flex;
    justify-content: center;
  }

  .join-button {
    width: 100%;
    padding: 0.75rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
    font-weight: bold;
    transition: background-color 0.2s;
  }

  .join-button.enabled {
    background: #4CAF50;
    color: white;
  }

  .join-button.enabled:hover:not(:disabled) {
    background: #45a049;
  }

  .join-button.disabled {
    background: #ccc;
    color: #666;
    cursor: not-allowed;
  }

  .join-button:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }
`;
document.head.appendChild(style);
