import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { DirectiveResult } from "lit/directive.js";
import { unsafeHTML, UnsafeHTMLDirective } from "lit/directives/unsafe-html.js";
import { EventBus } from "../../../core/EventBus";
import { MessageType, Tick } from "../../../core/game/Game";
import {
  AllianceRequestReplyUpdate,
  AllianceRequestUpdate,
  BrokeAllianceUpdate,
  GameUpdateType,
} from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { onlyImages } from "../../../core/Util";
import {
  SendAllianceExtensionIntentEvent,
  SendAllianceRejectIntentEvent,
  SendAllianceRequestIntentEvent,
} from "../../Transport";
import { translateText } from "../../Utils";
import { UIState } from "../UIState";
import { GameEvent } from "./EventsDisplay";
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

  createRenderRoot() {
    return this;
  }

  init() {}

  tick() {
    this.active = true;

    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this._isVisible = true;
    }

    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      if (this._isVisible) {
        this._isVisible = false;
      }
      return;
    }

    this.checkForAllianceExpirations();
    this.processAllianceUpdates();

    // Expire old events
    const remainingEvents = this.events.filter((event) => {
      const shouldKeep =
        this.game.ticks() - event.createdAt < (event.duration ?? 600) &&
        !event.shouldDelete?.(this.game);
      if (!shouldKeep && event.onDelete) {
        event.onDelete();
      }
      return shouldKeep;
    });

    if (this.events.length !== remainingEvents.length) {
      this.events = remainingEvents;
    }

    this.requestUpdate();
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
  }

  private onBrokeAllianceEvent(update: BrokeAllianceUpdate) {
    this.removeAllianceRenewalEvents(update.allianceID);
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
    this.events = this.events.filter(
      (event) =>
        !(
          event.type === MessageType.RENEW_ALLIANCE &&
          event.allianceID === allianceID
        ),
    );
  }

  // ── Rendering helpers ───────────────────────────────────────────────

  private emitGoToPlayerEvent(playerID: number) {
    const player = this.game.playerBySmallID(playerID) as PlayerView;
    if (!player) return;
    this.eventBus.emit(new GoToPlayerEvent(player));
  }

  private getEventDescription(
    event: GameEvent,
  ): string | DirectiveResult<typeof UnsafeHTMLDirective> {
    return event.unsafeDescription
      ? unsafeHTML(onlyImages(event.description))
      : event.description;
  }

  private renderButton(options: {
    content: any;
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

    if (hidden) return html``;

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
      : this.getEventDescription(event);

    return html`${description} ${this.renderEventButtons(event)}`;
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
        class="px-2 py-1.5 text-yellow-400 text-md md:text-sm border-b border-gray-700/50"
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
        class="w-full mb-1 pointer-events-auto text-white text-sm lg:text-base"
      >
        <!-- Betrayal debuff timer -->
        ${hasBetrayal ? this.renderBetrayalDebuffTimer() : ""}

        <!-- Pinned actionable alliance events -->
        ${pinnedEvents.length > 0
          ? html`
              <div
                class="bg-gray-900/80 border-b border-gray-700/30 max-h-[20vh] overflow-y-auto"
              >
                ${pinnedEvents.map(
                  (event) => html`
                    <div
                      class="px-2 py-1.5 border-b border-gray-700/50 last:border-b-0"
                    >
                      <div class="text-md md:text-sm">
                        ${this.renderEventContent(event)}
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
