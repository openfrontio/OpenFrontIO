import { WorkerMetricsMessage } from "./WorkerMessages";

export type WorkerDebugConfig = {
  enabled: boolean;
  intervalMs: number;
  includeTrace: boolean;
};

export class WorkerProfiler {
  public config: WorkerDebugConfig = {
    enabled: false,
    intervalMs: 1000,
    includeTrace: false,
  };

  private reportTimer: any = null;
  private lastReportWallMs = 0;

  private eventLoopLagSum = 0;
  private eventLoopLagCount = 0;
  private eventLoopLagMax = 0;

  private simDelaySum = 0;
  private simDelayCount = 0;
  private simDelayMax = 0;

  private simExecSum = 0;
  private simExecCount = 0;
  private simExecMax = 0;

  private readonly msgCounts = new Map<string, number>();
  private readonly msgHandlerSum = new Map<string, number>();
  private readonly msgQueueSum = new Map<string, number>();
  private readonly msgHandlerMax = new Map<string, number>();
  private readonly msgQueueMax = new Map<string, number>();

  private traceRing: string[] = [];
  private traceHead = 0;
  private readonly traceCap = 160;

  private renderSubmittedCount = 0;
  private renderNoopCount = 0;
  private renderGetTextureSum = 0;
  private renderGetTextureMax = 0;
  private renderFrameComputeSum = 0;
  private renderFrameComputeMax = 0;
  private renderTerritoryPassSum = 0;
  private renderTerritoryPassMax = 0;
  private renderTemporalResolveSum = 0;
  private renderTemporalResolveMax = 0;
  private renderSubmitSum = 0;
  private renderSubmitMax = 0;
  private renderCpuTotalSum = 0;
  private renderCpuTotalMax = 0;

  constructor(private send: (message: WorkerMetricsMessage) => void) {}

  start(): void {
    if (this.reportTimer) return;
    this.lastReportWallMs = Date.now();

    // Event-loop lag sampler (low overhead).
    let expected = Date.now() + 100;
    setInterval(() => {
      if (!this.config.enabled) return;
      const now = Date.now();
      const lag = Math.max(0, now - expected);
      expected = now + 100;
      this.eventLoopLagSum += lag;
      this.eventLoopLagCount++;
      this.eventLoopLagMax = Math.max(this.eventLoopLagMax, lag);
    }, 100);

    this.reportTimer = setInterval(() => this.report(), this.config.intervalMs);
  }

  configure(next: Partial<WorkerDebugConfig>): void {
    const prevInterval = this.config.intervalMs;
    this.config = {
      enabled: next.enabled ?? this.config.enabled,
      intervalMs: Math.max(
        100,
        (next.intervalMs ?? this.config.intervalMs) | 0,
      ),
      includeTrace: next.includeTrace ?? this.config.includeTrace,
    };

    if (this.config.enabled && !this.reportTimer) {
      this.start();
    }

    if (this.reportTimer && this.config.intervalMs !== prevInterval) {
      clearInterval(this.reportTimer);
      this.reportTimer = setInterval(
        () => this.report(),
        this.config.intervalMs,
      );
    }
  }

  recordMessage(type: string, queueMs: number | null, handlerMs: number): void {
    if (!this.config.enabled) return;
    this.msgCounts.set(type, (this.msgCounts.get(type) ?? 0) + 1);
    this.msgHandlerSum.set(
      type,
      (this.msgHandlerSum.get(type) ?? 0) + handlerMs,
    );
    this.msgHandlerMax.set(
      type,
      Math.max(this.msgHandlerMax.get(type) ?? 0, handlerMs),
    );
    if (queueMs !== null) {
      this.msgQueueSum.set(type, (this.msgQueueSum.get(type) ?? 0) + queueMs);
      this.msgQueueMax.set(
        type,
        Math.max(this.msgQueueMax.get(type) ?? 0, queueMs),
      );
    }

    if (handlerMs > 25 || (queueMs !== null && queueMs > 250)) {
      this.trace(
        `${new Date().toISOString()} msg ${type} queue=${queueMs ?? "?"}ms handler=${Math.round(handlerMs)}ms`,
      );
    }
  }

