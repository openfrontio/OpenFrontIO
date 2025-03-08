import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Player } from "../../../core/game/Game";
import { ClientID } from "../../../core/Schemas";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { Layer } from "./Layer";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { PseudoRandom } from "../../../core/PseudoRandom";
import { simpleHash } from "../../../core/Util";
import { EventBus } from "../../../core/EventBus";
import { SendWinnerEvent } from "../../Transport";

// Add this at the top of your file
declare global {
  interface Window {
    adsbygoogle: any[];
  }
}
// Add this at the top of your file
declare let adsbygoogle: any[];

@customElement("win-modal")
export class WinModal extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;

  private rand: PseudoRandom;

  private hasShownDeathModal = false;

  @state()
  isVisible = false;

  private _title: string;
  private won: boolean;

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
      width: 300px;
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
      font-size: 24px;
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
        font-size: 20px;
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
        <h2>${this._title || ""}</h2>
        ${this.won ? this.supportHTML() : this.adsHTML()}
        <div class="button-container">
          <button @click=${this._handleExit}>Exit Game</button>
          <button @click=${this.hide}>Keep Playing</button>
        </div>
      </div>
    `;
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    // Initialize ads if modal is visible and showing ads
    if (changedProperties.has("isVisible") && this.isVisible && !this.won) {
      try {
        setTimeout(() => {
          (adsbygoogle = window.adsbygoogle || []).push({});
        }, 0);
      } catch (error) {
        console.error("Error initializing ad:", error);
      }
    }
  }

  adsHTML() {
    return html`<ins
      class="adsbygoogle"
      style="display:block"
      data-ad-client="ca-pub-7035513310742290"
      data-ad-slot="winmodalad"
      data-ad-format="auto"
      data-full-width-responsive="true"
    ></ins>`;
  }

  supportHTML() {
    return html`
      <div style="text-align: center; margin: 15px 0;">
        <p>
          Like the game? Help make this my full-time project!
          <a
            href="https://discord.gg/k22YrnAzGp"
            target="_blank"
            rel="noopener noreferrer"
            style="color: #0096ff; text-decoration: underline; display: block; margin-top: 5px;"
          >
            Support the game!
          </a>
        </p>
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

  init() {
    this.rand = new PseudoRandom(simpleHash(this.game.myClientID()));
  }

  tick() {
    const myPlayer = this.game.myPlayer();
    if (!this.hasShownDeathModal && myPlayer && !myPlayer.isAlive()) {
      this.hasShownDeathModal = true;
      this._title = "You died";
      this.won = false;
      this.show();
    }
    this.game.updatesSinceLastTick()[GameUpdateType.Win].forEach((wu) => {
      const winner = this.game.playerBySmallID(wu.winnerID) as PlayerView;
      this.eventBus.emit(
        new SendWinnerEvent(winner.clientID(), wu.allPlayersStats),
      );
      if (winner == this.game.myPlayer()) {
        this._title = "You Won!";
        this.won = true;
      } else {
        this._title = `${winner.name()} has won!`;
        this.won = false;
      }
      this.show();
    });
  }

  renderLayer(context: CanvasRenderingContext2D) {}

  shouldTransform(): boolean {
    return false;
  }
}
