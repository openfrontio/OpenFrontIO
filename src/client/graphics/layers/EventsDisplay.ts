import { html, LitElement } from "lit";
import { customElement, query, state, property } from "lit/decorators.js";
import { DirectiveResult } from "lit/directive.js";
import { unsafeHTML, UnsafeHTMLDirective } from "lit/directives/unsafe-html.js";
import { EventBus } from "../../../core/EventBus";
import {
  AllPlayers,
  getMessageCategory,
  MessageCategory,
  MessageType,
  Tick,
  UnitType,
} from "../../../core/game/Game";
import {
  AllianceExpiredUpdate,
  AllianceExtensionUpdate,
  AllianceRequestReplyUpdate,
  AllianceRequestUpdate,
  BrokeAllianceUpdate,
  DisplayChatMessageUpdate,
  DisplayMessageUpdate,
  EmojiUpdate,
  GameUpdateType,
  TargetPlayerUpdate,
  UnitIncomingUpdate,
} from "../../../core/game/GameUpdates";
import {
  SendAllianceExtensionIntentEvent,
  SendAllianceRejectIntentEvent,
  SendAllianceRequestIntentEvent,
} from "../../Transport";
import { Layer } from "./Layer";

import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { onlyImages } from "../../../core/Util";
import { renderNumber } from "../../Utils";
import { GoToPlayerEvent, GoToUnitEvent } from "./Leaderboard";

import { getMessageTypeClasses, translateText } from "../../Utils";
import { UIState } from "../UIState";
import allianceIcon from "/images/AllianceIconWhite.svg?url";
import chatIcon from "/images/ChatIconWhite.svg?url";
import donateGoldIcon from "/images/DonateGoldIconWhite.svg?url";
import nukeIcon from "/images/NukeIconWhite.svg?url";
import swordIcon from "/images/SwordIconWhite.svg?url";

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
  shouldDelete?: (game: GameView) => boolean;
  allianceID?: number;
  unitType?: string;
  messageKey?: string;
}

@customElement("events-display")
export class EventsDisplay extends LitElement implements Layer {
  @property({ type: String })
mode:
  | "all"
  | "trades"
  | "alerts"
  | "social"
  | "right"
  | "alliance_requests" = "all";
  public eventBus: EventBus;
  public game: GameView;
  public uiState: UIState;

  private active: boolean = false;
  private events: GameEvent[] = [];

