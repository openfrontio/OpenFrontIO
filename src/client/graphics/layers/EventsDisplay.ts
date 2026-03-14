import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { DirectiveResult } from "lit/directive.js";
import { unsafeHTML, UnsafeHTMLDirective } from "lit/directives/unsafe-html.js";
import { EventBus } from "../../../core/EventBus";
import {
  AllPlayers,
  getMessageCategory,
  MessageCategory,
  MessageType,
  Tick,
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
import hydroIcon from "/images/MushroomCloudIconWhite.svg?url";
import nukeIcon from "/images/NukeIconWhite.svg?url";
import swordIcon from "/images/SwordIconWhite.svg?url";

const EVENT_DISPLAY_POSITION_KEY = "ui.hud.eventDisplayPosition";
const DIPLOMACY_POSITION_KEY = "ui.hud.diplomacyPosition";

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
}

@customElement("events-display")
export class EventsDisplay extends LitElement implements Layer {
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
  @state() private _eventDisplayPosition: "right" | "left" = "right";
  @state() private _diplomacyPosition: "right" | "left" = "right";
  private goldAmountTimeoutId: ReturnType<typeof setTimeout> | null = null;
  @state() private eventsFilters: Map<MessageCategory, boolean> = new Map([
    [MessageCategory.ATTACK, false],
    [MessageCategory.NUKE, false],
    [MessageCategory.TRADE, false],
    [MessageCategory.ALLIANCE, false],
    [MessageCategory.CHAT, false],
  ]);

  @query(".events-container")
  private _eventsContainer?: HTMLDivElement;
  @query(".events-main-panel")
  private _eventsMainPanel?: HTMLDivElement;
  @query(".events-toggle-panel")
  private _eventsTogglePanel?: HTMLDivElement;
  @state() private _eventsPanelHeight = 0;
  private _shouldScrollToBottom = true;

