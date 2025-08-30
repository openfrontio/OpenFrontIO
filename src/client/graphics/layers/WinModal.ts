import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { GutterAdModalEvent } from "./GutterAdModal";
import { Layer } from "./Layer";
import { SendWinnerEvent } from "../../Transport";
import { translateText } from "../../../client/Utils";
import { claimPrize, getLobbyInfo, GameStatus, type LobbyInfo, watchLobbyEvents, type ContractEventCallbacks } from "../../contract";

@customElement("win-modal")
export class WinModal extends LitElement implements Layer {
  public game: GameView | undefined;
  public eventBus: EventBus | undefined;

  private hasShownDeathModal = false;

  @state()
  isVisible = false;

  @state()
  showButtons = false;

  @state()
  private claimingPrize = false;

  @state()
  private prizeClaimStatus = "";

  @state()
  private lobbyInfo: LobbyInfo | null = null;

  @state()
  private checkingLobbyStatus = false;

  @state()
  private lobbyStatusError = "";

  private _title = "";
  private currentGameId = "";
  private lobbyStatusCheckInterval: ReturnType<typeof setInterval> | null = null;
  private eventUnwatcher: (() => void) | null = null;

  // Override to prevent shadow DOM creation
  createRenderRoot() {
    return this;
  }

  static styles = css`
    .win-modal {
      display: none;
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background-color: rgba(30, 30, 30, 0.7);
      padding: 25px;
      border-radius: 10px;
      z-index: 9999;
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(5px);
      color: white;
      width: 350px;
      transition:
        opacity 0.3s ease-in-out,
        visibility 0.3s ease-in-out;
    }

    .win-modal.visible {
      display: block;
      animation: fadeIn 0.3s ease-out;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translate(-50%, -48%);
      }
      to {
        opacity: 1;
        transform: translate(-50%, -50%);
      }
    }

    .win-modal h2 {
      margin: 0 0 15px 0;
      font-size: 26px;
      text-align: center;
      color: white;
    }

    .win-modal p {
      margin: 0 0 20px 0;
      text-align: center;
      background-color: rgba(0, 0, 0, 0.3);
      padding: 10px;
      border-radius: 5px;
    }

    .button-container {
      display: flex;
      justify-content: space-between;
      gap: 10px;
    }

    .win-modal button {
      flex: 1;
      padding: 12px;
      font-size: 16px;
      cursor: pointer;
      background: rgba(0, 150, 255, 0.6);
      color: white;
      border: none;
      border-radius: 5px;
      transition:
        background-color 0.2s ease,
        transform 0.1s ease;
    }

    .win-modal button:hover {
      background: rgba(0, 150, 255, 0.8);
      transform: translateY(-1px);
    }

    .win-modal button:active {
      transform: translateY(1px);
    }

    @media (max-width: 768px) {
      .win-modal {
        width: 90%;
        max-width: 300px;
        padding: 20px;
      }

      .win-modal h2 {
        font-size: 26px;
      }

      .win-modal button {
        padding: 10px;
        font-size: 14px;
      }
    }
  `;

  constructor() {
    super();
    // Add styles to document
    const styleEl = document.createElement("style");
    styleEl.textContent = WinModal.styles.toString();
    document.head.appendChild(styleEl);
  }

  render() {
    return html`
      <div class="win-modal ${this.isVisible ? "visible" : ""}">
        <h2>${this._title}</h2>
        ${this.renderLobbyStatus()}
        ${this.prizeClaimStatus ? html`
          <p style="color: ${this.prizeClaimStatus.includes('Success') ? '#4a9eff' : '#ff4a4a'}; text-align: center; margin: 10px 0;">
            ${this.prizeClaimStatus}
          </p>
        ` : ''}
        <div
          class="button-container ${this.showButtons ? "visible" : "hidden"}"
        >
          ${this.shouldShowClaimButton() ? html`
            <button 
              @click=${this._handleClaimPrize}
              ?disabled=${this.claimingPrize}
              style="background: ${this.claimingPrize ? 'rgba(100, 100, 100, 0.6)' : 'rgba(0, 200, 0, 0.6)'};"
            >
              ${this.claimingPrize ? 'Claiming...' : 'Claim Prize'}
            </button>
          ` : ''}
          <button @click=${this._handleExit}>
            ${translateText("win_modal.exit")}
          </button>
          <button @click=${this.hide}>
            ${translateText("win_modal.keep")}
          </button>
        </div>
      </div>
    `;
  }

