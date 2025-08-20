/* eslint-disable max-lines */
import {
  AllPlayers,
  MessageCategory,
  MessageType,
  PlayerType,
  Tick,
  UnitType,
  getMessageCategory,
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
  SendAllianceExtensionIntentEvent,
  SendAllianceReplyIntentEvent,
} from "../../Transport";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import {
  GoToPlayerEvent,
  GoToPositionEvent,
  GoToUnitEvent,
} from "./Leaderboard";
import { LitElement, TemplateResult, html } from "lit";
import { UnsafeHTMLDirective, unsafeHTML } from "lit/directives/unsafe-html.js";
import { customElement, state } from "lit/decorators.js";
import { getMessageTypeClasses, translateText } from "../../Utils";
import { renderNumber, renderTroops } from "../../Utils";
import { DirectiveResult } from "lit/directive.js";
import { EventBus } from "../../../core/EventBus";
import { Layer } from "./Layer";
import allianceIcon from "../../../../resources/images/AllianceIconWhite.svg";
import chatIcon from "../../../../resources/images/ChatIconWhite.svg";
import donateGoldIcon from "../../../../resources/images/DonateGoldIconWhite.svg";
import { onlyImages } from "../../../core/Util";
import swordIcon from "../../../../resources/images/SwordIconWhite.svg";

type GameEvent = {
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
  shouldDelete?: (game: GameView) => boolean;
};

@customElement("events-display")
export class EventsDisplay extends LitElement implements Layer {
  public eventBus: EventBus;
  public game: GameView;

  private active = false;
  private events: GameEvent[] = [];

  // allianceID -> last checked at tick
  private readonly alliancesCheckedAt = new Map<number, Tick>();
  @state() private incomingAttacks: AttackUpdate[] = [];
  @state() private outgoingAttacks: AttackUpdate[] = [];
  @state() private outgoingLandAttacks: AttackUpdate[] = [];
  @state() private outgoingBoats: UnitView[] = [];
  @state() private _hidden = false;
  @state() private _isVisible = false;
  @state() private newEvents = 0;
  @state() private latestGoldAmount: bigint | null = null;
  @state() private goldAmountAnimating = false;
  private goldAmountTimeoutId: ReturnType<typeof setTimeout> | null = null;
  @state() private readonly eventsFilters: Map<MessageCategory, boolean> = new Map([
    [MessageCategory.ATTACK, false],
    [MessageCategory.TRADE, false],
    [MessageCategory.ALLIANCE, false],
    [MessageCategory.CHAT, false],
  ]);

  private renderButton(options: {
    content: string | TemplateResult | DirectiveResult<typeof UnsafeHTMLDirective>;
    onClick?: () => void;
    className?: string;
    disabled?: boolean;
    translate?: boolean;
    hidden?: boolean;
  }) {
    const {
      content,
      onClick,
      className = "",
      disabled = false,
      translate = true,
      hidden = false,
    } = options;

    if (hidden) {
      return html``;
    }

    return html`
      <button
        class="${className}"
        @click=${onClick}
        ?disabled=${disabled}
        ?translate=${translate}
      >
        ${content}
      </button>
    `;
  }

  private toggleHidden() {
    this._hidden = !this._hidden;
    if (this._hidden) {
      this.newEvents = 0;
    }
    this.requestUpdate();
  }

  private toggleEventFilter(filterName: MessageCategory) {
    const currentState = this.eventsFilters.get(filterName) ?? false;
    this.eventsFilters.set(filterName, !currentState);
    this.requestUpdate();
  }

