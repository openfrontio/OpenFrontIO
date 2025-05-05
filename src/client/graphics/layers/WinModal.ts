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
    /* Cold War-themed modal container */
    .win-modal {
      display: none;
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: linear-gradient(
        135deg,
        rgba(40, 54, 24, 0.9) 0%, /* Olive drab military green */
        rgba(28, 37, 44, 0.9) 100% /* Dark slate gray */
      );
      padding: 30px;
      border: 3px solid #6b7280; /* Battleship gray */
      border-radius: 8px;
      z-index: 9999;
      box-shadow:
        0 0 15px rgba(0, 0, 0, 0.7),
        inset 0 0 10px rgba(255, 255, 255, 0.1); /* Subtle metallic sheen */
      backdrop-filter: blur(3px);
      color: #e5e7eb; /* Light gray for text */
      width: 400px;
      max-width: 90%;
      font-family: "Courier New", monospace; /* Typewriter font */
      background-image: url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='0' y='0' width='100' height='100' fill='none'/%3E%3Cpath d='M0 0h100v100H0z' fill='none'/%3E%3Cpath d='M10 10h80v80H10z' fill='none' stroke='%23FF0000' stroke-width='2' opacity='0.2'/%3E%3C/svg%3E"); /* Subtle red border pattern */
      background-size: 50px;
      transition:
        opacity 0.5s ease-in-out,
        transform 0.5s ease-in-out;
    }

    .win-modal.visible {
      display: block;
      animation: radarFlicker 0.6s ease-out;
    }

    /* Flicker animation mimicking old radar screens */
    @keyframes radarFlicker {
      0% {
        opacity: 0;
        transform: translate(-50%, -46%) scale(0.95);
        filter: brightness(0.8);
      }
      20% {
        opacity: 0.4;
        filter: brightness(1.2);
      }
      40% {
        opacity: 0.2;
        filter: brightness(0.9);
      }
      100% {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
        filter: brightness(1);
      }
    }

    /* Title styling with stencil-like effect */
    .win-modal h2 {
      margin: 0 0 20px 0;
      font-size: 28px;
      font-weight: bold;
      text-align: center;
      color: #dc2626; /* Soviet red for emphasis */
      text-transform: uppercase;
      letter-spacing: 2px;
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
      font-family: "Impact", "Arial Narrow", sans-serif; /* Stencil-like font */
    }

    /* Inner content area */
    .win-modal p {
      margin: 0 0 20px 0;
      text-align: center;
      background: rgba(17, 24, 39, 0.8); /* Dark blue-gray */
      padding: 12px;
      border: 1px solid #4b5563; /* Gray border */
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
      background: rgba(0, 0, 0, 0.85);
      border: 2px solid #b91c1c; /* Dark red border */
      border-radius: 6px;
      position: relative;
      z-index: 1;
      background-image: linear-gradient(
        45deg,
        rgba(255, 255, 255, 0.05) 25%,
        transparent 25%,
        transparent 50%,
        rgba(255, 255, 255, 0.05) 50%,
        rgba(255, 255, 255, 0.05) 75%,
        transparent 75%,
        transparent
      ); /* Diagonal stripe pattern */
      background-size: 20px 20px;
    }

    .promo-container a {
      color: #60a5fa; /* Bright blue for links */
      font-weight: bold;
      text-decoration: none;
      transition: color 0.2s ease;
    }

    .promo-container a:hover {
      color: #93c5fd; /* Lighter blue on hover */
      text-decoration: underline;
    }

    /* Button container */
    .button-container {
      display: flex;
      justify-content: space-between;
      gap: 15px;
      margin-top: 20px;
    }

    /* Button styling with military aesthetic */
    .win-modal button {
      flex: 1;
      padding: 12px;
      font-size: 16px;
      font-family: "Courier New", monospace;
      cursor: pointer;
      background: linear-gradient(
        180deg,
        #4b5563 0%, /* Gray top */
        #374151 100% /* Darker gray bottom */
      );
      color: #f3f4f6; /* Light gray text */
      border: 2px solid #1f2937; /* Dark border */
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
        #dc2626 0%, /* Red top */
        #b91c1c 100% /* Darker red bottom */
      );
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.4);
    }

    .win-modal button:active {
      transform: translateY(0);
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    }

    /* Button pseudo-element for retro scanline effect */
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
        font-size: 14px;
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
        <div style="font-size: 18px; line-height: 1.5;">
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
