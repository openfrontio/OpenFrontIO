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
  UnitType,
} from "../../../core/game/Game";
import {
  AttackUpdate,
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
} from "../../Transport";
import { Layer } from "./Layer";

import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { onlyImages } from "../../../core/Util";
import { renderNumber, renderTroops } from "../../Utils";
import { getColoredSprite } from "../SpriteLoader";
import {
  GoToPlayerEvent,
  GoToPositionEvent,
  GoToUnitEvent,
} from "./Leaderboard";

import { getMessageTypeClasses, translateText } from "../../Utils";
import { UIState } from "../UIState";
import chatIcon from "/images/ChatIconWhite.svg?url";
import donateGoldIcon from "/images/DonateGoldIconWhite.svg?url";
import nukeIcon from "/images/NukeIconWhite.svg?url";
import swordIcon from "/images/SwordIcon.svg?url";
import swordIconWhite from "/images/SwordIconWhite.svg?url";

export interface GameEvent {
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

  // Attack/boat tracking (mirrored from AttacksDisplay)
  private spriteDataURLCache: Map<string, string> = new Map();
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
    [MessageCategory.NUKE, false],
    [MessageCategory.TRADE, false],
    [MessageCategory.CHAT, false],
  ]);

  @query(".events-container")
  private _eventsContainer?: HTMLDivElement;
  private _shouldScrollToBottom = true;

  @query(".alliance-slot")
  private _allianceSlot?: HTMLDivElement;
  private _allianceOriginalParent?: Element | null = null;

  updated(changed: Map<string, unknown>) {
    super.updated(changed);
    if (this._eventsContainer && this._shouldScrollToBottom) {
      this._eventsContainer.scrollTop = this._eventsContainer.scrollHeight;
    }
    // Reparent <alliance-display> into the slot between button bar and
    // content area. This is a DOM move (not a clone), so the element keeps
    // its internal state, event listeners, and Lit lifecycle intact.
    // Side-effect: the element's parentElement changes, which means any
    // external code using document.querySelector("alliance-display") will
    // still find it, but its position in the DOM tree shifts. If this
    // causes issues with layout or third-party observers, consider using a
    // placeholder/sentinel element or CSS-based repositioning instead.
    const ad = document.querySelector("alliance-display");
    if (this._allianceSlot && ad) {
      this._allianceOriginalParent ??= ad.parentElement;
      if (ad.parentElement !== this._allianceSlot) {
        this._allianceSlot.appendChild(ad);
      }
    } else if (
      ad &&
      this._allianceOriginalParent &&
      document.contains(this._allianceOriginalParent) &&
      ad.parentElement !== this._allianceOriginalParent
    ) {
      // Panel is hidden/collapsed — move alliance-display back to its
      // original parent, but only if that parent is still in the document.
      this._allianceOriginalParent.appendChild(ad);
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

  private updateMap = [
    [GameUpdateType.DisplayEvent, this.onDisplayMessageEvent.bind(this)],
    [GameUpdateType.DisplayChatEvent, this.onDisplayChatEvent.bind(this)],
    [GameUpdateType.TargetPlayer, this.onTargetPlayerEvent.bind(this)],
    [GameUpdateType.Emoji, this.onEmojiMessageEvent.bind(this)],
    [GameUpdateType.UnitIncoming, this.onUnitIncomingEvent.bind(this)],
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

    this.updateAttacksAndBoats(myPlayer);

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
    super.disconnectedCallback();
    if (this.goldAmountTimeoutId !== null) {
      clearTimeout(this.goldAmountTimeoutId);
      this.goldAmountTimeoutId = null;
    }
    // Restore <alliance-display> to its original parent so it isn't lost
    // when EventsDisplay is removed from the DOM.
    const ad = document.querySelector("alliance-display");
    if (
      ad &&
      this._allianceOriginalParent &&
      document.contains(this._allianceOriginalParent) &&
      ad.parentElement !== this._allianceOriginalParent
    ) {
      this._allianceOriginalParent.appendChild(ad);
    }
    this._allianceOriginalParent = null;
  }

  private updateAttacksAndBoats(myPlayer: PlayerView) {
    this.outgoingAttacks = myPlayer
      .outgoingAttacks()
      .filter((a) => a.targetID !== 0);

    this.outgoingLandAttacks = myPlayer
      .outgoingAttacks()
      .filter((a) => a.targetID === 0);

    this.outgoingBoats = myPlayer
      .units()
      .filter((u) => u.type() === UnitType.TransportShip);
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

  private renderEventButtons(event: GameEvent) {
    if (!event.buttons) return "";
    return html`
      <div class="flex flex-wrap gap-1.5 mt-1">
        ${event.buttons.map(
          (btn) => html`
            <button
              class="inline-block px-3 py-1 text-white rounded-sm text-md md:text-sm cursor-pointer transition-colors duration-300
                ${btn.className.includes("btn-info")
                ? "bg-blue-500 hover:bg-blue-600"
                : btn.className.includes("btn-gray")
                  ? "bg-gray-500 hover:bg-gray-600"
                  : "bg-green-600 hover:bg-green-700"}"
              @click=${() => {
                btn.action();
                if (!btn.preventClose) {
                  const idx = this.events.findIndex((e) => e === event);
                  if (idx !== -1) this.removeEvent(idx);
                }
                this.requestUpdate();
              }}
            >
              ${btn.text}
            </button>
          `,
        )}
      </div>
    `;
  }

  private renderEventContent(event: GameEvent) {
    const description = event.focusID
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
        : this.getEventDescription(event);

    return html`${description} ${this.renderEventButtons(event)}`;
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

  // ── Attack / Boat render helpers (ported from AttacksDisplay) ──────────

  private emitCancelAttackIntent(id: string) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    this.eventBus.emit(new CancelAttackIntentEvent(id));
  }

  private emitBoatCancelIntent(id: number) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    this.eventBus.emit(new CancelBoatIntentEvent(id));
  }

  private getBoatSpriteDataURL(unit: UnitView): string {
    const owner = unit.owner();
    const key = `boat-${owner.id()}`;
    const cached = this.spriteDataURLCache.get(key);
    if (cached) return cached;
    try {
      const canvas = getColoredSprite(unit, this.game.config().theme());
      const dataURL = canvas.toDataURL();
      this.spriteDataURLCache.set(key, dataURL);
      return dataURL;
    } catch {
      return "";
    }
  }

  private async attackWarningOnClick(attack: AttackUpdate) {
    const playerView = this.game.playerBySmallID(attack.attackerID);
    if (playerView.isPlayer()) {
      const averagePosition = await playerView.attackAveragePosition(
        attack.attackerID,
        attack.id,
      );

      if (averagePosition === null) {
        this.emitGoToPlayerEvent(attack.attackerID);
      } else {
        this.eventBus.emit(
          new GoToPositionEvent(averagePosition.x, averagePosition.y),
        );
      }
    } else {
      this.emitGoToPlayerEvent(attack.attackerID);
    }
  }

  private renderOutgoingAttacks() {
    if (this.outgoingAttacks.length === 0) return html``;

    return this.outgoingAttacks.map(
      (attack) => html`
        <div
          class="flex items-center gap-0.5 w-full bg-gray-800/70 backdrop-blur-xs rounded px-1.5 py-0.5 overflow-hidden"
        >
          ${this.renderButton({
            content: html`<img
                src="${swordIcon}"
                class="h-4 w-4 inline-block"
                style="filter: invert(1)"
              />
              <span class="inline-block min-w-[3rem] text-right"
                >${renderTroops(attack.troops)}</span
              >
              <span class="truncate"
                >${(
                  this.game.playerBySmallID(attack.targetID) as PlayerView
                )?.name()}</span
              > `,
            onClick: async () => this.attackWarningOnClick(attack),
            className:
              "text-left text-blue-400 inline-flex items-center gap-0.5 lg:gap-1 min-w-0",
            translate: false,
          })}
          ${!attack.retreating
            ? this.renderButton({
                content: "❌",
                onClick: () => this.emitCancelAttackIntent(attack.id),
                className: "ml-auto text-left shrink-0",
                disabled: attack.retreating,
              })
            : html`<span class="ml-auto shrink-0 text-blue-400"
                >(${translateText("events_display.retreating")}...)</span
              >`}
        </div>
      `,
    );
  }

  private renderOutgoingLandAttacks() {
    if (this.outgoingLandAttacks.length === 0) return html``;

    return this.outgoingLandAttacks.map(
      (landAttack) => html`
        <div
          class="flex items-center gap-0.5 w-full bg-gray-800/70 backdrop-blur-xs rounded px-1.5 py-0.5 overflow-hidden"
        >
          ${this.renderButton({
            content: html`<img
                src="${swordIcon}"
                class="h-4 w-4 inline-block"
                style="filter: invert(1)"
              />
              <span class="inline-block min-w-[3rem] text-right"
                >${renderTroops(landAttack.troops)}</span
              >
              ${translateText("help_modal.ui_wilderness")}`,
            className:
              "text-left text-gray-400 inline-flex items-center gap-0.5 lg:gap-1 min-w-0",
            translate: false,
          })}
          ${!landAttack.retreating
            ? this.renderButton({
                content: "❌",
                onClick: () => this.emitCancelAttackIntent(landAttack.id),
                className: "ml-auto text-left shrink-0",
                disabled: landAttack.retreating,
              })
            : html`<span class="ml-auto shrink-0 text-blue-400"
                >(${translateText("events_display.retreating")}...)</span
              >`}
        </div>
      `,
    );
  }

  private getBoatTargetName(boat: UnitView): string {
    const target = boat.targetTile();
    if (target === undefined) return "";
    const ownerID = this.game.ownerID(target);
    if (ownerID === 0) return "";
    const player = this.game.playerBySmallID(ownerID) as PlayerView;
    return player?.name() ?? "";
  }

  private renderBoatIcon(boat: UnitView) {
    const dataURL = this.getBoatSpriteDataURL(boat);
    if (!dataURL) return html``;
    return html`<img
      src="${dataURL}"
      class="h-5 w-5 inline-block"
      style="image-rendering: pixelated"
    />`;
  }

  private renderBoats() {
    if (this.outgoingBoats.length === 0) return html``;

    return this.outgoingBoats.map(
      (boat) => html`
        <div
          class="flex items-center gap-0.5 w-full bg-gray-800/70 backdrop-blur-xs rounded px-1.5 py-0.5 overflow-hidden"
        >
          ${this.renderButton({
            content: html`${this.renderBoatIcon(boat)}
              <span class="inline-block min-w-[3rem] text-right"
                >${renderTroops(boat.troops())}</span
              >
              <span class="truncate text-xs"
                >${this.getBoatTargetName(boat)}</span
              >`,
            onClick: () => this.eventBus.emit(new GoToUnitEvent(boat)),
            className:
              "text-left text-blue-400 inline-flex items-center gap-0.5 lg:gap-1 min-w-0",
            translate: false,
          })}
          ${!boat.retreating()
            ? this.renderButton({
                content: "❌",
                onClick: () => this.emitBoatCancelIntent(boat.id()),
                className: "ml-auto text-left shrink-0",
                disabled: boat.retreating(),
              })
            : html`<span class="ml-auto shrink-0 text-blue-400"
                >(${translateText("events_display.retreating")}...)</span
              >`}
        </div>
      `,
    );
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
            <div
              class="relative w-fit min-[1200px]:bottom-4 min-[1200px]:right-4 z-50"
            >
              ${this.renderButton({
                content: html`
                  Events
                  <span
                    class="${this.newEvents
                      ? ""
                      : "hidden"} inline-block px-2 bg-red-500 rounded-lg text-sm"
                    >${this.newEvents}</span
                  >
                `,
                onClick: this.toggleHidden,
                className:
                  "text-white cursor-pointer pointer-events-auto w-fit p-2 lg:p-3 rounded-lg bg-gray-800/70 backdrop-blur-sm",
              })}
            </div>
          `
        : html`
            <!-- Main Events Display -->
            <div
              class="relative w-full min-[1200px]:bottom-4 min-[1200px]:right-4 z-50 min-[1200px]:w-96 backdrop-blur-sm"
            >
              <!-- Button Bar -->
              <div
                class="w-full p-2 lg:p-3 bg-gray-800/70 min-[1200px]:rounded-t-lg lg:rounded-tl-lg"
              >
                <div class="flex justify-between items-center">
                  <div class="flex gap-4">
                    ${this.renderToggleButton(
                      swordIconWhite,
                      MessageCategory.ATTACK,
                    )}
                    ${this.renderToggleButton(nukeIcon, MessageCategory.NUKE)}
                    ${this.renderToggleButton(
                      donateGoldIcon,
                      MessageCategory.TRADE,
                    )}
                    ${this.renderToggleButton(chatIcon, MessageCategory.CHAT)}
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

              <!-- Alliance Display Slot -->
              <div class="alliance-slot"></div>

              <!-- Content Area -->
              <div
                class="bg-gray-800/70 max-h-[30vh] overflow-y-auto w-full h-full min-[1200px]:rounded-b-xl events-container"
              >
                <div>
                  <table
                    class="w-full max-h-none border-collapse text-white shadow-lg lg:text-base text-md md:text-xs pointer-events-auto"
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
                              ${this.renderEventContent(event)}
                            </td>
                          </tr>
                        `,
                      )}
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