  private readonly updateMap = [
    [GameUpdateType.DisplayEvent, this.onDisplayMessageEvent.bind(this)],
    [GameUpdateType.DisplayChatEvent, this.onDisplayChatEvent.bind(this)],
    [GameUpdateType.AllianceRequest, this.onAllianceRequestEvent.bind(this)],
    [
      GameUpdateType.AllianceRequestReply,
      this.onAllianceRequestReplyEvent.bind(this),
    ],
    [GameUpdateType.BrokeAlliance, this.onBrokeAllianceEvent.bind(this)],
    [GameUpdateType.TargetPlayer, this.onTargetPlayerEvent.bind(this)],
    [GameUpdateType.Emoji, this.onEmojiMessageEvent.bind(this)],
    [GameUpdateType.UnitIncoming, this.onUnitIncomingEvent.bind(this)],
    [GameUpdateType.AllianceExpired, this.onAllianceExpiredEvent.bind(this)],
  ] as const;

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

    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this._isVisible = true;
      this.requestUpdate();
    }

    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      if (this._isVisible) {
        this._isVisible = false;
        this.requestUpdate();
      }
      return;
    }

    this.checkForAllianceExpirations();

    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      for (const [ut, fn] of this.updateMap) {
        updates[ut]?.forEach(fn as (event: unknown) => void);
      }
    }

    let remainingEvents = this.events.filter((event) => {
      const shouldKeep =
        this.game.ticks() - event.createdAt < (event.duration ?? 600) &&
        !event.shouldDelete?.(this.game);
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

  disconnectedCallback() {
    if (this.goldAmountTimeoutId !== null) {
      clearTimeout(this.goldAmountTimeoutId);
      this.goldAmountTimeoutId = null;
    }
  }

  private checkForAllianceExpirations() {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer?.isAlive()) return;

    for (const alliance of myPlayer.alliances()) {
      if (
        alliance.expiresAt >
        this.game.ticks() + this.game.config().allianceExtensionPromptOffset()
      ) {
        continue;
      }

      if (
        (this.alliancesCheckedAt.get(alliance.id) ?? 0) >=
        this.game.ticks() - this.game.config().allianceExtensionPromptOffset()
      ) {
        // We've already displayed a message for this alliance.
        continue;
      }

      this.alliancesCheckedAt.set(alliance.id, this.game.ticks());

      const other = this.game.player(alliance.other);
      if (!other.isAlive()) continue;

      this.addEvent({
        description: translateText("events_display.about_to_expire", {
          name: other.name(),
        }),
        type: MessageType.RENEW_ALLIANCE,
        duration: this.game.config().allianceExtensionPromptOffset() - 3 * 10, // 3 second buffer
        buttons: [
          {
            text: translateText("events_display.focus"),
            className: "btn-gray",
            action: () => this.eventBus.emit(new GoToPlayerEvent(other)),
            preventClose: true,
          },
          {
            text: translateText("events_display.renew_alliance", {
              name: other.name(),
            }),
            className: "btn",
            action: () =>
              this.eventBus.emit(new SendAllianceExtensionIntentEvent(other)),
          },
          {
            text: translateText("events_display.ignore"),
            className: "btn-info",
            action: () => {},
          },
        ],
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: other.smallID(),
      });
    }
  }

  private addEvent(event: GameEvent) {
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

    if (event.goldAmount !== undefined) {
      const hasChanged = this.latestGoldAmount !== event.goldAmount;
      this.latestGoldAmount = event.goldAmount;

      if (this.goldAmountTimeoutId !== null) {
        clearTimeout(this.goldAmountTimeoutId);
      }

      this.goldAmountTimeoutId = setTimeout(() => {
        this.latestGoldAmount = null;
        this.goldAmountTimeoutId = null;
        this.requestUpdate();
      }, 5000);

      if (hasChanged) {
        this.goldAmountAnimating = true;
        setTimeout(() => {
          this.goldAmountAnimating = false;
          this.requestUpdate();
        }, 600);
      }
    }

    let description: string = event.message;
    if (event.params !== undefined) {
      if (event.message.startsWith("events_display.")) {
        description = translateText(event.message, event.params);
      }
    }

    this.addEvent({
      description,
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
    let translatedMessage = baseMessage;
    if (event.target) {
      try {
        const targetPlayer = this.game.player(event.target);
        const targetName = targetPlayer?.displayName() ?? event.target;
        translatedMessage = baseMessage.replace("[P1]", targetName);
      } catch (e) {
        console.warn(
          `Failed to resolve player for target ID '${event.target}'`,
          e,
        );
        return;
      }
    }

    let otherPlayerDiplayName = "";
    if (event.recipient !== null) {
      //'recipient' parameter contains sender ID or recipient ID
      const player = this.game.player(event.recipient);
      otherPlayerDiplayName = player ? player.displayName() : "";
    }

    this.addEvent({
      description: translateText(event.isFrom ? "chat.from" : "chat.to", {
        user: otherPlayerDiplayName,
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
      description: translateText("events_display.request_alliance", {
        name: requestor.name(),
      }),
      buttons: [
        {
          text: translateText("events_display.focus"),
          className: "btn-gray",
          action: () => this.eventBus.emit(new GoToPlayerEvent(requestor)),
          preventClose: true,
        },
        {
          text: translateText("events_display.accept_alliance"),
          className: "btn",
          action: () =>
            this.eventBus.emit(
              new SendAllianceReplyIntentEvent(requestor, recipient, true),
            ),
        },
        {
          text: translateText("events_display.reject_alliance"),
          className: "btn-info",
          action: () =>
            this.eventBus.emit(
              new SendAllianceReplyIntentEvent(requestor, recipient, false),
            ),
        },
      ],
      highlight: true,
      type: MessageType.ALLIANCE_REQUEST,
      createdAt: this.game.ticks(),
      priority: 0,
      duration: this.game.config().allianceRequestDuration() - 20, // 2 second buffer
      shouldDelete: (game) => {
        // Recipient sent a separate request, so they became allied without the recipient responding.
        return requestor.isAlliedWith(recipient);
      },
      focusID: update.requestorID,
    });
  }

  onAllianceRequestReplyEvent(update: AllianceRequestReplyUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      return;
    }
    // myPlayer can deny alliances without clicking on the button
    if (update.request.recipientID === myPlayer.smallID()) {
      // Remove alliance requests whose requestors are the same as the reply's requestor
      // Noop unless the request was denied through other means (e.g attacking the requestor)
      this.events = this.events.filter(
        (event) =>
          !(
            event.type === MessageType.ALLIANCE_REQUEST &&
            event.focusID === update.request.requestorID
          ),
      );
      this.requestUpdate();
      return;
    }
    if (update.request.requestorID !== myPlayer.smallID()) {
      return;
    }

    const recipient = this.game.playerBySmallID(
      update.request.recipientID,
    ) as PlayerView;
    this.addEvent({
      description: translateText("events_display.alliance_request_status", {
        name: recipient.name(),
        status: update.accepted
          ? translateText("events_display.alliance_accepted")
          : translateText("events_display.alliance_rejected"),
      }),
      type: update.accepted
        ? MessageType.ALLIANCE_ACCEPTED
        : MessageType.ALLIANCE_REJECTED,
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

    if (betrayed.isDisconnected()) return; // Do not send the message if betraying a disconnected player

    if (!betrayed.isTraitor() && traitor === myPlayer) {
      const malusPercent = Math.round(
        (1 - this.game.config().traitorDefenseDebuff()) * 100,
      );

      const traitorDuration = Math.floor(
        this.game.config().traitorDuration() * 0.1,
      );
      const durationText =
        traitorDuration === 1
          ? translateText("events_display.duration_second")
          : translateText("events_display.duration_seconds_plural", {
            seconds: traitorDuration,
          });

      this.addEvent({
        description: translateText("events_display.betrayal_description", {
          name: betrayed.name(),
          malusPercent,
          durationText,
        }),
        type: MessageType.ALLIANCE_BROKEN,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.betrayedID,
      });
    } else if (betrayed === myPlayer) {
      const buttons = [
        {
          text: translateText("events_display.focus"),
          className: "btn-gray",
          action: () => this.eventBus.emit(new GoToPlayerEvent(traitor)),
          preventClose: true,
        },
      ];
      this.addEvent({
        description: translateText("events_display.betrayed_you", {
          name: traitor.name(),
        }),
        type: MessageType.ALLIANCE_BROKEN,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.traitorID,
        buttons,
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
      description: translateText("events_display.alliance_expired", {
        name: other.name(),
      }),
      type: MessageType.ALLIANCE_EXPIRED,
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
      description: translateText("events_display.attack_request", {
        name: other.name(),
        target: target.name(),
      }),
      type: MessageType.ATTACK_REQUEST,
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
        description: `${sender.displayName()}: ${update.emoji.message}`,
        unsafeDescription: true,
        type: MessageType.CHAT,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.emoji.senderID,
      });
    } else if (sender === myPlayer && recipient !== AllPlayers) {
      this.addEvent({
        description: translateText("events_display.sent_emoji", {
          name: (recipient as PlayerView).displayName(),
          emoji: update.emoji.message,
        }),
        unsafeDescription: true,
        type: MessageType.CHAT,
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
      unitView,
    });
  }

  private getEventDescription(
    event: GameEvent,
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
            ${this.incomingAttacks.map(
              (attack) => html`
                ${this.renderButton({
                  content: html`
                    ${renderTroops(attack.troops)}
                    ${(
                      this.game.playerBySmallID(attack.attackerID) as PlayerView
                    )?.name()}
                    ${attack.retreating
                      ? `(${translateText("events_display.retreating")}...)`
                      : ""}
                  `,
                  onClick: () => this.attackWarningOnClick(attack),
                  className: "text-left text-red-400",
                  translate: false,
                })}
              `,
            )}
          `
        : ""}
    `;
  }

  private renderOutgoingAttacks() {
    return html`
      ${this.outgoingAttacks.length > 0
        ? html`
            <div class="flex flex-wrap gap-y-1 gap-x-2">
              ${this.outgoingAttacks.map(
                (attack) => html`
                  <div class="inline-flex items-center gap-1">
                    ${this.renderButton({
                      content: html`
                        ${renderTroops(attack.troops)}
                        ${(
                          this.game.playerBySmallID(
                            attack.targetID,
                          ) as PlayerView
                        )?.name()}
                      `,
                      onClick: async () => this.attackWarningOnClick(attack),
                      className: "text-left text-blue-400",
                      translate: false,
                    })}
                    ${!attack.retreating
                      ? this.renderButton({
                        content: "❌",
                        onClick: () => this.emitCancelAttackIntent(attack.id),
                        className: "text-left flex-shrink-0",
                        disabled: attack.retreating,
                      })
                      : html`<span class="flex-shrink-0 text-blue-400"
                          >(${translateText(
                            "events_display.retreating",
                          )}...)</span
                        >`}
                  </div>
                `,
              )}
            </div>
          `
        : ""}
    `;
  }

  private renderOutgoingLandAttacks() {
    return html`
      ${this.outgoingLandAttacks.length > 0
        ? html`
            <div class="flex flex-wrap gap-y-1 gap-x-2">
              ${this.outgoingLandAttacks.map(
                (landAttack) => html`
                  <div class="inline-flex items-center gap-1">
                    ${this.renderButton({
                      content: html`${renderTroops(landAttack.troops)}
                      ${translateText("help_modal.ui_wilderness")}`,
                      className: "text-left text-gray-400",
                      translate: false,
                    })}
                    ${!landAttack.retreating
                      ? this.renderButton({
                        content: "❌",
                        onClick: () =>
                          this.emitCancelAttackIntent(landAttack.id),
                        className: "text-left flex-shrink-0",
                        disabled: landAttack.retreating,
                      })
                      : html`<span class="flex-shrink-0 text-blue-400"
                          >(${translateText(
                            "events_display.retreating",
                          )}...)</span
                        >`}
                  </div>
                `,
              )}
            </div>
          `
        : ""}
    `;
  }

  private renderBoats() {
    return html`
      ${this.outgoingBoats.length > 0
        ? html`
            <div class="flex flex-wrap gap-y-1 gap-x-2">
              ${this.outgoingBoats.map(
                (boat) => html`
                  <div class="inline-flex items-center gap-1">
                    ${this.renderButton({
                      content: html`${translateText("events_display.boat")}:
                      ${renderTroops(boat.troops())}`,
                      onClick: () => this.emitGoToUnitEvent(boat),
                      className: "text-left text-blue-400",
                      translate: false,
                    })}
                    ${!boat.retreating()
                      ? this.renderButton({
                        content: "❌",
                        onClick: () => this.emitBoatCancelIntent(boat.id()),
                        className: "text-left flex-shrink-0",
                        disabled: boat.retreating(),
                      })
                      : html`<span class="flex-shrink-0 text-blue-400"
                          >(${translateText(
                            "events_display.retreating",
                          )}...)</span
                        >`}
                  </div>
                `,
              )}
            </div>
          `
        : ""}
    `;
  }

  render() {
    if (!this.active || !this._isVisible) {
      return html``;
    }

    const styles = html`
      <style>
        @keyframes goldBounce {
          0% {
            transform: scale(1);
          }
          30% {
            transform: scale(1.3);
          }
          50% {
            transform: scale(1.1);
          }
          70% {
            transform: scale(1.2);
          }
          100% {
            transform: scale(1);
          }
        }
      </style>
    `;

    const filteredEvents = this.events.filter((event) => {
      const category = getMessageCategory(event.type);
      return !this.eventsFilters.get(category);
    });

    filteredEvents.sort((a, b) => {
      const aPrior = a.priority ?? 100000;
      const bPrior = b.priority ?? 100000;
      if (aPrior === bPrior) {
        return a.createdAt - b.createdAt;
      }
      return bPrior - aPrior;
    });

    return html`
      ${styles}
      <!-- Events Toggle (when hidden) -->
      ${this._hidden
        ? html`
            <div class="relative w-fit lg:bottom-2.5 lg:right-2.5 z-50">
              ${this.renderButton({
                content: html`
                  Events
                  <span
                    class="${this.newEvents
                      ? ""
                      : "hidden"} inline-block px-2 bg-red-500 rounded-xl text-sm"
                    >${this.newEvents}</span
                  >
                `,
                onClick: this.toggleHidden,
                className:
                  "text-white cursor-pointer pointer-events-auto w-fit p-2 " +
                  "lg:p-3 rounded-md bg-gray-800/70 backdrop-blur",
              })}
            </div>
          `
        : html`
            <!-- Main Events Display -->
            <div
              class="relative w-full sm:bottom-2.5 sm:right-2.5 z-50 sm:w-96 backdrop-blur"
            >
              <!-- Button Bar -->
              <div
                class="w-full p-2 lg:p-3 rounded-t-none md:rounded-t-md bg-gray-800/70"
              >
                <div class="flex justify-between items-center">
                  <div class="flex gap-4">
                    ${this.renderButton({
                      content: html`<img
                        src="${swordIcon}"
                        class="w-5 h-5"
                        style="filter: ${this.eventsFilters.get(
                          MessageCategory.ATTACK,
                        )
                          ? "grayscale(1) opacity(0.5)"
                          : "none"}"
                      />`,
                      onClick: () =>
                        this.toggleEventFilter(MessageCategory.ATTACK),
                      className: "cursor-pointer pointer-events-auto",
                    })}
                    ${this.renderButton({
                      content: html`<img
                        src="${donateGoldIcon}"
                        class="w-5 h-5"
                        style="filter: ${this.eventsFilters.get(
                          MessageCategory.TRADE,
                        )
                          ? "grayscale(1) opacity(0.5)"
                          : "none"}"
                      />`,
                      onClick: () =>
                        this.toggleEventFilter(MessageCategory.TRADE),
                      className: "cursor-pointer pointer-events-auto",
                    })}
                    ${this.renderButton({
                      content: html`<img
                        src="${allianceIcon}"
                        class="w-5 h-5"
                        style="filter: ${this.eventsFilters.get(
                          MessageCategory.ALLIANCE,
                        )
                          ? "grayscale(1) opacity(0.5)"
                          : "none"}"
                      />`,
                      onClick: () =>
                        this.toggleEventFilter(MessageCategory.ALLIANCE),
                      className: "cursor-pointer pointer-events-auto",
                    })}
                    ${this.renderButton({
                      content: html`<img
                        src="${chatIcon}"
                        class="w-5 h-5"
                        style="filter: ${this.eventsFilters.get(
                          MessageCategory.CHAT,
                        )
                          ? "grayscale(1) opacity(0.5)"
                          : "none"}"
                      />`,
                      onClick: () =>
                        this.toggleEventFilter(MessageCategory.CHAT),
                      className: "cursor-pointer pointer-events-auto",
                    })}
                  </div>
                  <div class="flex items-center gap-3">
                    ${this.latestGoldAmount !== null
                      ? html`<span
                          class="text-green-400 font-semibold transition-all duration-300 ${this
                            .goldAmountAnimating
                            ? "animate-pulse scale-110"
                            : "scale-100"}"
                          style="animation: ${this.goldAmountAnimating
                            ? "goldBounce 0.6s ease-out"
                            : "none"}"
                          >+${renderNumber(this.latestGoldAmount)}</span
                        >`
                      : ""}
                    ${this.renderButton({
                      content: translateText("leaderboard.hide"),
                      onClick: this.toggleHidden,
                      className:
                        "text-white cursor-pointer pointer-events-auto",
                    })}
                  </div>
                </div>
              </div>

              <!-- Content Area -->
              <div
                class="rounded-b-none md:rounded-b-md bg-gray-800/70
                  max-h-[30vh] flex flex-col-reverse overflow-y-auto w-full
                  h-full"
              >
                <div>
                  <table
                    class="w-full max-h-none border-collapse text-white shadow-lg lg:text-base text-md md:text-xs"
                    style="pointer-events: auto;"
                  >
                    <tbody>
                      ${filteredEvents.map(
                        (event, index) => html`
                          <tr>
                            <td
                              class="lg:px-2 lg:py-1 p-1 text-left ${getMessageTypeClasses(
                                event.type,
                              )}"
                            >
                              ${event.focusID
                                ? this.renderButton({
                                  content: this.getEventDescription(event),
                                  onClick: () => {
                                    event.focusID &&
                                        this.emitGoToPlayerEvent(event.focusID);
                                  },
                                  className: "text-left",
                                })
                                : event.unitView
                                  ? this.renderButton({
                                    content: this.getEventDescription(event),
                                    onClick: () => {
                                      event.unitView &&
                                          this.emitGoToUnitEvent(
                                            event.unitView,
                                          );
                                    },
                                    className: "text-left",
                                  })
                                  : this.getEventDescription(event)}
                              <!-- Events with buttons (Alliance requests) -->
                              ${event.buttons
                                ? html`
                                    <div class="flex flex-wrap gap-1.5 mt-1">
                                      ${event.buttons.map(
                                        (btn) => html`
                                          <button
                                            class="inline-block px-3 py-1
                                              text-white rounded text-md
                                              md:text-sm cursor-pointer
                                              transition-colors duration-300
                            ${btn.className.includes("btn-info")
                              ? "bg-blue-500 hover:bg-blue-600"
                              : btn.className.includes(
                                "btn-gray",
                              )
                                ? "bg-gray-500 hover:bg-gray-600"
                                : "bg-green-600 hover:bg-green-700"}"
                                            @click=${() => {
                                              btn.action();
                                              if (!btn.preventClose) {
                                                const originalIndex =
                                                  this.events.findIndex(
                                                    (e) => e === event,
                                                  );
                                                if (originalIndex !== -1) {
                                                  this.removeEvent(
                                                    originalIndex,
                                                  );
                                                }
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
                      <!--- Incoming attacks row -->
                      ${this.incomingAttacks.length > 0
                        ? html`
                            <tr class="lg:px-2 lg:py-1 p-1">
                              <td class="lg:px-2 lg:py-1 p-1 text-left">
                                ${this.renderIncomingAttacks()}
                              </td>
                            </tr>
                          `
                        : ""}

                      <!--- Outgoing attacks row -->
                      ${this.outgoingAttacks.length > 0
                        ? html`
                            <tr class="lg:px-2 lg:py-1 p-1">
                              <td class="lg:px-2 lg:py-1 p-1 text-left">
                                ${this.renderOutgoingAttacks()}
                              </td>
                            </tr>
                          `
                        : ""}

                      <!--- Outgoing land attacks row -->
                      ${this.outgoingLandAttacks.length > 0
                        ? html`
                            <tr class="lg:px-2 lg:py-1 p-1">
                              <td class="lg:px-2 lg:py-1 p-1 text-left">
                                ${this.renderOutgoingLandAttacks()}
                              </td>
                            </tr>
                          `
                        : ""}

                      <!--- Boats row -->
                      ${this.outgoingBoats.length > 0
                        ? html`
                            <tr class="lg:px-2 lg:py-1 p-1">
                              <td class="lg:px-2 lg:py-1 p-1 text-left">
                                ${this.renderBoats()}
                              </td>
                            </tr>
                          `
                        : ""}

                      <!--- Empty row when no events or attacks -->
                      ${filteredEvents.length === 0 &&
                      this.incomingAttacks.length === 0 &&
                      this.outgoingAttacks.length === 0 &&
                      this.outgoingLandAttacks.length === 0 &&
                      this.outgoingBoats.length === 0
                        ? html`
                            <tr>
                              <td
                                class="lg:px-2 lg:py-1 p-1 min-w-72 text-left"
                              >
                                &nbsp;
                              </td>
                            </tr>
                          `
                        : ""}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          `}
    `;
  }

  createRenderRoot() {
    return this;
  }
}
