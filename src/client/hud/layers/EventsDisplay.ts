import { AllPlayers, MessageType } from "@openfront/engine-api/game/GameTypes";
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
} from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { DirectiveResult } from "lit/directive.js";
import { repeat } from "lit/directives/repeat.js";
import { unsafeHTML, UnsafeHTMLDirective } from "lit/directives/unsafe-html.js";
import "../../components/OfIcon";
import type { OfIconName } from "../../components/OfIcon";
import { Controller } from "../../Controller";
import { SendAllianceRequestIntentEvent } from "../../Transport";
import { UserSettings } from "../../UserSettings";

import { GoToPlayerEvent, GoToUnitEvent } from "../../TransformHandler";
import { GameView, PlayerView, UnitView } from "../../view";
import { onlyImages } from "./OnlyImages";

import { renderNumber, renderTroops } from "@openfront/engine-lib/Format";
import { PlaySoundEffectEvent } from "../../sound/Sounds";
import { UIState } from "../../UIState";
import {
  getMessageTypeClasses,
  severityColors,
  translateText,
} from "../../Utils";
import { ticksToSeconds } from "../GameTicks";
import { keepPressKeysFromGame, pressWithoutFocus } from "../HudKeys";
import { timeLeftLine } from "../TimeLeftLine";
import { eventText, EventTextPart } from "./EventText";

interface GameEvent {
  /** Keys the event's row, so the row stays its own as others come and go. */
  id: number;
  description: string;
  /** The description in parts, its names and amounts marked to be bold. */
  parts?: EventTextPart[];
  unsafeDescription?: boolean;
  type: MessageType;
  highlight?: boolean;
  /** Show in the small feed even if the type is normally tier 1. */
  minor?: boolean;
  createdAt: number;
  onDelete?: () => void;
  focusID?: number;
  unitView?: UnitView;
  /** Replaces the type's icon, when the type alone does not say enough. */
  icon?: OfIconName;
  /** Set on a missile warning that stands for every bomb of one type from one sender. */
  missileGroup?: InboundMissileGroup;
  /**
   * The line read out when the event arrived. Kept apart from the
   * description, so a missile line's new count is not read out again.
   */
  spoken?: string;
}

interface InboundMissileGroup {
  senderID: number;
  senderName: string;
  /** Translation key for a single bomb. */
  messageKey: string;
  /** Translation key for two or more bombs. */
  countKey: string;
  units: UnitView[];
}

// Missile warnings get one line per sender and bomb type, with a count,
// instead of one line per bomb. Maps each single-bomb key to its count key.
const INBOUND_MISSILE_COUNT_KEYS: Readonly<Record<string, string>> = {
  "events_display.atom_bomb_inbound": "events_display.atom_bomb_inbound_count",
  "events_display.hydrogen_bomb_inbound":
    "events_display.hydrogen_bomb_inbound_count",
  "events_display.mirv_inbound": "events_display.mirv_inbound_count",
};

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

const isImportant = (event: GameEvent): boolean =>
  TIER_1_TYPES.has(event.type) && !event.minor;

// A translated sentence for an event: plain as its description, and in parts
// for its row, with the values of the params named in `strong` and `emoji`
// marked.
function sentence(
  key: string,
  params: Record<string, string | number>,
  strong: readonly string[],
  emoji?: string,
): Pick<GameEvent, "description" | "parts"> {
  const parts = eventText(key, params, strong, emoji);
  return { description: parts.map((part) => part.text).join(""), parts };
}

// The icon of each message type. A Record, so a new type does not build
// until it has one.
const EVENT_ICONS: Record<MessageType, OfIconName> = {
  [MessageType.ATTACK_FAILED]: "sword",
  [MessageType.ATTACK_CANCELLED]: "sword",
  [MessageType.ATTACK_REQUEST]: "target",
  [MessageType.CONQUERED_PLAYER]: "sword",
  [MessageType.MIRV_INBOUND]: "mirv",
  [MessageType.NUKE_INBOUND]: "atom-bomb",
  [MessageType.NUKE_DETONATED]: "atom-bomb",
  [MessageType.HYDROGEN_BOMB_INBOUND]: "hydrogen-bomb",
  [MessageType.NAVAL_INVASION_INBOUND]: "boat",
  [MessageType.SAM_MISS]: "sam-launcher",
  [MessageType.SAM_HIT]: "sam-launcher",
  [MessageType.CAPTURED_ENEMY_UNIT]: "sword",
  [MessageType.UNIT_DESTROYED]: "explosion",
  [MessageType.ALLIANCE_ACCEPTED]: "alliance",
  [MessageType.ALLIANCE_REJECTED]: "alliance",
  [MessageType.ALLIANCE_REQUEST]: "alliance-request",
  [MessageType.ALLIANCE_BROKEN]: "break-alliance",
  [MessageType.ALLIANCE_EXPIRED]: "alliance",
  [MessageType.DONATION_SENT]: "donate-gold",
  [MessageType.DONATION_RECEIVED]: "donate-gold",
  [MessageType.CHAT]: "chat",
  [MessageType.RENEW_ALLIANCE]: "alliance",
};

