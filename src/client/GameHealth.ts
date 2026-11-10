export interface GameHealthState {
  highLatency: boolean;
  connectionUnstable: boolean;
  performance: boolean;
}

export interface GameHealthContext {
  catchingUp: boolean;
  paused: boolean;
  hidden: boolean;
  networkEnabled: boolean;
  active: boolean;
}

/** Client-only diagnostics. All timestamps use the performance.now() clock. */
export class GameHealth {
  private roundTrips: number[] = [];
  private lastRoundTripAt: number | null = null;
  private latencySpike = false;
  private lastTurnAt: number | null = null;
  private lastTroubledAt = -Infinity;
  private lastFrameAt: number | null = null;
  private frameWindowMs = 0;
  private frameWindowCount = 0;
  private lowFrameMs = 0;
  private lowFrameRate = false;
  private catchingUpSince: number | null = null;
  private sampling = false;
  private networkEnabled = false;
  private struggling = false;
  private readonly state: GameHealthState = {
    highLatency: false,
    connectionUnstable: false,
    performance: false,
  };

  reset(nowMs: number): void {
    this.roundTrips = [];
    this.lastRoundTripAt = null;
    this.latencySpike = false;
    this.lastTurnAt = null;
    this.lastTroubledAt = nowMs;
    this.sampling = false;
    this.networkEnabled = false;
    this.struggling = false;
    this.resetFrames();
    this.catchingUpSince = null;
    this.clearState();
  }

  recordFrame(nowMs: number): void {
    if (!this.sampling) return;
    if (this.lastFrameAt !== null) {
      const elapsed = nowMs - this.lastFrameAt;
      if (elapsed >= 100) this.lastTroubledAt = nowMs;
      if (elapsed > 0) {
        this.frameWindowMs += elapsed;
        this.frameWindowCount++;
        if (this.frameWindowMs >= 1000) {
          const fps = (this.frameWindowCount * 1000) / this.frameWindowMs;
          if (fps < 30) {
            // One blocked frame is jank, not sustained low FPS. Require
            // several completed windows before displaying the warning.
            this.lowFrameMs += Math.min(this.frameWindowMs, 1000);
            this.lowFrameRate = this.lowFrameMs >= 3000;
          } else if (fps >= 35) {
            this.lowFrameMs = 0;
            this.lowFrameRate = false;
          }
          this.frameWindowMs = 0;
          this.frameWindowCount = 0;
        }
      }
    }
    this.lastFrameAt = nowMs;
  }

  recordTurn(nowMs: number): void {
    this.lastTurnAt = nowMs;
  }

  recordRoundTrip(ms: number, nowMs: number): void {
    if (this.lastFrameAt !== null && nowMs - this.lastFrameAt >= 100) {
      this.lastTroubledAt = nowMs;
    }
    if (
      !this.sampling ||
      !this.networkEnabled ||
      !Number.isFinite(ms) ||
      ms < 0 ||
      nowMs - ms <= this.lastTroubledAt
    ) {
      // A pong queued behind client work cannot diagnose network latency.
      this.latencySpike = false;
      return;
    }
    const sorted = [...this.roundTrips].sort((a, b) => a - b);
    const baseline = sorted[Math.floor(sorted.length / 2)];
    this.latencySpike =
      sorted.length >= 3 && ms > Math.max(baseline * 2, baseline + 100);
    this.lastRoundTripAt = nowMs;
    // A bounded rolling baseline can adapt if the connection changes mid-match.
    this.roundTrips.push(ms);
    if (this.roundTrips.length > 12) this.roundTrips.shift();
  }

  update(nowMs: number, context: GameHealthContext): GameHealthState {
    const sampling = context.active && !context.hidden && !context.paused;
    this.networkEnabled = context.networkEnabled;
    if (!sampling) {
      this.lastTroubledAt = nowMs;
      this.sampling = false;
      this.struggling = false;
      this.resetFrames();
      this.catchingUpSince = null;
      this.lastTurnAt = null;
      this.latencySpike = false;
      this.clearState();
      return this.state;
    }
    if (!this.sampling) {
      this.sampling = true;
      // Reject any ping still in flight across a hidden/paused/rejoin period.
      this.lastTroubledAt = nowMs;
      this.lastTurnAt = nowMs;
    }
    if (context.catchingUp) {
      this.catchingUpSince ??= nowMs;
    } else {
      this.catchingUpSince = null;
    }
    const struggling =
      context.catchingUp || this.lowFrameRate || this.lowFrameMs > 0;
    // Include the final interval before recovery, even if no update ran in it.
    if (struggling || this.struggling) this.lastTroubledAt = nowMs;
    this.struggling = struggling;
    this.state.performance =
      this.lowFrameRate ||
      (this.catchingUpSince !== null && nowMs - this.catchingUpSince >= 1000);
    this.state.highLatency =
      context.networkEnabled &&
      !struggling &&
      this.latencySpike &&
      this.lastRoundTripAt !== null &&
      nowMs - this.lastRoundTripAt < 10_000;
    this.state.connectionUnstable =
      context.networkEnabled &&
      this.lastTurnAt !== null &&
      nowMs - this.lastTurnAt >= 500;
    return this.state;
  }

  private resetFrames(): void {
    this.lastFrameAt = null;
    this.frameWindowMs = 0;
    this.frameWindowCount = 0;
    this.lowFrameMs = 0;
    this.lowFrameRate = false;
  }

  private clearState(): void {
    this.state.highLatency = false;
    this.state.connectionUnstable = false;
    this.state.performance = false;
  }
}