  renderLobbyStatus() {
    if (!this.currentGameId) return '';

    if (this.checkingLobbyStatus) {
      return html`
        <div style="text-align: center; margin: 10px 0; color: #ccc; font-size: 14px;">
          🔍 Checking blockchain status...
        </div>
      `;
    }

    if (this.lobbyStatusError) {
      return html`
        <div style="text-align: center; margin: 10px 0; padding: 8px; 
                   background-color: #f8d7da; border: 1px solid #f5c6cb; 
                   border-radius: 4px; color: #721c24; font-size: 14px;">
          <strong>Blockchain Error:</strong> ${this.lobbyStatusError}
        </div>
      `;
    }

    if (!this.lobbyInfo) return '';

    const statusText = GameStatus[this.lobbyInfo.status];
    const statusColor = this.getStatusColor(this.lobbyInfo.status);

    return html`
      <div style="text-align: center; margin: 10px 0; padding: 10px; 
                 background-color: rgba(50, 50, 50, 0.8); 
                 border-radius: 6px; font-size: 14px;">
        <div style="margin-bottom: 8px;">
          <strong style="color: #ccc;">Game Status:</strong>
          <span style="color: ${statusColor}; font-weight: bold; margin-left: 8px;">
            ${statusText}
          </span>
        </div>
        
        ${this.lobbyInfo.status === GameStatus.Claimed ? html`
          <div style="color: #4a9eff; margin-top: 8px;">
            🎉 <strong>Prize Already Claimed!</strong>
          </div>
          <div style="color: #aaa; font-size: 12px; margin-top: 4px;">
            Total Prize: ${this.formatEther(this.lobbyInfo.totalPrize)} ETH
          </div>
        ` : this.lobbyInfo.status === GameStatus.Finished ? html`
          <div style="color: #ffa500; margin-top: 8px;">
            🏆 <strong>Ready to Claim Prize!</strong>
          </div>
          <div style="color: #aaa; font-size: 12px; margin-top: 4px;">
            Prize Pool: ${this.formatEther(this.lobbyInfo.totalPrize)} ETH
          </div>
        ` : this.lobbyInfo.status === GameStatus.InProgress ? html`
          <div style="color: #90ee90; margin-top: 8px;">
            ${this._title.includes(translateText("win_modal.you_won")) ? html`
              🏆 <strong>You Won!</strong> Waiting for server confirmation...
            ` : html`
              🎮 Game in Progress
            `}
          </div>
          ${this._title.includes(translateText("win_modal.you_won")) ? html`
            <div style="color: #aaa; font-size: 12px; margin-top: 4px;">
              The server will declare you as winner shortly, then you can claim your prize.
            </div>
          ` : ''}
        ` : html`
          <div style="color: #ccc; margin-top: 8px;">
            ⏳ Game Created
          </div>
        `}
      </div>
    `;
  }

  show() {
    this.eventBus?.emit(new GutterAdModalEvent(true));
    setTimeout(() => {
      this.isVisible = true;
      this.requestUpdate();
      
      // Start watching blockchain events and do initial status check
      if (this.currentGameId) {
        this.startWatchingBlockchainEvents();
        this.checkLobbyStatus();
      }
    }, 1500);
    setTimeout(() => {
      this.showButtons = true;
      this.requestUpdate();
    }, 3000);
  }

  private startWatchingBlockchainEvents() {
    if (!this.currentGameId || this.eventUnwatcher) return;

    console.log('Starting to watch blockchain events for lobby:', this.currentGameId);

    const callbacks: ContractEventCallbacks = {
      onGameStarted: (lobbyId) => {
        console.log('🎮 Game started event received for lobby:', lobbyId);
        this.handleBlockchainStatusChange();
      },
      
      onWinnerDeclared: (lobbyId, winner) => {
        console.log('🏆 Winner declared event received for lobby:', lobbyId, 'winner:', winner);
        this.handleBlockchainStatusChange();
      },
      
      onPrizeClaimed: (lobbyId, winner, amount) => {
        console.log('🎉 Prize claimed event received for lobby:', lobbyId, 'winner:', winner, 'amount:', amount);
        this.handleBlockchainStatusChange();
      }
    };

    this.eventUnwatcher = watchLobbyEvents(this.currentGameId, callbacks);
  }

  private async handleBlockchainStatusChange() {
    console.log('Handling blockchain status change...');
    // Add a small delay to ensure transaction is fully processed
    setTimeout(async () => {
      await this.checkLobbyStatus();
    }, 1000);
  }

  hide() {
    this.eventBus?.emit(new GutterAdModalEvent(false));
    this.isVisible = false;
    this.showButtons = false;
    
    // Clear the lobby status checking interval
    if (this.lobbyStatusCheckInterval) {
      clearInterval(this.lobbyStatusCheckInterval);
      this.lobbyStatusCheckInterval = null;
    }
    
    // Stop watching blockchain events
    if (this.eventUnwatcher) {
      console.log('Stopping blockchain event watching for lobby:', this.currentGameId);
      this.eventUnwatcher();
      this.eventUnwatcher = null;
    }
    
    this.requestUpdate();
  }

