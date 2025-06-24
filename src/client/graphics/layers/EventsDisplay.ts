import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { DirectiveResult } from "lit/directive.js";
import { unsafeHTML, UnsafeHTMLDirective } from "lit/directives/unsafe-html.js";
import allianceIcon from "../../../../resources/images/AllianceIconWhite.svg";
import chatIcon from "../../../../resources/images/ChatIconWhite.svg";
import donateGoldIcon from "../../../../resources/images/DonateGoldIconWhite.svg";
import swordIcon from "../../../../resources/images/SwordIconWhite.svg";
import { EventBus } from "../../../core/EventBus";
import {
  AllPlayers,
  getMessageCategory,
  MessageCategory,
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
  ExpireVoteForPeaceUpdate,
  GameUpdateType,
  RequestVoteForPeaceUpdate,
  TargetPlayerUpdate,
  UnitIncomingUpdate,
  VoteForPeaceReplyUpdate,
} from "../../../core/game/GameUpdates";
import {
  CancelAttackIntentEvent,
  CancelBoatIntentEvent,
  SendAllianceReplyIntentEvent,
  SendAllianceWinVoteReplyIntentEvent,
} from "../../Transport";
import { Layer } from "./Layer";

import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { onlyImages } from "../../../core/Util";
import { renderNumber, renderTroops } from "../../Utils";
import {
  GoToPlayerEvent,
  GoToPositionEvent,
  GoToUnitEvent,
} from "./Leaderboard";

import { UserSettings } from "../../../core/game/UserSettings";
import { getMessageTypeClasses, translateText } from "../../Utils";

interface GameEvent {
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

  private userSettings: UserSettings = new UserSettings();
  private active: boolean = false;
  private events: GameEvent[] = [];
  @state() private incomingAttacks: AttackUpdate[] = [];
  @state() private outgoingAttacks: AttackUpdate[] = [];
  @state() private outgoingLandAttacks: AttackUpdate[] = [];
  @state() private outgoingBoats: UnitView[] = [];
  @state() private _hidden: boolean = false;
  @state() private _isVisible: boolean = false;
  @state() private newEvents: number = 0;
  @state() private latestGoldAmount: bigint | null = null;
  @state() private goldAmountAnimating: boolean = false;
  private goldAmountTimeoutId: ReturnType<typeof setTimeout> | null = null;
  @state() private eventsFilters: Map<MessageCategory, boolean> = new Map([
    [MessageCategory.ATTACK, false],
    [MessageCategory.TRADE, false],
    [MessageCategory.ALLIANCE, false],
    [MessageCategory.CHAT, false],
  ]);

