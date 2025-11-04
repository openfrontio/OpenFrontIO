import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { AllPlayers } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { TerraNulliusImpl } from "../../../core/game/TerraNulliusImpl";
import { Emoji, emojiTable, flattenedEmojiTable } from "../../../core/Util";
import { CloseViewEvent, ShowEmojiMenuEvent } from "../../InputHandler";
import { SendEmojiIntentEvent } from "../../Transport";
import { TransformHandler } from "../TransformHandler";

@customElement("emoji-table")
export class EmojiTable extends LitElement {
  @state() public isVisible = false;
  public transformHandler: TransformHandler;
  public game: GameView;

  initEventBus(eventBus: EventBus) {
    eventBus.on(ShowEmojiMenuEvent, (e) => {
      this.isVisible = true;
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
        eventBus.emit(
          new SendEmojiIntentEvent(
            recipient,
            flattenedEmojiTable.indexOf(emoji as Emoji),
          ),
        );
        this.hideTable();
      });
    });
    eventBus.on(CloseViewEvent, (e) => {
      if (!this.hidden) {
        this.hideTable();
      }
    });
  }

  private onEmojiClicked: (emoji: string) => void = () => {};

  private handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      this.hideTable();
    }
  };

  render() {
    if (!this.isVisible) {
      return null;
    }

    return html`
      <div
        class="fixed inset-0 bg-black/15 backdrop-brightness-110 flex items-center justify-center z-[9998]"
        @click=${this.handleBackdropClick}
      >
        <div
          class="bg-zinc-900/95 max-w-[95vw] p-[10px] flex flex-col items-center rounded-[10px] z-[9999] justify-center relative shadow-2xl shadow-black/50 ring-1 ring-white/5"
          @contextmenu=${(e: MouseEvent) => e.preventDefault()}
          @wheel=${(e: WheelEvent) => e.stopPropagation()}
          @click=${(e: MouseEvent) => e.stopPropagation()}
        >
          <!-- Close button -->
          <button
            class="absolute -top-3 -right-3 w-7 h-7 flex items-center justify-center
                    bg-zinc-700 hover:bg-red-500 text-white rounded-full shadow transition-colors z-[10000]"
            @click=${this.hideTable}
          >
            ✕
          </button>
          <div class="flex flex-col">
            ${emojiTable.map(
              (row) => html`
                <div class="w-full justify-center flex">
                  ${row.map(
                    (emoji) => html`
                      <button
                        class="flex transition-transform duration-300 ease justify-center items-center cursor-pointer
                                border border-solid border-zinc-600 rounded-[8px] bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600
                                md:m-[4px] md:text-[40px] md:w-[60px] md:h-[60px] hover:scale-[1.1] active:scale-[0.95]
                                sm:w-[45px] sm:h-[45px] sm:text-[30px] sm:m-[3px] text-[25px] w-[35px] h-[35px] m-[2px]"
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
        </div>
      </div>
    `;
  }

  hideTable() {
    this.isVisible = false;
    this.requestUpdate();
  }

  showTable(oneEmojiClicked: (emoji: string) => void) {
    this.onEmojiClicked = oneEmojiClicked;
    this.isVisible = true;
    this.requestUpdate();
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
