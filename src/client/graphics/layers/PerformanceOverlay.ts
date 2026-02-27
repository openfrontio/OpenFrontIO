import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { UserSettings } from "../../../core/game/UserSettings";
import {
  TickMetricsEvent,
  TogglePerformanceOverlayEvent,
} from "../../InputHandler";
import { translateText } from "../../Utils";
import { FrameProfiler } from "../FrameProfiler";
import { Layer } from "./Layer";

@customElement("performance-overlay")
export class PerformanceOverlay extends LitElement implements Layer {
  @property({ type: Object })
  public eventBus!: EventBus;

  @property({ type: Object })
  public userSettings!: UserSettings;

  private subscribedEventBus: EventBus | null = null;
  private isUserSettingsListenerAttached: boolean = false;

  @state()
  private currentFPS: number = 0;

  @state()
  private averageFPS: number = 0;

  @state()
  private frameTime: number = 0;

  @state()
  private tickExecutionAvg: number = 0;

  @state()
  private tickExecutionMax: number = 0;

  @state()
  private tickDelayAvg: number = 0;

  @state()
  private tickDelayMax: number = 0;

  @state()
  private isVisible: boolean = false;

  @state()
  private currentTPS: number = 0;

  @state()
  private averageTPS: number = 0;

  @state()
  private isDragging: boolean = false;

  @state()
  private position: { x: number; y: number } = { x: 8, y: 8 }; // px values

  @state()
  private copyStatus: "idle" | "success" | "error" = "idle";

  @state()
  private renderLayersExpanded: boolean = false;

  @state()
  private tickLayersExpanded: boolean = false;

  @state()
  private overlayWidthPx: number | null = null;

  private frameCount: number = 0;
  private lastTime: number = 0;
  private frameTimes: number[] = [];
  private fpsHistory: number[] = [];
  private lastSecondTime: number = 0;
  private framesThisSecond: number = 0;
  private tickExecutionTimes: number[] = [];
  private tickDelayTimes: number[] = [];
  private tickTimestamps: number[] = [];
  private tickHead1s: number = 0;
  private tickHead60s: number = 0;

  private copyStatusTimeoutId: ReturnType<typeof setTimeout> | null = null;

  private resizeState: {
    pointerId: number;
    startClientX: number;
    startWidthPx: number;
    pendingWidthPx: number;
  } | null = null;

  private dragState: {
    pointerId: number;
    dragStart: { x: number; y: number };
  } | null = null;

  // Smoothed per-layer render timings (EMA over recent frames)
  private layerStats: Map<
    string,
    { avg: number; max: number; last: number; total: number }
  > = new Map();

  @state()
  private layerBreakdown: {
    name: string;
    avg: number;
    max: number;
    total: number;
  }[] = [];

  // Smoothed per-layer tick timings (EMA over recent ticks)
  private tickLayerStats: Map<
    string,
    { avg: number; max: number; last: number; total: number }
  > = new Map();

  @state()
  private tickLayerBreakdown: {
    name: string;
    avg: number;
    max: number;
    total: number;
  }[] = [];

  @state()
  private tickLayerLastCount: number = 0;

  @state()
  private tickLayerLastTotalMs: number = 0;

  @state()
  private tickLayerLastDurations: Record<string, number> = {};

  @state()
  private renderLastTickFrameCount: number = 0;

  @state()
  private renderLastTickLayerTotalMs: number = 0;

  @state()
  private renderLastTickLayerDurations: Record<string, number> = {};

  @state()
  private layerCounters: Record<string, Record<string, number>> = {};

  // Smoothed per-layer render-per-tick timings (EMA over recent ticks)
  private renderPerTickLayerStats: Map<
    string,
    { avg: number; max: number; last: number; total: number }
  > = new Map();

