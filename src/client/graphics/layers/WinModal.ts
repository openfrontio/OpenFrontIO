import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { TerraNulliusImpl } from "../../../core/game/TerraNulliusImpl";
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
  private _subtitle: string;

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
        <h2>${this._title || ""}</h2>
        <h3>${this._subtitle || ""}</h3>
        ${this.innerHtml()}
        <div class="button-container">
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
      this._title = translateText("win_modal.died");
      this.show();
    }
    const updates = this.game.updatesSinceLastTick();
    const winUpdates = updates !== null ? updates[GameUpdateType.Win] : [];
    winUpdates.forEach((wu) => {
      if (wu.winner[0] === "team") {
        this.eventBus.emit(new SendWinnerEvent(wu.winner, wu.allPlayersStats));
        if (wu.winner[1] === this.game.myPlayer()?.team()) {
          this._title = translateText("win_modal.your_team");
        } else {
          this._title = translateText("win_modal.other_team", {
            team: wu.winner[1],
          });
        }
        this.show();
      } else if (wu.winner.length === 2) {
        // If the winners chosen are a group of players (but not in a team game mode), we need to handle this case as a Coalition win.
        const winnerId = wu.winner[1];
        // Grab the first in the list, this player is considered the "winner", and should get the winner event.
        const winner = this.game.playerBySmallID(winnerId);
        if (!winner.isPlayer()) return;

        const winnerClient = winner.clientID();

        if (winnerClient !== null) {
          this.eventBus.emit(
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
      } else if (wu.winner.length > 2) {
        const winnerId = wu.winner[1];
        const assistedByIds: any[] = wu.winner.slice(2);
        const winner: PlayerView | TerraNulliusImpl =
          this.game.playerBySmallID(winnerId);
        if (winner instanceof TerraNulliusImpl) {
          throw new Error(`small id ${winnerId} not found`);
        }
        const winnerClient = winner.clientID();
        const assistedByClientIds: string[] = assistedByIds
          // First, map to the values, which creates the array with undefineds
          .map((id) => this.game.playerBySmallID(id)?.clientID())
          // Then, filter out the null/undefined values
          .filter((clientId) => clientId !== null);

        const myPlayer = this.game.myPlayer();
        const myPlayerName = myPlayer?.name();
        const assistedByNames: string[] = this.determineNamesBySmallId(
          assistedByIds,
          myPlayerName,
        );

        const helpers = assistedByNames.join(", ");

        if (winnerClient !== null) {
          this.eventBus.emit(
            new SendWinnerEvent(
              ["player", winnerClient, ...assistedByClientIds],
              wu.allPlayersStats,
            ),
          );
        }

        const myClientID = myPlayer?.clientID();
        const isCurrentPlayerWinner =
          winnerClient !== null && winnerClient === myPlayer?.clientID();
        const isCurrentPlayerHelper =
          typeof myClientID !== "undefined" &&
          myClientID !== null &&
          assistedByClientIds.includes(myClientID);

        if (isCurrentPlayerWinner) {
          this._title = translateText("win_modal.you_won");
        } else {
          this._title = translateText("win_modal.other_won", {
            player: winner.name(),
          });
        }

        this._subtitle = isCurrentPlayerHelper
          ? translateText("win_modal.with_your_help", { players: helpers })
          : translateText("win_modal.with_help", { players: helpers });

        this.show();
      }
    });
  }

  renderLayer(/* context: CanvasRenderingContext2D */) {}

  shouldTransform(): boolean {
    return false;
  }

  determineNamesBySmallId(
    smallIds: number[],
    nameToFilter: string | undefined | null,
  ): string[] {
    return (
      smallIds
        // First, map to the values, which creates the array with undefineds
        .map((id) => this.game.playerBySmallID(id))
        // Then, filter out the "null" players.
        .filter((object) => object instanceof PlayerView)
        .map((player) => player.name())
        .filter((playerName) => {
          if (nameToFilter !== null) {
            return playerName !== nameToFilter;
          } else {
            return playerName;
          }
        })
    );
  }
}
