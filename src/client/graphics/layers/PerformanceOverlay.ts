import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { UserSettings } from "../../../core/game/UserSettings";
import {
  TickMetricsEvent,
  TogglePerformanceOverlayEvent,
} from "../../InputHandler";
import { Layer } from "./Layer";

@customElement("performance-overlay")
export class PerformanceOverlay extends LitElement implements Layer {
  @property({ type: Object })
  public eventBus!: EventBus;

  @property({ type: Object })
  public userSettings!: UserSettings;

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
  private isDragging: boolean = false;

  @state()
  private position: { x: number; y: number } = { x: 50, y: 20 }; // Percentage values

  private frameCount: number = 0;
  private lastTime: number = 0;
  private frameTimes: number[] = [];
  private fpsHistory: number[] = [];
  private lastSecondTime: number = 0;
  private framesThisSecond: number = 0;
  private dragStart: { x: number; y: number } = { x: 0, y: 0 };
  private tickExecutionTimes: number[] = [];
  private tickDelayTimes: number[] = [];

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

  static styles = css`
    .performance-overlay {
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 8px 16px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      z-index: 9999;
      user-select: none;
      cursor: move;
      transition: none;
      min-width: 420px;
    }

    .performance-overlay.dragging {
      cursor: grabbing;
      transition: none;
      opacity: 0.5;
    }

    .performance-line {
      margin: 2px 0;
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
    }

    .layer-name {
      flex: 0 0 280px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .layer-bar {
      flex: 1;
      height: 6px;
      background: rgba(148, 163, 184, 0.25);
      border-radius: 3px;
      overflow: hidden;
    }

    .layer-bar-fill {
      height: 100%;
      background: #38bdf8;
      border-radius: 3px;
    }

    .layer-metrics {
      flex: 0 0 auto;
      white-space: nowrap;
    }
  `;

  constructor() {
    super();
  }

  init() {
    this.eventBus.on(TogglePerformanceOverlayEvent, () => {
      this.userSettings.togglePerformanceOverlay();
    });
    this.eventBus.on(TickMetricsEvent, (event: TickMetricsEvent) => {
      this.updateTickMetrics(event.tickExecutionDuration, event.tickDelay);
    });
  }

  setVisible(visible: boolean) {
    this.isVisible = visible;
  }

  private handleClose() {
    this.userSettings.togglePerformanceOverlay();
  }

  private handleMouseDown = (e: MouseEvent) => {
    // Don't start dragging if clicking on close button
    const target = e.target as HTMLElement;
    if (
      target.classList.contains("close-button") ||
      target.classList.contains("reset-button")
    ) {
      return;
    }

    this.isDragging = true;
    this.dragStart = {
      x: e.clientX - this.position.x,
      y: e.clientY - this.position.y,
    };

    document.addEventListener("mousemove", this.handleMouseMove);
    document.addEventListener("mouseup", this.handleMouseUp);
    e.preventDefault();
  };

  private handleMouseMove = (e: MouseEvent) => {
    if (!this.isDragging) return;

    const newX = e.clientX - this.dragStart.x;
    const newY = e.clientY - this.dragStart.y;

    // Convert to percentage of viewport
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    this.position = {
      x: Math.max(0, Math.min(viewportWidth - 100, newX)), // Keep within viewport bounds
      y: Math.max(0, Math.min(viewportHeight - 100, newY)),
    };

    this.requestUpdate();
  };

  private handleMouseUp = () => {
    this.isDragging = false;
    document.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener("mouseup", this.handleMouseUp);
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

    // reset layer breakdown
    this.layerStats.clear();
    this.layerBreakdown = [];

    this.requestUpdate();
  };

  updateFrameMetrics(
    frameDuration: number,
    layerDurations?: Record<string, number>,
  ) {
    this.isVisible = this.userSettings.performanceOverlay();

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

  updateTickMetrics(tickExecutionDuration?: number, tickDelay?: number) {
    if (!this.isVisible || !this.userSettings.performanceOverlay()) return;

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

  render() {
    if (!this.isVisible) {
      return html``;
    }

    const style = `
      left: ${this.position.x}px;
      top: ${this.position.y}px;
      transform: none;
    `;

    const maxLayerAvg =
      this.layerBreakdown.length > 0
        ? Math.max(...this.layerBreakdown.map((l) => l.avg))
        : 1;

    return html`
      <div
        class="performance-overlay ${this.isDragging ? "dragging" : ""}"
        style="${style}"
        @mousedown="${this.handleMouseDown}"
      >
        <button class="reset-button" @click="${this.handleReset}">Reset</button>
        <button class="close-button" @click="${this.handleClose}">×</button>
        <div class="performance-line">
          FPS:
          <span class="${this.getPerformanceColor(this.currentFPS)}"
            >${this.currentFPS}</span
          >
        </div>
        <div class="performance-line">
          Avg (60s):
          <span class="${this.getPerformanceColor(this.averageFPS)}"
            >${this.averageFPS}</span
          >
        </div>
        <div class="performance-line">
          Frame:
          <span class="${this.getPerformanceColor(1000 / this.frameTime)}"
            >${this.frameTime}ms</span
          >
        </div>
        <div class="performance-line">
          Tick Exec:
          <span>${this.tickExecutionAvg.toFixed(2)}ms</span>
          (max: <span>${this.tickExecutionMax}ms</span>)
        </div>
        <div class="performance-line">
          Tick Delay:
          <span>${this.tickDelayAvg.toFixed(2)}ms</span>
          (max: <span>${this.tickDelayMax}ms</span>)
        </div>
        ${this.layerBreakdown.length
          ? html`<div class="layers-section">
              <div class="performance-line">
                Layers (avg / max, sorted by total time):
              </div>
              ${this.layerBreakdown.map((layer) => {
                const width = Math.min(
                  100,
                  (layer.avg / maxLayerAvg) * 100 || 0,
                );
                return html`<div class="layer-row">
                  <span class="layer-name" title=${layer.name}
                    >${layer.name}</span
                  >
                  <div class="layer-bar">
                    <div class="layer-bar-fill" style="width: ${width}%;"></div>
                  </div>
                  <span class="layer-metrics">
                    ${layer.avg.toFixed(2)} / ${layer.max.toFixed(2)}ms
                  </span>
                </div>`;
              })}
            </div>`
          : html``}
      </div>
    `;
  }
}
