import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { PseudoRandom } from "../../../core/PseudoRandom";
import { simpleHash } from "../../../core/Util";
import { SendWinnerEvent } from "../../Transport";
import { Layer } from "./Layer";

// Add this at the top of your file
declare global {
  interface Window {
    adsbygoogle: any[];
  }
}
// Add this at the top of your file
declare var adsbygoogle: any[];

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

  static styles = css`
    :host {
      display: block;
    }

    .modal {
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

    .modal.visible {
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

    h2 {
      margin: 0 0 15px 0;
      font-size: 24px;
      text-align: center;
      color: white;
    }

    p {
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

    button {
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

    button:hover {
      background: rgba(0, 150, 255, 0.8);
      transform: translateY(-1px);
    }

    button:active {
      transform: translateY(1px);
    }

    @media (max-width: 768px) {
      .modal {
        width: 90%;
        max-width: 300px;
        padding: 20px;
      }

      h2 {
        font-size: 20px;
      }

      button {
        padding: 10px;
        font-size: 14px;
      }
    }
  `;

  render() {
    return html`
      <div class="modal ${this.isVisible ? "visible" : ""}">
        <h2>${this._title}</h2>
        <div>${this.won ? this.supportHTML() : this.adsHTML()}</div>
        <div class="button-container">
          <button @click=${this._handleExit}>Exit Game</button>
          <button @click=${this.hide}>Keep Playing</button>
        </div>
      </div>
    `;
  }

  adsHTML(): ReturnType<typeof html> {
    return html`<ins
      class="adsbygoogle"
      style="display:block"
      data-ad-client="ca-pub-7035513310742290"
      data-ad-slot="3772893937"
      data-ad-format="auto"
      data-full-width-responsive="true"
    ></ins>`;
  }

  supportHTML(): ReturnType<typeof html> {
    return html`
      <div style="text-align: center; margin: 15px 0;">
        <p>
          Like the game? Help make this my full-time project!
          <a
            href="https://discord.com/channels/1284581928254701718/shop/1330243291366559744"
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
      try {
        (adsbygoogle = window.adsbygoogle || []).push({});
      } catch (error) {
        console.error("Error initializing ad:", error);
      }
      this.show();
    }
    this.game.updatesSinceLastTick()[GameUpdateType.WinUpdate].forEach((wu) => {
      const winner = this.game.playerBySmallID(wu.winnerID) as PlayerView;
      this.eventBus.emit(new SendWinnerEvent(winner.clientID()));
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
