import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import mastersIcon from "../../../../resources/images/MastersIcon.png";
import { EventBus } from "../../../core/EventBus";
import { Team } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { SendWinnerEvent } from "../../Transport";
import { Layer } from "./Layer";

@customElement("win-modal")
export class WinModal extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;

  private hasShownDeathModal = false;

  @state()
  isVisible = false;

  private _title: string;

  createRenderRoot() {
    return this;
  }

  static styles = css`
    /* Cold War-themed modal container, fully opaque with diagonal stripes */
    .win-modal {
      display: none;
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: linear-gradient(
        135deg,
        #283618 0%, /* Olive drab military green */
        #1c252c 100% /* Dark slate gray */
      );
      /* Diagonal stripe pattern filling the entire modal */
      background-image: linear-gradient(
        45deg,
        rgba(255, 255, 255, 0.2) 25%, /* Slightly bolder stripes */
        transparent 25%,
        transparent 50%,
        rgba(255, 255, 255, 0.2) 50%,
        rgba(255, 255, 255, 0.2) 75%,
        transparent 75%,
        transparent
      );
      background-size: 30px 30px; /* Bold stripes */
      opacity: 1; /* Fully opaque */
      padding: 30px;
      border: 4px solid #6b7280; /* Thick battleship gray border */
      border-radius: 8px;
      z-index: 9999;
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.8); /* Strong shadow */
      color: #e5e7eb; /* Light gray text */
      width: 400px;
      max-width: 90%;
      font-family: "Courier New", monospace; /* Typewriter font */
      transition:
        opacity 0.5s ease-in-out,
        transform 0.5s ease-in-out;
    }

    .win-modal.visible {
      display: block;
      animation: radarFlicker 0.6s ease-out;
    }

    /* Flicker animation for CRT/radar effect */
    @keyframes radarFlicker {
      0% {
        opacity: 0;
        transform: translate(-50%, -46%) scale(0.95);
        filter: brightness(0.8);
      }
      20% {
        opacity: 0.6;
        filter: brightness(1.3);
      }
      40% {
        opacity: 0.3;
        filter: brightness(0.9);
      }
      100% {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
        filter: brightness(1);
      }
    }

    /* Title with stencil-like effect */
    .win-modal h2 {
      margin: 0 0 20px 0;
      font-size: 28px;
      font-weight: bold;
      text-align: center;
      color: #dc2626; /* Soviet red */
      text-transform: uppercase;
      letter-spacing: 2px;
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.6);
      font-family: "Impact", "Arial Narrow", sans-serif; /* Stencil font */
    }

    /* Inner content area */
    .win-modal p {
      margin: 0 0 20px 0;
      text-align: center;
      background: #111827; /* Solid dark blue-gray */
      padding: 12px;
      border: 2px solid #4b5563; /* Gray border */
      border-radius: 5px;
      font-size: 16px;
      line-height: 1.6;
      color: #d1d5db; /* Light gray */
    }

    /* Promotional content container */
    .promo-container {
      text-align: center;
      margin: 15px 0;
      padding: 15px;
      background: #111827; /* Solid dark blue-gray */
      border: 3px solid #b91c1c; /* Dark red border */
      border-radius: 6px;
      font-size: 18px;
      line-height: 1.5;
      position: relative;
      z-index: 1;
      /* Subtle stripes for consistency */
      background-image: linear-gradient(
        45deg,
        rgba(255, 255, 255, 0.15) 25%,
        transparent 25%,
        transparent 50%,
        rgba(255, 255, 255, 0.15) 50%,
        rgba(255, 255, 255, 0.15) 75%,
        transparent 75%,
        transparent
      );
      background-size: 20px 20px;
    }

    .promo-container a {
      color: #60a5fa; /* CRT blue */
      font-weight: bold;
      text-decoration: none;
      transition: color 0.2s ease;
    }

    .promo-container a:hover {
      color: #93c5fd; /* Lighter blue */
      text-decoration: underline;
    }

    /* Button container */
    .button-container {
      display: flex;
      justify-content: space-between;
      gap: 15px;
      margin-top: 20px;
    }

    /* Buttons with military aesthetic */
    .win-modal button {
      flex: 1;
      padding: 12px;
      font-size: 16px;
      font-family: "Courier New", monospace;
      cursor: pointer;
      background: linear-gradient(
        180deg,
        #4b5563 0%, /* Gray */
        #374151 100% /* Darker gray */
      );
      color: #f3f4f6; /* Light gray text */
      border: 3px solid #1f2937; /* Dark border */
      border-radius: 6px;
      text-transform: uppercase;
      letter-spacing: 1px;
      transition:
        background 0.3s ease,
        transform 0.2s ease,
        box-shadow 0.2s ease;
      position: relative;
      overflow: hidden;
    }

    .win-modal button:hover {
      background: linear-gradient(
        180deg,
        #dc2626 0%, /* Red */
        #b91c1c 100% /* Darker red */
      );
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.4);
    }

    .win-modal button:active {
      transform: translateY(0);
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    }

    /* Scanline effect on buttons */
    .win-modal button::before {
      content: "";
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 2px;
      background: rgba(255, 255, 255, 0.3);
      transition: left 0.4s ease;
    }

    .win-modal button:hover::before {
      left: 100%;
    }

    /* Responsive adjustments */
    @media (max-width: 768px) {
      .win-modal {
        width: 90%;
        max-width: 320px;
        padding: 20px;
        background-size: 20px 20px; /* Smaller stripes for mobile */
      }

      .win-modal h2 {
        font-size: 24px;
        letter-spacing: 1.5px;
      }

      .win-modal p {
        font-size: 14px;
        padding: 10px;
      }

      .promo-container {
        padding: 10px;
        font-size: 16px;
        background-size: 15px 15px;
      }

      .win-modal button {
        padding: 10px;
        font-size: 14px;
      }
    }
  `;

  constructor() {
    super();
    const styleEl = document.createElement("style");
    styleEl.textContent = WinModal.styles.toString();
    document.head.appendChild(styleEl);
  }

  render() {
    return html`
      <div class="win-modal ${this.isVisible ? "visible" : ""}" role="dialog" aria-labelledby="win-modal-title">
        <h2 id="win-modal-title">${this._title || ""}</h2>
        ${this.innerHtml()}
        <div class="button-container">
          <button @click=${this._handleExit} aria-label="Exit the game">Exit Game</button>
          <button @click=${this.hide} aria-label="Continue playing">Keep Playing</button>
        </div>
      </div>
    `;
  }

  innerHtml() {
    return html`
      <div class="promo-container">
        <div>
          Watch the best compete in the
          <br />
          <a
            href="https://openfrontmaster.com/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Visit OpenFront Masters website"
          >
            OpenFront Masters
          </a>
        </div>
      </div>
    `;
  }

  show() {
    this.isVisible = true;
    this.requestUpdate();
  }

  hide() {
    this.isVisible = false;
    this.requestUpdate();
  }

  private _handleExit() {
    this.hide();
    window.location.href = "/";
  }

  init() {}

  tick() {
    const myPlayer = this.game.myPlayer();
    if (
      !this.hasShownDeathModal &&
      myPlayer &&
      !myPlayer.isAlive() &&
      !this.game.inSpawnPhase() &&
      myPlayer.hasSpawned()
    ) {
      this.hasShownDeathModal = true;
      this._title = "You died";
      this.show();
    }
    this.game.updatesSinceLastTick()[GameUpdateType.Win].forEach((wu) => {
      if (wu.winnerType === "team") {
        this.eventBus.emit(
          new SendWinnerEvent(wu.winner as Team, wu.allPlayersStats, "team")
        );
        if (wu.winner == this.game.myPlayer()?.team()) {
          this._title = "Your team won!";
        } else {
          this._title = `${wu.winner} team has won!`;
        }
        this.show();
      } else {
        const winner = this.game.playerBySmallID(wu.winner as number) as PlayerView;
        this.eventBus.emit(
          new SendWinnerEvent(winner.clientID(), wu.allPlayersStats, "player")
        );
        if (winner == this.game.myPlayer()) {
          this._title = "You Won!";
        } else {
          this._title = `${winner.name()} has won!`;
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