  // allianceID -> last checked at tick
  private alliancesCheckedAt = new Map<number, Tick>();
  @state() private _hidden: boolean = false;
  @state() private _isVisible: boolean = false;
  @state() private newEvents: number = 0;
  @state() private latestGoldAmount: bigint | null = null;
  @state() private goldAmountAnimating: boolean = false;
  private goldAmountTimeoutId: ReturnType<typeof setTimeout> | null = null;
  @state() private eventsFilters: Map<MessageCategory, boolean> = new Map([
    [MessageCategory.ATTACK, false],
    [MessageCategory.NUKE, false],
    [MessageCategory.TRADE, false],
    [MessageCategory.ALLIANCE, false],
    [MessageCategory.CHAT, false],
  ]);
private applyModeFilters() {
  // true = caché ; false = affiché
  const hideAll = () => {
    this.eventsFilters.set(MessageCategory.ATTACK, true);
    this.eventsFilters.set(MessageCategory.NUKE, true);
    this.eventsFilters.set(MessageCategory.TRADE, true);
    this.eventsFilters.set(MessageCategory.ALLIANCE, true);
    this.eventsFilters.set(MessageCategory.CHAT, true);
  };

  const show = (cat: MessageCategory) => {
    this.eventsFilters.set(cat, false);
  };

  if (this.mode === "all") {
    // tout afficher
    this.eventsFilters.set(MessageCategory.ATTACK, false);
    this.eventsFilters.set(MessageCategory.NUKE, false);
    this.eventsFilters.set(MessageCategory.TRADE, false);
    this.eventsFilters.set(MessageCategory.ALLIANCE, false);
    this.eventsFilters.set(MessageCategory.CHAT, false);
    this.requestUpdate();
    return;
  }

  hideAll();

  if (this.mode === "trades") {
    show(MessageCategory.TRADE);
  } else if (this.mode === "alerts") {
    show(MessageCategory.ATTACK);
    show(MessageCategory.NUKE);
  } else if (this.mode === "social") {
    show(MessageCategory.ALLIANCE);
    show(MessageCategory.CHAT);
  } else if (this.mode === "right") {
    show(MessageCategory.ATTACK);
    show(MessageCategory.NUKE);
    show(MessageCategory.ALLIANCE);
    show(MessageCategory.CHAT);
  } else if (this.mode === "alliance_requests") {
    show(MessageCategory.ALLIANCE);
  }

  this.requestUpdate();
}
  private isCategoryAllowedInMode(category: MessageCategory): boolean {
    if (this.mode === "all") return true;
    if (this.mode === "trades") return category === MessageCategory.TRADE;
    if (this.mode === "alerts") {
      return (
        category === MessageCategory.ATTACK || category === MessageCategory.NUKE
      );
    }
    if (this.mode === "social") {
      return (
        category === MessageCategory.ALLIANCE || category === MessageCategory.CHAT
      );
    }
    if (this.mode === "right") {
      return (
        category === MessageCategory.ATTACK ||
        category === MessageCategory.NUKE ||
        category === MessageCategory.ALLIANCE ||
        category === MessageCategory.CHAT
      );
    }
    if (this.mode === "alliance_requests") {
      return category === MessageCategory.ALLIANCE;
    }
    return false;
  }

  private getEventCategory(event: GameEvent): MessageCategory {
    const isTradeShipCapture =
      event.unitType === UnitType.TradeShip ||
      event.messageKey === "events_display.received_gold_from_captured_ship";
    if (isTradeShipCapture) {
      return MessageCategory.TRADE;
    }
    return getMessageCategory(event.type);
  }

  private shouldHideEventForMode(event: GameEvent): boolean {
    if (this.mode === "alliance_requests") {
      return (
        event.type !== MessageType.ALLIANCE_REQUEST &&
        event.type !== MessageType.RENEW_ALLIANCE
      );
    }

    if (this.mode === "right") {
      if (
        event.type === MessageType.ALLIANCE_REQUEST ||
        event.type === MessageType.RENEW_ALLIANCE
      ) {
        return true;
      }
    }

    if (this.mode === "trades") {
      return event.type === MessageType.SENT_TROOPS_TO_PLAYER;
    }

    if (this.mode !== "alerts" && this.mode !== "right") return false;
    if (
      event.type !== MessageType.CAPTURED_ENEMY_UNIT &&
      event.type !== MessageType.UNIT_CAPTURED_BY_ENEMY
    ) {
      return false;
    }

    return (
      event.unitType === UnitType.City ||
      event.unitType === UnitType.Factory ||
      event.unitType === UnitType.Port
    );
  }
  @query(".events-container")
  private _eventsContainer?: HTMLDivElement;
  private _shouldScrollToBottom = true;

  updated(changed: Map<string, unknown>) {
  super.updated(changed);

  if (changed.has("mode")) {
    this.applyModeFilters();
  }

  if (this._eventsContainer && this._shouldScrollToBottom) {
    this._eventsContainer.scrollTop = this._eventsContainer.scrollHeight;
  }
}

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

  private renderToggleButton(src: string, category: MessageCategory) {
    if (!this.isCategoryAllowedInMode(category)) {
      return html``;
    }
    // Adding the literal for the default size ensures tailwind will generate the class
    const toggleButtonSizeMap = { default: "h-5" };
    return this.renderButton({
      content: html`<img
        src="${src}"
        class="${toggleButtonSizeMap["default"]}"
        style="${this.eventsFilters.get(category)
          ? "filter: grayscale(1) opacity(0.5);"
          : ""}"
      />`,
      onClick: () => this.toggleEventFilter(category),
      className: "cursor-pointer pointer-events-auto",
    });
  }

