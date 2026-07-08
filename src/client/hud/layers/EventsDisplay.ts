import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { DirectiveResult } from "lit/directive.js";
import { unsafeHTML, UnsafeHTMLDirective } from "lit/directives/unsafe-html.js";
import { EventBus } from "../../../core/EventBus";
import { AllPlayers, MessageType } from "../../../core/game/Game";
import {
  AllianceExpiredUpdate,
  AllianceRequestReplyUpdate,
  BrokeAllianceUpdate,
  DisplayChatMessageUpdate,
  DisplayMessageUpdate,
  DonateEventUpdate,
  EmojiUpdate,
  GameUpdateType,
  TargetPlayerUpdate,
  UnitIncomingUpdate,
} from "../../../core/game/GameUpdates";
import { Controller } from "../../Controller";
import { SendAllianceRequestIntentEvent } from "../../Transport";

import { onlyImages } from "../../../core/Util";
import { GoToPlayerEvent, GoToUnitEvent } from "../../TransformHandler";
import { GameView, PlayerView, UnitView } from "../../view";

import { PlaySoundEffectEvent } from "../../sound/Sounds";
import { UIState } from "../../UIState";
import {
  getMessageTypeClasses,
  renderNumber,
  renderTroops,
  translateText,
} from "../../Utils";

const UNIT_TRANSLATION_KEYS: Record<string, string> = {
  "City": "unit_type.city",
  "Port": "unit_type.port",
  "Defense Post": "unit_type.defense_post",
  "SAM Launcher": "unit_type.sam_launcher",
  "Missile Silo": "unit_type.missile_silo",
  "Factory": "unit_type.factory",
  "Warship": "unit_type.warship",
  "Transport": "unit_type.boat",
  "Atom Bomb": "unit_type.atom_bomb",
  "Hydrogen Bomb": "unit_type.hydrogen_bomb",
  "MIRV": "unit_type.mirv",
};

const getTranslatedUnitName = (unitType: string, plural: boolean): string => {
  const key = UNIT_TRANSLATION_KEYS[unitType];
  if (!key) return unitType;
  return translateText(plural ? `unit_type_plural.${key}` : `unit_type.${key}`);
};