// Good news about gold or troops: important, but not a warning, so it reads
// a size smaller than the rest of the important events.
const QUIET_TIER_1_TYPES: ReadonlySet<MessageType> = new Set([
  MessageType.CONQUERED_PLAYER,
  MessageType.DONATION_RECEIVED,
]);

// Look. Sizes, colours and spacing of each part live here, so a change of
// look is one edit. The templates below only hold structure.

// Each block is one flat panel; the rows are not panels. The scrollbar has a
// fixed colour so it still shows over the map at 0% HUD opacity.
const BLOCK =
  "hud-panel rounded-lg sm:max-lg:landscape:rounded-l-none overflow-x-hidden overflow-y-auto [scrollbar-width:thin] [scrollbar-color:rgb(255_255_255_/_0.35)_transparent]";
// The hairline between rows is an inset shadow, not a border, so it takes no
// height of its own. Clipped, so the content of a new row rising from below
// does not make the block taller and scroll it while it rises.
const ROW =
  "relative overflow-clip not-first:shadow-[inset_0_1px_var(--color-hud-line)]";
// Important rows with a tone: a light fade of the tone's colour, strongest at
// the row's end and gone before the text. A child, so the row's hover draws
// over it; it does not fade with the HUD opacity, as it is content. It is
// drawn twice as strong at half opacity, so a new row can land with it at
// full strength and let it settle by fading opacity alone.
const TINT =
  "pointer-events-none absolute inset-0 bg-linear-to-l from-current/40 via-current/10 via-55% to-transparent opacity-50 animate-event-arrive motion-reduce:animate-none";
// An icon column, then the text. The icon's box is one line tall and sits on
// the first line, so a wrapped row keeps its icon at the top. A new row's
// content rises into place; the row's own height does not open, as that
// would fight the important block's stick-to-bottom scrolling.
const ROW_BODY =
  "relative grid w-full grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 ps-2 pe-2.5 text-start animate-hud-rise motion-reduce:animate-none";
const GO_TO =
  "pointer-fine:hover:bg-white/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-aquarius";
const ICON_BOX = "flex items-center justify-center";
const TEXT = "min-w-0 wrap-anywhere";
// Important rows: 15px text in 32px rows, 16px in 36px from lg. Routine
// rows: 13px in 24px, 14px in 28px from lg, and dimmer. The sentence is in a
// regular weight and its names and amounts (`strong`) stand out from it.
const TIERS = {
  important: {
    body: "py-1.5",
    icon: "h-5 lg:h-6",
    iconSize: 16,
    text: "text-[15px]/5 lg:text-base/6 text-white/80",
    strong: "font-bold text-white",
  },
  routine: {
    body: "py-1",
    icon: "h-4 lg:h-5",
    iconSize: 14,
    text: "text-[13px]/4 lg:text-sm/5 text-white/70",
    strong: "font-semibold text-white",
  },
} as const;
// Good news about gold or troops (QUIET_TIER_1_TYPES): a size smaller, in
// the same row height.
const QUIET_TEXT = "text-[13px]/5 lg:text-sm/6 text-white/80";
// An emoji a third larger than the text. No line height of its own, so the
// row keeps its height; moved down onto the capitals, as emoji fonts draw the
// glyph above them (translate, not top: layout rounds top to whole pixels).
// In opaque white, as a colour emoji takes the alpha of the dimmed sentence.
const EMOJI =
  "inline-block text-[1.33em] leading-[0] translate-y-[0.1em] text-white";
