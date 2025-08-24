import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { AllPlayers } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { TerraNulliusImpl } from "../../../core/game/TerraNulliusImpl";
import { emojiTable, flattenedEmojiTable } from "../../../core/Util";
import { CloseViewEvent, ShowEmojiMenuEvent } from "../../InputHandler";
import { SendEmojiIntentEvent } from "../../Transport";
import { TransformHandler } from "../TransformHandler";

@customElement("emoji-table")
export class EmojiTable extends LitElement {
  @state() public isVisible = false;

  init(transformHandler: TransformHandler, game: GameView, eventBus: EventBus) {
    eventBus.on(ShowEmojiMenuEvent, (e) => {
      this.isVisible = true;
      const cell = transformHandler.screenToWorldCoordinates(e.x, e.y);
      if (!game.isValidCoord(cell.x, cell.y)) {
        return;
      }

      const tile = game.ref(cell.x, cell.y);
      if (!game.hasOwner(tile)) {
        return;
      }

      const targetPlayer = game.owner(tile);
      // maybe redundant due to owner check but better safe than sorry
      if (targetPlayer instanceof TerraNulliusImpl) {
        return;
      }

      this.showTable((emoji) => {
        const recipient =
          targetPlayer === game.myPlayer()
            ? AllPlayers
            : (targetPlayer as PlayerView);
        eventBus.emit(
          new SendEmojiIntentEvent(
            recipient,
            flattenedEmojiTable.indexOf(emoji),
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

  render() {
    if (!this.isVisible) {
      return null;
    }

    return html`
      <div
        class="bg-slate-800 max-w-[95vw] max-h-[95vh] pt-[15px] pb-[15px] fixed
          flex flex-col -translate-x-1/2 -translate-y-1/2 items-center
          rounded-[10px] z-[9999] top-[50%] left-[50%] justify-center"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
        @wheel=${(e: WheelEvent) => e.stopPropagation()}
      >
        <!-- Close button -->
        <button
          class="absolute -top-2 -right-2 w-6 h-6 flex items-center
            justify-center bg-red-500 hover:bg-red-900 text-white rounded-full
            text-sm font-bold transition-colors"
          @click=${this.hideTable}
        >
          ✕
        </button>
        <div
          class="flex flex-col overflow-y-auto"
          style="scrollbar-gutter: stable both-edges;"
        >
          ${emojiTable.map(
            (row) => html`
              <div class="w-full justify-center flex">
                ${row.map(
                  (emoji) => html`
                    <button
                      class="flex transition-transform duration-300 ease
                        justify-center items-center cursor-pointer border
                        border-solid border-slate-500 rounded-[12px]
                        bg-slate-700 hover:bg-slate-600 active:bg-slate-500
                        md:m-[8px] md:text-[60px] md:w-[80px] md:h-[80px]
                        hover:scale-[1.1] active:scale-[0.95] sm:w-[60px]
                        sm:h-[60px] sm:text-[32px] sm:m-[5px] text-[28px]
                        w-[50px] h-[50px] m-[3px]"
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