  recordSimExec(execMs: number): void {
    if (!this.config.enabled) return;
    this.simExecSum += execMs;
    this.simExecCount++;
    this.simExecMax = Math.max(this.simExecMax, execMs);
    if (execMs > 25) {
      this.trace(
        `${new Date().toISOString()} sim executeNextTick ${Math.round(execMs)}ms`,
      );
    }
  }

  recordSimDelay(delayMs: number): void {
    if (!this.config.enabled) return;
    this.simDelaySum += delayMs;
    this.simDelayCount++;
    this.simDelayMax = Math.max(this.simDelayMax, delayMs);
    if (delayMs > 25) {
      this.trace(
        `${new Date().toISOString()} sim scheduleDelay ${Math.round(delayMs)}ms`,
      );
    }
  }

  recordRenderBreakdown(b: {
    submitted: boolean;
    getTextureMs?: number;
    frameComputeMs?: number;
    territoryPassMs?: number;
    temporalResolveMs?: number;
    submitMs?: number;
    cpuTotalMs?: number;
  }): void {
    if (!this.config.enabled) return;
    if (!b.submitted) {
      this.renderNoopCount++;
      return;
    }
    this.renderSubmittedCount++;

    if (typeof b.getTextureMs === "number") {
      this.renderGetTextureSum += b.getTextureMs;
      this.renderGetTextureMax = Math.max(
        this.renderGetTextureMax,
        b.getTextureMs,
      );
    }
    if (typeof b.frameComputeMs === "number") {
      this.renderFrameComputeSum += b.frameComputeMs;
      this.renderFrameComputeMax = Math.max(
        this.renderFrameComputeMax,
        b.frameComputeMs,
      );
    }
    if (typeof b.territoryPassMs === "number") {
      this.renderTerritoryPassSum += b.territoryPassMs;
      this.renderTerritoryPassMax = Math.max(
        this.renderTerritoryPassMax,
        b.territoryPassMs,
      );
    }
    if (typeof b.temporalResolveMs === "number") {
      this.renderTemporalResolveSum += b.temporalResolveMs;
      this.renderTemporalResolveMax = Math.max(
        this.renderTemporalResolveMax,
        b.temporalResolveMs,
      );
    }
    if (typeof b.submitMs === "number") {
      this.renderSubmitSum += b.submitMs;
      this.renderSubmitMax = Math.max(this.renderSubmitMax, b.submitMs);
    }
    if (typeof b.cpuTotalMs === "number") {
      this.renderCpuTotalSum += b.cpuTotalMs;
      this.renderCpuTotalMax = Math.max(this.renderCpuTotalMax, b.cpuTotalMs);
    }
  }

  trace(line: string): void {
    if (!this.config.enabled || !this.config.includeTrace) return;
    if (this.traceRing.length < this.traceCap) {
      this.traceRing.push(line);
      return;
    }
    this.traceRing[this.traceHead] = line;
    this.traceHead = (this.traceHead + 1) % this.traceCap;
  }

  private flushTrace(): string[] {
    if (!this.config.includeTrace || this.traceRing.length === 0) {
      return [];
    }
    if (this.traceRing.length < this.traceCap) {
      return [...this.traceRing];
    }
    return [
      ...this.traceRing.slice(this.traceHead),
      ...this.traceRing.slice(0, this.traceHead),
    ];
  }

