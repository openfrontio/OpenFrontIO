import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { GutterAdModalEvent } from "./GutterAdModal";
import { Layer } from "./Layer";
import { SendWinnerEvent } from "../../Transport";
import { translateText } from "../../../client/Utils";
import { claimPrize } from "../../contract";

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

  private _title = "";
  private currentGameId = "";

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
        ${this.innerHtml()}
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

  innerHtml() {
    return html`<p>
      <a
        href="https://store.steampowered.com/app/3560670"
        target="_blank"
        rel="noopener noreferrer"
        style="
          color: #4a9eff;
          text-decoration: underline;
          font-weight: 500;
          transition: color 0.2s ease;
          font-size: 24px;
        "
        onmouseover="this.style.color='#6db3ff'"
        onmouseout="this.style.color='#4a9eff'"
      >
        ${translateText("win_modal.wishlist")}
      </a>
    </p>`;
  }

  show() {
    this.eventBus?.emit(new GutterAdModalEvent(true));
    setTimeout(() => {
      this.isVisible = true;
      this.requestUpdate();
    }, 1500);
    setTimeout(() => {
      this.showButtons = true;
      this.requestUpdate();
    }, 3000);
  }

  hide() {
    this.eventBus?.emit(new GutterAdModalEvent(false));
    this.isVisible = false;
    this.showButtons = false;
    this.requestUpdate();
  }

  private shouldShowClaimButton(): boolean {
    // Only show claim button if the current player won
    return this._title.includes(translateText("win_modal.you_won")) && this.currentGameId !== "";
  }

  private async _handleClaimPrize() {
    if (this.claimingPrize || !this.currentGameId) return;
    
    this.claimingPrize = true;
    this.prizeClaimStatus = "";
    this.requestUpdate();
    
    try {
      const result = await claimPrize({ lobbyId: this.currentGameId });
      this.prizeClaimStatus = `Success! Transaction: ${result.hash.slice(0, 10)}...`;
    } catch (error) {
      this.prizeClaimStatus = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    } finally {
      this.claimingPrize = false;
      this.requestUpdate();
    }
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