  private toggleHidden() {
    this._hidden = !this._hidden;
    if (this._hidden) {
      this.newEvents = 0;
    }
    this.requestUpdate();
  }

  private toggleEventFilter(filterName: MessageCategory) {
    if (!this.isCategoryAllowedInMode(filterName)) {
      return;
    }
    const currentState = this.eventsFilters.get(filterName) ?? false;
    this.eventsFilters.set(filterName, !currentState);
    this.requestUpdate();
  }

  private updateMap = [
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
    [
      GameUpdateType.AllianceExtension,
      this.onAllianceExtensionEvent.bind(this),
    ],
  ] as const;

  constructor() {
    super();
    this.events = [];
  }

  init() {}

  tick() {
    this.active = true;

    if (this._eventsContainer) {
      const el = this._eventsContainer;
      this._shouldScrollToBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 5;
    } else {
      this._shouldScrollToBottom = true;
    }

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

    const currentAllianceIds = new Set<number>();

    for (const alliance of myPlayer.alliances()) {
      currentAllianceIds.add(alliance.id);

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

      const other = this.game.player(alliance.other) as PlayerView;

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
            className: "btn-danger",
            action: () => {},
          },
        ],
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: other.smallID(),
        allianceID: alliance.id,
      });
    }

    for (const [allianceId] of this.alliancesCheckedAt) {
      if (!currentAllianceIds.has(allianceId)) {
        this.removeAllianceRenewalEvents(allianceId);
        this.alliancesCheckedAt.delete(allianceId);
      }
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

  private removeAllianceRenewalEvents(allianceID: number) {
    this.events = this.events.filter(
      (event) =>
        !(
          event.type === MessageType.RENEW_ALLIANCE &&
          event.allianceID === allianceID
        ),
    );
  }

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
    if (event.message.startsWith("events_display.")) {
      description = translateText(event.message, event.params ?? {});
    }

    this.addEvent({
      description: description,
      createdAt: this.game.ticks(),
      highlight: true,
      type: event.messageType,
      unsafeDescription: true,
      unitType:
        typeof event.params?.unit === "string" ? String(event.params.unit) : "",
      messageKey: event.message,
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

    let otherPlayerDiplayName: string = "";
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
              new SendAllianceRequestIntentEvent(recipient, requestor),
            ),
        },
        {
          text: translateText("events_display.reject_alliance"),
          className: "btn-danger",
          action: () =>
            this.eventBus.emit(new SendAllianceRejectIntentEvent(requestor)),
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

    this.removeAllianceRenewalEvents(update.allianceID);
    this.alliancesCheckedAt.delete(update.allianceID);
    this.requestUpdate();

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
          malusPercent: malusPercent,
          durationText: durationText,
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

  private onAllianceExtensionEvent(update: AllianceExtensionUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || myPlayer.smallID() !== update.playerID) return;
    this.removeAllianceRenewalEvents(update.allianceID);
    this.requestUpdate();
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

  emitGoToPlayerEvent(attackerID: number) {
    const attacker = this.game.playerBySmallID(attackerID) as PlayerView;
    if (!attacker) return;
    this.eventBus.emit(new GoToPlayerEvent(attacker));
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
      unitView: unitView,
    });
  }

  private getEventDescription(
    event: GameEvent,
  ): string | DirectiveResult<typeof UnsafeHTMLDirective> {
    return event.unsafeDescription
      ? unsafeHTML(onlyImages(event.description))
      : event.description;
  }

  private renderBetrayalDebuffTimer() {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isTraitor()) {
      return html``;
    }

    const remainingTicks = myPlayer.getTraitorRemainingTicks();
    const remainingSeconds = Math.ceil(remainingTicks / 10);

    if (remainingSeconds <= 0) {
      return html``;
    }

    return html`
      ${this.renderButton({
        content: html`${translateText("events_display.betrayal_debuff_ends", {
          time: remainingSeconds,
        })}`,
        className: "text-left text-yellow-400",
        translate: false,
      })}
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
      const category = this.getEventCategory(event);
      if (this.eventsFilters.get(category)) {
        return false;
      }
      if (this.shouldHideEventForMode(event)) {
        return false;
      }
      return true;
    });

    filteredEvents.sort((a, b) => {
      const aPrior = a.priority ?? 100000;
      const bPrior = b.priority ?? 100000;
      if (aPrior === bPrior) {
        return a.createdAt - b.createdAt;
      }
      return bPrior - aPrior;
    });

    if (this.mode === "alliance_requests") {
      const actionableEvents = filteredEvents.filter(
        (event) =>
          (event.type === MessageType.ALLIANCE_REQUEST ||
            event.type === MessageType.RENEW_ALLIANCE) &&
          (event.buttons?.length ?? 0) > 0,
      );

      if (actionableEvents.length === 0) {
        return html``;
      }

      return html`
        ${styles}
        <div class="w-full bg-gray-900/75 backdrop-blur-sm rounded-lg p-2 pointer-events-auto border border-white/10">
          <div class="text-[11px] uppercase tracking-wide text-gray-300 mb-1">
            Alliance Requests
          </div>
          <div class="flex flex-col gap-2">
            ${actionableEvents.map(
              (event) => html`
                <div class="text-xs text-white">
                  ${this.getEventDescription(event)}
                  <div class="flex flex-wrap gap-1.5 mt-1">
                    ${event.buttons?.map(
                      (btn) => html`
                        <button
                          class="inline-block px-3 py-1 text-white rounded-sm text-xs cursor-pointer transition-colors duration-300
                            ${btn.className.includes("btn-danger")
                              ? "bg-red-600 hover:bg-red-700"
                              : btn.className.includes("btn-gray")
                                ? "bg-gray-500 hover:bg-gray-600"
                                : "bg-green-600 hover:bg-green-700"}"
                          @click=${() => {
                            btn.action();
                            if (!btn.preventClose) {
                              const originalIndex = this.events.findIndex(
                                (e) => e === event,
                              );
                              if (originalIndex !== -1) {
                                this.removeEvent(originalIndex);
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
                </div>
              `,
            )}
          </div>
        </div>
      `;
    }

    return html`
      ${styles}
      <!-- Events Toggle (when hidden) -->
      ${this._hidden
        ? html`
            <div
              class="relative w-fit z-50"
            >
              ${this.renderButton({
                content: html`
                  <span class="flex items-center gap-2">
                    ${translateText("events_display.events")}
                    ${this.newEvents > 0
                      ? html`<span
                          class="inline-block px-2 bg-red-500 rounded-lg text-sm"
                          >${this.newEvents}</span
                        >`
                      : ""}
                  </span>
                `,
                onClick: this.toggleHidden,
                className:
                  "text-white cursor-pointer pointer-events-auto w-fit p-2 lg:p-3 min-[1200px]:rounded-lg max-sm:rounded-tr-lg sm:rounded-tl-lg bg-gray-800/70 backdrop-blur-xs",
              })}
            </div>
          `
        : html`
            <!-- Main Events Display -->
            <div
              class="relative w-full z-50 backdrop-blur-sm"
            >
              <!-- Button Bar -->
              <div
                class="${this.mode === "trades"
                  ? "w-full p-1.5 lg:p-2 bg-slate-900/45"
                  : this.mode === "right"
                    ? "w-full p-1.5 lg:p-2 bg-gray-800/70"
                    : "w-full p-2 lg:p-3 bg-gray-800/70"} min-[1200px]:rounded-t-lg sm:rounded-tl-lg"
              >
                <div class="flex justify-between items-center gap-3">
                  <div class="flex gap-4">
                    ${this.mode === "trades"
                      ? html`<span
                          class="text-white text-xs lg:text-sm font-semibold tracking-wide uppercase"
                          >Trade Information</span
                        >`
                      : this.mode === "alliance_requests"
                        ? html`<span
                            class="text-white text-xs lg:text-sm font-semibold tracking-wide uppercase"
                            >Alliance Requests</span
                          >`
                      : html`
                          ${this.renderToggleButton(
                            swordIcon,
                            MessageCategory.ATTACK,
                          )}
                          ${this.renderToggleButton(
                            nukeIcon,
                            MessageCategory.NUKE,
                          )}
                          ${this.renderToggleButton(
                            donateGoldIcon,
                            MessageCategory.TRADE,
                          )}
                          ${this.renderToggleButton(
                            allianceIcon,
                            MessageCategory.ALLIANCE,
                          )}
                          ${this.renderToggleButton(
                            chatIcon,
                            MessageCategory.CHAT,
                          )}
                        `}
                  </div>
                  <div class="flex items-center gap-3">
                    ${this.mode === "trades" && this.latestGoldAmount !== null
                      ? html`<span
                          class="text-gray-300 text-xs lg:text-sm font-medium"
                          >+${renderNumber(this.latestGoldAmount)}</span
                        >`
                      : ""}
                    ${this.renderButton({
                      content: translateText("leaderboard.hide"),
                      onClick: this.toggleHidden,
                      className: `text-white cursor-pointer pointer-events-auto ${this.mode === "right" ? "text-xs" : ""}`,
                    })}
                  </div>
                </div>
              </div>

              <!-- Content Area -->
              <div
                class="${this.mode === "trades"
                  ? "bg-slate-900/45 max-h-[7rem]"
                  : this.mode === "right"
                    ? "bg-gray-800/70 max-h-[27vh]"
                    : "bg-gray-800/70 max-h-[30vh]"} overflow-y-auto w-full h-full min-[1200px]:rounded-b-xl events-container"
              >
                <div>
                  <table
                    class="w-full max-h-none border-collapse text-white shadow-lg text-xs lg:text-sm pointer-events-auto"
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
                                      if (event.focusID)
                                        this.emitGoToPlayerEvent(event.focusID);
                                    },
                                    className: "text-left",
                                  })
                                : event.unitView
                                  ? this.renderButton({
                                      content: this.getEventDescription(event),
                                      onClick: () => {
                                        if (event.unitView)
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
                                            class="inline-block px-3 py-1 text-white rounded-sm text-xs lg:text-sm cursor-pointer transition-colors duration-300
                            ${btn.className.includes("btn-danger")
                                              ? "bg-red-600 hover:bg-red-700"
                                              : btn.className.includes("btn-info")
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
                      <!-- Betrayal debuff timer row (shown only in alerts panel) -->
                      ${(() => {
                        const myPlayer = this.game.myPlayer();
                        return (
                          (this.mode === "alerts" || this.mode === "right") &&
                          myPlayer &&
                          myPlayer.isTraitor() &&
                          myPlayer.getTraitorRemainingTicks() > 0
                        );
                      })()
                        ? html`
                            <tr class="lg:px-2 lg:py-1 p-1">
                              <td class="lg:px-2 lg:py-1 p-1 text-left">
                                ${this.renderBetrayalDebuffTimer()}
                              </td>
                            </tr>
                          `
                        : ""}

                      <!--- Empty row when no events -->
                      ${filteredEvents.length === 0 &&
                      !(() => {
                        const myPlayer = this.game.myPlayer();
                        return (
                          (this.mode === "alerts" || this.mode === "right") &&
                          myPlayer &&
                          myPlayer.isTraitor() &&
                          myPlayer.getTraitorRemainingTicks() > 0
                        );
                      })()
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
