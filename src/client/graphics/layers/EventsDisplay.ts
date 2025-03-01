import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { EventBus } from "../../../core/EventBus";
import {
  AllPlayers,
  MessageType,
  PlayerType,
  Tick,
} from "../../../core/game/Game";
import {
  AllianceExpiredUpdate,
  AllianceRequestReplyUpdate,
  AllianceRequestUpdate,
  AttackUpdate,
  BrokeAllianceUpdate,
  DisplayMessageUpdate,
  EmojiUpdate,
  GameUpdateType,
  TargetPlayerUpdate,
} from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { ClientID } from "../../../core/Schemas";
import { onlyImages } from "../../../core/Util";
import { SendAllianceReplyIntentEvent } from "../../Transport";
import { renderTroops } from "../../Utils";
import { Layer } from "./Layer";

interface Event {
  description: string;
  unsafeDescription?: boolean;
  buttons?: {
    text: string;
    className: string;
    action: () => void;
  }[];
  type: MessageType;
  highlight?: boolean;
  createdAt: number;
  onDelete?: () => void;
  // lower number: lower on the display
  priority?: number;
  duration?: Tick;
}

@customElement("events-display")
export class EventsDisplay extends LitElement implements Layer {
  public eventBus: EventBus;
  public game: GameView;
  public clientID: ClientID;

  private events: Event[] = [];
  @state() private incomingAttacks: AttackUpdate[] = [];
  @state() private outgoingAttacks: AttackUpdate[] = [];
  @state() private _hidden: boolean = false;

  private updateMap = new Map([
    [GameUpdateType.DisplayEvent, (u) => this.onDisplayMessageEvent(u)],
    [GameUpdateType.AllianceRequest, (u) => this.onAllianceRequestEvent(u)],
    [
      GameUpdateType.AllianceRequestReply,
      (u) => this.onAllianceRequestReplyEvent(u),
    ],
    [GameUpdateType.BrokeAlliance, (u) => this.onBrokeAllianceEvent(u)],
    [GameUpdateType.TargetPlayer, (u) => this.onTargetPlayerEvent(u)],
    [GameUpdateType.EmojiUpdate, (u) => this.onEmojiMessageEvent(u)],
  ]);

  constructor() {
    super();
    this.events = [];
    this.incomingAttacks = [];
    this.outgoingAttacks = [];
  }

  init() {}

  tick() {
    const updates = this.game.updatesSinceLastTick();
    for (const [ut, fn] of this.updateMap) {
      updates[ut]?.forEach((u) => fn(u));
    }

    let remainingEvents = this.events.filter((event) => {
      const shouldKeep =
        this.game.ticks() - event.createdAt < (event.duration ?? 600);
      if (!shouldKeep && event.onDelete) {
        event.onDelete();
      }
      return shouldKeep;
    });

    if (remainingEvents.length > 30) {
      remainingEvents = remainingEvents.slice(-30);
    }

    if (this.events.length !== remainingEvents.length) {
      this.events = remainingEvents;
      this.requestUpdate();
    }

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      return;
    }

    // Update attacks
    this.incomingAttacks = myPlayer.incomingAttacks().filter((a) => {
      const t = (this.game.playerBySmallID(a.attackerID) as PlayerView).type();
      return t != PlayerType.Bot;
    });

    this.outgoingAttacks = myPlayer
      .outgoingAttacks()
      .filter((a) => a.targetID != 0);

