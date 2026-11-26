import { MessageType, Tick } from "@openfront/engine-api/game/GameTypes";
import {
  AllianceExtensionUpdate,
  AllianceRequestReplyUpdate,
  AllianceRequestUpdate,
  BrokeAllianceUpdate,
  GameUpdateType,
} from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { repeat } from "lit/directives/repeat.js";
import "../../components/OfIcon";
import type { OfIconName } from "../../components/OfIcon";
import { Controller } from "../../Controller";
import { PlaySoundEffectEvent } from "../../sound/Sounds";
import { GoToPlayerEvent } from "../../TransformHandler";
import {
  SendAllianceExtensionIntentEvent,
  SendAllianceRejectIntentEvent,
  SendAllianceRequestIntentEvent,
} from "../../Transport";
import { UIState } from "../../UIState";
import { renderDuration, translateText } from "../../Utils";
import { GameView, PlayerView } from "../../view";
import { requestTicksLeft, ticksToSeconds } from "../GameTicks";
import { keepPressKeysFromGame, pressWithoutFocus } from "../HudKeys";
import { timeLeftLine } from "../TimeLeftLine";
import { TINT } from "../Tint";

type CardAction = "focus" | "accept" | "reject" | "renew" | "ignore";

// Look. Sizes, colours, radii and spacing of each part live here, so a
// change of look is one edit. The templates below only hold structure.

// The same flat block as the events feed above. The sentence starts in the
// feed's 20px icon column, on the same edge as the event text.
const LIST = "flex flex-col w-full min-[1200px]:w-96 pointer-events-auto";
// A new card opens its height, so the feed above glides instead of jumping.
// The card's space above it is a margin inside the opening part, so it
// opens with the card.
const SPACE = "grid grid-rows-[1fr]";
const OPENING = "animate-card-open motion-reduce:animate-none";
// Positioned and clipped for the time-left line on its bottom edge.
const CARD =
  "hud-panel relative overflow-hidden rounded-lg sm:max-lg:landscape:rounded-l-none mt-1 p-2 text-white animate-card-rise motion-reduce:animate-none";
// Positioned, so the content draws over a renewal's tint.
const HEAD = "relative grid grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-x-2";
const ICON_SIZE = 16;
// One text line tall, so a wrapped sentence keeps the icon on its first line.
const MARK =
  "flex h-5 lg:h-6 items-center justify-center transition-colors duration-200";
const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aquarius";
const TITLE = `min-w-0 self-baseline cursor-pointer rounded-sm text-start text-sm/5 lg:text-base/6 font-semibold wrap-anywhere transition-colors duration-200 pointer-fine:hover:text-aquarius ${FOCUS_RING}`;
// On the title's first baseline. The minimum width keeps the title from
// shifting when the count drops a digit.
const SECONDS =
  "min-w-[3ch] self-baseline text-end text-[13px]/5 lg:text-sm/5 font-semibold tabular-nums text-white/70 transition-opacity duration-150 motion-reduce:transition-none";
// Buttons wrap to a second line when a translation is too long for one.
// Labels keep today's 12px until the card takes its 384px width at 1200px
// (from 1024px it is only 262px wide), and the sides stay narrow, so the
// three buttons still share a line where they did before the icons.
// Once answered, the other buttons close up (inert) and the gap with them,
// so the chosen one takes the row.
const ACTIONS =
  "relative mt-2 flex flex-wrap transition-[gap] duration-260 ease-in-out motion-reduce:transition-none";
