import { EventBus } from "../../../core/EventBus";
import { UserSettings } from "../../../core/game/UserSettings";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  dispatchUiAction,
  dispatchUiSnapshot,
  initDioxusRuntime,
} from "../../UiRuntimeBridge";
import { TickMetricsEvent, TogglePerformanceOverlayEvent } from "../../InputHandler";
import { translateText } from "../../Utils";
import { subscribeUiRuntimeEvents } from "../../runtime/UiRuntimeEventRouter";
import {
  UI_RUNTIME_ACTIONS,
  UI_RUNTIME_EVENTS,
  UI_RUNTIME_SNAPSHOTS,
} from "../../runtime/UiRuntimeProtocol";
import { FrameProfiler } from "../FrameProfiler";
import { Layer } from "./Layer";

interface LayerBreakdownJson {
  name: string;
  avg: string;
  max: string;
  barWidth: number;
}

interface PerformanceOverlayStateJson {
  isVisible: boolean;
  currentFps: number;
  averageFps: number;
  frameTime: number;
  tickExecutionAvg: string;
  tickExecutionMax: number;
  tickDelayAvg: string;
  tickDelayMax: number;
  layers: LayerBreakdownJson[];
  fpsLabel: string;
  avg60sLabel: string;
  frameLabel: string;
  tickExecLabel: string;
  tickDelayLabel: string;
  layersHeaderLabel: string;
  resetLabel: string;
  copyLabel: string;
  posX: number;
  posY: number;
}

function dispatchInGameRuntimeAction(
  actionType: string,
  payload: Record<string, unknown> = {},
): void {
  if (!dispatchUiAction({ type: actionType, payload })) {
    console.warn(
      "[PerformanceOverlayBridge] Failed runtime action:",
      actionType,
    );
  }
}

@customElement("dioxus-performance-overlay")
export class DioxusPerformanceOverlay extends LitElement implements Layer {
  public eventBus!: EventBus;
  public userSettings!: UserSettings;

  private currentFPS = 0;
  private averageFPS = 0;
  private frameTime = 0;
  private tickExecutionAvg = 0;
  private tickExecutionMax = 0;
  private tickDelayAvg = 0;
  private tickDelayMax = 0;
  private isVisible = false;
  private position: { x: number; y: number } = { x: 50, y: 20 };
  private copyStatus: "idle" | "success" | "error" = "idle";

  private frameCount = 0;
  private lastTime = 0;
  private frameTimes: number[] = [];
  private fpsHistory: number[] = [];
  private lastSecondTime = 0;
  private framesThisSecond = 0;
  private tickExecutionTimes: number[] = [];
  private tickDelayTimes: number[] = [];
  private copyStatusTimeoutId: ReturnType<typeof setTimeout> | null = null;

  private layerStats: Map<
    string,
    { avg: number; max: number; last: number; total: number }
  > = new Map();
  private layerBreakdown: {
    name: string;
    avg: number;
    max: number;
    total: number;
  }[] = [];

  @state() private isLaunched = false;

