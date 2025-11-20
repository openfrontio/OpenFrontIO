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
    const panelContent = this.querySelector(
      'div[class*="bg-zinc-900"]',
    ) as HTMLElement;
    if (panelContent && !panelContent.contains(e.target as Node)) {
      this.hideTable();
    }
  };

  render() {
    if (!this.isVisible) {
      return null;
    }

    return html`
      <div
        class="fixed inset-0 bg-black/15 backdrop-brightness-110 flex items-center justify-center z-[10002]"
        @click=${this.handleBackdropClick}
      >
        <div
          class="bg-zinc-900/95 p-[6px] flex items-center justify-center rounded-[10px] z-[10003] relative shadow-2xl shadow-black/50 ring-1 ring-white/5"
          style="
            width: min(410px, calc(100vw - 60px), calc((100vh - 40px) * 215 / 449));
            aspect-ratio: 215 / 449;
            container-type: size;
          "
          @contextmenu=${(e: MouseEvent) => e.preventDefault()}
          @wheel=${(e: WheelEvent) => e.stopPropagation()}
          @click=${(e: MouseEvent) => e.stopPropagation()}
        >
          <!-- Close button -->
          <button
            class="absolute -top-3 -right-3 w-7 h-7 flex items-center justify-center
                    bg-zinc-700 hover:bg-red-500 text-white rounded-full shadow transition-colors z-[10004]"
            @click=${this.hideTable}
          >
            ✕
          </button>
          <div
            class="flex flex-col"
            style="transform: scale(calc(100cqw / 215px)); transform-origin: center;"
          >
            ${emojiTable.map(
              (row) => html`
                <div class="flex justify-center">
                  ${row.map(
                    (emoji) => html`
                      <button
                        class="flex transition-transform duration-300 ease justify-center items-center cursor-pointer
                                border border-solid border-zinc-600 rounded-[8px] bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600
                                m-[2px] text-[25px] w-[35px] h-[35px] hover:scale-[1.1] active:scale-[0.95]"
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