  private shouldShowClaimButton(): boolean {
    // Only show claim button if the current player won, game is finished, and prize not claimed
    return this._title.includes(translateText("win_modal.you_won")) && 
           this.currentGameId !== "" && 
           this.lobbyInfo?.status === GameStatus.Finished;
  }

  private async checkLobbyStatus() {
    if (!this.currentGameId || this.checkingLobbyStatus) return;

    this.checkingLobbyStatus = true;
    this.lobbyStatusError = "";

    try {
      const lobbyInfo = await getLobbyInfo(this.currentGameId);
      this.lobbyInfo = lobbyInfo;
      
      if (lobbyInfo) {
        console.log(`Lobby status: ${GameStatus[lobbyInfo.status]} (${lobbyInfo.status})`);
      }
    } catch (error) {
      console.error('Error checking lobby status:', error);
      this.lobbyStatusError = error instanceof Error ? error.message : 'Failed to check lobby status';
    } finally {
      this.checkingLobbyStatus = false;
      this.requestUpdate();
    }
  }

  private async _handleClaimPrize() {
    if (this.claimingPrize || !this.currentGameId) return;
    
    this.claimingPrize = true;
    this.prizeClaimStatus = "";
    this.requestUpdate();
    
    try {
      const result = await claimPrize({ lobbyId: this.currentGameId });
      this.prizeClaimStatus = `Success! Transaction: ${result.hash.slice(0, 10)}...`;
      
      // Wait for transaction confirmation and then refresh status multiple times
      this.waitForStatusUpdate();
    } catch (error) {
      this.prizeClaimStatus = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    } finally {
      this.claimingPrize = false;
      this.requestUpdate();
    }
  }

  private async waitForStatusUpdate() {
    // With event watching, we don't need to poll as aggressively
    // Just wait a bit for the transaction to be confirmed
    console.log('Waiting for blockchain event confirmation...');
    
    // The event watcher will automatically update status when PrizeClaimed event is received
    // Just do a single check after a reasonable delay for transaction confirmation
    setTimeout(async () => {
      await this.checkLobbyStatus();
    }, 3000);
  }

  private getStatusColor(status: GameStatus): string {
    switch (status) {
      case GameStatus.Created:
        return '#ccc';
      case GameStatus.InProgress:
        return '#90ee90';
      case GameStatus.Finished:
        return '#ffa500';
      case GameStatus.Claimed:
        return '#4a9eff';
      default:
        return '#ccc';
    }
  }

  private formatEther(wei: bigint): string {
    // Simple ETH formatting - convert wei to ETH
    const eth = Number(wei) / 1e18;
    return eth.toFixed(4);
  }

  private _handleExit() {
    this.hide();
    window.location.href = "/";
  }

  init() {}

  tick() {
    if (this.game === undefined) throw new Error("Not initialized");
    
    // Set current game ID for claim functionality
    this.currentGameId = this.game.gameID();
    const myPlayer = this.game.myPlayer();
    if (
      !this.hasShownDeathModal &&
      myPlayer &&
      !myPlayer.isAlive() &&
      !this.game.inSpawnPhase() &&
      myPlayer.hasSpawned()
    ) {
      this.hasShownDeathModal = true;
      this._title = translateText("win_modal.died");
      this.show();
    }
    const updates = this.game.updatesSinceLastTick();
    const winUpdates = updates !== null ? updates[GameUpdateType.Win] : [];
    winUpdates.forEach((wu) => {
      if (this.game === undefined) return;
      if (wu.winner === undefined) {
        // ...
      } else if (wu.winner[0] === "team") {
        this.eventBus?.emit(new SendWinnerEvent(wu.winner, wu.allPlayersStats));
        if (wu.winner[1] === this.game.myPlayer()?.team()) {
          this._title = translateText("win_modal.your_team");
        } else {
          this._title = translateText("win_modal.other_team", {
            team: wu.winner[1],
          });
        }
        this.show();
      } else {
        const winner = this.game.playerByClientID(wu.winner[1]);
        if (!winner?.isPlayer()) return;
        const winnerClient = winner.clientID();
        if (winnerClient !== null) {
          this.eventBus?.emit(
            new SendWinnerEvent(["player", winnerClient], wu.allPlayersStats),
          );
        }
        if (
          winnerClient !== null &&
          winnerClient === this.game.myPlayer()?.clientID()
        ) {
          this._title = translateText("win_modal.you_won");
        } else {
          this._title = translateText("win_modal.other_won", {
            player: winner.name(),
          });
        }
        this.show();
      }
    });
  }

  renderLayer(/* context: CanvasRenderingContext2D */) {}

  shouldTransform(): boolean {
    return false;
  }
}
