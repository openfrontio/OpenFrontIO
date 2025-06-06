import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { DirectiveResult } from "lit/directive.js";
import { unsafeHTML, UnsafeHTMLDirective } from "lit/directives/unsafe-html.js";
import { EventBus } from "../../../core/EventBus";
import {
  AllPlayers,
  MessageType,
  PlayerType,
  Tick,
  UnitType,
} from "../../../core/game/Game";
import {
  AllianceExpiredUpdate,
  AllianceRequestReplyUpdate,
  AllianceRequestUpdate,
  AttackUpdate,
  BrokeAllianceUpdate,
  DisplayChatMessageUpdate,
  DisplayMessageUpdate,
  EmojiUpdate,
  GameUpdateType,
  TargetPlayerUpdate,
  UnitIncomingUpdate,
} from "../../../core/game/GameUpdates";
import {
  CancelAttackIntentEvent,
  CancelBoatIntentEvent,
  SendAllianceReplyIntentEvent,
} from "../../Transport";
import { Layer } from "./Layer";

import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { onlyImages } from "../../../core/Util";
import { renderTroops } from "../../Utils";
import {
  GoToPlayerEvent,
  GoToPositionEvent,
  GoToUnitEvent,
} from "./Leaderboard";

import { translateText } from "../../Utils";

interface Event {
  description: string;
  unsafeDescription?: boolean;
  buttons?: {
    text: string;
    className: string;
    action: () => void;
    preventClose?: boolean;
  }[];
  type: MessageType;
  highlight?: boolean;
  createdAt: number;
  onDelete?: () => void;
  // lower number: lower on the display
  priority?: number;
  duration?: Tick;
  focusID?: number;
  unitView?: UnitView;
}

@customElement("events-display")
export class EventsDisplay extends LitElement implements Layer {
  public eventBus: EventBus;
  public game: GameView;

  private active: boolean = false;
  private events: Event[] = [];
  @state() private incomingAttacks: AttackUpdate[] = [];
  @state() private outgoingAttacks: AttackUpdate[] = [];
  @state() private outgoingLandAttacks: AttackUpdate[] = [];
  @state() private outgoingBoats: UnitView[] = [];
  @state() private _hidden: boolean = false;
  @state() private newEvents: number = 0;

  private toggleHidden() {
    this._hidden = !this._hidden;
    if (this._hidden) {
      this.newEvents = 0;
    }
    this.requestUpdate();
  }

  private updateMap = new Map([
    [GameUpdateType.DisplayEvent, (u) => this.onDisplayMessageEvent(u)],
    [GameUpdateType.DisplayChatEvent, (u) => this.onDisplayChatEvent(u)],
    [GameUpdateType.AllianceRequest, (u) => this.onAllianceRequestEvent(u)],
    [
      GameUpdateType.AllianceRequestReply,
      (u) => this.onAllianceRequestReplyEvent(u),
    ],
    [GameUpdateType.BrokeAlliance, (u) => this.onBrokeAllianceEvent(u)],
    [GameUpdateType.TargetPlayer, (u) => this.onTargetPlayerEvent(u)],
    [GameUpdateType.Emoji, (u) => this.onEmojiMessageEvent(u)],
    [GameUpdateType.UnitIncoming, (u) => this.onUnitIncomingEvent(u)],
  ]);

  constructor() {
    super();
    this.events = [];
    this.incomingAttacks = [];
    this.outgoingAttacks = [];
    this.outgoingBoats = [];
  }

  init() {}

