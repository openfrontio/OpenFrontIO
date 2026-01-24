import { Colord } from "colord";
import { base64url } from "jose";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { Tick } from "../../../core/game/Game";
import {
  AllianceRequestReplyUpdate,
  AllianceRequestUpdate,
  GameUpdateType,
} from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { PatternDecoder } from "../../../core/PatternDecoder";
import { PlayerPattern } from "../../../core/Schemas";
import {
  SendAllianceExtensionIntentEvent,
  SendAllianceReplyIntentEvent,
} from "../../Transport";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";
import { GoToPlayerEvent } from "./Leaderboard";

// Cache for pattern preview images
const patternPreviewCache = new Map<string, string>();

function generatePatternPreviewDataUrl(
  pattern: PlayerPattern,
  size: number,
): string {
  const patternLookupKey = [
    pattern.name,
    pattern.colorPalette?.primaryColor ?? "undefined",
    pattern.colorPalette?.secondaryColor ?? "undefined",
    size,
  ].join("-");

  if (patternPreviewCache.has(patternLookupKey)) {
    return patternPreviewCache.get(patternLookupKey)!;
  }

  try {
    const decoder = new PatternDecoder(pattern, base64url.decode);
    const scaledWidth = decoder.scaledWidth();
    const scaledHeight = decoder.scaledHeight();

    const width = Math.max(1, Math.floor(size / scaledWidth)) * scaledWidth;
    const height = Math.max(1, Math.floor(size / scaledHeight)) * scaledHeight;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;
    const primary = pattern.colorPalette?.primaryColor
      ? new Colord(pattern.colorPalette.primaryColor).toRgb()
      : { r: 255, g: 255, b: 255 };
    const secondary = pattern.colorPalette?.secondaryColor
      ? new Colord(pattern.colorPalette.secondaryColor).toRgb()
      : { r: 0, g: 0, b: 0 };

    let i = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const rgba = decoder.isPrimary(x, y) ? primary : secondary;
        data[i++] = rgba.r;
        data[i++] = rgba.g;
        data[i++] = rgba.b;
        data[i++] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    const dataUrl = canvas.toDataURL("image/png");
    patternPreviewCache.set(patternLookupKey, dataUrl);
    return dataUrl;
  } catch (e) {
    console.error("Error generating pattern preview", e);
    return "";
  }
}

interface AllianceIndicator {
  id: string;
  type: "request" | "renewal";
  playerSmallID: number;
  playerName: string;
  playerColor: string;
  playerPattern?: PlayerPattern;
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

const MAX_VISIBLE_INDICATORS = 5; // TEST: normally 20

@customElement("alliance-request-panel")
export class AllianceRequestPanel extends LitElement implements Layer {
  public eventBus: EventBus;
  public game: GameView;

  private active: boolean = false;
  @state() private indicators: AllianceIndicator[] = [];
  @state() private hoveredIndicator: string | null = null;
  @state() private popupHovered: boolean = false;
  @state() private sidebarWidth: number = 0;

  // Queue of pending indicator additions while popup is open
  private pendingIndicators: AllianceIndicator[] = [];
  // Set of indicator IDs to remove when popup closes
  private pendingRemovals: Set<string> = new Set();

  // allianceID -> last checked at tick (for renewal notifications)
  private alliancesCheckedAt = new Map<number, Tick>();

  // ResizeObserver to track sidebar height changes
  private sidebarObserver: ResizeObserver | null = null;

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

  init() {
    // Observe the game-left-sidebar for size changes
    this.setupSidebarObserver();
  }

