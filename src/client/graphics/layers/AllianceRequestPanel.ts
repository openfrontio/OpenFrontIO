import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { MessageType, Tick } from "../../../core/game/Game";
import {
  AllianceRequestReplyUpdate,
  AllianceRequestUpdate,
  GameUpdateType,
} from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import {
  SendAllianceExtensionIntentEvent,
  SendAllianceReplyIntentEvent,
} from "../../Transport";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";
import { GoToPlayerEvent } from "./Leaderboard";

interface AllianceIndicator {
  id: string;
  type: "request" | "renewal";
  playerSmallID: number;
  playerName: string;
  playerColor: string;
  createdAt: Tick;
  duration: Tick;
  // For requests
  requestorView?: PlayerView;
  recipientView?: PlayerView;
  // For renewals
  allianceID?: number;
  otherPlayerView?: PlayerView;
  otherPlayerWantsRenewal?: boolean;
}

@customElement("alliance-request-panel")
export class AllianceRequestPanel extends LitElement implements Layer {
  public eventBus: EventBus;
  public game: GameView;

  private active: boolean = false;
  @state() private indicators: AllianceIndicator[] = [];
  @state() private hoveredIndicator: string | null = null;
  @state() private popupHovered: boolean = false;

  // Queue of pending indicator additions while popup is open
  private pendingIndicators: AllianceIndicator[] = [];
  // Set of indicator IDs to remove when popup closes
  private pendingRemovals: Set<string> = new Set();

  // allianceID -> last checked at tick (for renewal notifications)
  private alliancesCheckedAt = new Map<number, Tick>();

  private updateMap = [
    [GameUpdateType.AllianceRequest, this.onAllianceRequestEvent.bind(this)],
    [
      GameUpdateType.AllianceRequestReply,
      this.onAllianceRequestReplyEvent.bind(this),
    ],
  ] as const;

  constructor() {
    super();
    this.indicators = [];
  }

  init() {}

  tick() {
    this.active = true;

    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      return;
    }

    // If popup is open, don't modify the indicators list at all
    // Queue changes to apply when popup closes
    if (this.popupHovered) {
      // Still check for new events but queue them
      this.checkForAllianceExpirations();
      const updates = this.game.updatesSinceLastTick();
      if (updates) {
        for (const [ut, fn] of this.updateMap) {
          updates[ut]?.forEach(fn as (event: unknown) => void);
        }
      }
      // Mark expired indicators for removal later
      for (const indicator of this.indicators) {
        const isExpired =
          this.game.ticks() - indicator.createdAt >= indicator.duration ||
          this.shouldDeleteIndicator(indicator);
        if (isExpired) {
          this.pendingRemovals.add(indicator.id);
          // If the hovered indicator expired, force close popup and apply changes
          if (indicator.id === this.hoveredIndicator) {
            this.popupHovered = false;
            this.hoveredIndicator = null;
            this.flushPendingChanges();
            return;
          }
        }
      }
      // Still update for countdown animation even when popup is hovered
      this.requestUpdate();
      return;
    }