  tick() {
    this.active = true;
    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      for (const [ut, fn] of this.updateMap) {
        updates[ut]?.forEach(fn);
      }
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
      return t !== PlayerType.Bot;
    });

    this.outgoingAttacks = myPlayer
      .outgoingAttacks()
      .filter((a) => a.targetID !== 0);

    this.outgoingLandAttacks = myPlayer
      .outgoingAttacks()
      .filter((a) => a.targetID === 0);

    this.outgoingBoats = myPlayer
      .units()
      .filter((u) => u.type() === UnitType.TransportShip);

    this.requestUpdate();
  }

  private addEvent(event: Event) {
    this.events = [...this.events, event];
    if (this._hidden === true) {
      this.newEvents++;
    }
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
    const myPlayer = this.game.myPlayer();
    if (
      event.playerID !== null &&
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

  onDisplayChatEvent(event: DisplayChatMessageUpdate) {
    const myPlayer = this.game.myPlayer();
    if (
      event.playerID === null ||
      !myPlayer ||
      myPlayer.smallID() !== event.playerID
    ) {
      return;
    }

    const baseMessage = translateText(`chat.${event.category}.${event.key}`);
    const translatedMessage = baseMessage.replace(
      /\[([^\]]+)\]/g,
      (_, key) => event.variables?.[key] || `[${key}]`,
    );

    this.addEvent({
      description: translateText(event.isFrom ? "chat.from" : "chat.to", {
        user: event.recipient,
        msg: translatedMessage,
      }),
      createdAt: this.game.ticks(),
      highlight: true,
      type: MessageType.CHAT,
      unsafeDescription: false,
    });
  }

  onAllianceRequestEvent(update: AllianceRequestUpdate) {
    const myPlayer = this.game.myPlayer();
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
          text: "Focus",
          className: "btn-gray",
          action: () => this.eventBus.emit(new GoToPlayerEvent(requestor)),
          preventClose: true,
        },
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
      focusID: update.requestorID,
    });
  }

  onAllianceRequestReplyEvent(update: AllianceRequestReplyUpdate) {
    const myPlayer = this.game.myPlayer();
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
      focusID: update.request.recipientID,
    });
  }

  onBrokeAllianceEvent(update: BrokeAllianceUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const betrayed = this.game.playerBySmallID(update.betrayedID) as PlayerView;
    const traitor = this.game.playerBySmallID(update.traitorID) as PlayerView;

    if (!betrayed.isTraitor() && traitor === myPlayer) {
      const malusPercent = Math.round(
        (1 - this.game.config().traitorDefenseDebuff()) * 100,
      );

      const traitorDuration = Math.floor(
        this.game.config().traitorDuration() * 0.1,
      );
      const durationText =
        traitorDuration === 1 ? "1 second" : `${traitorDuration} seconds`;

      this.addEvent({
        description:
          `You broke your alliance with ${betrayed.name()}, making you a TRAITOR ` +
          `(${malusPercent}% defense debuff for ${durationText})`,
        type: MessageType.ERROR,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.betrayedID,
      });
    } else if (betrayed === myPlayer) {
      this.addEvent({
        description: `${traitor.name()} broke their alliance with you`,
        type: MessageType.ERROR,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.traitorID,
      });
    }
  }

  onAllianceExpiredEvent(update: AllianceExpiredUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const otherID =
      update.player1ID === myPlayer.smallID()
        ? update.player2ID
        : update.player2ID === myPlayer.smallID()
          ? update.player1ID
          : null;
    if (otherID === null) return;
    const other = this.game.playerBySmallID(otherID) as PlayerView;
    if (!other || !myPlayer.isAlive() || !other.isAlive()) return;

    this.addEvent({
      description: `Your alliance with ${other.name()} expired`,
      type: MessageType.WARN,
      highlight: true,
      createdAt: this.game.ticks(),
      focusID: otherID,
    });
  }

  onTargetPlayerEvent(event: TargetPlayerUpdate) {
    const other = this.game.playerBySmallID(event.playerID) as PlayerView;
    const myPlayer = this.game.myPlayer() as PlayerView;
    if (!myPlayer || !myPlayer.isFriendly(other)) return;

    const target = this.game.playerBySmallID(event.targetID) as PlayerView;

    this.addEvent({
      description: `${other.name()} requests you attack ${target.name()}`,
      type: MessageType.INFO,
      highlight: true,
      createdAt: this.game.ticks(),
      focusID: event.targetID,
    });
  }

  emitCancelAttackIntent(id: string) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    this.eventBus.emit(new CancelAttackIntentEvent(id));
  }

  emitBoatCancelIntent(id: number) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    this.eventBus.emit(new CancelBoatIntentEvent(id));
  }

  emitGoToPlayerEvent(attackerID: number) {
    const attacker = this.game.playerBySmallID(attackerID) as PlayerView;
    if (!attacker) return;
    this.eventBus.emit(new GoToPlayerEvent(attacker));
  }

  emitGoToPositionEvent(x: number, y: number) {
    this.eventBus.emit(new GoToPositionEvent(x, y));
  }

  emitGoToUnitEvent(unit: UnitView) {
    this.eventBus.emit(new GoToUnitEvent(unit));
  }

  onEmojiMessageEvent(update: EmojiUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const recipient =
      update.emoji.recipientID === AllPlayers
        ? AllPlayers
        : this.game.playerBySmallID(update.emoji.recipientID);
    const sender = this.game.playerBySmallID(
      update.emoji.senderID,
    ) as PlayerView;

    if (recipient === myPlayer) {
      this.addEvent({
        description: `${sender.displayName()}:${update.emoji.message}`,
        unsafeDescription: true,
        type: MessageType.INFO,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.emoji.senderID,
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
        focusID: recipient.smallID(),
      });
    }
  }

  onUnitIncomingEvent(event: UnitIncomingUpdate) {
    const myPlayer = this.game.myPlayer();

    if (!myPlayer || myPlayer.smallID() !== event.playerID) {
      return;
    }

    const unitView = this.game.unit(event.unitID);

    this.addEvent({
      description: event.message,
      type: event.messageType,
      unsafeDescription: false,
      highlight: true,
      createdAt: this.game.ticks(),
      unitView: unitView,
    });
  }

  private getMessageTypeClasses(type: MessageType): string {
    switch (type) {
      case MessageType.SUCCESS:
        return "text-green-300";
      case MessageType.INFO:
        return "text-gray-200";
      case MessageType.CHAT:
        return "text-gray-200";
      case MessageType.WARN:
        return "text-yellow-300";
      case MessageType.ERROR:
        return "text-red-300";
      default:
        return "text-white";
    }
  }

  private getEventDescription(
    event: Event,
  ): string | DirectiveResult<typeof UnsafeHTMLDirective> {
    return event.unsafeDescription
      ? unsafeHTML(onlyImages(event.description))
      : event.description;
  }

  private async attackWarningOnClick(attack: AttackUpdate) {
    const playerView = this.game.playerBySmallID(attack.attackerID);
    if (playerView !== undefined) {
      if (playerView instanceof PlayerView) {
        const averagePosition = await playerView.attackAveragePosition(
          attack.attackerID,
          attack.id,
        );

        if (averagePosition === null) {
          this.emitGoToPlayerEvent(attack.attackerID);
        } else {
          this.emitGoToPositionEvent(averagePosition.x, averagePosition.y);
        }
      }
    } else {
      this.emitGoToPlayerEvent(attack.attackerID);
    }
  }

  private renderIncomingAttacks() {
    return html`
      ${this.incomingAttacks.length > 0
        ? html`
            <tr class="border-t border-gray-700">
              <td class="lg:p-3 p-1 text-left text-red-400">
                ${this.incomingAttacks.map(
                  (attack) => html`
                    <button
                      translate="no"
                      class="ml-2"
                      @click=${() => this.attackWarningOnClick(attack)}
                    >
                      ${renderTroops(attack.troops)}
                      ${(
                        this.game.playerBySmallID(
                          attack.attackerID,
                        ) as PlayerView
                      )?.name()}
                    </button>
                    ${attack.retreating ? "(retreating...)" : ""}
                  `,
                )}
              </td>
            </tr>
          `
        : ""}
    `;
  }

  private renderOutgoingAttacks() {
    return html`
      ${this.outgoingAttacks.length > 0
        ? html`
            <tr class="border-t border-gray-700">
              <td class="lg:p-3 p-1 text-left text-blue-400">
                ${this.outgoingAttacks.map(
                  (attack) => html`
                    <button
                      translate="no"
                      class="ml-2"
                      @click=${async () => this.attackWarningOnClick(attack)}
                    >
                      ${renderTroops(attack.troops)}
                      ${(
                        this.game.playerBySmallID(attack.targetID) as PlayerView
                      )?.name()}
                    </button>

                    ${!attack.retreating
                      ? html`<button
                          ${attack.retreating ? "disabled" : ""}
                          @click=${() => {
                            this.emitCancelAttackIntent(attack.id);
                          }}
                        >
                          ❌
                        </button>`
                      : "(retreating...)"}
                  `,
                )}
              </td>
            </tr>
          `
        : ""}
    `;
  }

  private renderOutgoingLandAttacks() {
    return html`
      ${this.outgoingLandAttacks.length > 0
        ? html`
            <tr class="border-t border-gray-700">
              <td class="lg:p-3 p-1 text-left text-gray-400">
                ${this.outgoingLandAttacks.map(
                  (landAttack) => html`
                    <button translate="no" class="ml-2">
                      ${renderTroops(landAttack.troops)} Wilderness
                    </button>

                    ${!landAttack.retreating
                      ? html`<button
                          ${landAttack.retreating ? "disabled" : ""}
                          @click=${() => {
                            this.emitCancelAttackIntent(landAttack.id);
                          }}
                        >
                          ❌
                        </button>`
                      : "(retreating...)"}
                  `,
                )}
              </td>
            </tr>
          `
        : ""}
    `;
  }

  private renderBoats() {
    return html`
      ${this.outgoingBoats.length > 0
        ? html`
            <tr class="border-t border-gray-700">
              <td class="lg:p-3 p-1 text-left text-blue-400">
                ${this.outgoingBoats.map(
                  (boat) => html`
                    <button
                      translate="no"
                      @click=${() => this.emitGoToUnitEvent(boat)}
                    >
                      Boat: ${renderTroops(boat.troops())}
                    </button>
                    ${!boat.retreating()
                      ? html`<button
                          ${boat.retreating() ? "disabled" : ""}
                          @click=${() => {
                            this.emitBoatCancelIntent(boat.id());
                          }}
                        >
                          ❌
                        </button>`
                      : "(retreating...)"}
                  `,
                )}
              </td>
            </tr>
          `
        : ""}
    `;
  }

  render() {
    if (!this.active) {
      return html``;
    }

    this.events.sort((a, b) => {
      const aPrior = a.priority ?? 100000;
      const bPrior = b.priority ?? 100000;
      if (aPrior === bPrior) {
        return a.createdAt - b.createdAt;
      }
      return bPrior - aPrior;
    });

    return html`
      <div
        class="${this._hidden
          ? "w-fit px-[10px] py-[5px]"
          : ""} rounded-md bg-black bg-opacity-60 relative max-h-[30vh] flex flex-col-reverse overflow-y-auto w-full lg:bottom-2.5 lg:right-2.5 z-50 lg:max-w-[30vw] lg:w-full lg:w-auto"
      >
        <div>
          <div class="w-full bg-black/80 sticky top-0 px-[10px]">
            <button
              class="text-white cursor-pointer pointer-events-auto ${this
                ._hidden
                ? "hidden"
                : ""}"
              @click=${this.toggleHidden}
            >
              Hide
            </button>
          </div>
          <button
            class="text-white cursor-pointer pointer-events-auto ${this._hidden
              ? ""
              : "hidden"}"
            @click=${this.toggleHidden}
          >
            Events
            <span
              class="${this.newEvents
                ? ""
                : "hidden"} inline-block px-2 bg-red-500 rounded-sm"
              >${this.newEvents}</span
            >
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
                      ${event.focusID
                        ? html`<button
                            @click=${() => {
                              event.focusID &&
                                this.emitGoToPlayerEvent(event.focusID);
                            }}
                          >
                            ${this.getEventDescription(event)}
                          </button>`
                        : event.unitView
                          ? html`<button
                              @click=${() => {
                                event.unitView &&
                                  this.emitGoToUnitEvent(event.unitView);
                              }}
                            >
                              ${this.getEventDescription(event)}
                            </button>`
                          : this.getEventDescription(event)}
                      ${event.buttons
                        ? html`
                            <div class="flex flex-wrap gap-1.5 mt-1">
                              ${event.buttons.map(
                                (btn) => html`
                                  <button
                                    class="inline-block px-3 py-1 text-white rounded text-sm cursor-pointer transition-colors duration-300
                            ${btn.className.includes("btn-info")
                                      ? "bg-blue-500 hover:bg-blue-600"
                                      : btn.className.includes("btn-gray")
                                        ? "bg-gray-500 hover:bg-gray-600"
                                        : "bg-green-600 hover:bg-green-700"}"
                                    @click=${() => {
                                      btn.action();
                                      if (!btn.preventClose) {
                                        this.removeEvent(index);
                                      }
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
              ${this.renderIncomingAttacks()} ${this.renderOutgoingAttacks()}
              ${this.renderOutgoingLandAttacks()} ${this.renderBoats()}
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