  updated(changed: Map<string, unknown>) {
    super.updated(changed);
    if (this._eventsContainer && this._shouldScrollToBottom) {
      this._eventsContainer.scrollTop = this._eventsContainer.scrollHeight;
    }
    const measuredHeight =
      this._eventsMainPanel?.offsetHeight ??
      this._eventsTogglePanel?.offsetHeight ??
      0;
    if (measuredHeight !== this._eventsPanelHeight) {
      this._eventsPanelHeight = measuredHeight;
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
    const currentState = this.eventsFilters.get(filterName) ?? false;
    this.eventsFilters.set(filterName, !currentState);
    this.requestUpdate();
  }

  private toggleEventDisplayPosition() {
    this._eventDisplayPosition =
      this._eventDisplayPosition === "right" ? "left" : "right";
    localStorage.setItem(EVENT_DISPLAY_POSITION_KEY, this._eventDisplayPosition);
    window.dispatchEvent(new CustomEvent("hud-position-change"));
    this.requestUpdate();
  }

  private toggleDiplomacyPosition() {
    this._diplomacyPosition =
      this._diplomacyPosition === "right" ? "left" : "right";
    localStorage.setItem(DIPLOMACY_POSITION_KEY, this._diplomacyPosition);
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
    this._eventDisplayPosition =
      localStorage.getItem(EVENT_DISPLAY_POSITION_KEY) === "left"
        ? "left"
        : "right";
    this._diplomacyPosition =
      localStorage.getItem(DIPLOMACY_POSITION_KEY) === "left"
        ? "left"
        : "right";
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
            className: "btn-info",
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
          className: "btn-info",
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
    const isNukeInbound =
      event.messageType === MessageType.NUKE_INBOUND ||
      event.messageType === MessageType.HYDROGEN_BOMB_INBOUND ||
      event.messageType === MessageType.MIRV_INBOUND;

    this.addEvent({
      description: event.message,
      type: event.messageType,
      unsafeDescription: false,
      highlight: true,
      createdAt: this.game.ticks(),
      unitView: unitView,
      focusID: unitView?.owner()?.smallID(),
      duration: isNukeInbound ? 60 * 60 * 10 : undefined,
      shouldDelete: isNukeInbound
        ? (game) => {
            const currentUnit = game.unit(event.unitID);
            return (
              !currentUnit ||
              !currentUnit.isActive() ||
              currentUnit.reachedTarget()
            );
          }
        : undefined,
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

  private isPriorityEvent(event: GameEvent): boolean {
    const category = getMessageCategory(event.type);
    if (category === MessageCategory.NUKE) return true;
    return (
      event.type === MessageType.ALLIANCE_REQUEST ||
      event.type === MessageType.RENEW_ALLIANCE
    );
  }

  private isDiplomacyFeedEvent(event: GameEvent): boolean {
    const category = getMessageCategory(event.type);
    if (category === MessageCategory.CHAT) return true;
    return (
      event.type === MessageType.ALLIANCE_ACCEPTED ||
      event.type === MessageType.ALLIANCE_REJECTED
    );
  }

  private renderEventBody(event: GameEvent) {
    return html`
      ${event.focusID
        ? this.renderButton({
            content: this.getEventDescription(event),
            onClick: () => {
              if (event.focusID) this.emitGoToPlayerEvent(event.focusID);
            },
            className: "text-left",
          })
        : event.unitView
          ? this.renderButton({
              content: this.getEventDescription(event),
              onClick: () => {
                if (event.unitView) this.emitGoToUnitEvent(event.unitView);
              },
              className: "text-left",
            })
          : this.getEventDescription(event)}
      ${event.buttons
        ? html`
            <div class="flex flex-wrap gap-1.5 mt-1">
              ${event.buttons.map(
                (btn) => html`
                  <button
                    class="inline-block px-3 py-1 text-white rounded-sm text-xs lg:text-sm cursor-pointer transition-colors duration-300
                      ${btn.className.includes("btn-info")
                      ? "bg-blue-500 hover:bg-blue-600"
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
          `
        : ""}
    `;
  }

  private formatRemainingTime(ticks: Tick): string {
    const totalSeconds = Math.max(0, Math.ceil(ticks / 10));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes <= 0) {
      return `${totalSeconds}s`;
    }
    return `${minutes}m ${seconds}s`;
  }

  private getAllianceRemainingTimeClass(ticks: Tick): string {
    if (ticks <= 30 * 10) {
      return "text-red-400";
    }
    if (ticks <= 60 * 10) {
      return "text-orange-300";
    }
    if (ticks <= 120 * 10) {
      return "text-yellow-300";
    }
    return "text-white/70";
  }

  private getAlliancePlayerNameClass(ticks: Tick): string {
    if (ticks <= 30 * 10) {
      return "text-red-400 hover:text-red-400";
    }
    if (ticks <= 60 * 10) {
      return "text-orange-300 hover:text-orange-200";
    }
    if (ticks <= 120 * 10) {
      return "text-yellow-300 hover:text-yellow-200";
    }
    return "text-emerald-300 hover:text-emerald-200";
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

    const visibleNonPriorityEvents = this.events.filter((event) => {
      if (this.isPriorityEvent(event)) return false;
      const category = getMessageCategory(event.type);
      return !this.eventsFilters.get(category);
    });
    const filteredEvents = visibleNonPriorityEvents.filter(
      (event) => !this.isDiplomacyFeedEvent(event),
    );
    const diplomacyFeedEvents = visibleNonPriorityEvents
      .filter((event) => this.isDiplomacyFeedEvent(event))
      .sort((a, b) => b.createdAt - a.createdAt);
    const priorityEvents = this.events.filter((event) =>
      this.isPriorityEvent(event),
    );

    filteredEvents.sort((a, b) => {
      const aPrior = a.priority ?? 100000;
      const bPrior = b.priority ?? 100000;
      if (aPrior === bPrior) {
        return a.createdAt - b.createdAt;
      }
      return bPrior - aPrior;
    });
    priorityEvents.sort((a, b) => a.createdAt - b.createdAt);
    const alliancePriorityEvents =
      this.eventsFilters.get(MessageCategory.ALLIANCE) === true
        ? []
        : priorityEvents.filter(
            (event) =>
              event.type === MessageType.ALLIANCE_REQUEST ||
              event.type === MessageType.RENEW_ALLIANCE,
          );
    const nukePriorityEvents = priorityEvents.filter(
      (event) =>
        this.eventsFilters.get(MessageCategory.NUKE) !== true &&
        getMessageCategory(event.type) === MessageCategory.NUKE,
    );
    const compactNukeAlerts = (() => {
      const grouped = new Map<
        string,
        {
          event: GameEvent;
          count: number;
        }
      >();
      for (const event of nukePriorityEvents) {
        const sourceKey =
          event.focusID !== undefined
            ? `p:${event.focusID}`
            : `d:${event.description}`;
        const key = `${event.type}:${sourceKey}`;
        const existing = grouped.get(key);
        if (!existing) {
          grouped.set(key, { event, count: 1 });
          continue;
        }
        existing.count += 1;
        if (event.createdAt >= existing.event.createdAt) {
          existing.event = event;
        }
      }
      return [...grouped.values()].sort(
        (a, b) => b.event.createdAt - a.event.createdAt,
      );
    })();
    const myPlayer = this.game.myPlayer();
    const expiringAlliances = (myPlayer?.alliances() ?? [])
      .slice()
      .sort((a, b) => a.expiresAt - b.expiresAt)
      .map((alliance) => {
        const other = this.game.player(alliance.other) as
          | PlayerView
          | undefined;
        if (!other) {
          return null;
        }
        return {
          other,
          remainingTicks: Math.max(0, alliance.expiresAt - this.game.ticks()),
        };
      })
      .filter(
        (
          row,
        ): row is {
          other: PlayerView;
          remainingTicks: Tick;
        } => row !== null,
      );
    const diplomacyOnLeft = this._diplomacyPosition === "left";
    const diplomacyBottomOffset =
      this._eventDisplayPosition === this._diplomacyPosition
        ? this._eventsPanelHeight + 8
        : 8;

    return html`
      ${styles}
      <!-- Events Toggle (when hidden) -->
      ${this._hidden
          ? html`
            <div class="relative w-fit z-50 events-toggle-panel">
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
                  "text-white cursor-pointer pointer-events-auto w-fit p-2 lg:p-3 min-[1200px]:rounded-lg sm:rounded-tl-lg bg-gray-800/92 backdrop-blur-sm",
              })}
            </div>
          `
        : html`
            <!-- Main Events Display -->
            <div
              class="relative w-full z-50 min-[1200px]:w-96 backdrop-blur-sm events-main-panel"
            >
              <!-- Button Bar -->
              <div
                class="w-full p-2 lg:p-3 bg-gray-800/92 backdrop-blur-sm sm:rounded-tl-lg min-[1200px]:rounded-t-lg"
              >
                <div class="flex justify-between items-center gap-3">
                  <div class="flex gap-4">
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
                    <button
                      class="px-1.5 py-0.5 rounded border border-white/20 text-[10px] font-semibold leading-none text-white/70 hover:text-white hover:border-white/40 transition-colors"
                      title="${this._eventDisplayPosition === "right"
                        ? "Move event display to left"
                        : "Move event display to right"}"
                      @click=${() => this.toggleEventDisplayPosition()}
                      translate="no"
                    >
                      ${this._eventDisplayPosition === "right" ? "R" : "L"}
                    </button>
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
              ${compactNukeAlerts.length > 0
                ? html`
                    <div class="bg-gray-800/92 border-t border-white/10 max-h-[4.5rem] overflow-y-auto">
                      ${compactNukeAlerts.map(({ event, count }) => {
                        const isHydrogen =
                          event.type === MessageType.HYDROGEN_BOMB_INBOUND;
                        const isMirv = event.type === MessageType.MIRV_INBOUND;
                        const cardClass = isMirv
                          ? "bg-red-600/92 border-b border-red-300/30 text-white"
                          : "bg-amber-400/92 border-b border-amber-300/60 text-zinc-900";
                        const iconClass = isMirv
                          ? "h-4 w-4 object-contain"
                          : "h-4 w-4 object-contain brightness-0";
                        return html`
                          <div
                            class="${cardClass} px-2 py-1.5 cursor-pointer"
                            @click=${() => {
                              if (event.unitView) {
                                this.emitGoToUnitEvent(event.unitView);
                                return;
                              }
                              if (event.focusID) {
                                this.emitGoToPlayerEvent(event.focusID);
                              }
                            }}
                          >
                            <div class="flex items-center gap-2">
                              <img
                                src=${isHydrogen ? hydroIcon : nukeIcon}
                                class="${iconClass}"
                              />
                              <div class="flex-1 min-w-0 text-xs font-semibold truncate">
                                ${this.getEventDescription(event)}
                              </div>
                              <div class="text-[11px] font-bold whitespace-nowrap">
                                X${count}
                              </div>
                            </div>
                          </div>
                        `;
                      })}
                    </div>
                  `
                : ""}
              <div
                class="bg-gray-800/92 backdrop-blur-sm max-h-[10.5rem] overflow-y-auto w-full h-full min-[1200px]:rounded-b-xl events-container"
              >
                <div>
                  <table
                    class="w-full max-h-none border-collapse text-white shadow-lg text-xs lg:text-sm pointer-events-auto"
                  >
                    <tbody>
                      ${filteredEvents.map(
                        (event) => html`
                          <tr>
                            <td
                              class="lg:px-2 lg:py-1 p-1 text-left ${getMessageTypeClasses(
                                event.type,
                              )}"
                            >
                              ${this.renderEventBody(event)}
                            </td>
                          </tr>
                        `,
                      )}
                      <!--- Betrayal debuff timer row -->
                      ${(() => {
                        const myPlayer = this.game.myPlayer();
                        return (
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
      <div
        class="hidden lg:flex fixed ${diplomacyOnLeft ? "left-0" : "right-0"} z-[260] w-96 max-w-[calc(100vw-1rem)] flex-col gap-1.5 pointer-events-none"
        style="${diplomacyOnLeft
          ? "left: env(safe-area-inset-left);"
          : "right: env(safe-area-inset-right);"} bottom: calc(env(safe-area-inset-bottom) + ${diplomacyBottomOffset}px);"
      >
        <div
          class="w-full bg-gray-800/92 border border-indigo-300/30 text-white backdrop-blur-sm rounded-xl shadow-lg pointer-events-auto overflow-hidden"
        >
          <div
            class="px-3 py-2 border-b border-white/10 flex items-center justify-between gap-3"
          >
            <div class="min-w-0">
              <div class="text-xs lg:text-sm font-semibold truncate">
                Diplomacy
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                class="px-1.5 py-0.5 rounded border border-white/20 text-[10px] font-semibold leading-none text-white/70 hover:text-white hover:border-white/40 transition-colors"
                title="${this._diplomacyPosition === "right"
                  ? "Move diplomacy panel to left"
                  : "Move diplomacy panel to right"}"
                @click=${() => this.toggleDiplomacyPosition()}
                translate="no"
              >
                ${this._diplomacyPosition === "right" ? "R" : "L"}
              </button>
              ${this.renderToggleButton(allianceIcon, MessageCategory.ALLIANCE)}
              ${this.renderToggleButton(chatIcon, MessageCategory.CHAT)}
            </div>
          </div>
          ${alliancePriorityEvents.length > 0
            ? html`
                <div class="px-2 py-2 border-b border-white/10 space-y-1.5">
                  ${alliancePriorityEvents.slice(-3).map((event) => {
                    const focusButton = event.buttons?.find((btn) =>
                      btn.className.includes("btn-gray"),
                    );
                    const noButton = event.buttons?.find((btn) =>
                      btn.className.includes("btn-info"),
                    );
                    const actionButton = event.buttons?.find(
                      (btn) =>
                        btn.className.includes("btn") &&
                        !btn.className.includes("btn-gray") &&
                        !btn.className.includes("btn-info"),
                    );
                    return html`
                      <div
                        class="bg-gray-700/45 border border-indigo-300/20 rounded-lg px-2.5 py-2"
                      >
                        <div class="flex-1 min-w-0">
                          <div class="text-xs lg:text-sm leading-tight font-bold">
                            ${this.getEventDescription(event)}
                          </div>
                          <div class="mt-1.5 flex gap-1.5">
                            <button
                              class="w-[72px] py-1 rounded-md text-white text-[13px] leading-none text-center ${event.type ===
                              MessageType.RENEW_ALLIANCE
                                ? "bg-blue-600/90"
                                : "bg-green-600/90"}"
                              @click=${() => {
                                actionButton?.action();
                                if (!actionButton?.preventClose) {
                                  const originalIndex = this.events.findIndex(
                                    (e) => e === event,
                                  );
                                  if (originalIndex !== -1) this.removeEvent(originalIndex);
                                }
                                this.requestUpdate();
                              }}
                            >
                              ${event.type === MessageType.RENEW_ALLIANCE
                                ? "Renew"
                                : "Yes"}
                            </button>
                            <button
                              class="w-[72px] py-1 rounded-md bg-red-600/90 text-white text-[13px] leading-none text-center"
                              @click=${() => {
                                noButton?.action();
                                if (!noButton?.preventClose) {
                                  const originalIndex = this.events.findIndex(
                                    (e) => e === event,
                                  );
                                  if (originalIndex !== -1) this.removeEvent(originalIndex);
                                }
                                this.requestUpdate();
                              }}
                            >
                              No
                            </button>
                            <button
                              class="w-[72px] py-1 rounded-md bg-zinc-600/90 text-white text-[13px] leading-none text-center"
                              @click=${() => {
                                if (event.focusID) {
                                  this.emitGoToPlayerEvent(event.focusID);
                                } else {
                                  focusButton?.action();
                                }
                                this.requestUpdate();
                              }}
                            >
                              Focus
                            </button>
                          </div>
                        </div>
                      </div>
                    `;
                  })}
                </div>
              `
            : ""}
          <div class="max-h-[108px] overflow-y-auto">
            ${expiringAlliances.length > 0
              ? expiringAlliances.map(
                  ({ other, remainingTicks }) => html`
                    <div class="px-3 py-2 border-b border-white/10 last:border-b-0">
                      <div class="flex items-center justify-between gap-2">
                        <button
                          class="text-left text-xs lg:text-sm font-semibold truncate ${this.getAlliancePlayerNameClass(
                            remainingTicks,
                          )}"
                          @click=${() =>
                            this.emitGoToPlayerEvent(other.smallID())}
                        >
                          ${other.name()}
                        </button>
                        <span
                          class="text-[11px] lg:text-xs whitespace-nowrap ${this.getAllianceRemainingTimeClass(
                            remainingTicks,
                          )}"
                        >
                          ${this.formatRemainingTime(remainingTicks)}
                        </span>
                      </div>
                    </div>
                  `,
                )
              : html`<div class="px-3 py-2 text-xs text-white/60">
                  No active alliances
                </div>`}
          </div>
          <div class="border-t border-white/10">
            <div class="px-3 py-1.5 text-[11px] uppercase tracking-wide text-white/55">
              Messages
            </div>
            <div class="max-h-[78px] overflow-y-auto">
              ${diplomacyFeedEvents.length > 0
                ? diplomacyFeedEvents.slice(0, 20).map(
                    (event) => html`
                      <div
                        class="px-3 py-1.5 border-b border-white/10 last:border-b-0 text-xs lg:text-sm ${getMessageTypeClasses(
                          event.type,
                        )}"
                      >
                        ${this.renderEventBody(event)}
                      </div>
                    `,
                  )
                : html`<div class="px-3 py-2 text-xs text-white/60">
                    No diplomacy messages
                  </div>`}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this;
  }
}