const BUTTON = `inline-flex h-8 lg:h-9 max-w-full items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-md px-2.5 text-xs min-[1200px]:text-sm font-semibold cursor-pointer disabled:cursor-default transition-[color,background-color,flex-grow,max-width,padding,opacity] duration-260 ease-in-out motion-reduce:transition-none inert:max-w-0 inert:grow-0 inert:px-0 inert:opacity-0 ${FOCUS_RING}`;
const QUIET = "bg-white/6 pointer-fine:hover:bg-white/10 active:bg-white/15";
// Hover darkens: the lighter shades hold white text under 4.5:1.
const YES = "flex-1 bg-green-700 pointer-fine:hover:bg-green-800";
const NO = "flex-1 bg-red-600 pointer-fine:hover:bg-red-700";
// The chosen button's icon pops once.
const POP = "animate-card-answer-pop motion-reduce:animate-none";
// An alliance about to end is the more urgent card: it carries the tint of
// the feed's warning rows, and an hourglass where a request has a handshake.
// Renew settles it, so the tint fades and the card shows the green of the
// answer alone, as an accepted request does. Ignore leaves it: the alliance
// still ends.
const RENEWAL_TINT =
  "text-yellow-400 transition-opacity duration-200 motion-reduce:transition-none in-data-[answered=renew]:opacity-0";
// The card's edge, over the panel's own hairline: a child, since the panel
// keeps its own shadow. It takes the answer's colour.
const EDGE =
  "pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset transition-shadow duration-200";

// How an answer shows while the card holds it, and how long it holds: a yes
// longer than a no. The card keeps its place for that time, so the second
// click of a double click lands on it and not on the card that would drop
// into its place; then it folds away, and the fold's end removes it. The
// time-left line refills in the answer's colour.
interface Answer {
  fold: string;
  edge: string;
  mark: string;
  title?: string;
  line?: string;
}
const ACCEPTED: Answer = {
  fold: "animate-card-accepted motion-reduce:animate-card-accepted-still",
  edge: "ring-green-400/55",
  mark: "text-green-400",
  line: "bg-green-400 transition-[width,background-color] duration-300 ease-out",
};
const REJECTED: Answer = {
  fold: "animate-card-declined motion-reduce:animate-card-declined-still",
  edge: "ring-red-400/50",
  mark: "text-red-400",
  title: "text-white/60",
  line: "bg-red-400 transition-[width,background-color] duration-300 ease-out",
};
// Ignore is no answer to the ally: no colour, the line runs on.
const IGNORED: Answer = {
  fold: "animate-card-declined motion-reduce:animate-card-declined-still",
  edge: "ring-transparent",
  mark: "text-yellow-400",
};

const CARD_BUTTON: Record<
  CardAction,
  { look: string; icon?: OfIconName; answer?: Answer }
> = {
  focus: { look: `flex-none ${QUIET}`, icon: "focus" },
  accept: { look: YES, icon: "check", answer: ACCEPTED },
  reject: { look: NO, icon: "close", answer: REJECTED },
  renew: { look: YES, answer: ACCEPTED },
  ignore: { look: `flex-1 ${QUIET}`, answer: IGNORED },
};

interface ActionableEvent {
  id: number;
  description: string;
  type: MessageType;
  createdAt: number;
  focusID: number;
  buttons: {
    kind: CardAction;
    text: string;
    action: () => void;
    preventClose?: boolean;
  }[];
  priority?: number;
  allianceID?: number;
  duration?: Tick;
  requestorID: number;
  /** The line read out when the card arrived, with the time it gave. */
  spoken?: string;
  /** The button that answered the card, while the card shows the answer. */
  answered?: CardAction;
}

// An answered card stays until its fold ends: the reply, the expiry and a
// withdrawn request do not cut it short.
const isOpen = (event: ActionableEvent) => event.answered === undefined;

@customElement("actionable-events")
export class ActionableEvents extends LitElement implements Controller {
  public eventBus: EventBus;
  public game: GameView;
  public uiState: UIState;

  private active = false;
  private events: ActionableEvent[] = [];
  private nextEventId = 0;
  // allianceID -> last checked at tick
  private alliancesCheckedAt = new Map<number, Tick>();
  @state() private _isVisible = false;

  private updateMap = [
    [GameUpdateType.AllianceRequest, this.onAllianceRequestEvent.bind(this)],
    [
      GameUpdateType.AllianceRequestReply,
      this.onAllianceRequestReplyEvent.bind(this),
    ],
    [GameUpdateType.BrokeAlliance, this.onBrokeAllianceEvent.bind(this)],
    [
      GameUpdateType.AllianceExtension,
      this.onAllianceExtensionEvent.bind(this),
    ],
  ] as const;