  static styles = css`
    .performance-overlay {
      position: fixed;
      top: var(--top, 20px);
      left: var(--left, 50%);
      transform: var(--transform, translateX(-50%));
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 32px 16px 8px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      z-index: 9999;
      user-select: none;
      cursor: default;
      transition: none;
      box-sizing: border-box;
      width: var(--overlay-width, min(460px, calc(100vw - 16px)));
      max-width: calc(100vw - 16px);
      max-height: calc(100vh - 16px);
      overflow: hidden;
    }

    .overlay-scroll {
      overflow: auto;
      max-height: calc(100vh - 56px);
    }

    .performance-overlay.dragging {
      cursor: grabbing;
      transition: none;
      opacity: 0.5;
    }

    .drag-handle {
      position: absolute;
      top: 0;
      left: 0;
      right: 12px; /* leave space for the resize handle */
      height: 32px;
      cursor: grab;
      touch-action: none;
      pointer-events: auto;
    }

    .performance-overlay.dragging .drag-handle {
      cursor: grabbing;
    }

    .performance-line {
      margin: 2px 0;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .collapse-button {
      width: 22px;
      height: 18px;
      padding: 0;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.4);
      color: white;
      font-family: monospace;
      font-size: 12px;
      line-height: 1;
      cursor: pointer;
      user-select: none;
      pointer-events: auto;
    }

    .resize-handle {
      position: absolute;
      top: 0;
      right: 0;
      height: 100%;
      width: 12px;
      cursor: ew-resize;
      touch-action: none;
      pointer-events: auto;
    }

    .resize-handle::after {
      content: "";
      position: absolute;
      top: 6px;
      bottom: 6px;
      right: 4px;
      width: 2px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.25);
    }

    .performance-good {
      color: #4ade80; /* green-400 */
    }

    .performance-warning {
      color: #fbbf24; /* amber-400 */
    }

    .performance-bad {
      color: #f87171; /* red-400 */
    }

    .close-button {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 20px;
      height: 20px;
      background-color: rgba(0, 0, 0, 0.8);
      border-radius: 4px;
      color: white;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      user-select: none;
      pointer-events: auto;
    }

    .reset-button {
      position: absolute;
      top: 8px;
      left: 8px;
      height: 20px;
      padding: 0 6px;
      background-color: rgba(0, 0, 0, 0.8);
      border-radius: 4px;
      color: white;
      font-size: 10px;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      user-select: none;
      pointer-events: auto;
    }

    .copy-json-button {
      position: absolute;
      top: 8px;
      left: 70px;
      height: 20px;
      padding: 0 6px;
      background-color: rgba(0, 0, 0, 0.8);
      border-radius: 4px;
      color: white;
      font-size: 10px;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      user-select: none;
      pointer-events: auto;
    }

    .layers-section {
      margin-top: 4px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding-top: 4px;
    }

    .layer-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      margin-top: 2px;
      padding: 2px 4px;
      border-radius: 3px;
      background: linear-gradient(
        90deg,
        rgba(56, 189, 248, 0.35) 0%,
        rgba(56, 189, 248, 0.35) var(--pct, 0%),
        rgba(56, 189, 248, 0) var(--pct, 0%),
        rgba(56, 189, 248, 0) 100%
      );
    }

    .layer-row.table-header {
      background: none;
      opacity: 0.75;
      font-size: 11px;
      margin-top: 4px;
    }

    .layer-row.inactive {
      opacity: 0.5;
    }

    .layer-name {
      flex: 0 0 280px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .layer-metrics {
      flex: 0 0 auto;
      white-space: nowrap;
    }
  `;

  constructor() {
    super();
  }

  private onTogglePerformanceOverlay = (
    _event: TogglePerformanceOverlayEvent,
  ) => {
    const nextVisible = !this.isVisible;
    this.setVisible(nextVisible);
    this.userSettings.set("settings.performanceOverlay", nextVisible);
  };

  private onTickMetricsEvent = (event: TickMetricsEvent) => {
    this.updateTickMetrics(event.tickExecutionDuration, event.tickDelay);
  };

  private onUserSettingsChanged = (event: Event) => {
    const customEvent = event as CustomEvent<{
      key?: string;
      value?: unknown;
    }>;
    if (customEvent.detail?.key !== "settings.performanceOverlay") return;

    const nextVisible = customEvent.detail.value === true;
    if (this.isVisible === nextVisible) return;
    this.setVisible(nextVisible);
  };

