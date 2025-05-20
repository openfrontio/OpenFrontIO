import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { AllPlayers } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { TerraNulliusImpl } from "../../../core/game/TerraNulliusImpl";
import { emojiTable, flattenedEmojiTable } from "../../../core/Util";
import { ShowEmojiMenuEvent } from "../../InputHandler";
import { SendEmojiIntentEvent } from "../../Transport";
import { TransformHandler } from "../TransformHandler";

@customElement("emoji-table")
export class EmojiTable extends LitElement {
  public eventBus: EventBus;
  public transformHandler: TransformHandler;
  public game: GameView;

  static styles = css`
    :host {
      display: block;
    }
    .emoji-table {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 9999;
      background-color: #1e1e1e;
      padding: 15px;
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
      border-radius: 10px;
      display: flex;
      flex-direction: column;
      align-items: center;
      max-width: 95vw;
      max-height: 95vh;
      overflow-y: auto;
    }
    .emoji-row {
      display: flex;
      justify-content: center;
      width: 100%;
    }
    .emoji-button {
      font-size: 60px;
      width: 80px;
      height: 80px;
      border: 1px solid #333;
      background-color: #2c2c2c;
      color: white;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      justify-content: center;
      align-items: center;
      margin: 8px;
    }
    .emoji-button:hover {
      background-color: #3a3a3a;
      transform: scale(1.1);
    }
    .emoji-button:active {
      background-color: #4a4a4a;
      transform: scale(0.95);
    }
    .hidden {
      display: none !important;
    }

    @media (max-width: 600px) {
      .emoji-button {
        font-size: 32px;
        /* Slightly smaller font size for mobile */
        width: 60px;
        /* Smaller width for mobile */
        height: 60px;
        /* Smaller height for mobile */
        margin: 5px;
        /* Smaller margin for mobile */
      }
    }

    @media (max-width: 400px) {
      .emoji-button {
        font-size: 28px;
        width: 50px;
        height: 50px;
        margin: 3px;
      }
    }
  `;

  @state()
  private _hidden = true;

  initEventBus() {
    this.eventBus.on(ShowEmojiMenuEvent, (e) => {
      const cell = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
      if (!this.game.isValidCoord(cell.x, cell.y)) {
        return;
      }

      const tile = this.game.ref(cell.x, cell.y);
      if (!this.game.hasOwner(tile)) {
        return;
      }

      const targetPlayer = this.game.owner(tile);
      // maybe redundant due to owner check but better safe than sorry
      if (targetPlayer instanceof TerraNulliusImpl) {
        return;
      }

      this.showTable((emoji) => {
        const recipient =
          targetPlayer === this.game.myPlayer()
            ? AllPlayers
            : (targetPlayer as PlayerView);
        this.eventBus.emit(
          new SendEmojiIntentEvent(
            recipient,
            flattenedEmojiTable.indexOf(emoji),
          ),
        );
        this.hideTable();
      });
    });
  }

  private onEmojiClicked: (emoji: string) => void = () => {};

  render() {
    return html`
      <div class="emoji-table ${this._hidden ? "hidden" : ""}">
        ${emojiTable.map(
          (row) => html`
            <div class="emoji-row">
              ${row.map(
                (emoji) => html`
                  <button
                    class="emoji-button"
                    @click=${() => this.onEmojiClicked(emoji)}
                  >
                    ${emoji}
                  </button>
                `,
              )}
            </div>
          `,
        )}
      </div>
    `;
  }

  hideTable() {
    this._hidden = true;
    this.requestUpdate();
  }

  showTable(oneEmojiClicked: (emoji: string) => void) {
    this.onEmojiClicked = oneEmojiClicked;
    this._hidden = false;
    this.requestUpdate();
  }

  get isVisible() {
    return !this._hidden;
  }
}
