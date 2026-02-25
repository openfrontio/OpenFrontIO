import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { MessageType, Tick } from "../../../core/game/Game";
import {
  AllianceRequestReplyUpdate,
  AllianceRequestUpdate,
  BrokeAllianceUpdate,
  GameUpdateType,
} from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import {
  SendAllianceExtensionIntentEvent,
  SendAllianceRejectIntentEvent,
  SendAllianceRequestIntentEvent,
} from "../../Transport";
import { translateText } from "../../Utils";
import { UIState } from "../UIState";
import { GameEvent } from "./EventsDisplay";
import { renderEventContent } from "./EventRenderUtils";
import { Layer } from "./Layer";
import { GoToPlayerEvent } from "./Leaderboard";

@customElement("alliance-display")
export class AllianceDisplay extends LitElement implements Layer {
  public eventBus: EventBus;
  public game: GameView;
  public uiState: UIState;

  private active: boolean = false;
  private events: GameEvent[] = [];

  // allianceID -> last checked at tick
  private alliancesCheckedAt = new Map<number, Tick>();
  @state() private _isVisible: boolean = false;
  @state() private isHovered: boolean = false;
  private pendingRemovals: Set<GameEvent> = new Set();

  createRenderRoot() {
    return this;
  }

  init() {}

  tick() {
    this.active = true;
    let needsUpdate = false;

    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this._isVisible = true;
      needsUpdate = true;
    }

    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      if (this._isVisible) {
        this._isVisible = false;
        needsUpdate = true;
      }
      if (needsUpdate) this.requestUpdate();
      return;
    }

    const oldEventsLength = this.events.length;
    this.checkForAllianceExpirations();
    this.processAllianceUpdates();
    if (this.events.length !== oldEventsLength) {
      needsUpdate = true;
    }

    // Expire old events
    const remainingEvents = this.events.filter((event) => {
      const isExpired = this.game.ticks() - event.createdAt >= (event.duration ?? 600);
      const shouldDelete = event.shouldDelete?.(this.game);
      
      if (isExpired || shouldDelete) {
        if (this.isHovered) {
          this.pendingRemovals.add(event);
          return true;
        } else {
          if (event.onDelete) event.onDelete();
          this.pendingRemovals.delete(event);
          return false;
        }
      }
      
      if (!this.isHovered && this.pendingRemovals.has(event)) {
        if (event.onDelete) event.onDelete();
        this.pendingRemovals.delete(event);
        return false;
      }
      
      return true;
    });

    if (this.events.length !== remainingEvents.length) {
      this.events = remainingEvents;
      needsUpdate = true;
    }

    if (needsUpdate) {
      this.requestUpdate();
    }
  }

  shouldTransform(): boolean {
    return false;
  }

  renderLayer(): void {}

  // ── Alliance update processing ──────────────────────────────────────

  private processAllianceUpdates() {
    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;

    for (const event of updates[
      GameUpdateType.AllianceRequest
    ] as AllianceRequestUpdate[]) {
      this.onAllianceRequestEvent(event);
    }
    for (const event of updates[
      GameUpdateType.AllianceRequestReply
    ] as AllianceRequestReplyUpdate[]) {
      this.onAllianceRequestReplyEvent(event);
    }
    for (const event of updates[
      GameUpdateType.BrokeAlliance
    ] as BrokeAllianceUpdate[]) {
      this.onBrokeAllianceEvent(event);
    }
  }

  // ── Alliance expiration checks ──────────────────────────────────────

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
        continue;
      }

      this.alliancesCheckedAt.set(alliance.id, this.game.ticks());

      const other = this.game.player(alliance.other) as PlayerView;
      if (!other.isAlive()) continue;

      this.addEvent({
        description: translateText("events_display.about_to_expire", {
          name: other.name(),
        }),
        type: MessageType.RENEW_ALLIANCE,
        duration: this.game.config().allianceExtensionPromptOffset() - 3 * 10,
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
  }

  // ── Event handlers ──────────────────────────────────────────────────

  private onAllianceRequestEvent(update: AllianceRequestUpdate) {
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
      duration: this.game.config().allianceRequestDuration() - 20,
      shouldDelete: (game) => {
        return requestor.isAlliedWith(recipient);
      },
      focusID: update.requestorID,
    });
  }

  private onAllianceRequestReplyEvent(update: AllianceRequestReplyUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    if (update.request.recipientID === myPlayer.smallID()) {
      const toRemove = this.events.filter(
        (event) =>
          event.type === MessageType.ALLIANCE_REQUEST &&
          event.focusID === update.request.requestorID
      );
      
      if (this.isHovered) {
        toRemove.forEach(e => this.pendingRemovals.add(e));
      } else {
        this.events = this.events.filter(e => !toRemove.includes(e));
        this.requestUpdate();
      }
      return;
    }
  }

  private onBrokeAllianceEvent(update: BrokeAllianceUpdate) {
    this.removeAllianceRenewalEvents(update.allianceID);
    
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const betrayed = this.game.playerBySmallID(update.betrayedID) as PlayerView;
    const traitor = this.game.playerBySmallID(update.traitorID) as PlayerView;

    if (betrayed === myPlayer) {
      this.addEvent({
        description: translateText("events_display.betrayed_you", {
          name: traitor.name(),
        }),
        type: MessageType.ALLIANCE_BROKEN,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.traitorID,
        buttons: [
          {
            text: translateText("events_display.focus"),
            className: "btn-gray",
            action: () => this.eventBus.emit(new GoToPlayerEvent(traitor)),
            preventClose: true,
          },
        ],
      });
    }

    this.requestUpdate();
  }

  // ── Event management helpers ────────────────────────────────────────

  private addEvent(event: GameEvent) {
    this.events = [...this.events, event];
    this.requestUpdate();
  }

  private removeEvent(index: number) {
    this.events = [
      ...this.events.slice(0, index),
      ...this.events.slice(index + 1),
    ];
  }

  removeAllianceRenewalEvents(allianceID: number) {
    const toRemove = this.events.filter(
      (event) =>
        event.type === MessageType.RENEW_ALLIANCE &&
        event.allianceID === allianceID
    );
    
    if (this.isHovered) {
      toRemove.forEach(e => this.pendingRemovals.add(e));
    } else {
      this.events = this.events.filter(e => !toRemove.includes(e));
    }
  }

  // ── Rendering helpers ───────────────────────────────────────────────

  private emitGoToPlayerEvent(playerID: number) {
    const player = this.game.playerBySmallID(playerID) as PlayerView;
    if (!player) return;
    this.eventBus.emit(new GoToPlayerEvent(player));
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
      <div
        class="px-3 py-2 text-yellow-400 text-md md:text-sm border-b border-gray-700/50"
      >
        ${translateText("events_display.betrayal_debuff_ends", {
          time: remainingSeconds,
        })}
      </div>
    `;
  }

  // ── Render ──────────────────────────────────────────────────────────

  render() {
    if (!this.active || !this._isVisible) {
      return html``;
    }

    const pinnedEvents = [...this.events].sort(
      (a, b) => a.createdAt - b.createdAt,
    );

    const hasBetrayal = (() => {
      const myPlayer = this.game.myPlayer();
      return (
        myPlayer &&
        myPlayer.isTraitor() &&
        myPlayer.getTraitorRemainingTicks() > 0
      );
    })();

    const hasAnything = pinnedEvents.length > 0 || hasBetrayal;

    if (!hasAnything) return html``;

    return html`
      <div
        class="w-full pointer-events-auto text-white text-sm lg:text-base"
        @mouseenter=${() => { this.isHovered = true; }}
        @mouseleave=${() => { this.isHovered = false; }}
      >
        <!-- Betrayal debuff timer -->
        ${hasBetrayal ? this.renderBetrayalDebuffTimer() : ""}

        <!-- Pinned actionable alliance events -->
        ${pinnedEvents.length > 0
          ? html`
              <div
                class="bg-gray-800/70 sm:rounded-l-lg min-[1200px]:rounded-lg max-h-[20vh] overflow-y-auto shadow-lg backdrop-blur-xs"
              >
                ${pinnedEvents.map(
                  (event) => html`
                    <div
                      class="px-3 py-2 border-b border-gray-700/50 last:border-b-0"
                    >
                      <div class="text-md md:text-sm">
                        ${renderEventContent(
                          event,
                          (id) => this.emitGoToPlayerEvent(id),
                          () => {}, // no unit focus in alliance display
                          (e) => {
                            const idx = this.events.findIndex((ev) => ev === e);
                            if (idx !== -1) this.removeEvent(idx);
                          },
                          () => this.requestUpdate()
                        )}
                      </div>
                    </div>
                  `,
                )}
              </div>
            `
          : ""}
      </div>
    `;
  }
}