  private renderButton(options: {
    content: any; // Can be string, TemplateResult, or other renderable content
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
    const currentState = this.eventsFilters.get(filterName) || false;
    this.eventsFilters.set(filterName, !currentState);
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
    [GameUpdateType.VoteForPeace, (u) => this.onVoteForPeaceEvent(u)],
    [GameUpdateType.VoteForPeaceReply, (u) => this.onVoteForPeaceReplyEvent(u)],
    [
      GameUpdateType.VoteForPeaceExpired,
      (u) => this.onVoteForPeaceExpiredEvent(u),
    ],
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
    let translatedMessage = baseMessage;
    if (event.target) {
      try {
        const targetPlayer = this.game.player(event.target);
        const targetName = targetPlayer?.name() ?? event.target;
        translatedMessage = baseMessage.replace("[P1]", targetName);
      } catch (e) {
        console.warn(
          `Failed to resolve player for target ID '${event.target}'`,
          e,
        );
        return;
      }
    }

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
      type: MessageType.ALLIANCE_REQUEST,
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
        type: MessageType.ALLIANCE_BROKEN,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.betrayedID,
      });
    } else if (betrayed === myPlayer) {
      const buttons = [
        {
          text: "Focus",
          className: "btn-gray",
          action: () => this.eventBus.emit(new GoToPlayerEvent(traitor)),
          preventClose: true,
        },
      ];
      this.addEvent({
        description: `${traitor.name()} broke their alliance with you`,
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
      description: `Your alliance with ${other.name()} expired`,
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
      description: `${other.name()} requests you attack ${target.name()}`,
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
        description: `${sender.displayName()}:${update.emoji.message}`,
        unsafeDescription: true,
        type: MessageType.CHAT,
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
      unitView: unitView,
    });
  }

  onVoteForPeaceEvent(event: RequestVoteForPeaceUpdate) {
    const myPlayer = this.game.myPlayer();

    if (!myPlayer || myPlayer.smallID() !== event.playerID) {
      return;
    }

    const leader = this.game.playerBySmallID(event.leaderID) as PlayerView;
    const coalitionMembers = event.participants;

    const coalitionString = coalitionMembers.join(", ");
    this.addEvent({
      description: translateText("events_display.vote_for_peace", {
        list: coalitionString,
      }),
      type: MessageType.VOTE_FOR_PEACE,
      unsafeDescription: false,
      highlight: true,
      createdAt: this.game.ticks(),
      buttons: [
        {
          text: translateText("player_panel.yes"),
          className: "btn",
          action: () =>
            this.eventBus.emit(
              new SendAllianceWinVoteReplyIntentEvent(myPlayer, true),
            ),
        },
        {
          text: translateText("player_panel.no"),
          className: "btn-info",
          action: () =>
            this.eventBus.emit(
              new SendAllianceWinVoteReplyIntentEvent(myPlayer, false),
            ),
        },
      ],
    });
  }

  onVoteForPeaceReplyEvent(event: VoteForPeaceReplyUpdate) {
    const myPlayer = this.game.myPlayer();

    if (!myPlayer || myPlayer.smallID() !== event.playerID) {
      return;
    }

    this.addEvent({
      description: `${translateText("events_display.player_vote_response")} ${event.accepted ? translateText("player_panel.yes") : translateText("player_panel.no")}`,
      type: MessageType.VOTE_FOR_PEACE_REPLY,
      unsafeDescription: false,
      highlight: true,
      createdAt: this.game.ticks(),
    });
  }

  onVoteForPeaceExpiredEvent(event: ExpireVoteForPeaceUpdate) {
    const voteData = event.vote;
    const votedFor: string[] = [];
    const votedAgainst: string[] = [];
    for (const [voterID, accepted] of voteData.results.entries()) {
      if (accepted) {
        votedFor.push(voterID);
      } else {
        votedAgainst.push(voterID);
      }
    }
    const votedForString = votedFor.join(", ");
    const votedAgainstString = votedAgainst.join(", ");
    this.addEvent({
      description: `${translateText("events_display.vote_expired", { votedForString, votedAgainstString })}`,
      type: MessageType.VOTE_FOR_PEACE_REPLY,
      unsafeDescription: false,
      highlight: true,
      createdAt: this.game.ticks(),
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
                      Wilderness`,
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
                  "text-white cursor-pointer pointer-events-auto w-fit p-2 lg:p-3 rounded-md bg-gray-800/70 backdrop-blur",
              })}
            </div>
          `
        : html`
            <!-- Main Events Display -->
            <div
              class="relative w-full lg:bottom-2.5 lg:right-2.5 z-50 lg:w-96 backdrop-blur"
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
                      content: "Hide",
                      onClick: this.toggleHidden,
                      className:
                        "text-white cursor-pointer pointer-events-auto",
                    })}
                  </div>
                </div>
              </div>

              <!-- Content Area -->
              <div
                class="rounded-b-none md:rounded-b-md bg-gray-800/70 max-h-[30vh] flex flex-col-reverse overflow-y-auto w-full h-full"
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
                                            class="inline-block px-3 py-1 text-white rounded text-md md:text-sm cursor-pointer transition-colors duration-300
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
