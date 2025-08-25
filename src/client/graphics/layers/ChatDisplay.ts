import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { DirectiveResult } from "lit/directive.js";
import { UnsafeHTMLDirective, unsafeHTML } from "lit/directives/unsafe-html.js";
import { EventBus } from "../../../core/EventBus";
import { MessageType } from "../../../core/game/Game";
import {
  DisplayMessageUpdate,
  GameUpdateType,
} from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { onlyImages } from "../../../core/Util";
import { Layer } from "./Layer";

type ChatEvent = {
  description: string;
  unsafeDescription?: boolean;
  createdAt: number;
  highlight?: boolean;
};

@customElement("chat-display")
export class ChatDisplay extends LitElement implements Layer {
  public eventBus: EventBus | undefined;
  public game: GameView | undefined;

  private readonly active = false;

  @state() private _hidden = false;
  @state() private newEvents = 0;
  @state() private chatEvents: ChatEvent[] = [];

  private toggleHidden() {
    this._hidden = !this._hidden;
    if (this._hidden) {
      this.newEvents = 0;
    }
    this.requestUpdate();
  }

  private addEvent(event: ChatEvent) {
    this.chatEvents = [...this.chatEvents, event];
    if (this._hidden) {
      this.newEvents++;
    }
    this.requestUpdate();
  }

  private removeEvent(index: number) {
    this.chatEvents = [
      ...this.chatEvents.slice(0, index),
      ...this.chatEvents.slice(index + 1),
    ];
  }

  onDisplayMessageEvent(event: DisplayMessageUpdate) {
    if (event.messageType !== MessageType.CHAT) return;
    if (!this.game) return;
    const myPlayer = this.game.myPlayer();
    if (
      event.playerID !== null &&
      (!myPlayer || myPlayer.smallID() !== event.playerID)
    ) {
      return;
    }

    this.addEvent({
      createdAt: this.game.ticks(),
      description: event.message,
      highlight: true,
      unsafeDescription: true,
    });
  }

  init() {}

  tick() {
    // this.active = true;
    if (!this.game) return;
    const updates = this.game.updatesSinceLastTick();
    if (updates === null) return;
    const messages = updates[GameUpdateType.DisplayEvent] as
      | DisplayMessageUpdate[]
      | undefined;

    if (messages) {
      for (const msg of messages) {
        if (msg.messageType === MessageType.CHAT) {
          const myPlayer = this.game.myPlayer();
          if (
            msg.playerID !== null &&
            (!myPlayer || myPlayer.smallID() !== msg.playerID)
          ) {
            continue;
          }

          this.chatEvents = [
            ...this.chatEvents,
            {
              createdAt: this.game.ticks(),
              description: msg.message,
              unsafeDescription: true,
            },
          ];
        }
      }
    }

    if (this.chatEvents.length > 100) {
      this.chatEvents = this.chatEvents.slice(-100);
    }

    this.requestUpdate();
  }

  private getChatContent(
    chat: ChatEvent,
  ): string | DirectiveResult<typeof UnsafeHTMLDirective> {
    return chat.unsafeDescription
      ? unsafeHTML(onlyImages(chat.description))
      : chat.description;
  }

  render() {
    if (!this.active) {
      return html``;
    }
    return html`
      <div
        class="${this._hidden ? "w-fit px-[10px] py-[5px]" : ""} rounded-md
        bg-black bg-opacity-60 relative max-h-[30vh] flex flex-col-reverse
        overflow-y-auto w-full lg:bottom-2.5 lg:right-2.5 z-50 lg:max-w-[30vw]
        lg:w-full lg:w-auto"
        style="pointer-events: auto"
      >
        <div>
          <div class="w-full bg-black/80 sticky top-0 px-[10px]">
            <button
              class="text-white cursor-pointer pointer-events-auto ${
                this._hidden ? "hidden" : ""
              }"
              @click=${this.toggleHidden}
            >
              Hide
            </button>
          </div>

          <button
            class="text-white cursor-pointer pointer-events-auto ${
              this._hidden ? "" : "hidden"
            }"
            @click=${this.toggleHidden}
          >
            Chat
            <span
              class="${
                this.newEvents ? "" : "hidden"
              } inline-block px-2 bg-red-500 rounded-sm"
              >${this.newEvents}</span
            >
          </button>

          <table
            class="w-full border-collapse text-white shadow-lg lg:text-xl text-xs ${
              this._hidden ? "hidden" : ""
            }"
            style="pointer-events: auto;"
          >
            <tbody>
              ${this.chatEvents.map(
                (chat) => html`
                  <tr class="border-b border-opacity-0">
                    <td class="lg:p-3 p-1 text-left">
                      ${this.getChatContent(chat)}
                    </td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this;
  }
}