    this.requestUpdate();
  }

  private addEvent(event: Event) {
    this.events = [...this.events, event];
    this.requestUpdate();
  }

  private removeEvent(index: number) {
    this.events = [
      ...this.events.slice(0, index),
      ...this.events.slice(index + 1),
    ];
  }

  shouldTransform(): boolean {
    return false;
  }

  renderLayer(): void {}

  onDisplayMessageEvent(event: DisplayMessageUpdate) {
    const myPlayer = this.game.playerByClientID(this.clientID);
    if (
      event.playerID != null &&
      (!myPlayer || myPlayer.smallID() !== event.playerID)
    ) {
      return;
    }

    this.addEvent({
      description: event.message,
      createdAt: this.game.ticks(),
      highlight: true,
      type: event.messageType,
      unsafeDescription: true,
    });
  }

  onAllianceRequestEvent(update: AllianceRequestUpdate) {
    const myPlayer = this.game.playerByClientID(this.clientID);
    if (!myPlayer || update.recipientID !== myPlayer.smallID()) {
      return;
    }

    const requestor = this.game.playerBySmallID(
      update.requestorID,
    ) as PlayerView;
    const recipient = this.game.playerBySmallID(
      update.recipientID,
    ) as PlayerView;

    this.addEvent({
      description: `${requestor.name()} requests an alliance!`,
      buttons: [
        {
          text: "Accept",
          className: "btn",
          action: () =>
            this.eventBus.emit(
              new SendAllianceReplyIntentEvent(requestor, recipient, true),
            ),
        },
        {
          text: "Reject",
          className: "btn-info",
          action: () =>
            this.eventBus.emit(
              new SendAllianceReplyIntentEvent(requestor, recipient, false),
            ),
        },
      ],
      highlight: true,
      type: MessageType.INFO,
      createdAt: this.game.ticks(),
      onDelete: () =>
        this.eventBus.emit(
          new SendAllianceReplyIntentEvent(requestor, recipient, false),
        ),
      priority: 0,
      duration: 150,
    });
  }

  onAllianceRequestReplyEvent(update: AllianceRequestReplyUpdate) {
    const myPlayer = this.game.playerByClientID(this.clientID);
    if (!myPlayer || update.request.requestorID !== myPlayer.smallID()) {
      return;
    }

    const recipient = this.game.playerBySmallID(
      update.request.recipientID,
    ) as PlayerView;

    this.addEvent({
      description: `${recipient.name()} ${
        update.accepted ? "accepted" : "rejected"
      } your alliance request`,
      type: update.accepted ? MessageType.SUCCESS : MessageType.ERROR,
      highlight: true,
      createdAt: this.game.ticks(),
    });
  }

  onBrokeAllianceEvent(update: BrokeAllianceUpdate) {
    const myPlayer = this.game.playerByClientID(this.clientID);
    if (!myPlayer) return;

    const betrayed = this.game.playerBySmallID(update.betrayedID) as PlayerView;
    const traitor = this.game.playerBySmallID(update.traitorID) as PlayerView;

    if (!betrayed.isTraitor() && traitor === myPlayer) {
      this.addEvent({
        description: `You broke your alliance with ${betrayed.name()}, making you a TRAITOR`,
        type: MessageType.ERROR,
        highlight: true,
        createdAt: this.game.ticks(),
      });
    } else if (betrayed === myPlayer) {
      this.addEvent({
        description: `${traitor.name()}, broke their alliance with you`,
        type: MessageType.ERROR,
        highlight: true,
        createdAt: this.game.ticks(),
      });
    }
  }

  onAllianceExpiredEvent(update: AllianceExpiredUpdate) {
    const myPlayer = this.game.playerByClientID(this.clientID);
    if (!myPlayer) return;

    const otherID =
      update.player1ID === myPlayer.smallID()
        ? update.player2ID
        : update.player2ID === myPlayer.smallID()
          ? update.player1ID
          : null;
    const other = this.game.playerBySmallID(otherID) as PlayerView;
    if (!other || !myPlayer.isAlive() || !other.isAlive()) return;

    this.addEvent({
      description: `Your alliance with ${other.name()} expired`,
      type: MessageType.WARN,
      highlight: true,
      createdAt: this.game.ticks(),
    });
  }

  onTargetPlayerEvent(event: TargetPlayerUpdate) {
    const other = this.game.playerBySmallID(event.playerID) as PlayerView;
    const myPlayer = this.game.playerByClientID(this.clientID) as PlayerView;
    if (!myPlayer || !myPlayer.isAlliedWith(other)) return;

    const target = this.game.playerBySmallID(event.targetID) as PlayerView;

    this.addEvent({
      description: `${other.name()} requests you attack ${target.name()}`,
      type: MessageType.INFO,
      highlight: true,
      createdAt: this.game.ticks(),
    });
  }

  onEmojiMessageEvent(update: EmojiUpdate) {
    const myPlayer = this.game.playerByClientID(this.clientID);
    if (!myPlayer) return;

    const recipient =
      update.emoji.recipientID == AllPlayers
        ? AllPlayers
        : this.game.playerBySmallID(update.emoji.recipientID);
    const sender = this.game.playerBySmallID(
      update.emoji.senderID,
    ) as PlayerView;

    if (recipient == myPlayer) {
      this.addEvent({
        description: `${sender.displayName()}:${update.emoji.message}`,
        unsafeDescription: true,
        type: MessageType.INFO,
        highlight: true,
        createdAt: this.game.ticks(),
      });
    } else if (sender === myPlayer && recipient !== AllPlayers) {
      this.addEvent({
        description: `Sent ${(recipient as PlayerView).displayName()}: ${
          update.emoji.message
        }`,
        unsafeDescription: true,
        type: MessageType.INFO,
        highlight: true,
        createdAt: this.game.ticks(),
      });
    }
  }

  private getMessageTypeClasses(type: MessageType): string {
    switch (type) {
      case MessageType.SUCCESS:
        return "text-green-300";
      case MessageType.INFO:
        return "text-gray-200";
      case MessageType.WARN:
        return "text-yellow-300";
      case MessageType.ERROR:
        return "text-red-300";
      default:
        return "text-white";
    }
  }

  private renderAttacks() {
    if (
      this.incomingAttacks.length === 0 &&
      this.outgoingAttacks.length === 0
    ) {
      return html``;
    }

    return html`
      ${this.incomingAttacks.length > 0
        ? html`
            <tr class="border-t border-gray-700">
              <td class="lg:p-3 p-1 text-left text-red-400">
                ${this.incomingAttacks.map(
                  (attack) => html`
                    <div class="ml-2">
                      ${renderTroops(attack.troops)}
                      ${(
                        this.game.playerBySmallID(
                          attack.attackerID,
                        ) as PlayerView
                      )?.name()}
                    </div>
                  `,
                )}
              </td>
            </tr>
          `
        : ""}
      ${this.outgoingAttacks.length > 0
        ? html`
            <tr class="border-t border-gray-700">
              <td class="lg:p-3 p-1 text-left text-blue-400">
                ${this.outgoingAttacks.map(
                  (attack) => html`
                    <div class="ml-2">
                      ${renderTroops(attack.troops)}
                      ${(
                        this.game.playerBySmallID(attack.targetID) as PlayerView
                      )?.name()}
                    </div>
                  `,
                )}
              </td>
            </tr>
          `
        : ""}
    `;
  }

  render() {
    if (
      this.events.length === 0 &&
      this.incomingAttacks.length === 0 &&
      this.outgoingAttacks.length === 0
    ) {
      return html``;
    }
    this.events.sort((a, b) => {
      const aPrior = a.priority ?? 100000;
      const bPrior = b.priority ?? 100000;
      if (aPrior == bPrior) {
        return a.createdAt - b.createdAt;
      }
      return bPrior - aPrior;
    });

    return html`
      <div
        class="${this._hidden
          ? "w-fit px-[10px] py-[5px]"
          : ""} rounded-md bg-black bg-opacity-60 relative max-h-[30vh] flex flex-col-reverse overflow-y-auto w-full lg:bottom-2.5 lg:right-2.5 z-50 lg:max-w-3xl lg:w-full lg:w-auto"
      >
        <div>
          <div class="w-full bg-black/80 sticky top-0 px-[10px]">
            <button
              class="text-white cursor-pointer pointer-events-auto ${this
                ._hidden
                ? "hidden"
                : ""}"
              @click=${() => (this._hidden = true)}
            >
              Hide
            </button>
          </div>
          <button
            class="text-white cursor-pointer pointer-events-auto ${this._hidden
              ? ""
              : "hidden"}"
            @click=${() => (this._hidden = false)}
          >
            Events
          </button>
          <table
            class="w-full border-collapse text-white shadow-lg lg:text-xl text-xs ${this
              ._hidden
              ? "hidden"
              : ""}"
            style="pointer-events: auto;"
          >
            <tbody>
              ${this.events.map(
                (event, index) => html`
                  <tr
                    class="border-b border-opacity-0 ${this.getMessageTypeClasses(
                      event.type,
                    )}"
                  >
                    <td class="lg:p-3 p-1 text-left">
                      ${event.unsafeDescription
                        ? unsafeHTML(onlyImages(event.description))
                        : event.description}
                      ${event.buttons
                        ? html`
                            <div class="flex flex-wrap gap-1.5 mt-1">
                              ${event.buttons.map(
                                (btn) => html`
                                  <button
                                    class="inline-block px-3 py-1 text-white rounded text-sm cursor-pointer transition-colors duration-300
                            ${btn.className.includes("btn-info")
                                      ? "bg-blue-500 hover:bg-blue-600"
                                      : "bg-green-600 hover:bg-green-700"}"
                                    @click=${() => {
                                      btn.action();
                                      this.removeEvent(index);
                                      this.requestUpdate();
                                    }}
                                  >
                                    ${btn.text}
                                  </button>
                                `,
                              )}
                            </div>
                          `
                        : ""}
                    </td>
                  </tr>
                `,
              )}
              ${this.renderAttacks()}
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
