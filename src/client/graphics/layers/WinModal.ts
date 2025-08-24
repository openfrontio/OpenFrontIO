import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { SendWinnerEvent } from "../../Transport";
import { GutterAdModalEvent } from "./GutterAdModal";
import { Layer } from "./Layer";

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