  private setupSidebarObserver() {
    // Look for the aside element inside the sidebar (the actual visible element)
    const sidebar = document.querySelector("game-left-sidebar aside");
    if (sidebar) {
      this.sidebarObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          this.sidebarWidth = entry.contentRect.width;
        }
      });
      this.sidebarObserver.observe(sidebar);
      // Get initial width
      this.sidebarWidth = sidebar.getBoundingClientRect().width;
    } else {
      // Sidebar not found yet, use default position
      this.sidebarWidth = 0;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.sidebarObserver) {
      this.sidebarObserver.disconnect();
      this.sidebarObserver = null;
    }
  }

  tick() {
    this.active = true;

    // Try to set up sidebar observer if not already done
    if (!this.sidebarObserver) {
      this.setupSidebarObserver();
    }

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

      // Always update otherPlayerWantsRenewal for existing indicators
      const existingIndicator = this.indicators.find(
        (i) => i.type === "renewal" && i.allianceID === alliance.id,
      );
      if (
        existingIndicator &&
        existingIndicator.otherPlayerWantsRenewal !==
          alliance.otherWantsToExtend
      ) {
        this.indicators = this.indicators.map((i) =>
          i === existingIndicator
            ? { ...i, otherPlayerWantsRenewal: alliance.otherWantsToExtend }
            : i,
        );
        this.requestUpdate();
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
        playerPattern: other.cosmetics.pattern,
        createdAt: this.game.ticks(),
        duration: this.game.config().allianceExtensionPromptOffset() - 3 * 10, // 3 second buffer
        allianceID: alliance.id,
        otherPlayerView: other,
        otherPlayerWantsRenewal: alliance.otherWantsToExtend,
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
            ? {
                ...i,
                otherPlayerWantsRenewal: indicator.otherPlayerWantsRenewal,
              }
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

    // If we're at max capacity, queue the indicator instead of showing it
    if (this.indicators.length >= MAX_VISIBLE_INDICATORS) {
      if (!this.pendingIndicators.some((i) => i.id === indicator.id)) {
        this.pendingIndicators.push(indicator);
      }
      return;
    }

    // Add to the end of the array so new indicators appear on the right (row grows rightward)
    this.indicators = [...this.indicators, indicator];
    this.requestUpdate();
  }

  private removeIndicator(id: string, force: boolean = false) {
    // Don't remove if popup is being hovered (unless forced)
    if (!force && this.popupHovered && this.hoveredIndicator === id) {
      return;
    }
    this.indicators = this.indicators.filter((i) => i.id !== id);

    // If we have pending indicators and now have room, add one
    if (
      this.indicators.length < MAX_VISIBLE_INDICATORS &&
      this.pendingIndicators.length > 0
    ) {
      const nextIndicator = this.pendingIndicators.shift()!;
      if (!this.indicators.some((i) => i.id === nextIndicator.id)) {
        this.indicators = [...this.indicators, nextIndicator];
      }
    }

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

    // Apply any pending additions (up to the max limit)
    while (
      this.pendingIndicators.length > 0 &&
      this.indicators.length < MAX_VISIBLE_INDICATORS
    ) {
      const indicator = this.pendingIndicators.shift()!;
      // Double-check it doesn't already exist
      if (!this.indicators.some((i) => i.id === indicator.id)) {
        this.indicators = [...this.indicators, indicator];
      }
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
      playerPattern: requestor.cosmetics.pattern,
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
    if (player.isPlayer()) {
      this.eventBus.emit(new GoToPlayerEvent(player));
    }
  }

  // Helper to create SVG arc path for radial buttons
  private describeArc(
    x: number,
    y: number,
    innerRadius: number,
    outerRadius: number,
    startAngle: number,
    endAngle: number,
  ): string {
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = x + innerRadius * Math.cos(startRad);
    const y1 = y + innerRadius * Math.sin(startRad);
    const x2 = x + outerRadius * Math.cos(startRad);
    const y2 = y + outerRadius * Math.sin(startRad);
    const x3 = x + outerRadius * Math.cos(endRad);
    const y3 = y + outerRadius * Math.sin(endRad);
    const x4 = x + innerRadius * Math.cos(endRad);
    const y4 = y + innerRadius * Math.sin(endRad);

    const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;

    return [
      `M ${x1} ${y1}`,
      `L ${x2} ${y2}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x3} ${y3}`,
      `L ${x4} ${y4}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x1} ${y1}`,
      "Z",
    ].join(" ");
  }

  shouldTransform(): boolean {
    return false;
  }

  renderLayer(): void {}

  render() {
    // Don't show during spawn phase or if no indicators
    if (
      !this.active ||
      !this.game ||
      this.indicators.length === 0 ||
      this.game.inSpawnPhase()
    ) {
      return html``;
    }

    // Position to the right of the sidebar (16px base + sidebar width + 20px gap)
    const leftPosition = 16 + this.sidebarWidth + 20;

    return html`
      <style>
        .alliance-indicator-wrapper {
          position: relative;
          padding: 12px 4px 8px 4px; /* Reduced horizontal padding for closer circles */
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
          border: 2px solid #444;
          overflow: hidden;
        }
        .alliance-indicator-bg {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          border-radius: 50%;
          z-index: 1;
        }
        .alliance-indicator-pattern {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          object-fit: cover;
          image-rendering: pixelated;
          z-index: 2;
        }
        .countdown-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          background: rgba(255, 255, 255, 0.6);
          pointer-events: none;
          transition: height 0.1s linear;
          z-index: 3;
        }

        /* Radial popup container - positioned above the indicator circle */
        .radial-popup {
          position: absolute;
          bottom: 50%;
          left: 50%;
          transform: translateX(-50%);
          z-index: 200;
          pointer-events: auto;
        }

        /* SVG radial menu */
        .radial-svg {
          overflow: visible;
          filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3));
        }

        .radial-arc {
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .radial-arc:hover {
          filter: brightness(1.2);
        }

        .radial-arc-accept {
          fill: url(#acceptGradient);
          stroke: rgba(68, 68, 68, 0.8);
          stroke-width: 1.5;
        }

        .radial-arc-reject {
          fill: url(#rejectGradient);
          stroke: rgba(68, 68, 68, 0.8);
          stroke-width: 1.5;
        }

        .radial-arc-icon {
          fill: white;
          font-size: 18px;
          font-weight: bold;
          pointer-events: none;
          text-anchor: middle;
          dominant-baseline: central;
        }

        /* Info tooltip below the indicator circle */
        .radial-info {
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-top: 4px;
          background: rgba(31, 41, 55, 0.95);
          backdrop-filter: blur(4px);
          border-radius: 6px;
          padding: 4px 8px;
          text-align: center;
          white-space: nowrap;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          z-index: 201;
        }

        .radial-info::before {
          content: "";
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          border: 5px solid transparent;
          border-bottom-color: rgba(31, 41, 55, 0.95);
          margin-bottom: -1px;
        }

        .radial-player-name {
          font-weight: 600;
          color: white;
          font-size: 13px;
        }

        .radial-countdown {
          color: #fbbf24;
          font-size: 12px;
          font-weight: 600;
        }

        .radial-other-wants {
          color: #22c55e;
          font-size: 10px;
          font-weight: 600;
        }

        .request-icon {
          position: absolute;
          bottom: -3px;
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
          border: 1.5px solid #555;
          z-index: 10;
          pointer-events: none;
        }
        .renewal-icon {
          position: absolute;
          bottom: -3px;
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
          border: 1.5px solid #555;
          z-index: 10;
          pointer-events: none;
        }
        .renewal-icon.other-wants {
          background: #22c55e;
          animation: pulse-green 1s infinite;
        }
        @keyframes pulse-green {
          0%,
          100% {
            box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7);
          }
          50% {
            box-shadow: 0 0 0 4px rgba(34, 197, 94, 0);
          }
        }
        .overflow-indicator {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4px 8px;
          background: rgba(0, 0, 0, 0.7);
          border-radius: 12px;
          color: white;
          font-size: 12px;
          font-weight: bold;
          gap: 4px;
          white-space: nowrap;
        }
        .overflow-caret {
          animation: slide-left-right 0.8s ease-in-out infinite;
        }
        @keyframes slide-left-right {
          0%,
          100% {
            transform: translateX(-2px);
          }
          50% {
            transform: translateX(2px);
          }
        }
        .alliance-panel-container {
          position: fixed;
          top: 24px;
          z-index: 1000;
          transition: left 0.3s ease;
        }
      </style>
      <div
        class="alliance-panel-container flex flex-row flex-wrap gap-1 items-start pointer-events-auto"
        style="left: ${leftPosition}px;"
      >
        ${this.indicators.map((indicator) => {
          const elapsed = this.game.ticks() - indicator.createdAt;
          const remaining = indicator.duration - elapsed;
          const remainingSeconds = Math.max(0, Math.ceil(remaining / 10));
          const percentExpired = Math.min(
            100,
            (elapsed / indicator.duration) * 100,
          );

          // Generate pattern preview if player has a pattern
          const patternUrl = indicator.playerPattern
            ? generatePatternPreviewDataUrl(indicator.playerPattern, 48)
            : null;

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
                <div
                  class="alliance-indicator-bg"
                  style="background-color: ${indicator.playerColor};"
                ></div>
                ${patternUrl
                  ? html`<img
                      class="alliance-indicator-pattern"
                      src="${patternUrl}"
                      alt="Player pattern"
                    />`
                  : ""}
                <div
                  class="countdown-overlay"
                  style="height: ${percentExpired}%;"
                ></div>
              </div>
              ${indicator.type === "request"
                ? html`<div class="request-icon">?</div>`
                : html`<div
                    class="renewal-icon ${indicator.otherPlayerWantsRenewal
                      ? "other-wants"
                      : ""}"
                  >
                    ⏳
                  </div>`}
              ${this.hoveredIndicator === indicator.id
                ? html`
                    <div
                      class="radial-popup"
                      @mouseenter=${() => (this.popupHovered = true)}
                      @mouseleave=${() => this.closePopup()}
                    >
                      <!-- SVG with radial arc buttons above the indicator -->
                      <svg
                        class="radial-svg"
                        width="140"
                        height="60"
                        viewBox="-70 -60 140 60"
                        style="display: block;"
                      >
                        <defs>
                          <linearGradient
                            id="acceptGradient"
                            x1="0%"
                            y1="0%"
                            x2="100%"
                            y2="100%"
                          >
                            <stop offset="0%" style="stop-color:#22c55e" />
                            <stop offset="100%" style="stop-color:#16a34a" />
                          </linearGradient>
                          <linearGradient
                            id="rejectGradient"
                            x1="0%"
                            y1="0%"
                            x2="100%"
                            y2="100%"
                          >
                            <stop offset="0%" style="stop-color:#ef4444" />
                            <stop offset="100%" style="stop-color:#dc2626" />
                          </linearGradient>
                        </defs>

                        <!-- Accept arc (left side) - spans from -150deg to -90deg (60 degrees, meeting at top) -->
                        <path
                          class="radial-arc radial-arc-accept"
                          d="${this.describeArc(0, 0, 24, 55, -150, -90)}"
                          @click=${(e: Event) => {
                            e.stopPropagation();
                            this.handleAccept(indicator);
                          }}
                        />
                        <text
                          class="radial-arc-icon"
                          x="${39.5 * Math.cos((-120 * Math.PI) / 180)}"
                          y="${39.5 * Math.sin((-120 * Math.PI) / 180)}"
                          style="pointer-events: none;"
                        >
                          ✓
                        </text>

                        <!-- Reject arc (right side) - spans from -90deg to -30deg (60 degrees, meeting at top) -->
                        <path
                          class="radial-arc radial-arc-reject"
                          d="${this.describeArc(0, 0, 24, 55, -90, -30)}"
                          @click=${(e: Event) => {
                            e.stopPropagation();
                            this.handleReject(indicator);
                          }}
                        />
                        <text
                          class="radial-arc-icon"
                          x="${39.5 * Math.cos((-60 * Math.PI) / 180)}"
                          y="${39.5 * Math.sin((-60 * Math.PI) / 180)}"
                          style="pointer-events: none;"
                        >
                          ✕
                        </text>
                      </svg>
                    </div>
                    <!-- Info tooltip below the indicator circle -->
                    <div class="radial-info">
                      <div class="radial-player-name">
                        ${indicator.playerName}
                      </div>
                      <div class="radial-countdown">${remainingSeconds}s</div>
                      ${indicator.type === "renewal" &&
                      indicator.otherPlayerWantsRenewal
                        ? html`<div class="radial-other-wants">
                            ${translateText("events_display.wants_to_renew")}
                          </div>`
                        : ""}
                    </div>
                  `
                : ""}
            </div>
          `;
        })}
        ${this.pendingIndicators.length > 0
          ? html`
              <div class="overflow-indicator">
                <span>+${this.pendingIndicators.length}</span>
                <span class="overflow-caret">&gt;</span>
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