  private runtimeUnsubscribe?: () => void;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.launchDioxusComponent();
  }

  disconnectedCallback() {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    if (this.copyStatusTimeoutId !== null) {
      clearTimeout(this.copyStatusTimeoutId);
    }
    super.disconnectedCallback();
  }

  private async launchDioxusComponent() {
    try {
      await initDioxusRuntime();
      await this.updateComplete;
      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGamePerformanceOverlayLaunch,
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;

      this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
        [
          UI_RUNTIME_EVENTS.uiInGamePerformanceOverlayReset,
          UI_RUNTIME_EVENTS.uiInGamePerformanceOverlayCopy,
          UI_RUNTIME_EVENTS.uiInGamePerformanceOverlayCloseRequest,
        ],
        (event) => {
          if (event.type === UI_RUNTIME_EVENTS.uiInGamePerformanceOverlayReset) {
            this.handleReset();
            return;
          }
          if (event.type === UI_RUNTIME_EVENTS.uiInGamePerformanceOverlayCopy) {
            void this.handleCopyJson();
            return;
          }
          this.handleClose();
        },
      );
    } catch (err) {
      console.error("[DioxusPerformanceOverlay] Failed to launch:", err);
    }
  }

  init() {
    this.eventBus.on(TogglePerformanceOverlayEvent, () => {
      this.userSettings.togglePerformanceOverlay();
      this.setVisible(this.userSettings.performanceOverlay());
    });
    this.eventBus.on(TickMetricsEvent, (event: TickMetricsEvent) => {
      this.updateTickMetrics(event.tickExecutionDuration, event.tickDelay);
    });
  }

  setVisible(visible: boolean) {
    this.isVisible = visible;
    FrameProfiler.setEnabled(visible);
  }

  private handleClose() {
    this.userSettings.togglePerformanceOverlay();
  }

  private handleReset() {
    this.frameCount = 0;
    this.lastTime = 0;
    this.frameTimes = [];
    this.fpsHistory = [];
    this.lastSecondTime = 0;
    this.framesThisSecond = 0;
    this.currentFPS = 0;
    this.averageFPS = 0;
    this.frameTime = 0;
    this.tickExecutionTimes = [];
    this.tickDelayTimes = [];
    this.tickExecutionAvg = 0;
    this.tickExecutionMax = 0;
    this.tickDelayAvg = 0;
    this.tickDelayMax = 0;
    this.layerStats.clear();
    this.layerBreakdown = [];
  }

  updateFrameMetrics(
    frameDuration: number,
    layerDurations?: Record<string, number>,
  ) {
    const wasVisible = this.isVisible;
    this.isVisible = this.userSettings.performanceOverlay();

    if (wasVisible !== this.isVisible) {
      FrameProfiler.setEnabled(this.isVisible);
    }

    if (!this.isVisible) return;

    const now = performance.now();

    if (this.lastTime === 0) {
      this.lastTime = now;
      this.lastSecondTime = now;
      return;
    }

    const deltaTime = now - this.lastTime;

    this.frameTimes.push(deltaTime);
    if (this.frameTimes.length > 60) {
      this.frameTimes.shift();
    }

    if (this.frameTimes.length > 0) {
      const avgFrameTime =
        this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.currentFPS = Math.round(1000 / avgFrameTime);
      this.frameTime = Math.round(avgFrameTime);
    }

    this.framesThisSecond++;

    if (now - this.lastSecondTime >= 1000) {
      this.fpsHistory.push(this.framesThisSecond);
      if (this.fpsHistory.length > 60) {
        this.fpsHistory.shift();
      }

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

    this.sendState();
  }

  private updateLayerStats(layerDurations: Record<string, number>) {
    const alpha = 0.2;

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
      ticks: {
        executionAvgMs: this.tickExecutionAvg,
        executionMaxMs: this.tickExecutionMax,
        delayAvgMs: this.tickDelayAvg,
        delayMaxMs: this.tickDelayMax,
        executionSamples: [...this.tickExecutionTimes],
        delaySamples: [...this.tickDelayTimes],
      },
      layers: this.layerBreakdown.map((layer) => ({ ...layer })),
    };
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

    if (this.copyStatusTimeoutId !== null) {
      clearTimeout(this.copyStatusTimeoutId);
    }
    this.copyStatusTimeoutId = setTimeout(() => {
      this.copyStatus = "idle";
      this.copyStatusTimeoutId = null;
    }, 2000);
  }

  private sendState() {
    if (!this.isLaunched) return;

    const maxLayerAvg =
      this.layerBreakdown.length > 0
        ? Math.max(...this.layerBreakdown.map((l) => l.avg))
        : 1;

    const copyLabel =
      this.copyStatus === "success"
        ? translateText("performance_overlay.copied")
        : this.copyStatus === "error"
          ? translateText("performance_overlay.failed_copy")
          : translateText("performance_overlay.copy_clipboard");

    const state: PerformanceOverlayStateJson = {
      isVisible: this.isVisible,
      currentFps: this.currentFPS,
      averageFps: this.averageFPS,
      frameTime: this.frameTime,
      tickExecutionAvg: this.tickExecutionAvg.toFixed(2),
      tickExecutionMax: this.tickExecutionMax,
      tickDelayAvg: this.tickDelayAvg.toFixed(2),
      tickDelayMax: this.tickDelayMax,
      layers: this.layerBreakdown.map((layer) => ({
        name: layer.name,
        avg: layer.avg.toFixed(2),
        max: layer.max.toFixed(2),
        barWidth: Math.min(100, (layer.avg / maxLayerAvg) * 100 || 0),
      })),
      fpsLabel: translateText("performance_overlay.fps"),
      avg60sLabel: translateText("performance_overlay.avg_60s"),
      frameLabel: translateText("performance_overlay.frame"),
      tickExecLabel: translateText("performance_overlay.tick_exec"),
      tickDelayLabel: translateText("performance_overlay.tick_delay"),
      layersHeaderLabel: translateText("performance_overlay.layers_header"),
      resetLabel: translateText("performance_overlay.reset"),
      copyLabel,
      posX: this.position.x,
      posY: this.position.y,
    };

    if (
      !dispatchUiSnapshot({
        type: UI_RUNTIME_SNAPSHOTS.uiSnapshotInGamePerformanceOverlay,
        scope: "ingame",
        payload: { state },
      })
    ) {
      console.warn(
        "[DioxusPerformanceOverlay] Failed to dispatch runtime snapshot",
      );
    }
  }

  shouldTransform(): boolean {
    return false;
  }

  render() {
    return html`
      <div
        id="dioxus-performance-overlay-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-performance-overlay": DioxusPerformanceOverlay;
  }
}
