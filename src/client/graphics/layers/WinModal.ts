import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { GutterAdModalEvent } from "./GutterAdModal";
import { Layer } from "./Layer";
import { SendWinnerEvent } from "../../Transport";
import { translateText } from "../../../client/Utils";

@customElement("win-modal")
export class WinModal extends LitElement implements Layer {
  public game: GameView | undefined;
  public eventBus: EventBus | undefined;

  private hasShownDeathModal = false;

  @state()
  isVisible = false;

  @state()
  showButtons = false;

  private _title = "";

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
      background-color: rgba(26, 26, 26, 0.95);
      border: 2px solid rgba(74, 103, 65, 0.6);
      padding: 25px;
      border-radius: 4px;
      z-index: 9999;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(8px);
      color: #e8e8e8;
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
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      text-align: center;
      color: #f0f0f0;
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
    }

    .win-modal p {
      margin: 0 0 20px 0;
      text-align: center;
      background-color: rgba(74, 103, 65, 0.2);
      border: 1px solid rgba(74, 103, 65, 0.3);
      padding: 15px;
      border-radius: 4px;
      font-weight: 500;
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
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      cursor: pointer;
      background: linear-gradient(135deg, #4a6741, #3d5536);
      color: #f0f0f0;
      border: 2px solid rgba(74, 103, 65, 0.6);
      border-radius: 4px;
      transition:
        all 0.2s ease,
        transform 0.1s ease;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    }

    .win-modal button:hover {
      background: linear-gradient(135deg, #3d5536, #2d4026);
      border-color: rgba(74, 103, 65, 0.8);
      transform: translateY(-1px);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.4);
    }

    .win-modal button:active {
      transform: translateY(1px);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    }

    @media (max-width: 768px) {
      .win-modal {
        width: 90%;
        max-width: 300px;
        padding: 20px;
      }

      .win-modal h2 {
        font-size: 22px;
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
        <div
          class="button-container ${this.showButtons ? "visible" : "hidden"}"
        >
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
          color: #4a6741;
          text-decoration: underline;
          font-weight: 600;
          transition: color 0.2s ease;
          font-size: 24px;
        "
        onmouseover="this.style.color='#5a7751'"
        onmouseout="this.style.color='#4a6741'"
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

  private _handleExit() {
    this.hide();
    window.location.href = "/";
  }

  init() {}

  tick() {
    if (this.game === undefined) throw new Error("Not initialized");
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