  createRenderRoot() {
    return this;
  }

  private addEvent(event: Omit<ActionableEvent, "id">) {
    this.events = [...this.events, { ...event, id: this.nextEventId++ }];
    this.requestUpdate();
  }

  private removeEvent(index: number) {
    this.events = [
      ...this.events.slice(0, index),
      ...this.events.slice(index + 1),
    ];
  }

  private removeAllianceRenewalEvents(allianceID: number) {
    this.events = this.events.filter(
      (event) =>
        !isOpen(event) ||
        !(
          event.type === MessageType.RENEW_ALLIANCE &&
          event.allianceID === allianceID
        ),
    );
  }

  tick() {
    this.active = true;

    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this._isVisible = true;
      this.requestUpdate();
    }

    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      // The cards are not drawn, so an answered card's fold would never end.
      this.events = this.events.filter(isOpen);
      if (this._isVisible) {
        this._isVisible = false;
        this.requestUpdate();
      }
      return;
    }

    const firstNewID = this.nextEventId;
    this.checkForAllianceExpirations();

    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      for (const [ut, fn] of this.updateMap) {
        updates[ut]?.forEach(fn as (event: unknown) => void);
      }
    }

    // A card asks for an answer within seconds, so it is read out at once,
    // with the time it gives. Not in a replay, nor while the game catches up
    // on missed turns: cards come and go many ticks at a time there.
    if (
      this._isVisible &&
      !this.game.config().isReplay() &&
      !this.game.isCatchingUp()
    ) {
      for (const event of this.events) {
        if (event.id < firstNewID) continue;
        const time = this.timeLeft(event);
        event.spoken = time
          ? `${event.description} ${translateText(
              "events_display.time_to_answer",
              { seconds: Math.ceil(ticksToSeconds(time.left)) },
            )}`
          : event.description;
      }
    }

    const remainingEvents = this.events.filter(
      (event) =>
        !isOpen(event) ||
        ((event.duration === undefined ||
          requestTicksLeft(event.createdAt, this.game.ticks(), event.duration) >
            0) &&
          (event.type !== MessageType.ALLIANCE_REQUEST ||
            // We remove Alliance Requests if the requestor is dead.
            ((
              this.game.playerBySmallID(event.requestorID) as PlayerView
            ).isAlive() &&
              // We remove Alliance Requests if the requestor is no longer requesting an alliance with us.
              (
                this.game.playerBySmallID(event.requestorID) as PlayerView
              ).isRequestingAllianceWith(this.game.myPlayer() as PlayerView)))),
    );

    if (this.events.length !== remainingEvents.length) {
      this.events = remainingEvents;
      this.requestUpdate();
    } else if (this.events.length > 0) {
      // The time left on open cards moves with every tick.
      this.requestUpdate();
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
        // Already prompted for this alliance in the current window.
        continue;
      }

      this.alliancesCheckedAt.set(alliance.id, this.game.ticks());

      const other = this.game.player(alliance.other) as PlayerView;

      this.addEvent({
        description: translateText("events_display.about_to_expire", {
          name: other.displayName(),
        }),
        type: MessageType.RENEW_ALLIANCE,
        buttons: [
          {
            kind: "focus",
            text: translateText("events_display.focus"),
            action: () => this.eventBus.emit(new GoToPlayerEvent(other)),
            preventClose: true,
          },
          {
            kind: "renew",
            text: translateText("events_display.renew_alliance", {
              name: other.displayName(),
            }),
            action: () =>
              this.eventBus.emit(new SendAllianceExtensionIntentEvent(other)),
          },
          {
            kind: "ignore",
            text: translateText("events_display.ignore"),
            action: () => {},
          },
        ],
        createdAt: this.game.ticks(),
        focusID: other.smallID(),
        allianceID: alliance.id,
        requestorID: other.smallID(),
      });
    }

    for (const [allianceId] of this.alliancesCheckedAt) {
      if (!currentAllianceIds.has(allianceId)) {
        this.removeAllianceRenewalEvents(allianceId);
        this.alliancesCheckedAt.delete(allianceId);
        this.requestUpdate();
      }
    }
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

    if (!requestor.isAlliedWith(recipient)) {
      this.eventBus.emit(new PlaySoundEffectEvent("alliance-suggested"));
    }
    this.addEvent({
      description: translateText("events_display.request_alliance", {
        name: requestor.displayName(),
      }),
      buttons: [
        {
          kind: "focus",
          text: translateText("events_display.focus"),
          action: () => this.eventBus.emit(new GoToPlayerEvent(requestor)),
          preventClose: true,
        },
        {
          kind: "accept",
          text: translateText("events_display.accept_alliance"),
          action: () => {
            this.eventBus.emit(new PlaySoundEffectEvent("alliance-accepted"));
            this.eventBus.emit(
              new SendAllianceRequestIntentEvent(recipient, requestor),
            );
          },
        },
        {
          kind: "reject",
          text: translateText("events_display.reject_alliance"),
          action: () => {
            this.eventBus.emit(new PlaySoundEffectEvent("alliance-declined"));
            this.eventBus.emit(new SendAllianceRejectIntentEvent(requestor));
          },
        },
      ],
      type: MessageType.ALLIANCE_REQUEST,
      // The engine lets the request lapse from the tick it made it, which
      // an update that arrives late is already past.
      createdAt: update.createdAt,
      priority: 0,
      duration: this.game.config().allianceRequestDuration(),
      focusID: update.requestorID,
      requestorID: update.requestorID,
    });
  }

  private onAllianceRequestReplyEvent(update: AllianceRequestReplyUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || update.request.recipientID !== myPlayer.smallID()) {
      return;
    }
    // The incoming alliance request was resolved (accepted or rejected), so
    // remove any pending request card from that player.
    const requestorID = update.request.requestorID;
    const remaining = this.events.filter(
      (event) =>
        !isOpen(event) ||
        !(
          event.type === MessageType.ALLIANCE_REQUEST &&
          event.focusID === requestorID
        ),
    );
    if (remaining.length !== this.events.length) {
      this.events = remaining;
      this.requestUpdate();
    }
  }

  onBrokeAllianceEvent(update: BrokeAllianceUpdate) {
    // Cleanup-only: any open renewal prompt for this alliance is now moot.
    this.removeAllianceRenewalEvents(update.allianceID);
    this.alliancesCheckedAt.delete(update.allianceID);
    this.requestUpdate();
  }

  private onAllianceExtensionEvent(update: AllianceExtensionUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || myPlayer.smallID() !== update.playerID) return;
    this.removeAllianceRenewalEvents(update.allianceID);
    this.requestUpdate();
  }

  // Ticks until the card's question lapses, and the whole span it had.
  private timeLeft(event: ActionableEvent): { left: Tick; total: Tick } | null {
    if (event.duration !== undefined) {
      return {
        left: requestTicksLeft(
          event.createdAt,
          this.game.ticks(),
          event.duration,
        ),
        total: event.duration,
      };
    }
    // A renewal prompt lapses with the alliance itself.
    const alliance = this.game
      .myPlayer()
      ?.alliances()
      .find((a) => a.id === event.allianceID);
    if (!alliance) return null;
    return {
      left: alliance.expiresAt - this.game.ticks(),
      total: this.game.config().allianceExtensionPromptOffset(),
    };
  }

  // The fold is an answered card's last moment, so the card goes when it
  // ends: no timer has to match it, and a paused game cannot hold it.
  private endAnswered(e: AnimationEvent, event: ActionableEvent) {
    // The card's own rise ends too and bubbles up here, and the opening
    // that an answer cuts short is cancelled here.
    if (e.target !== e.currentTarget || e.animationName !== "card-fold") return;
    const index = this.events.indexOf(event);
    if (index !== -1) this.removeEvent(index);
    this.requestUpdate();
  }

  private emitGoToPlayerEvent(focusID: number) {
    const target = this.game.playerBySmallID(focusID) as PlayerView;
    if (!target) return;
    this.eventBus.emit(new GoToPlayerEvent(target));
  }

  render() {
    if (!this.active || !this._isVisible) {
      return html``;
    }

    const sorted = [...this.events].sort((a, b) => {
      const aPrior = a.priority ?? 100000;
      const bPrior = b.priority ?? 100000;
      if (aPrior === bPrior) {
        return b.createdAt - a.createdAt;
      }
      return bPrior - aPrior;
    });

    // The region stays while the cards are shown, even with none open: a
    // screen reader may not read out a region that appears with its first line.
    return html`
      <div aria-live="assertive" class="sr-only">
        ${repeat(
          this.events.filter((event) => event.spoken !== undefined),
          (event) => event.id,
          (event) => html`<p>${event.spoken}</p>`,
        )}
      </div>
      <div
        class=${LIST}
        ?hidden=${sorted.length === 0}
        @keydown=${keepPressKeysFromGame}
        @keyup=${keepPressKeysFromGame}
      >
        ${repeat(
          sorted,
          (event) => event.id,
          (event) => {
            const time = this.timeLeft(event);
            const answered = event.answered;
            const answer = answered && CARD_BUTTON[answered].answer;
            const renewal = event.type === MessageType.RENEW_ALLIANCE;
            return html`
              <div
                class="${SPACE} ${answer ? answer.fold : OPENING}"
                @animationend=${(e: AnimationEvent) =>
                  this.endAnswered(e, event)}
                @animationcancel=${(e: AnimationEvent) =>
                  this.endAnswered(e, event)}
              >
                <div class="min-h-0">
                  <div
                    data-event-card
                    data-answered=${ifDefined(answered)}
                    data-card-kind=${renewal ? "renewal" : "request"}
                    role="group"
                    aria-label=${event.description}
                    class=${CARD}
                  >
                    ${
                      renewal
                        ? html`<span
                            data-tint
                            class="${TINT} ${RENEWAL_TINT}"
                          ></span>`
                        : ""
                    }
                    <span
                      aria-hidden="true"
                      class="${EDGE} ${answer ? answer.edge : "ring-transparent"}"
                    ></span>
                    <div class=${HEAD}>
                      <span
                        class="${MARK} ${answer ? answer.mark : "text-yellow-400"}"
                      >
                        <of-icon
                          name=${renewal ? "hourglass" : "alliance"}
                          size=${ICON_SIZE}
                        ></of-icon>
                      </span>
                      <button
                        class="${TITLE} ${answer?.title ?? ""}"
                        @mousedown=${pressWithoutFocus}
                        @click=${() => this.emitGoToPlayerEvent(event.focusID)}
                      >
                        ${event.description}
                      </button>
                      ${
                        time
                          ? html`<span
                              data-card-seconds
                              aria-hidden="true"
                              class="${SECONDS} ${answered ? "opacity-0" : ""}"
                              >${renderDuration(
                                Math.ceil(ticksToSeconds(time.left)),
                              )}</span
                            >`
                          : ""
                      }
                    </div>
                    <div class="${ACTIONS} ${answered ? "gap-0" : "gap-1"}">
                      ${event.buttons.map(
                        (btn) => html`
                          <button
                            data-card-action=${btn.kind}
                            class="${BUTTON} ${CARD_BUTTON[btn.kind].look}"
                            ?inert=${answered !== undefined && btn.kind !== answered}
                            ?disabled=${answered !== undefined}
                            @mousedown=${pressWithoutFocus}
                            @click=${() => {
                              btn.action();
                              if (!btn.preventClose) event.answered = btn.kind;
                              this.requestUpdate();
                            }}
                          >
                            ${
                              CARD_BUTTON[btn.kind].icon
                                ? html`<of-icon
                                    name=${CARD_BUTTON[btn.kind].icon}
                                    size=${ICON_SIZE}
                                    class=${btn.kind === answered ? POP : ""}
                                  ></of-icon>`
                                : ""
                            }
                            ${btn.text}
                          </button>
                        `,
                      )}
                    </div>
                    ${
                      answer?.line
                        ? timeLeftLine(1, answer.line)
                        : time
                          ? timeLeftLine(time.left / time.total)
                          : ""
                    }
                  </div>
                </div>
              </div>
            `;
          },
        )}
      </div>
    `;
  }
}