  init() {
    this.setVisible(this.userSettings.performanceOverlay());

    if (this.subscribedEventBus && this.subscribedEventBus !== this.eventBus) {
      this.subscribedEventBus.off(
        TogglePerformanceOverlayEvent,
        this.onTogglePerformanceOverlay,
      );
      this.subscribedEventBus.off(TickMetricsEvent, this.onTickMetricsEvent);
      this.subscribedEventBus = null;
    }

    if (this.subscribedEventBus !== this.eventBus) {
      this.eventBus.on(
        TogglePerformanceOverlayEvent,
        this.onTogglePerformanceOverlay,
      );
      this.eventBus.on(TickMetricsEvent, this.onTickMetricsEvent);
      this.subscribedEventBus = this.eventBus;
    }

    if (!this.isUserSettingsListenerAttached) {
      globalThis.addEventListener(
        "user-settings-changed",
        this.onUserSettingsChanged,
      );
      this.isUserSettingsListenerAttached = true;
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();

    if (this.isUserSettingsListenerAttached) {
      globalThis.removeEventListener(
        "user-settings-changed",
        this.onUserSettingsChanged,
      );
      this.isUserSettingsListenerAttached = false;
    }

    if (this.subscribedEventBus) {
      this.subscribedEventBus.off(
        TogglePerformanceOverlayEvent,
        this.onTogglePerformanceOverlay,
      );
      this.subscribedEventBus.off(TickMetricsEvent, this.onTickMetricsEvent);
      this.subscribedEventBus = null;
    }

    if (this.copyStatusTimeoutId) {
      clearTimeout(this.copyStatusTimeoutId);
      this.copyStatusTimeoutId = null;
    }

    if (this.resizeState) {
      globalThis.removeEventListener("pointermove", this.onResizePointerMove);
      globalThis.removeEventListener("pointerup", this.onResizePointerUp);
      globalThis.removeEventListener("pointercancel", this.onResizePointerUp);
      this.resizeState = null;
    }

    if (this.dragState) {
      globalThis.removeEventListener("pointermove", this.onDragPointerMove);
      globalThis.removeEventListener("pointerup", this.onDragPointerUp);
      globalThis.removeEventListener("pointercancel", this.onDragPointerUp);
      this.dragState = null;
      this.isDragging = false;
    }
  }

  setVisible(visible: boolean) {
    this.isVisible = visible;
    FrameProfiler.setEnabled(visible);

    if (!visible && this.resizeState) {
      globalThis.removeEventListener("pointermove", this.onResizePointerMove);
      globalThis.removeEventListener("pointerup", this.onResizePointerUp);
      globalThis.removeEventListener("pointercancel", this.onResizePointerUp);
      this.resizeState = null;
    }

    if (!visible && this.dragState) {
      globalThis.removeEventListener("pointermove", this.onDragPointerMove);
      globalThis.removeEventListener("pointerup", this.onDragPointerUp);
      globalThis.removeEventListener("pointercancel", this.onDragPointerUp);
      this.dragState = null;
      this.isDragging = false;
    }

    this.requestUpdate();
  }

  private handleClose() {
    const nextVisible = false;
    this.setVisible(nextVisible);
    this.userSettings.set("settings.performanceOverlay", nextVisible);
  }

  private onDragPointerMove = (e: PointerEvent) => {
    if (!this.dragState || e.pointerId !== this.dragState.pointerId) return;

    const newX = e.clientX - this.dragState.dragStart.x;
    const newY = e.clientY - this.dragState.dragStart.y;

    const margin = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const defaultWidth = Math.min(460, Math.max(0, viewportWidth - margin * 2));
    const overlayWidth = Math.min(
      this.overlayWidthPx ?? defaultWidth,
      viewportWidth - margin * 2,
    );

    this.position = {
      x: Math.max(
        margin,
        Math.min(viewportWidth - overlayWidth - margin, newX),
      ),
      y: Math.max(margin, Math.min(viewportHeight - 100, newY)),
    };

    this.requestUpdate();
  };

  private onDragPointerUp = (e: PointerEvent) => {
    if (!this.dragState || e.pointerId !== this.dragState.pointerId) return;

    globalThis.removeEventListener("pointermove", this.onDragPointerMove);
    globalThis.removeEventListener("pointerup", this.onDragPointerUp);
    globalThis.removeEventListener("pointercancel", this.onDragPointerUp);

    this.dragState = null;
    this.isDragging = false;
    this.requestUpdate();
  };

  private handleDragPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    this.isDragging = true;
    this.dragState = {
      pointerId: e.pointerId,
      dragStart: {
        x: e.clientX - this.position.x,
        y: e.clientY - this.position.y,
      },
    };

    globalThis.addEventListener("pointermove", this.onDragPointerMove);
    globalThis.addEventListener("pointerup", this.onDragPointerUp);
    globalThis.addEventListener("pointercancel", this.onDragPointerUp);
  };

  private onResizePointerMove = (e: PointerEvent) => {
    if (!this.resizeState || e.pointerId !== this.resizeState.pointerId) return;

    const margin = 8;
    const viewportWidth = window.innerWidth;
    const left = Math.max(margin, Math.min(this.position.x, viewportWidth));
    const maxWidthPx = Math.max(120, viewportWidth - left - margin);
    const minWidthPx = Math.min(260, maxWidthPx);

    const delta = e.clientX - this.resizeState.startClientX;
    const nextWidth = this.resizeState.startWidthPx + delta;
    const clamped = Math.max(minWidthPx, Math.min(maxWidthPx, nextWidth));
    this.resizeState.pendingWidthPx = clamped;

    const overlay = this.renderRoot.querySelector<HTMLElement>(
      ".performance-overlay",
    );
    overlay?.style.setProperty("--overlay-width", `${clamped}px`);
  };

