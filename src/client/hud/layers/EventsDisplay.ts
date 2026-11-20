import { AllPlayers, MessageType } from "@openfront/engine-api/game/GameTypes";
import {
  AllianceExpiredUpdate,
  AllianceRequestReplyUpdate,
  AllianceRequestUpdate,
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
import { keyed } from "lit/directives/keyed.js";
import { repeat } from "lit/directives/repeat.js";
import { unsafeHTML, UnsafeHTMLDirective } from "lit/directives/unsafe-html.js";
import "../../components/OfIcon";
import type { OfIconName } from "../../components/OfIcon";
import { Controller } from "../../Controller";
import { SendAllianceRequestIntentEvent } from "../../Transport";
import { UserSettings } from "../../UserSettings";
import { prefersReducedMotion } from "../../utilities/ReducedMotion";

import { GoToPlayerEvent, GoToUnitEvent } from "../../TransformHandler";
import { GameView, PlayerView, UnitView } from "../../view";
import { onlyImages } from "./OnlyImages";

import { renderNumber, renderTroops } from "@openfront/engine-lib/Format";
import { PlaySoundEffectEvent } from "../../sound/Sounds";
import { UIState } from "../../UIState";
import {
  getMessageTypeClasses,
  renderDuration,
  severityColors,
  translateText,
} from "../../Utils";
import { requestTicksLeft, ticksToSeconds } from "../GameTicks";
import { keepPressKeysFromGame, pressWithoutFocus } from "../HudKeys";
import { timeLeftLine } from "../TimeLeftLine";
import { TINT } from "../Tint";
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
   * Set on the row of my own alliance request once the game has the
   * request: the tick it was made. The row then lives as long as it does.
   */
  requestedAt?: number;
  /**
   * The line read out when the event arrived. Kept apart from the
   * description, so a missile line's new count is not read out again when
   * a bomb lands. A new MIRV joining its line is: the line pulses again.
   */
  spoken?: string;
  /** The tick it was last read out: a new reading is a new line to say. */
  spokenAt?: number;
  /** Set when a MIRV joins the line, until the line is read out again. */
  joined?: boolean;
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
  "events_display.mirv_inbound_alarm":
    "events_display.mirv_inbound_alarm_count",
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

const byAge = (a: GameEvent, b: GameEvent) => a.createdAt - b.createdAt;

// The routine block shows the newest four; older ones wait in the feed.
const shownRoutine = (events: GameEvent[]): GameEvent[] =>
  events
    .filter((event) => !isImportant(event))
    .sort(byAge)
    .slice(-4);

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
// A row that goes fades, then closes its height, so the rows after it glide
// into its place. One grid track, as an fr track can be animated and a
// height of auto cannot.
const LEAVING = "grid animate-event-out";
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
// The seconds left on my pending alliance request, in a column of their own
// at the row's end, on the first line. The minimum width keeps the sentence
// from shifting when the count drops a digit.
const ROW_SECONDS =
  "col-start-3 row-start-1 min-w-[3ch] text-end font-semibold tabular-nums";

// The MIRV warning, the most dangerous event in the game: in place of the
// tint, a dark red fill with a red outline and inner glow over the
// strongest red wash, and two warning signs at each end. On arrival the glow
// swells three times and the signs beat with it, then both rest. The fill
// does not fade with the HUD opacity: like the tint, it is content, and dark
// enough that white text on it reads over the brightest land. The glow is
// inset, as the block clips anything drawn outside its rows.
const ALARM_FILL =
  "pointer-events-none absolute inset-0 bg-hud-alarm bg-linear-to-l from-red-600/55 via-red-700/28 via-60% to-red-700/18 shadow-hud-alarm animate-event-alarm motion-reduce:animate-none";
// The rows' size, not a step above it: the signs already take room on the
// line, and a larger sentence would wrap a name the other rows fit.
const ALARM_TEXT = "text-[15px]/5 lg:text-base/6 font-bold text-white";
// In the signs' yellow, like the other bombs' icons: red vanishes on the fill.
const ALARM_ICON = "text-yellow-300";
const ALARM_SIGNS = "items-center gap-1 text-yellow-300";
// One sign at each end on phones, upright or on their side, where two
// would wrap most names.
const ALARM_SIGN =
  "hud-sheet:not-first:hidden animate-event-alarm-sign motion-reduce:animate-none";

const isAlarm = (event: GameEvent): boolean =>
  event.type === MessageType.MIRV_INBOUND;

type Tier = keyof typeof TIERS;

@customElement("events-display")
export class EventsDisplay extends LitElement implements Controller {
  public eventBus: EventBus;
  public game: GameView;
  public uiState: UIState;

  private active: boolean = false;
  private events: GameEvent[] = [];
  // Rows gone from the feed, drawn until they have folded away.
  private leaving: GameEvent[] = [];
  // The rows drawn by the last render: only those can fold away.
  private drawn = new Set<GameEvent>();
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
    // Before the reply, so a reply on the same tick finds the request.
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
    // The element outlives the game: a row still folding would come back
    // in the next one.
    this.leaving = [];
    this.drawn.clear();
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
      // A button from the start, so the row keeps its element when the
      // game's request arrives and the row becomes the pending request.
      focusID: e.recipient.smallID(),
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
        // Not drawn any more, so their animations will not end.
        this.leaving = [];
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

    // Important events are read out once, as they arrive, and a MIRV line
    // again when a new one joins it; routine ones would drown them. Not in a
    // replay, nor while the game catches up on missed turns: events come many
    // ticks at a time there, faster than speech.
    const speak =
      this._isVisible &&
      !this.game.config().isReplay() &&
      !this.game.isCatchingUp();
    for (const event of this.events) {
      if (
        speak &&
        (event.id >= firstNewID || event.joined) &&
        isImportant(event)
      ) {
        event.spoken = event.description;
        event.spokenAt = this.game.ticks();
      }
      event.joined = false;
    }

    let remainingEvents = this.events.filter((event) => {
      const age = this.game.ticks() - event.createdAt;
      // A negative age is an event from later in the game: the replay
      // viewer seeked back past it.
      const expired = age >= 80 || age < 0;
      if (event.missileGroup) {
        return this.keepMissileGroup(event, expired);
      }
      if (event.requestedAt !== undefined) {
        return age >= 0 && this.isRequestOpen(event);
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

    // The newest 30 rows stay, and my pending alliance requests past them:
    // nothing would bring those back before their answer.
    const capped = remainingEvents.filter(
      (event) => event.requestedAt === undefined,
    );
    if (capped.length > 30) {
      const cut = new Set(capped.slice(0, -30));
      remainingEvents = remainingEvents.filter((event) => !cut.has(event));
    }

    if (this.events.length !== remainingEvents.length) {
      this.foldAway(
        this.events.filter((event) => !remainingEvents.includes(event)),
      );
      this.events = remainingEvents;
      this.requestUpdate();
    }

    // A row still folding is from later in the game when the replay viewer
    // seeked back before it: at this point it never was.
    const now = this.game.ticks();
    this.leaving = this.leaving.filter((event) => event.createdAt <= now);

    this.requestUpdate();
  }

  // Rows on screen that go are folded away instead of cut. Only rows the
  // last render drew: one that came and went between two renders was never
  // seen. Not a routine row pushed out of the newest four, even on the tick
  // it expires: it goes at once, as any row pushed out does. Nor a row from
  // later in the game, after the replay viewer seeked back: at this point it
  // never was. Nor while the page is hidden: animations do not run there, so
  // the rows would pile up and all fold at once when the player comes back.
  private foldAway(gone: GameEvent[]) {
    if (!this._isVisible || document.hidden || prefersReducedMotion()) return;
    const routine = shownRoutine(this.events);
    const now = this.game.ticks();
    this.leaving = [
      ...this.leaving,
      ...gone.filter(
        (event) =>
          event.createdAt <= now &&
          this.drawn.has(event) &&
          (isImportant(event) || routine.includes(event)),
      ),
    ];
  }

  // A leaving row's animation is the rest of its life: it goes when that
  // ends, so no timer has to match it.
  private endLeaving(e: AnimationEvent, event: GameEvent) {
    // The row's content may still be easing in; its end bubbles up here.
    if (e.target !== e.currentTarget) return;
    this.leaving = this.leaving.filter((other) => other !== event);
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

  // The row of my alliance request stays until the answer replaces it, or
  // until the game lets the request lapse. The game keeps a request whose
  // recipient died, but nobody will answer it. A replay can miss the answer,
  // when it seeks past it or follows another player, so the row also goes
  // once the game no longer has the request.
  private isRequestOpen(event: GameEvent): boolean {
    const recipient = this.game.playerBySmallID(event.focusID!) as PlayerView;
    return (
      this.requestTicksLeft(event.requestedAt!) >= 0 &&
      recipient.isAlive() &&
      this.game.myPlayer()?.isRequestingAllianceWith(recipient) === true
    );
  }

  // Ticks until the game lets the request lapse: its own bound, read from
  // its config, counted as the recipient's card counts it.
  private requestTicksLeft(requestedAt: number): number {
    return requestTicksLeft(
      requestedAt,
      this.game.ticks(),
      this.game.config().allianceRequestDuration(),
    );
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
        existing.joined = isAlarm(existing);
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

  // The game made my alliance request: the row that confirmed my click now
  // stands for it, so the same row counts down and nothing new appears.
  onAllianceRequestEvent(update: AllianceRequestUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || update.requestorID !== myPlayer.smallID()) {
      return;
    }

    const sent = this.events.find(
      (event) =>
        event.type === MessageType.ALLIANCE_REQUEST &&
        event.focusID === update.recipientID &&
        event.requestedAt === undefined,
    );
    if (sent) {
      sent.requestedAt = update.createdAt;
      this.requestUpdate();
      return;
    }

    // No click came first: the replay viewer has none.
    const recipient = this.game.playerBySmallID(
      update.recipientID,
    ) as PlayerView;
    this.addEvent({
      ...sentence(
        "events_display.alliance_request_sent",
        { name: recipient.displayName() },
        ["name"],
      ),
      type: MessageType.ALLIANCE_REQUEST,
      createdAt: this.game.ticks(),
      focusID: update.recipientID,
      requestedAt: update.createdAt,
    });
  }

  onAllianceRequestReplyEvent(update: AllianceRequestReplyUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || update.request.requestorID !== myPlayer.smallID()) {
      return;
    }

    // The answer takes the pending request's place.
    this.events = this.events.filter(
      (event) =>
        event.requestedAt === undefined ||
        event.focusID !== update.request.recipientID,
    );
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
    const leaving = this.leaving.includes(event);
    const quiet = tier === "important" && QUIET_TIER_1_TYPES.has(event.type);
    const toneClass = getMessageTypeClasses(event.type);
    const tone = Object.keys(severityColors).find(
      (key) => severityColors[key] === toneClass,
    );
    const alarm = isAlarm(event);
    const tinted = tier === "important" && tone !== "info" && !alarm;
    // Keyed on the line's start, which each new MIRV restarts and a landing
    // one leaves alone, so the glow and the signs replay for a new MIRV.
    const alarmSigns = (place: string) =>
      keyed(
        event.createdAt,
        html`<span class="${place} ${ALARM_SIGNS} ${look.icon}">
          <of-icon
            name="warning"
            size=${look.iconSize}
            class=${ALARM_SIGN}
          ></of-icon>
          <of-icon
            name="warning"
            size=${look.iconSize}
            class=${ALARM_SIGN}
          ></of-icon>
        </span>`,
      );
    const content = html`
      <span class="${ICON_BOX} ${look.icon} ${alarm ? ALARM_ICON : toneClass}">
        <of-icon
          name=${event.icon ?? EVENT_ICONS[event.type]}
          size=${look.iconSize}
        ></of-icon>
      </span>
      <span
        class="${TEXT} ${alarm ? ALARM_TEXT : quiet ? QUIET_TEXT : look.text}"
      >
        ${
          alarm
            ? html`${alarmSigns("float-end ms-2 flex")}${alarmSigns(
                "me-1 inline-flex align-top",
              )}`
            : ""
        }
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
      ${
        event.requestedAt !== undefined
          ? html`<span
              data-row-seconds
              aria-hidden="true"
              class="${ROW_SECONDS} ${look.text}"
              >${renderDuration(
                Math.ceil(
                  ticksToSeconds(this.requestTicksLeft(event.requestedAt)),
                ),
              )}</span
            >`
          : ""
      }
    `;
    const { focusID, unitView } = event;
    const goTo = focusID
      ? () => this.emitGoToPlayerEvent(focusID)
      : unitView
        ? () => this.emitGoToUnitEvent(unitView)
        : undefined;
    // A leaving row is inert, so a click or a key meant for it cannot go
    // to its player, or to the row that glides into its place.
    return html`
      <li
        data-event-row
        data-tier=${tier}
        data-tone=${tone}
        ?data-quiet=${quiet}
        ?data-request-pending=${event.requestedAt !== undefined}
        ?data-alarm=${alarm}
        ?data-leaving=${leaving}
        ?inert=${leaving}
        class="${ROW} ${leaving ? LEAVING : ""}"
        @animationend=${(e: AnimationEvent) => this.endLeaving(e, event)}
        @animationcancel=${(e: AnimationEvent) => this.endLeaving(e, event)}
      >
        ${tinted ? html`<span data-tint class="${TINT} ${toneClass}"></span>` : ""}
        ${
          alarm
            ? keyed(
                event.createdAt,
                html`<span data-alarm-fill class=${ALARM_FILL}></span>`,
              )
            : ""
        }
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
      this.drawn.clear();
      return html``;
    }

    const myPlayer = this.game.myPlayer();
    const showBetrayalTimer = !!(
      myPlayer &&
      myPlayer.isTraitor() &&
      myPlayer.getTraitorRemainingTicks() > 0
    );

    // Leaving rows keep their place until they have folded away.
    const tier1Events = [...this.events, ...this.leaving]
      .filter(isImportant)
      .sort(byAge);
    const tier2Events = [
      ...shownRoutine(this.events),
      ...this.leaving.filter((event) => !isImportant(event)),
    ].sort(byAge);
    this.drawn = new Set([...tier1Events, ...tier2Events]);

    // The log is there whenever the feed is, even empty: a screen reader may
    // not read out a region that appears together with its first line. It
    // is out of the flow, so an empty feed still shows nothing. The MIRV
    // warning cannot wait behind the log's queue: it has a region of its own
    // that interrupts.
    const spoken = this.events.filter((event) => event.spoken !== undefined);
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
            spoken.filter((event) => !isAlarm(event)),
            (event) => event.id,
            (event) => html`<p>${event.spoken}</p>`,
          )}
        </div>
        <div aria-live="assertive" class="sr-only">
          ${repeat(
            spoken.filter(isAlarm),
            (event) => `${event.id}-${event.spokenAt}`,
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
