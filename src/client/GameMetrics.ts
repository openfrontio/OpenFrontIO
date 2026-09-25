import { reportMeasurement } from "./Telemetry";

/**
 * In-game performance metrics for Grafana: frame interval, sim tick
 * execution time, the gap between consecutive turn messages from the
 * server and the WebSocket round trip. Each is sampled continuously and summarised as p50/p90/p99 once
 * per window, so a 60fps client costs one measurement per series per window
 * rather than one event per frame.
 *
 * Series (Faro measurement type → values p50/p90/p99/count, all ms except
 * count):
 * - frame_time: time between consecutive animation frames of the game's
 *   render loop. 16.7 is 60fps; the p99 is the jank.
 * - tick_execution: how long the worker took to run one sim tick, as it
 *   reports in each GameUpdate.
 * - tick_interval: time between consecutive turn messages arriving over the
 *   WebSocket. The server sends one per turn interval (100ms), so p50 sits
 *   there and p90/p99 show stalls. Not a latency: turns carry no send time
 *   (ws_rtt measures that). Multiplayer only. A rejoin replays missed turns
 *   in a burst, so the window it lands in reads low.
 * - ws_rtt: ping → pong round trip over the game WebSocket. The client pings
 *   every 5s, so a window holds ~6 samples. Includes any time the pong waits
 *   behind other work on the client's main thread. Multiplayer only.
 */

export const FLUSH_INTERVAL_MS = 30_000;

export interface Percentiles {
  p50: number;
  p90: number;
  p99: number;
  count: number;
}

/** Nearest-rank percentiles of the samples; undefined when there are none. */
export function percentiles(samples: number[]): Percentiles | undefined {
  if (samples.length === 0) return undefined;
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) =>
    round(sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]);
  return { p50: at(50), p90: at(90), p99: at(99), count: sorted.length };
}

function round(ms: number): number {
  return Math.round(ms * 100) / 100;
}

export class GameMetrics {
  private frameTime: number[] = [];
  private tickExecution: number[] = [];
  private tickInterval: number[] = [];
  private roundTrip: number[] = [];
  private lastFrameAt: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly gameID: string,
    private readonly clientID: string | undefined,
    private readonly flushIntervalMs: number = FLUSH_INTERVAL_MS,
  ) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.flush(), this.flushIntervalMs);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  /** Stops sampling and reports whatever the last partial window holds. */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.flush();
  }

  /** Called once per animation frame with the frame's timestamp. */
  recordFrame(nowMs: number): void {
    if (this.lastFrameAt !== null) {
      this.frameTime.push(nowMs - this.lastFrameAt);
    }
    this.lastFrameAt = nowMs;
  }

  recordTickExecution(ms: number): void {
    this.tickExecution.push(ms);
  }

  recordTickInterval(ms: number): void {
    this.tickInterval.push(ms);
  }

  recordRoundTrip(ms: number): void {
    this.roundTrip.push(ms);
  }

  flush(): void {
    const context = { gameID: this.gameID, clientID: this.clientID ?? "" };
    for (const [type, samples] of [
      ["frame_time", this.frameTime],
      ["tick_execution", this.tickExecution],
      ["tick_interval", this.tickInterval],
      ["ws_rtt", this.roundTrip],
    ] as const) {
      const values = percentiles(samples);
      if (values === undefined) continue;
      reportMeasurement(type, { ...values }, context);
      samples.length = 0;
    }
  }

  // Animation frames stop while the tab is hidden, so the first frame back
  // would measure the whole absence as one frame. Start the interval over.
  private onVisibilityChange = (): void => {
    this.lastFrameAt = null;
  };
}