const BETRAYAL_ICON = "text-yellow-400";

type Tier = keyof typeof TIERS;

@customElement("events-display")
export class EventsDisplay extends LitElement implements Controller {
  public eventBus: EventBus;
  public game: GameView;
  public uiState: UIState;

  private active: boolean = false;
  private events: GameEvent[] = [];
  private nextEventID = 0;
  private userSettings = new UserSettings();

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

  private initGeneration = 0;
  private allianceConfirmationUnsub: (() => void) | null = null;
  private onAllianceRequestSentConfirmationBound =
    this.onAllianceRequestSentConfirmation.bind(this);

  private unsubscribeBus(): void {
    this.allianceConfirmationUnsub?.();
    this.allianceConfirmationUnsub = null;
  }

  init(): () => void {
    this.unsubscribeBus();
    const gen = ++this.initGeneration;
    const bus = this.eventBus;
    if (bus) {
      bus.on(
        SendAllianceRequestIntentEvent,
        this.onAllianceRequestSentConfirmationBound,
      );
      this.allianceConfirmationUnsub = () =>
        bus.off?.(
          SendAllianceRequestIntentEvent,
          this.onAllianceRequestSentConfirmationBound,
        );
    }
    return () => {
      if (gen === this.initGeneration) {
        this.dispose();
      }
    };
  }

  dispose(): void {
    this.initGeneration++;
    this.unsubscribeBus();
    this.events = [];
    this.active = false;
    this._isVisible = false;
    this.requestUpdate();
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
      ...sentence(
        "events_display.alliance_request_sent",
        { name: e.recipient.displayName() },
        ["name"],
      ),
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

    const firstNewID = this.nextEventID;
    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      for (const [ut, fn] of this.updateMap) {
        updates[ut]?.forEach(fn as (event: unknown) => void);
      }
    }

    // Important events are read out once, as they arrive; routine ones would
    // drown them. Not in a replay, nor while the game catches up on missed
    // turns: events come many ticks at a time there, faster than speech.
    if (
      this._isVisible &&
      !this.game.config().isReplay() &&
      !this.game.isCatchingUp()
    ) {
      for (const event of this.events) {
        if (event.id >= firstNewID && isImportant(event)) {
          event.spoken = event.description;
        }
      }
    }