  private report(): void {
    if (!this.config.enabled) return;
    const now = Date.now();
    const intervalMs = Math.max(1, now - this.lastReportWallMs);
    this.lastReportWallMs = now;

    const toAvgRecord = (
      sumMap: Map<string, number>,
      countMap: Map<string, number>,
    ) => {
      const out: Record<string, number> = {};
      for (const [k, sum] of sumMap) {
        const c = countMap.get(k) ?? 0;
        if (c > 0) {
          out[k] = sum / c;
        }
      }
      return out;
    };

    const toMaxRecord = (maxMap: Map<string, number>) => {
      const out: Record<string, number> = {};
      for (const [k, v] of maxMap) {
        out[k] = v;
      }
      return out;
    };

    const msgCountsObj: Record<string, number> = {};
    for (const [k, c] of this.msgCounts) {
      msgCountsObj[k] = c;
    }

    const renderTotal = this.renderSubmittedCount + this.renderNoopCount;
    const rAvg = (sum: number): number =>
      this.renderSubmittedCount > 0 ? sum / this.renderSubmittedCount : 0;

    const metrics: WorkerMetricsMessage = {
      type: "worker_metrics",
      intervalMs,
      eventLoopLagMsAvg:
        this.eventLoopLagCount > 0
          ? this.eventLoopLagSum / this.eventLoopLagCount
          : 0,
      eventLoopLagMsMax: this.eventLoopLagMax,
      simPumpDelayMsAvg:
        this.simDelayCount > 0 ? this.simDelaySum / this.simDelayCount : 0,
      simPumpDelayMsMax: this.simDelayMax,
      simPumpExecMsAvg:
        this.simExecCount > 0 ? this.simExecSum / this.simExecCount : 0,
      simPumpExecMsMax: this.simExecMax,
      renderSubmittedCount:
        renderTotal > 0 ? this.renderSubmittedCount : undefined,
      renderNoopCount: renderTotal > 0 ? this.renderNoopCount : undefined,
      renderGetTextureMsAvg:
        this.renderSubmittedCount > 0
          ? rAvg(this.renderGetTextureSum)
          : undefined,
      renderGetTextureMsMax:
        this.renderSubmittedCount > 0 ? this.renderGetTextureMax : undefined,
      renderFrameComputeMsAvg:
        this.renderSubmittedCount > 0
          ? rAvg(this.renderFrameComputeSum)
          : undefined,
      renderFrameComputeMsMax:
        this.renderSubmittedCount > 0 ? this.renderFrameComputeMax : undefined,
      renderTerritoryPassMsAvg:
        this.renderSubmittedCount > 0
          ? rAvg(this.renderTerritoryPassSum)
          : undefined,
      renderTerritoryPassMsMax:
        this.renderSubmittedCount > 0 ? this.renderTerritoryPassMax : undefined,
      renderTemporalResolveMsAvg:
        this.renderSubmittedCount > 0
          ? rAvg(this.renderTemporalResolveSum)
          : undefined,
      renderTemporalResolveMsMax:
        this.renderSubmittedCount > 0
          ? this.renderTemporalResolveMax
          : undefined,
      renderSubmitMsAvg:
        this.renderSubmittedCount > 0 ? rAvg(this.renderSubmitSum) : undefined,
      renderSubmitMsMax:
        this.renderSubmittedCount > 0 ? this.renderSubmitMax : undefined,
      renderCpuTotalMsAvg:
        this.renderSubmittedCount > 0
          ? rAvg(this.renderCpuTotalSum)
          : undefined,
      renderCpuTotalMsMax:
        this.renderSubmittedCount > 0 ? this.renderCpuTotalMax : undefined,
      msgCounts: msgCountsObj,
      msgHandlerMsAvg: toAvgRecord(this.msgHandlerSum, this.msgCounts),
      msgHandlerMsMax: toMaxRecord(this.msgHandlerMax),
      msgQueueMsAvg: toAvgRecord(this.msgQueueSum, this.msgCounts),
      msgQueueMsMax: toMaxRecord(this.msgQueueMax),
      trace: this.config.includeTrace ? this.flushTrace() : undefined,
    };

    this.send(metrics);

    // Reset per-interval counters.
    this.eventLoopLagSum = 0;
    this.eventLoopLagCount = 0;
    this.eventLoopLagMax = 0;
    this.simDelaySum = 0;
    this.simDelayCount = 0;
    this.simDelayMax = 0;
    this.simExecSum = 0;
    this.simExecCount = 0;
    this.simExecMax = 0;
    this.renderSubmittedCount = 0;
    this.renderNoopCount = 0;
    this.renderGetTextureSum = 0;
    this.renderGetTextureMax = 0;
    this.renderFrameComputeSum = 0;
    this.renderFrameComputeMax = 0;
    this.renderTerritoryPassSum = 0;
    this.renderTerritoryPassMax = 0;
    this.renderTemporalResolveSum = 0;
    this.renderTemporalResolveMax = 0;
    this.renderSubmitSum = 0;
    this.renderSubmitMax = 0;
    this.renderCpuTotalSum = 0;
    this.renderCpuTotalMax = 0;
    this.msgCounts.clear();
    this.msgHandlerSum.clear();
    this.msgHandlerMax.clear();
    this.msgQueueSum.clear();
    this.msgQueueMax.clear();
    if (this.config.includeTrace) {
      this.traceRing = [];
      this.traceHead = 0;
    }
  }
}