  private onResizePointerUp = (e: PointerEvent) => {
    if (!this.resizeState || e.pointerId !== this.resizeState.pointerId) return;

    globalThis.removeEventListener("pointermove", this.onResizePointerMove);
    globalThis.removeEventListener("pointerup", this.onResizePointerUp);
    globalThis.removeEventListener("pointercancel", this.onResizePointerUp);

    this.overlayWidthPx = this.resizeState.pendingWidthPx;
    this.resizeState = null;
    this.requestUpdate();
  };

  private handleResizePointerDown = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const overlay = this.renderRoot.querySelector<HTMLElement>(
      ".performance-overlay",
    );
    const startWidth = overlay?.getBoundingClientRect().width ?? 460;

    this.resizeState = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startWidthPx: startWidth,
      pendingWidthPx: startWidth,
    };

    globalThis.addEventListener("pointermove", this.onResizePointerMove);
    globalThis.addEventListener("pointerup", this.onResizePointerUp);
    globalThis.addEventListener("pointercancel", this.onResizePointerUp);
  };

  private handleReset = () => {
    // reset FPS / frame stats
    this.frameCount = 0;
    this.lastTime = 0;
    this.frameTimes = [];
    this.fpsHistory = [];
    this.lastSecondTime = 0;
    this.framesThisSecond = 0;
    this.currentFPS = 0;
    this.averageFPS = 0;
    this.frameTime = 0;

    // reset tick metrics
    this.tickExecutionTimes = [];
    this.tickDelayTimes = [];
    this.tickExecutionAvg = 0;
    this.tickExecutionMax = 0;
    this.tickDelayAvg = 0;
    this.tickDelayMax = 0;
    this.currentTPS = 0;
    this.averageTPS = 0;
    this.tickTimestamps = [];
    this.tickHead1s = 0;
    this.tickHead60s = 0;

    // reset layer breakdown
    this.layerStats.clear();
    this.layerBreakdown = [];

    // reset tick layer breakdown
    this.tickLayerStats.clear();
    this.tickLayerBreakdown = [];
    this.tickLayerLastCount = 0;
    this.tickLayerLastTotalMs = 0;
    this.tickLayerLastDurations = {};
    this.renderLastTickFrameCount = 0;
    this.renderLastTickLayerTotalMs = 0;
    this.renderLastTickLayerDurations = {};
    this.layerCounters = {};
    this.renderPerTickLayerStats.clear();
    this.renderLayersExpanded = false;
    this.tickLayersExpanded = false;

    this.requestUpdate();
  };

  private toggleRenderLayersExpanded = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    this.renderLayersExpanded = !this.renderLayersExpanded;
  };

  private toggleTickLayersExpanded = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    this.tickLayersExpanded = !this.tickLayersExpanded;
  };

  updateFrameMetrics(
    frameDuration: number,
    layerDurations?: Record<string, number>,
  ) {
    if (!this.isVisible) return;

    const now = performance.now();

    // Initialize timing on first call
    if (this.lastTime === 0) {
      this.lastTime = now;
      this.lastSecondTime = now;
      return;
    }

    const deltaTime = now - this.lastTime;

    // Track frame times for current FPS calculation (last 60 frames)
    this.frameTimes.push(deltaTime);
    if (this.frameTimes.length > 60) {
      this.frameTimes.shift();
    }

    // Calculate current FPS based on average frame time
    if (this.frameTimes.length > 0) {
      const avgFrameTime =
        this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.currentFPS = Math.round(1000 / avgFrameTime);
      this.frameTime = Math.round(avgFrameTime);
    }

    // Track FPS for 60-second average
    this.framesThisSecond++;

    // Update every second
    if (now - this.lastSecondTime >= 1000) {
      this.fpsHistory.push(this.framesThisSecond);
      if (this.fpsHistory.length > 60) {
        this.fpsHistory.shift();
      }

      // Calculate 60-second average
      if (this.fpsHistory.length > 0) {
        this.averageFPS = Math.round(
          this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length,
        );
      }

      this.framesThisSecond = 0;
      this.lastSecondTime = now;
    }

    this.lastTime = now;
    this.frameCount++;

    if (layerDurations) {
      this.updateLayerStats(layerDurations);
    }

    this.requestUpdate();
  }

  private updateLayerStats(layerDurations: Record<string, number>) {
    const alpha = 0.2; // smoothing factor for EMA

    Object.entries(layerDurations).forEach(([name, duration]) => {
      const existing = this.layerStats.get(name);
      if (!existing) {
        this.layerStats.set(name, {
          avg: duration,
          max: duration,
          last: duration,
          total: duration,
        });
      } else {
        const avg = existing.avg + alpha * (duration - existing.avg);
        const max = Math.max(existing.max, duration);
        const total = existing.total + duration;
        this.layerStats.set(name, { avg, max, last: duration, total });
      }
    });

    // Derive contributors sorted by total accumulated time spent
    const breakdown = Array.from(this.layerStats.entries())
      .map(([name, stats]) => ({
        name,
        avg: stats.avg,
        max: stats.max,
        total: stats.total,
      }))
      .sort((a, b) => b.total - a.total);

    this.layerBreakdown = breakdown;
  }

  updateRenderPerTickMetrics(
    frameCount: number,
    layerDurations: Record<string, number>,
  ) {
    if (!this.isVisible) return;

    const alpha = 0.2; // smoothing factor for EMA

    this.renderLastTickFrameCount = frameCount;
    this.renderLastTickLayerDurations = { ...layerDurations };
    this.renderLastTickLayerTotalMs = Object.values(layerDurations).reduce(
      (acc, ms) => acc + ms,
      0,
    );

    for (const [name, duration] of Object.entries(layerDurations)) {
      const existing = this.renderPerTickLayerStats.get(name);
      if (!existing) {
        this.renderPerTickLayerStats.set(name, {
          avg: duration,
          max: duration,
          last: duration,
          total: duration,
        });
        continue;
      }

      const avg = existing.avg + alpha * (duration - existing.avg);
      const max = Math.max(existing.max, duration);
      const total = existing.total + duration;
      this.renderPerTickLayerStats.set(name, {
        avg,
        max,
        last: duration,
        total,
      });
    }
  }

  updateTickLayerMetrics(tickLayerDurations: Record<string, number>) {
    if (!this.isVisible) return;

    const alpha = 0.2; // smoothing factor for EMA

    const entries = Object.entries(tickLayerDurations);
    this.tickLayerLastCount = entries.length;
    this.tickLayerLastDurations = { ...tickLayerDurations };
    this.tickLayerLastTotalMs = entries.reduce((acc, [, duration]) => {
      return acc + duration;
    }, 0);

    entries.forEach(([name, duration]) => {
      const existing = this.tickLayerStats.get(name);
      if (!existing) {
        this.tickLayerStats.set(name, {
          avg: duration,
          max: duration,
          last: duration,
          total: duration,
        });
      } else {
        const avg = existing.avg + alpha * (duration - existing.avg);
        const max = Math.max(existing.max, duration);
        const total = existing.total + duration;
        this.tickLayerStats.set(name, { avg, max, last: duration, total });
      }
    });

    const breakdown = Array.from(this.tickLayerStats.entries())
      .map(([name, stats]) => ({
        name,
        avg: stats.avg,
        max: stats.max,
        total: stats.total,
      }))
      .sort((a, b) => b.total - a.total);

    this.tickLayerBreakdown = breakdown;
  }

  updateLayerCounters(counters: Record<string, Record<string, number>>) {
    if (!this.isVisible) return;
    this.layerCounters = counters;
  }

  updateTickMetrics(tickExecutionDuration?: number, tickDelay?: number) {
    if (!this.isVisible) return;

    const now = performance.now();
    this.tickTimestamps.push(now);

    while (
      this.tickHead1s < this.tickTimestamps.length &&
      now - this.tickTimestamps[this.tickHead1s] > 1000
    ) {
      this.tickHead1s++;
    }
    while (
      this.tickHead60s < this.tickTimestamps.length &&
      now - this.tickTimestamps[this.tickHead60s] > 60000
    ) {
      this.tickHead60s++;
    }

    const ticksLast1s = this.tickTimestamps.length - this.tickHead1s;
    const ticksLast60s = this.tickTimestamps.length - this.tickHead60s;
    this.currentTPS = ticksLast1s;
    const oldest60 =
      ticksLast60s > 0 ? this.tickTimestamps[this.tickHead60s] : now;
    const elapsed60s = Math.min(60, Math.max(1, (now - oldest60) / 1000));
    this.averageTPS = Math.round((ticksLast60s / elapsed60s) * 10) / 10;

    // Compact occasionally to avoid unbounded growth on long sessions.
    if (this.tickHead60s > 4000) {
      this.tickTimestamps = this.tickTimestamps.slice(this.tickHead60s);
      this.tickHead1s = Math.max(0, this.tickHead1s - this.tickHead60s);
      this.tickHead60s = 0;
    }

    // Update tick execution duration stats
    if (tickExecutionDuration !== undefined) {
      this.tickExecutionTimes.push(tickExecutionDuration);
      if (this.tickExecutionTimes.length > 60) {
        this.tickExecutionTimes.shift();
      }

      if (this.tickExecutionTimes.length > 0) {
        const avg =
          this.tickExecutionTimes.reduce((a, b) => a + b, 0) /
          this.tickExecutionTimes.length;
        this.tickExecutionAvg = Math.round(avg * 100) / 100;
        this.tickExecutionMax = Math.round(
          Math.max(...this.tickExecutionTimes),
        );
      }
    }

    // Update tick delay stats
    if (tickDelay !== undefined) {
      this.tickDelayTimes.push(tickDelay);
      if (this.tickDelayTimes.length > 60) {
        this.tickDelayTimes.shift();
      }

      if (this.tickDelayTimes.length > 0) {
        const avg =
          this.tickDelayTimes.reduce((a, b) => a + b, 0) /
          this.tickDelayTimes.length;
        this.tickDelayAvg = Math.round(avg * 100) / 100;
        this.tickDelayMax = Math.round(Math.max(...this.tickDelayTimes));
      }
    }

    this.requestUpdate();
  }

  shouldTransform(): boolean {
    return false;
  }

  private getPerformanceColor(fps: number): string {
    if (fps >= 55) return "performance-good";
    if (fps >= 30) return "performance-warning";
    return "performance-bad";
  }

  private getTPSColor(tps: number): string {
    if (tps >= 18) return "performance-good";
    if (tps >= 10) return "performance-warning";
    return "performance-bad";
  }

  private buildPerformanceSnapshot() {
    return {
      timestamp: new Date().toISOString(),
      fps: {
        current: this.currentFPS,
        average60s: this.averageFPS,
        frameTimeMs: this.frameTime,
        history: [...this.fpsHistory],
      },
      tps: {
        current: this.currentTPS,
        average60s: this.averageTPS,
      },
      ticks: {
        executionAvgMs: this.tickExecutionAvg,
        executionMaxMs: this.tickExecutionMax,
        delayAvgMs: this.tickDelayAvg,
        delayMaxMs: this.tickDelayMax,
        executionSamples: [...this.tickExecutionTimes],
        delaySamples: [...this.tickDelayTimes],
      },
      renderPerTickLast: {
        frames: this.renderLastTickFrameCount,
        layerTotalMs: this.renderLastTickLayerTotalMs,
        layers: { ...this.renderLastTickLayerDurations },
      },
      layers: this.layerBreakdown.map((layer) => ({ ...layer })),
      tickLayers: this.tickLayerBreakdown.map((layer) => ({ ...layer })),
      layerCounters: { ...this.layerCounters },
    };
  }

  private clearCopyStatusTimeout() {
    if (this.copyStatusTimeoutId !== null) {
      clearTimeout(this.copyStatusTimeoutId);
      this.copyStatusTimeoutId = null;
    }
  }

  private scheduleCopyStatusReset() {
    this.clearCopyStatusTimeout();
    this.copyStatusTimeoutId = setTimeout(() => {
      this.copyStatus = "idle";
      this.copyStatusTimeoutId = null;
      this.requestUpdate();
    }, 2000);
  }

  private async handleCopyJson() {
    const snapshot = this.buildPerformanceSnapshot();
    const json = JSON.stringify(snapshot, null, 2);

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(json);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = json;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      this.copyStatus = "success";
    } catch (err) {
      console.warn("Failed to copy performance snapshot", err);
      this.copyStatus = "error";
    }

    this.scheduleCopyStatusReset();
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    const margin = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const defaultWidth = Math.min(460, Math.max(0, viewportWidth - margin * 2));
    const overlayWidth = Math.min(
      this.overlayWidthPx ?? defaultWidth,
      viewportWidth - margin * 2,
    );
    const maxLeft = Math.max(margin, viewportWidth - overlayWidth - margin);
    const clampedX = Math.max(margin, Math.min(this.position.x, maxLeft));
    const clampedY = Math.max(
      margin,
      Math.min(this.position.y, viewportHeight - 100),
    );

    const copyLabel =
      this.copyStatus === "success"
        ? translateText("performance_overlay.copied")
        : this.copyStatus === "error"
          ? translateText("performance_overlay.failed_copy")
          : translateText("performance_overlay.copy_clipboard");

    const renderLayersToShow = this.layerBreakdown.slice(0, 10);
    const tickLayersToShow = this.tickLayerBreakdown.slice(0, 10);
    const unitLayerCounters = this.layerCounters.UnitLayer ?? null;

    const maxLayerAvg =
      renderLayersToShow.length > 0
        ? Math.max(...renderLayersToShow.map((l) => l.avg))
        : 1;

    const maxTickLayerAvg =
      tickLayersToShow.length > 0
        ? Math.max(...tickLayersToShow.map((l) => l.avg))
        : 1;

    const overlayWidthStyle =
      this.overlayWidthPx === null
        ? ""
        : `--overlay-width: ${this.overlayWidthPx}px;`;

    return html`
      <div
        class="performance-overlay ${this.isDragging ? "dragging" : ""}"
        style="--left: ${clampedX}px; --top: ${clampedY}px; --transform: none; ${overlayWidthStyle}"
      >
        <div
          class="drag-handle"
          @pointerdown=${this.handleDragPointerDown}
        ></div>
        <button class="reset-button" @click="${this.handleReset}">
          ${translateText("performance_overlay.reset")}
        </button>
        <button
          class="copy-json-button"
          @click="${this.handleCopyJson}"
          title="${translateText("performance_overlay.copy_json_title")}"
        >
          ${copyLabel}
        </button>
        <button class="close-button" @click="${this.handleClose}">×</button>
        <div
          class="resize-handle"
          @pointerdown=${this.handleResizePointerDown}
        ></div>
        <div class="overlay-scroll">
          <div class="performance-line">
            ${translateText("performance_overlay.fps")}
            <span class="${this.getPerformanceColor(this.currentFPS)}"
              >${this.currentFPS}</span
            >
          </div>
          <div class="performance-line">
            ${translateText("performance_overlay.avg_60s")}
            <span class="${this.getPerformanceColor(this.averageFPS)}"
              >${this.averageFPS}</span
            >
          </div>
          <div class="performance-line">
            ${translateText("performance_overlay.frame")}
            <span class="${this.getPerformanceColor(1000 / this.frameTime)}"
              >${this.frameTime}ms</span
            >
          </div>
          <div class="performance-line">
            ${translateText("performance_overlay.tps")}
            <span class="${this.getTPSColor(this.currentTPS)}"
              >${this.currentTPS}</span
            >
            (${translateText("performance_overlay.tps_avg_60s")}
            <span>${this.averageTPS}</span>)
          </div>
          <div class="performance-line">
            ${translateText("performance_overlay.tick_exec")}
            <span>${this.tickExecutionAvg.toFixed(2)}ms</span>
            (max: <span>${this.tickExecutionMax}ms</span>)
          </div>
          <div class="performance-line">
            ${translateText("performance_overlay.tick_delay")}
            <span>${this.tickDelayAvg.toFixed(2)}ms</span>
            (max: <span>${this.tickDelayMax}ms</span>)
          </div>
          ${this.layerBreakdown.length
            ? html`<div class="layers-section">
                <div class="performance-line section-header">
                  <span
                    >${translateText("performance_overlay.layers_header")}</span
                  >
                  <button
                    class="collapse-button"
                    @click=${this.toggleRenderLayersExpanded}
                    title=${this.renderLayersExpanded
                      ? translateText("performance_overlay.collapse")
                      : translateText("performance_overlay.expand")}
                  >
                    ${this.renderLayersExpanded ? "▾" : "▸"}
                  </button>
                </div>
                <div class="performance-line">
                  ${translateText("performance_overlay.render_layers_summary", {
                    frames: this.renderLastTickFrameCount,
                    ms: this.renderLastTickLayerTotalMs.toFixed(2),
                  })}
                </div>
                ${this.renderLayersExpanded
                  ? html`<div class="layer-row table-header" style="--pct: 0%;">
                        <span class="layer-name"></span>
                        <span class="layer-metrics">
                          ${translateText(
                            "performance_overlay.render_layers_table_header",
                          )}
                        </span>
                      </div>
                      ${renderLayersToShow.map((layer) => {
                        const width = Math.min(
                          100,
                          (layer.avg / maxLayerAvg) * 100 || 0,
                        );
                        const perTickRenderMs =
                          this.renderLastTickLayerDurations[layer.name] ?? 0;
                        const perTickRenderAvgMs =
                          this.renderPerTickLayerStats.get(layer.name)?.avg ??
                          0;
                        const isInactive = perTickRenderMs <= 0.01;
                        const title = `${layer.name} | last tick render: ${perTickRenderMs.toFixed(
                          2,
                        )}ms`;
                        return html`<div
                          class="layer-row ${isInactive ? "inactive" : ""}"
                          style="--pct: ${width}%;"
                          title=${title}
                        >
                          <span class="layer-name" title=${layer.name}
                            >${layer.name}
                          </span>
                          <span class="layer-metrics">
                            ${layer.avg.toFixed(2)} / ${layer.max.toFixed(2)}ms
                            | ${perTickRenderAvgMs.toFixed(2)}ms
                          </span>
                        </div>`;
                      })}`
                  : html``}
              </div>`
            : html``}
          ${this.tickLayerBreakdown.length
            ? html`<div class="layers-section">
                <div class="performance-line section-header">
                  <span
                    >${translateText(
                      "performance_overlay.tick_layers_header",
                    )}</span
                  >
                  <button
                    class="collapse-button"
                    @click=${this.toggleTickLayersExpanded}
                    title=${this.tickLayersExpanded
                      ? translateText("performance_overlay.collapse")
                      : translateText("performance_overlay.expand")}
                  >
                    ${this.tickLayersExpanded ? "▾" : "▸"}
                  </button>
                </div>
                <div class="performance-line">
                  ${translateText("performance_overlay.tick_layers_summary", {
                    count: this.tickLayerLastCount,
                    ms: this.tickLayerLastTotalMs.toFixed(2),
                  })}
                </div>
                ${this.tickLayersExpanded
                  ? html`<div class="layer-row table-header" style="--pct: 0%;">
                        <span class="layer-name"></span>
                        <span class="layer-metrics">
                          ${translateText(
                            "performance_overlay.tick_layers_table_header",
                          )}
                        </span>
                      </div>
                      ${tickLayersToShow.map((layer) => {
                        const width = Math.min(
                          100,
                          (layer.avg / maxTickLayerAvg) * 100 || 0,
                        );
                        const lastTickMs =
                          this.tickLayerLastDurations[layer.name] ?? 0;
                        const isInactive = lastTickMs <= 0.01;
                        const title = `${layer.name} | last tick: ${lastTickMs.toFixed(2)}ms`;
                        return html`<div
                          class="layer-row ${isInactive ? "inactive" : ""}"
                          style="--pct: ${width}%;"
                          title=${title}
                        >
                          <span class="layer-name" title=${layer.name}
                            >${layer.name}</span
                          >
                          <span class="layer-metrics">
                            ${layer.avg.toFixed(2)} / ${layer.max.toFixed(2)}ms
                          </span>
                        </div>`;
                      })}`
                  : html``}
              </div>`
            : html``}
          ${unitLayerCounters
            ? html`<div class="layers-section">
                <div class="performance-line section-header">
                  <span>UnitLayer Counters</span>
                </div>
                <div class="performance-line">
                  tracked: ${Number(unitLayerCounters.moversTrackedTotal ?? 0)}
                  sampled: ${Number(unitLayerCounters.moversSampled ?? 0)}
                  drawn: ${Number(unitLayerCounters.moversDrawn ?? 0)}
                  skipped: ${Number(unitLayerCounters.moversSkipped ?? 0)}
                </div>
                <div class="performance-line">
                  moverCanvasScale:
                  ${Number(unitLayerCounters.moverCanvasScale ?? 0).toFixed(0)}
                  rescale(last/avg/count):
                  ${Number(unitLayerCounters.moverCanvasRescaleLastMs ?? 0).toFixed(2)}ms
                  /
                  ${Number(unitLayerCounters.moverCanvasRescaleAvgMs ?? 0).toFixed(2)}ms
                  /
                  ${Number(unitLayerCounters.moverCanvasRescaleCount ?? 0).toFixed(0)}
                </div>
                <div class="performance-line">
                  draw:
                  ${Number(unitLayerCounters.drawTimeMs ?? 0).toFixed(2)}ms
                </div>
                <div class="performance-line">
                  on:
                  ${Number(unitLayerCounters.onScreenDrawTimeMs ?? 0).toFixed(2)}ms
                  /
                  ${Number(unitLayerCounters.onScreenBudgetTargetMs ?? 0).toFixed(1)}ms
                  off:
                  ${Number(unitLayerCounters.offScreenVerifyTimeMs ?? 0).toFixed(2)}ms
                  /
                  ${Number(unitLayerCounters.offScreenVerifyBudgetMs ?? 0).toFixed(2)}ms
                </div>
                <div class="performance-line">
                  avgOnDebt: ${Number(unitLayerCounters.avgOnScreenDebt ?? 0).toFixed(2)}
                  maxOnDebt: ${Number(unitLayerCounters.maxOnScreenDebt ?? 0).toFixed(0)}
                </div>
              </div>`
            : html``}
        </div>
      </div>
    `;
  }
}