    let remainingEvents = this.events.filter((event) => {
      const age = this.game.ticks() - event.createdAt;
      // A negative age is an event from later in the game: the replay
      // viewer seeked back past it.
      const expired = age >= 80 || age < 0;
      if (event.missileGroup) {
        return this.keepMissileGroup(event, expired);
      }
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

  private addEvent(event: Omit<GameEvent, "id">) {
    this.events = [...this.events, { ...event, id: this.nextEventID++ }];
    this.requestUpdate();
  }

  // Drops bombs that landed or were shot down and refreshes the count.
  // The line goes away once none are left, or when it expires.
  private keepMissileGroup(event: GameEvent, expired: boolean): boolean {
    const group = event.missileGroup!;
    const before = group.units.length;
    group.units = group.units.filter((unit) => unit.isActive());
    const keep = !expired && group.units.length > 0;
    if (!keep) {
      event.onDelete?.();
      return false;
    }
    if (group.units.length !== before) {
      event.unitView = group.units[0];
      Object.assign(event, this.missileGroupSentence(group));
    }
    return true;
  }

  private missileGroupSentence(group: InboundMissileGroup) {
    if (group.units.length === 1) {
      return sentence(group.messageKey, { name: group.senderName }, ["name"]);
    }
    return sentence(
      group.countKey,
      { name: group.senderName, count: group.units.length },
      ["name"],
    );
  }

  // Adds the bomb to the open line for its sender and type, or starts one.
  private addInboundMissile(
    unitView: UnitView,
    messageKey: string,
    countKey: string,
    type: MessageType,
  ) {
    const sender = unitView.owner();
    const senderID = sender.smallID();
    const existing = this.events.find(
      (event) =>
        event.type === type && event.missileGroup?.senderID === senderID,
    );

    if (existing) {
      const group = existing.missileGroup!;
      if (!group.units.some((unit) => unit.id() === unitView.id())) {
        group.units.push(unitView);
      }
      Object.assign(existing, this.missileGroupSentence(group));
      // Each new bomb restarts the timer, so the line stays up while
      // bombs keep coming.
      existing.createdAt = this.game.ticks();
      this.events = [...this.events];
      this.requestUpdate();
      return;
    }

    const group: InboundMissileGroup = {
      senderID,
      senderName: sender.displayName(),
      messageKey,
      countKey,
      units: [unitView],
    };
    this.addEvent({
      ...this.missileGroupSentence(group),
      type,
      unsafeDescription: false,
      highlight: true,
      createdAt: this.game.ticks(),
      unitView,
      missileGroup: group,
    });
  }

  // The core simulation runs identically for every client and has no notion
  // of Anonymous Names, so a params.name value it bakes into a DisplayEvent
  // is always the subject's real name. When the message identifies that
  // subject via focusPlayerID, re-resolve the name through this viewer's own
  // PlayerView instead, which already respects the local Anonymous Names
  // setting - otherwise a message like "X conquered you" leaks X's real name
  // even when this viewer has Anonymous Names turned on.
  private resolveParams(
    event: DisplayMessageUpdate,
  ): Record<string, string | number> {
    let params = event.params ?? {};
    if (
      (event.message === "events_display.missile_intercepted" ||
        event.message === "events_display.unit_destroyed") &&
      typeof params.unit === "string" &&
      params.unit.startsWith("unit_type.")
    ) {
      params = { ...params, unit: translateText(params.unit) };
    }

    if (params.name === undefined || event.focusPlayerID === undefined) {
      return params;
    }
    const subject = this.game.playerBySmallID(event.focusPlayerID);
    if (!subject.isPlayer()) {
      return params;
    }
    return { ...params, name: subject.displayName() };
  }

  onDisplayMessageEvent(event: DisplayMessageUpdate) {
    const myPlayer = this.game.myPlayer();
    if (
      event.playerID !== null &&
      (!myPlayer || myPlayer.smallID() !== event.playerID)
    ) {
      return;
    }

    // Captured trade-ship gold is surfaced as a transient +gold pip in
    // control-panel rather than as a scroll-list entry.
    if (event.message === "events_display.received_gold_from_captured_ship") {
      return;
    }

    // Every string value is a name, an amount or a unit, so all are marked.
    // They are the resolved ones, so an anonymised name is the one in bold.
    let text: Pick<GameEvent, "description" | "parts"> = {
      description: event.message,
    };
    if (event.message.startsWith("events_display.")) {
      const params = this.resolveParams(event);
      const strong = Object.keys(params).filter(
        (name) => typeof params[name] === "string",
      );
      text = sentence(event.message, params, strong);
    }

    const unitView =
      event.unitID !== undefined ? this.game.unit(event.unitID) : undefined;
    this.addEvent({
      ...text,
      createdAt: this.game.ticks(),
      highlight: true,
      type: event.messageType,
      unsafeDescription: true,
      unitView: unitView,
      focusID: event.focusPlayerID,
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
    let otherPlayerSmallID: number | undefined;
    if (event.recipient !== null) {
      //'recipient' parameter contains sender ID or recipient ID
      const player = this.game.player(event.recipient);
      otherPlayerDiplayName = player ? player.displayName() : "";
      otherPlayerSmallID = player?.smallID();
    }

    // A message I sent is only a confirmation, like a sent emoji: it goes to
    // the small feed, quietly.
    const sent = !event.isFrom;
    this.addEvent({
      ...sentence(
        sent ? "chat.to" : "chat.from",
        { user: otherPlayerDiplayName, msg: translatedMessage },
        ["user"],
      ),
      createdAt: this.game.ticks(),
      highlight: !sent,
      minor: sent,
      type: MessageType.CHAT,
      unsafeDescription: false,
      focusID: otherPlayerSmallID,
    });
    if (!sent) {
      this.eventBus.emit(new PlaySoundEffectEvent("message"));
    }
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
      ...sentence(
        "events_display.alliance_request_status",
        {
          name: recipient.displayName(),
          status: update.accepted
            ? translateText("events_display.alliance_accepted")
            : translateText("events_display.alliance_rejected"),
        },
        ["name"],
      ),
      type: update.accepted
        ? MessageType.ALLIANCE_ACCEPTED
        : MessageType.ALLIANCE_REJECTED,
      highlight: true,
      createdAt: this.game.ticks(),
      focusID: update.request.recipientID,
    });
    this.eventBus.emit(
      new PlaySoundEffectEvent(
        update.accepted ? "alliance-accepted" : "alliance-declined",
      ),
    );
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
        ticksToSeconds(this.game.config().traitorDuration()),
      );
      const durationText =
        traitorDuration === 1
          ? translateText("events_display.duration_second")
          : translateText("events_display.duration_seconds_plural", {
              seconds: traitorDuration,
            });

      this.addEvent({
        ...sentence(
          "events_display.betrayal_description",
          {
            name: betrayed.displayName(),
            malusPercent: malusPercent,
            durationText: durationText,
          },
          ["name"],
        ),
        type: MessageType.ALLIANCE_BROKEN,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.betrayedID,
      });
    } else if (betrayed === myPlayer) {
      this.eventBus.emit(new PlaySoundEffectEvent("alliance-broken"));
      this.addEvent({
        ...sentence(
          "events_display.betrayed_you",
          { name: traitor.displayName() },
          ["name"],
        ),
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
      ...sentence(
        "events_display.alliance_expired",
        { name: other.displayName() },
        ["name"],
      ),
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
      ...sentence(messageKey, params, ["name", "gold", "troops"]),
      type: isRecipient
        ? MessageType.DONATION_RECEIVED
        : MessageType.DONATION_SENT,
      icon: isGold ? "donate-gold" : "donate-troops",
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
      ...sentence(
        "events_display.attack_request",
        { name: other.displayName(), target: target.displayName() },
        ["name", "target"],
      ),
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
      // Honor the "Disable emojis" setting: don't surface received emojis in
      // the events feed either (#4430). Confirmations of emojis you sent
      // still show, since the setting doesn't stop you sending them.
      if (!this.userSettings.emojis()) return;
      const name = sender.displayName();
      this.addEvent({
        description: `${name}: ${update.emoji.message}`,
        parts: [
          { text: name, strong: true },
          { text: ": ", strong: false },
          { text: update.emoji.message, strong: false, emoji: true },
        ],
        type: MessageType.CHAT,
        icon: "emoji",
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.emoji.senderID,
      });
    } else if (sender === myPlayer && recipient !== AllPlayers) {
      this.addEvent({
        ...sentence(
          "events_display.sent_emoji",
          {
            name: (recipient as PlayerView).displayName(),
            emoji: update.emoji.message,
          },
          ["name"],
          "emoji",
        ),
        type: MessageType.CHAT,
        icon: "emoji",
        minor: true,
        createdAt: this.game.ticks(),
        focusID: recipient.smallID(),
      });
    } else if (sender === myPlayer) {
      this.addEvent({
        ...sentence(
          "events_display.sent_emoji_all",
          { emoji: update.emoji.message },
          [],
          "emoji",
        ),
        type: MessageType.CHAT,
        icon: "emoji",
        minor: true,
        createdAt: this.game.ticks(),
      });
    }
  }

  onUnitIncomingEvent(event: UnitIncomingUpdate) {
    const myPlayer = this.game.myPlayer();

    if (!myPlayer || myPlayer.smallID() !== event.playerID) {
      return;
    }

    const unitView = this.game.unit(event.unitID);
    const countKey = INBOUND_MISSILE_COUNT_KEYS[event.message];
    if (unitView && countKey) {
      this.addInboundMissile(
        unitView,
        event.message,
        countKey,
        event.messageType,
      );
      return;
    }

    let text: Pick<GameEvent, "description" | "parts"> = {
      description: event.message,
    };
    if (event.message.startsWith("events_display.") && unitView) {
      const params: Record<string, string | number> = {
        name: unitView.owner().displayName(),
      };
      if (event.messageType === MessageType.NAVAL_INVASION_INBOUND) {
        params.troops = renderTroops(unitView.troops());
      }
      text = sentence(event.message, params, ["name", "troops"]);
    }

    this.addEvent({
      ...text,
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
    const remainingSeconds = Math.ceil(ticksToSeconds(remainingTicks));
    if (remainingSeconds <= 0) {
      return html``;
    }

    const look = TIERS.important;
    return html`
      <li data-betrayal-debuff class=${ROW}>
        <div class="${ROW_BODY} ${look.body}">
          <span class="${ICON_BOX} ${look.icon} ${BETRAYAL_ICON}">
            <of-icon name="traitor" size=${look.iconSize}></of-icon>
          </span>
          <span class="${TEXT} ${look.text}">
            ${translateText("events_display.betrayal_debuff_ends", {
              time: remainingSeconds,
            })}
          </span>
        </div>
        ${timeLeftLine(remainingTicks / this.game.config().traitorDuration())}
      </li>
    `;
  }

  private renderEventRow(event: GameEvent, tier: Tier) {
    const look = TIERS[tier];
    const quiet = tier === "important" && QUIET_TIER_1_TYPES.has(event.type);
    const toneClass = getMessageTypeClasses(event.type);
    const tone = Object.keys(severityColors).find(
      (key) => severityColors[key] === toneClass,
    );
    const tinted = tier === "important" && tone !== "info";
    const content = html`
      <span class="${ICON_BOX} ${look.icon} ${toneClass}">
        <of-icon
          name=${event.icon ?? EVENT_ICONS[event.type]}
          size=${look.iconSize}
        ></of-icon>
      </span>
      <span class="${TEXT} ${quiet ? QUIET_TEXT : look.text}">
        ${
          event.parts
            ? event.parts.map((part) =>
                part.strong
                  ? html`<strong dir="auto" class=${look.strong}
                      >${part.text}</strong
                    >`
                  : part.emoji
                    ? html`<span data-emoji class=${EMOJI}>${part.text}</span>`
                    : part.text,
              )
            : this.getEventDescription(event)
        }
      </span>
    `;
    const { focusID, unitView } = event;
    const goTo = focusID
      ? () => this.emitGoToPlayerEvent(focusID)
      : unitView
        ? () => this.emitGoToUnitEvent(unitView)
        : undefined;
    return html`
      <li
        data-event-row
        data-tier=${tier}
        data-tone=${tone}
        ?data-quiet=${quiet}
        class=${ROW}
      >
        ${tinted ? html`<span data-tint class="${TINT} ${toneClass}"></span>` : ""}
        ${
          goTo
            ? html`<button
                type="button"
                class="${ROW_BODY} ${look.body} ${GO_TO}"
                @mousedown=${pressWithoutFocus}
                @click=${goTo}
              >
                ${content}
              </button>`
            : html`<div class="${ROW_BODY} ${look.body}">${content}</div>`
        }
      </li>
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
      (isImportant(event) ? tier1Events : tier2Events).push(event);
    }
    tier1Events.sort((a, b) => a.createdAt - b.createdAt);
    tier2Events.sort((a, b) => a.createdAt - b.createdAt);
    tier2Events = tier2Events.slice(-4);

    // The log is there whenever the feed is, even empty: a screen reader may
    // not read out a region that appears together with its first line. It
    // is out of the flow, so an empty feed still shows nothing.
    return html`
      <div
        class="flex flex-col gap-1 w-full min-[1200px]:w-96"
        @keydown=${keepPressKeysFromGame}
        @keyup=${keepPressKeysFromGame}
      >
        <div
          role="log"
          aria-relevant="additions"
          aria-label=${translateText("events_display.log_label")}
          class="sr-only"
        >
          ${repeat(
            this.events.filter((event) => event.spoken !== undefined),
            (event) => event.id,
            (event) => html`<p>${event.spoken}</p>`,
          )}
        </div>
        ${
          tier2Events.length > 0
            ? html`
                <div
                  class="${BLOCK} max-h-[12vh] lg:max-h-[22vh] events-container"
                >
                  <ul role="list" class="pointer-events-auto">
                    ${repeat(
                      tier2Events,
                      (event) => event.id,
                      (event) => this.renderEventRow(event, "routine"),
                    )}
                  </ul>
                </div>
              `
            : ""
        }
        ${
          tier1Events.length > 0 || showBetrayalTimer
            ? html`
                <div
                  class="${BLOCK} max-h-[30vh] lg:max-h-[40vh] important-events-container"
                >
                  <ul role="list" class="pointer-events-auto">
                    ${repeat(
                      tier1Events,
                      (event) => event.id,
                      (event) => this.renderEventRow(event, "important"),
                    )}
                    ${showBetrayalTimer ? this.renderBetrayalDebuffTimer() : ""}
                  </ul>
                </div>
              `
            : ""
        }
      </div>
    `;
  }

  createRenderRoot() {
    return this;
  }
}