    this.checkForAllianceExpirations();

    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      for (const [ut, fn] of this.updateMap) {
        updates[ut]?.forEach(fn as (event: unknown) => void);
      }
    }

    // Remove expired indicators
    const remainingIndicators = this.indicators.filter((indicator) => {
      const shouldKeep =
        this.game.ticks() - indicator.createdAt < indicator.duration &&
        !this.shouldDeleteIndicator(indicator);
      return shouldKeep;
    });

    if (this.indicators.length !== remainingIndicators.length) {
      this.indicators = remainingIndicators;
    }
    // Always request update for countdown overlay animation
    this.requestUpdate();
  }

  private shouldDeleteIndicator(indicator: AllianceIndicator): boolean {
    if (indicator.type === "request") {
      // Check if requestor and recipient are now allied
      if (indicator.requestorView && indicator.recipientView) {
        return indicator.requestorView.isAlliedWith(indicator.recipientView);
      }
    } else if (indicator.type === "renewal") {
      // Check if the alliance still exists and is still in expiration window
      const myPlayer = this.game.myPlayer();
      if (!myPlayer) return true;
      
      const alliance = myPlayer
        .alliances()
        .find((a) => a.id === indicator.allianceID);
      
      // Alliance no longer exists (expired or broken)
      if (!alliance) return true;
      
      // Alliance was renewed (expiresAt is now far in the future)
      if (
        alliance.expiresAt >
        this.game.ticks() + this.game.config().allianceExtensionPromptOffset()
      ) {
        return true;
      }
    }
    return false;
  }

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
        // We've already displayed a message for this alliance.
        continue;
      }

      this.alliancesCheckedAt.set(alliance.id, this.game.ticks());

      const other = this.game.player(alliance.other) as PlayerView;
      if (!other.isAlive()) continue;

      const color = other.territoryColor().toHex();

      this.addIndicator({
        id: `renewal-${alliance.id}`,
        type: "renewal",
        playerSmallID: other.smallID(),
        playerName: other.name(),
        playerColor: color,
        createdAt: this.game.ticks(),
        duration: this.game.config().allianceExtensionPromptOffset() - 3 * 10, // 3 second buffer
        allianceID: alliance.id,
        otherPlayerView: other,
        otherPlayerWantsRenewal: alliance.hasExtensionRequest,
      });
    }
  }

  private addIndicator(indicator: AllianceIndicator) {
    // Check if indicator with same id already exists - always allow updating otherPlayerWantsRenewal
    const existingIndex = this.indicators.findIndex(
      (i) => i.id === indicator.id,
    );
    if (existingIndex !== -1) {
      // Update otherPlayerWantsRenewal if it changed (even during popup hover)
      const existing = this.indicators[existingIndex];
      if (
        indicator.type === "renewal" &&
        existing.otherPlayerWantsRenewal !== indicator.otherPlayerWantsRenewal
      ) {
        this.indicators = this.indicators.map((i, idx) =>
          idx === existingIndex
            ? { ...i, otherPlayerWantsRenewal: indicator.otherPlayerWantsRenewal }
            : i,
        );
        this.requestUpdate();
      }
      return; // Already exists
    }

    // If popup is open, queue new indicators for later
    if (this.popupHovered) {
      // Check if already in pending queue
      if (!this.pendingIndicators.some((i) => i.id === indicator.id)) {
        this.pendingIndicators.push(indicator);
      }
      return;
    }

    // Add to the front of the array so new indicators appear on the left
    this.indicators = [indicator, ...this.indicators];
    this.requestUpdate();
  }

  private removeIndicator(id: string, force: boolean = false) {
    // Don't remove if popup is being hovered (unless forced)
    if (!force && this.popupHovered && this.hoveredIndicator === id) {
      return;
    }
    this.indicators = this.indicators.filter((i) => i.id !== id);
    this.requestUpdate();
  }

  private flushPendingChanges() {
    // Apply any pending removals
    if (this.pendingRemovals.size > 0) {
      this.indicators = this.indicators.filter(
        (i) => !this.pendingRemovals.has(i.id),
      );
      this.pendingRemovals.clear();
    }

    // Apply any pending additions
    if (this.pendingIndicators.length > 0) {
      for (const indicator of this.pendingIndicators) {
        // Double-check it doesn't already exist
        if (!this.indicators.some((i) => i.id === indicator.id)) {
          this.indicators = [indicator, ...this.indicators];
        }
      }
      this.pendingIndicators = [];
    }

    this.requestUpdate();
  }

  private closePopup() {
    this.popupHovered = false;
    // Don't clear hoveredIndicator - the wrapper mouseenter/mouseleave handles that
    // This allows smooth transition from one popup to another circle
    // Apply all pending changes now that popup is closed
    this.flushPendingChanges();
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

    const color = requestor.territoryColor().toHex();

    this.addIndicator({
      id: `request-${update.requestorID}-${update.createdAt}`,
      type: "request",
      playerSmallID: update.requestorID,
      playerName: requestor.name(),
      playerColor: color,
      createdAt: this.game.ticks(),
      duration: this.game.config().allianceRequestDuration() - 20, // 2 second buffer
      requestorView: requestor,
      recipientView: recipient,
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
      this.indicators = this.indicators.filter(
        (indicator) =>
          !(
            indicator.type === "request" &&
            indicator.playerSmallID === update.request.requestorID
          ),
      );
      this.requestUpdate();
    }
  }

  private handleAccept(indicator: AllianceIndicator) {
    if (indicator.type === "request") {
      this.eventBus.emit(
        new SendAllianceReplyIntentEvent(
          indicator.requestorView!,
          indicator.recipientView!,
          true,
        ),
      );
    } else if (indicator.type === "renewal") {
      this.eventBus.emit(
        new SendAllianceExtensionIntentEvent(indicator.otherPlayerView!),
      );
    }
    // Close popup and flush pending changes
    this.popupHovered = false;
    this.hoveredIndicator = null;
    // Remove the clicked indicator plus any pending removals
    this.pendingRemovals.add(indicator.id);
    this.flushPendingChanges();
  }

  private handleReject(indicator: AllianceIndicator) {
    if (indicator.type === "request") {
      this.eventBus.emit(
        new SendAllianceReplyIntentEvent(
          indicator.requestorView!,
          indicator.recipientView!,
          false,
        ),
      );
    }
    // For renewals, "ignore" just removes the indicator
    // Close popup and flush pending changes
    this.popupHovered = false;
    this.hoveredIndicator = null;
    // Remove the clicked indicator plus any pending removals
    this.pendingRemovals.add(indicator.id);
    this.flushPendingChanges();
  }

  private handleFocus(indicator: AllianceIndicator) {
    const player = this.game.playerBySmallID(indicator.playerSmallID);
    if (player) {
      this.eventBus.emit(new GoToPlayerEvent(player as PlayerView));
    }
  }

  shouldTransform(): boolean {
    return false;
  }

  renderLayer(): void {}

  render() {
    // Don't show during spawn phase or if no indicators
    if (!this.active || this.indicators.length === 0 || this.game.inSpawnPhase()) {
      return html``;
    }

    return html`
      <style>
        .alliance-indicator-wrapper {
          position: relative;
          padding: 16px 8px 8px 8px; /* Generous padding for hover area */
          cursor: pointer;
        }
        .alliance-indicator-wrapper:hover .alliance-indicator {
          transform: scale(1.1);
        }
        .alliance-indicator {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          cursor: pointer;
          position: relative;
          transition: transform 0.15s ease;
          border: 3px solid #000;
          overflow: hidden;
        }
        .alliance-indicator-bg {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          border-radius: 50%;
        }
        .countdown-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          background: rgba(255, 255, 255, 0.6);
          pointer-events: none;
          transition: height 0.1s linear;
        }
        .alliance-popup {
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-bottom: 4px;
          background: rgba(31, 41, 55, 0.95);
          backdrop-filter: blur(4px);
          border-radius: 8px;
          padding: 10px 12px;
          white-space: nowrap;
          z-index: 200;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          pointer-events: auto;
        }
        .alliance-popup::after {
          content: "";
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          border: 8px solid transparent;
          border-top-color: rgba(31, 41, 55, 0.95);
          margin-top: -1px;
        }
        /* Invisible bridge between popup and circle */
        .alliance-popup::before {
          content: "";
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          width: 80px;
          height: 12px;
          background: transparent;
        }
        .popup-player-name {
          font-weight: 600;
          margin-bottom: 8px;
          text-align: center;
          color: white;
          font-size: 14px;
        }
        .popup-type-label {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.7);
          margin-bottom: 8px;
          text-align: center;
        }
        .popup-buttons {
          display: flex;
          gap: 8px;
          justify-content: center;
        }
        .popup-btn {
          padding: 6px 14px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .popup-btn-accept {
          background: #22c55e;
          color: white;
        }
        .popup-btn-accept:hover {
          background: #16a34a;
        }
        .popup-btn-reject {
          background: #ef4444;
          color: white;
        }
        .popup-btn-reject:hover {
          background: #dc2626;
        }
        .popup-btn-focus {
          background: #6b7280;
          color: white;
        }
        .popup-btn-focus:hover {
          background: #4b5563;
        }
        .request-icon {
          position: absolute;
          top: 5px;
          right: -3px;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: #3b82f6;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: bold;
          color: white;
          border: 2px solid rgba(0, 0, 0, 0.8);
          z-index: 10;
          pointer-events: none;
        }
        .renewal-icon {
          position: absolute;
          top: 5px;
          right: -3px;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: #f59e0b;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: bold;
          color: white;
          border: 2px solid rgba(0, 0, 0, 0.8);
          z-index: 10;
          pointer-events: none;
        }
        .renewal-icon.other-wants {
          background: #22c55e;
          animation: pulse-green 1s infinite;
        }
        @keyframes pulse-green {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
          50% { box-shadow: 0 0 0 4px rgba(34, 197, 94, 0); }
        }
        .other-wants-label {
          color: #22c55e;
          font-size: 11px;
          font-weight: 600;
          margin-bottom: 4px;
          text-align: center;
        }
        .countdown-seconds {
          color: #fbbf24;
          font-size: 12px;
          font-weight: 600;
          margin-bottom: 6px;
          text-align: center;
        }
      </style>
      <div
        class="flex flex-row gap-3 items-end pointer-events-auto"
        style="padding-right: 20px; padding-bottom: 24px;"
      >
        ${this.indicators.map((indicator) => {
          const elapsed = this.game.ticks() - indicator.createdAt;
          const remaining = indicator.duration - elapsed;
          const remainingSeconds = Math.max(0, Math.ceil(remaining / 10));
          const percentExpired = Math.min(100, (elapsed / indicator.duration) * 100);
          
          return html`
            <div
              class="alliance-indicator-wrapper"
              @mouseenter=${() => (this.hoveredIndicator = indicator.id)}
              @mouseleave=${() => {
                if (!this.popupHovered) {
                  this.hoveredIndicator = null;
                }
              }}
            >
              <div
                class="alliance-indicator"
                @click=${() => this.handleFocus(indicator)}
              >
                <div class="alliance-indicator-bg" style="background-color: ${indicator.playerColor};"></div>
                <div class="countdown-overlay" style="height: ${percentExpired}%;"></div>
              </div>
              ${indicator.type === "request"
                ? html`<div class="request-icon">?</div>`
                : html`<div class="renewal-icon ${indicator.otherPlayerWantsRenewal ? 'other-wants' : ''}">⏳</div>`}
              ${this.hoveredIndicator === indicator.id
                ? html`
                    <div
                      class="alliance-popup"
                      @mouseenter=${() => (this.popupHovered = true)}
                      @mouseleave=${() => this.closePopup()}
                    >
                        <div class="popup-player-name">${indicator.playerName}</div>
                        <div class="countdown-seconds">${translateText("events_display.seconds_remaining", { seconds: remainingSeconds })}</div>
                        ${indicator.type === "renewal" && indicator.otherPlayerWantsRenewal
                          ? html`<div class="other-wants-label">${translateText("events_display.wants_to_renew")}</div>`
                          : ''}}
                      <div class="popup-type-label">
                        ${indicator.type === "request"
                          ? translateText("events_display.request_alliance", {
                              name: indicator.playerName,
                            })
                          : translateText("events_display.about_to_expire", {
                              name: indicator.playerName,
                            })}
                      </div>
                      <div class="popup-buttons">
                        <button
                          class="popup-btn popup-btn-focus"
                          @click=${(e: Event) => {
                            e.stopPropagation();
                            this.handleFocus(indicator);
                          }}
                        >
                          ${translateText("events_display.focus")}
                        </button>
                        <button
                          class="popup-btn popup-btn-accept"
                          @click=${(e: Event) => {
                            e.stopPropagation();
                            this.handleAccept(indicator);
                          }}
                        >
                          ${indicator.type === "request"
                            ? translateText("events_display.accept_alliance")
                            : translateText("events_display.renew_alliance", {
                                name: indicator.playerName,
                              })}
                        </button>
                        <button
                          class="popup-btn popup-btn-reject"
                          @click=${(e: Event) => {
                            e.stopPropagation();
                            this.handleReject(indicator);
                          }}
                        >
                          ${indicator.type === "request"
                            ? translateText("events_display.reject_alliance")
                            : translateText("events_display.ignore")}
                        </button>
                    </div>
                  </div>
                `
              : ""}
            </div>
          `;
        })}
      </div>
    `;
  }

  createRenderRoot() {
    return this;
  }
}