function parseInboundNuke(m: string): { player: string; nukeType: string } | null {
  if (m.endsWith(" - atom bomb inbound")) return { player: m.slice(0, -20), nukeType: "atom" };
  if (m.endsWith(" - hydrogen bomb inbound")) return { player: m.slice(0, -24), nukeType: "hydrogen" };
  if (m.startsWith("⚠️⚠️⚠️ ") && m.endsWith(" - MIRV INBOUND ⚠️⚠️⚠️")) return { player: m.slice(7, -22), nukeType: "mirv" };
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _unused = [
  "events_display.atom_bomb_inbound",
  "events_display.atom_bomb_inbound_plural",
  "events_display.hydrogen_bomb_inbound",
  "events_display.hydrogen_bomb_inbound_plural",
  "events_display.mirv_inbound",
  "events_display.mirv_inbound_plural",
  "unit_type_plural.atom_bomb",
  "unit_type_plural.boat",
  "unit_type_plural.city",
  "unit_type_plural.defense_post",
  "unit_type_plural.factory",
  "unit_type_plural.hydrogen_bomb",
  "unit_type_plural.mirv",
  "unit_type_plural.missile_silo",
  "unit_type_plural.port",
  "unit_type_plural.sam_launcher",
  "unit_type_plural.warship",
];

interface GameEvent {
  description: string;
  unsafeDescription?: boolean;
  type: MessageType;
  highlight?: boolean;
  createdAt: number;
  onDelete?: () => void;
  focusID?: number;
  unitView?: UnitView;
  groupKey?: string;
  count?: number;
  unitType?: string;
  targetPlayerName?: string;
}

const TIER_1_TYPES: ReadonlySet<MessageType> = new Set([
  MessageType.NUKE_INBOUND,
  MessageType.HYDROGEN_BOMB_INBOUND,
  MessageType.MIRV_INBOUND,
  MessageType.NUKE_DETONATED,
  MessageType.NAVAL_INVASION_INBOUND,
  MessageType.ATTACK_REQUEST,
  MessageType.ALLIANCE_ACCEPTED,
  MessageType.ALLIANCE_REJECTED,
  MessageType.ALLIANCE_BROKEN,
  MessageType.RENEW_ALLIANCE,
  MessageType.CONQUERED_PLAYER,
  MessageType.CHAT,
  MessageType.DONATION_RECEIVED,
]);

const isTier1 = (type: MessageType): boolean => TIER_1_TYPES.has(type);

@customElement("events-display")
export class EventsDisplay extends LitElement implements Controller {
  public eventBus: EventBus;
  public game: GameView;
  public uiState: UIState;

  private active: boolean = false;
  private events: GameEvent[] = [];

  @state() private _isVisible: boolean = false;

  @query(".events-container")
  private _eventsContainer?: HTMLDivElement;
  private _shouldScrollToBottom = true;

  @query(".important-events-container")
  private _importantEventsContainer?: HTMLDivElement;
  private _shouldScrollImportantToBottom = true;

  updated(changed: Map<string, unknown>) {
    super.updated(changed);
    if (this._eventsContainer && this._shouldScrollToBottom) {
      this._eventsContainer.scrollTop = this._eventsContainer.scrollHeight;
    }
    if (this._importantEventsContainer && this._shouldScrollImportantToBottom) {
      this._importantEventsContainer.scrollTop =
        this._importantEventsContainer.scrollHeight;
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

  private updateMap = [
    [GameUpdateType.DisplayEvent, this.onDisplayMessageEvent.bind(this)],
    [GameUpdateType.DisplayChatEvent, this.onDisplayChatEvent.bind(this)],
    [
      GameUpdateType.AllianceRequestReply,
      this.onAllianceRequestReplyEvent.bind(this),
    ],
    [GameUpdateType.BrokeAlliance, this.onBrokeAllianceEvent.bind(this)],
    [GameUpdateType.TargetPlayer, this.onTargetPlayerEvent.bind(this)],
    [GameUpdateType.Emoji, this.onEmojiMessageEvent.bind(this)],
    [GameUpdateType.UnitIncoming, this.onUnitIncomingEvent.bind(this)],
    [GameUpdateType.AllianceExpired, this.onAllianceExpiredEvent.bind(this)],
    [GameUpdateType.DonateEvent, this.onDonateEvent.bind(this)],
  ] as const;

  constructor() {
    super();
    this.events = [];
  }

  init() {
    this.eventBus.on(
      SendAllianceRequestIntentEvent,
      this.onAllianceRequestSentConfirmation.bind(this),
    );
  }

  private onAllianceRequestSentConfirmation(e: SendAllianceRequestIntentEvent) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || e.requestor.id() !== myPlayer.id()) {
      return;
    }
    // If the recipient already has a pending alliance request to us, this
    // action accepts that request instead of sending a new one, so don't
    // show the "alliance request sent" confirmation.
    if (e.recipient.isRequestingAllianceWith(e.requestor)) {
      return;
    }
    this.addEvent({
      description: translateText("events_display.alliance_request_sent", {
        name: e.recipient.name(),
      }),
      type: MessageType.ALLIANCE_REQUEST,
      createdAt: this.game.ticks(),
    });
  }

  tick() {
    this.active = true;

    if (this._eventsContainer) {
      const el = this._eventsContainer;
      this._shouldScrollToBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 5;
    } else {
      this._shouldScrollToBottom = true;
    }

    if (this._importantEventsContainer) {
      const el = this._importantEventsContainer;
      this._shouldScrollImportantToBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 5;
    } else {
      this._shouldScrollImportantToBottom = true;
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

    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      for (const [ut, fn] of this.updateMap) {
        updates[ut]?.forEach(fn as (event: unknown) => void);
      }
    }

    let remainingEvents = this.events.filter((event) => {
      const expired = this.game.ticks() - event.createdAt >= 80;
      const isInboundWarning =
        event.type === MessageType.NUKE_INBOUND ||
        event.type === MessageType.HYDROGEN_BOMB_INBOUND ||
        event.type === MessageType.MIRV_INBOUND ||
        event.type === MessageType.NAVAL_INVASION_INBOUND;
      const unitGone =
        isInboundWarning &&
        event.unitView !== undefined &&
        !event.unitView.isActive();
      const shouldKeep = !expired && !unitGone;
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

  private addEvent(event: GameEvent) {
    if (event.groupKey) {
      const existing = this.events.find(
        (e) => e.groupKey === event.groupKey && this.game.ticks() - e.createdAt <= 30
      );
      if (existing) {
        existing.count = (existing.count ?? 1) + 1;
        existing.createdAt = this.game.ticks();
        if (event.unitView) existing.unitView = event.unitView;
        if (event.focusID) existing.focusID = event.focusID;

        const u = getTranslatedUnitName(existing.unitType ?? "", true);
        const n = existing.targetPlayerName ?? "";
        const c = existing.count;

        if (existing.groupKey?.startsWith("destroyed_")) {
          existing.description = translateText("events_display.unit_destroyed_plural", { count: c, unit: u });
        } else if (existing.groupKey?.startsWith("captured_")) {
          existing.description = translateText("events_display.unit_captured_plural", { count: c, unit: u, name: n });
        } else if (existing.groupKey?.startsWith("lost_")) {
          existing.description = translateText("events_display.unit_lost_plural", { count: c, unit: u, name: n });
        } else if (existing.groupKey?.startsWith("inbound_")) {
          const k = "events_display." + existing.unitType + (existing.unitType === "mirv" ? "" : "_bomb") + "_inbound_plural";
          existing.description = translateText(k, { count: c, name: n });
        }
        this.requestUpdate();
        return;
      }
    }
    this.events = [...this.events, event];
    this.requestUpdate();
  }

  onDisplayMessageEvent(event: DisplayMessageUpdate) {
    const myPlayer = this.game.myPlayer();
    if (event.playerID !== null && (!myPlayer || myPlayer.smallID() !== event.playerID)) return;
    if (event.message === "events_display.received_gold_from_captured_ship") return;

    const params = { ...event.params };
    if (params.unit) {
      params.unit = getTranslatedUnitName(String(params.unit), false);
    }

    const description = event.message.startsWith("events_display.")
      ? translateText(event.message, params)
      : event.message;

    let groupKey: string | undefined;
    const unitType = String(event.params?.unit ?? "");
    const targetPlayerName = String(event.params?.name ?? "");

    if (event.message === "events_display.unit_destroyed") {
      groupKey = `destroyed_${unitType}`;
    } else if (event.message === "events_display.unit_captured") {
      groupKey = `captured_${unitType}_${targetPlayerName}`;
    } else if (event.message === "events_display.unit_lost") {
      groupKey = `lost_${unitType}_${targetPlayerName}`;
    }

    this.addEvent({
      description,
      createdAt: this.game.ticks(),
      highlight: true,
      type: event.messageType,
      unsafeDescription: true,
      unitView: event.unitID !== undefined ? this.game.unit(event.unitID) : undefined,
      focusID: event.focusPlayerID,
      groupKey,
      unitType,
      targetPlayerName,
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
    this.eventBus.emit(new PlaySoundEffectEvent("message"));
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
      description: translateText("events_display.alliance_request_status", {
        name: recipient.displayName(),
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
      this.eventBus.emit(new PlaySoundEffectEvent("alliance-broken"));
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
          name: betrayed.displayName(),
          malusPercent: malusPercent,
          durationText: durationText,
        }),
        type: MessageType.ALLIANCE_BROKEN,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.betrayedID,
      });
    } else if (betrayed === myPlayer) {
      this.eventBus.emit(new PlaySoundEffectEvent("alliance-broken"));
      this.addEvent({
        description: translateText("events_display.betrayed_you", {
          name: traitor.displayName(),
        }),
        type: MessageType.ALLIANCE_BROKEN,
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
      description: translateText("events_display.alliance_expired", {
        name: other.displayName(),
      }),
      type: MessageType.ALLIANCE_EXPIRED,
      highlight: true,
      createdAt: this.game.ticks(),
      focusID: otherID,
    });
  }

  onDonateEvent(update: DonateEventUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const isRecipient = update.recipientId === myPlayer.id();
    const isSender = update.senderId === myPlayer.id();
    if (!isRecipient && !isSender) return;

    const other = isRecipient
      ? (this.game.player(update.senderId) as PlayerView)
      : (this.game.player(update.recipientId) as PlayerView);

    const isGold = update.donationType === "gold";
    const messageKey = isRecipient
      ? isGold
        ? "events_display.received_gold_from_player"
        : "events_display.received_troops_from_player"
      : isGold
        ? "events_display.sent_gold_to_player"
        : "events_display.sent_troops_to_player";
    const params: Record<string, string | number> = {
      name: other.displayName(),
      [isGold ? "gold" : "troops"]: isGold
        ? renderNumber(update.amount)
        : renderTroops(Number(update.amount)),
    };

    this.addEvent({
      description: translateText(messageKey, params),
      type: isRecipient
        ? MessageType.DONATION_RECEIVED
        : MessageType.DONATION_SENT,
      highlight: true,
      createdAt: this.game.ticks(),
      focusID: other.smallID(),
    });
  }

  onTargetPlayerEvent(event: TargetPlayerUpdate) {
    const other = this.game.playerBySmallID(event.playerID) as PlayerView;
    const myPlayer = this.game.myPlayer() as PlayerView;
    if (!myPlayer || !myPlayer.isFriendly(other)) return;

    const target = this.game.playerBySmallID(event.targetID) as PlayerView;

    this.addEvent({
      description: translateText("events_display.attack_request", {
        name: other.displayName(),
        target: target.displayName(),
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
    if (!myPlayer || myPlayer.smallID() !== event.playerID) return;

    const parsed = parseInboundNuke(event.message);
    let description = event.message;
    if (parsed) {
      const k = "events_display." + parsed.nukeType + (parsed.nukeType === "mirv" ? "" : "_bomb") + "_inbound";
      description = translateText(k, { name: parsed.player });
    }

    this.addEvent({
      description,
      type: event.messageType,
      unsafeDescription: false,
      highlight: true,
      createdAt: this.game.ticks(),
      unitView: this.game.unit(event.unitID),
      groupKey: parsed ? `inbound_${parsed.nukeType}_${parsed.player}` : undefined,
      unitType: parsed?.nukeType,
      targetPlayerName: parsed?.player,
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

  private renderEventRow(event: GameEvent) {
    return html`
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
        </td>
      </tr>
    `;
  }

  render() {
    if (!this.active || !this._isVisible) {
      return html``;
    }

    const myPlayer = this.game.myPlayer();
    const showBetrayalTimer = !!(
      myPlayer &&
      myPlayer.isTraitor() &&
      myPlayer.getTraitorRemainingTicks() > 0
    );

    const tier1Events: GameEvent[] = [];
    let tier2Events: GameEvent[] = [];
    for (const event of this.events) {
      (isTier1(event.type) ? tier1Events : tier2Events).push(event);
    }
    tier1Events.sort((a, b) => a.createdAt - b.createdAt);
    tier2Events.sort((a, b) => a.createdAt - b.createdAt);
    tier2Events = tier2Events.slice(-4);

    if (
      tier1Events.length === 0 &&
      tier2Events.length === 0 &&
      !showBetrayalTimer
    ) {
      return html``;
    }

    return html`
      <div class="flex flex-col gap-1 w-full min-[1200px]:w-96">
        ${tier2Events.length > 0
          ? html`
              <div
                class="bg-gray-800/92 backdrop-blur-sm max-h-[12vh] lg:max-h-[22vh] overflow-y-auto rounded-lg opacity-90 events-container"
              >
                <table
                  class="w-full border-collapse text-white text-xs lg:text-sm pointer-events-auto"
                >
                  <tbody>
                    ${tier2Events.map((event) => this.renderEventRow(event))}
                  </tbody>
                </table>
              </div>
            `
          : ""}
        ${tier1Events.length > 0 || showBetrayalTimer
          ? html`
              <div
                class="bg-gray-800 backdrop-blur-sm max-h-[30vh] lg:max-h-[40vh] overflow-y-auto rounded-lg shadow-lg border-l-4 border-red-500 important-events-container"
              >
                <table
                  class="w-full border-collapse text-white text-base lg:text-lg font-medium pointer-events-auto"
                >
                  <tbody>
                    ${tier1Events.map((event) => this.renderEventRow(event))}
                    ${showBetrayalTimer
                      ? html`
                          <tr>
                            <td class="lg:px-2 lg:py-1 p-1 text-left">
                              ${this.renderBetrayalDebuffTimer()}
                            </td>
                          </tr>
                        `
                      : ""}
                  </tbody>
                </table>
              </div>
            `
          : ""}
      </div>
    `;
  }

  createRenderRoot() {
    return this;
  }
}
