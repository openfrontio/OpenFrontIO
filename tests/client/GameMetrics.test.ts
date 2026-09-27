import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameMetrics, percentiles } from "../../src/client/GameMetrics";

const reportMeasurement = vi.fn();
vi.mock("../../src/client/Telemetry", () => ({
  reportMeasurement: (...args: unknown[]) => reportMeasurement(...args),
}));

describe("percentiles", () => {
  it("is undefined with no samples", () => {
    expect(percentiles([])).toBeUndefined();
  });

  it("takes the nearest rank of the sorted samples", () => {
    const samples = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(percentiles(samples)).toEqual({
      p50: 50,
      p90: 90,
      p99: 99,
      count: 100,
    });
  });

  it("answers the single sample for every percentile", () => {
    expect(percentiles([16.666])).toEqual({
      p50: 16.67,
      p90: 16.67,
      p99: 16.67,
      count: 1,
    });
  });
});

describe("GameMetrics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reportMeasurement.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports every series in one game_perf measurement per window and starts the window over", () => {
    const metrics = new GameMetrics("game1234", "c0000001", 1000);
    metrics.start();
    for (const t of [0, 16, 32, 48, 100]) metrics.recordFrame(t);
    metrics.recordTickExecution(3);
    metrics.recordTickExecution(9);
    metrics.recordTickInterval(100);
    metrics.recordTickInterval(101);
    metrics.recordTickInterval(400);

    vi.advanceTimersByTime(1000);

    const context = { gameID: "game1234", clientID: "c0000001" };
    expect(reportMeasurement.mock.calls).toEqual([
      [
        "game_perf",
        {
          frame_time_p50: 16,
          frame_time_p90: 52,
          frame_time_p99: 52,
          frame_time_count: 4,
          tick_execution_p50: 3,
          tick_execution_p90: 9,
          tick_execution_p99: 9,
          tick_execution_count: 2,
          tick_interval_p50: 101,
          tick_interval_p90: 400,
          tick_interval_p99: 400,
          tick_interval_count: 3,
        },
        context,
      ],
    ]);

    reportMeasurement.mockClear();
    metrics.recordTickExecution(5);
    vi.advanceTimersByTime(1000);
    expect(reportMeasurement.mock.calls).toEqual([
      [
        "game_perf",
        {
          tick_execution_p50: 5,
          tick_execution_p90: 5,
          tick_execution_p99: 5,
          tick_execution_count: 1,
        },
        context,
      ],
    ]);
  });

  it("reports the WebSocket round trip under ws_rtt", () => {
    const metrics = new GameMetrics("game1234", "c0000001", 1000);
    metrics.start();
    metrics.recordRoundTrip(40);
    metrics.recordRoundTrip(60);
    vi.advanceTimersByTime(1000);
    expect(reportMeasurement).toHaveBeenCalledWith(
      "game_perf",
      { ws_rtt_p50: 40, ws_rtt_p90: 60, ws_rtt_p99: 60, ws_rtt_count: 2 },
      { gameID: "game1234", clientID: "c0000001" },
    );
  });

  it("reports nothing for an empty window", () => {
    const metrics = new GameMetrics("game1234", undefined, 1000);
    metrics.start();
    vi.advanceTimersByTime(3000);
    expect(reportMeasurement).not.toHaveBeenCalled();
  });

  it("flushes the partial window on stop and stops reporting after", () => {
    const metrics = new GameMetrics("game1234", undefined, 1000);
    metrics.start();
    metrics.recordTickExecution(7);
    metrics.stop();
    expect(reportMeasurement).toHaveBeenCalledWith(
      "game_perf",
      {
        tick_execution_p50: 7,
        tick_execution_p90: 7,
        tick_execution_p99: 7,
        tick_execution_count: 1,
      },
      { gameID: "game1234", clientID: "" },
    );

    reportMeasurement.mockClear();
    metrics.recordTickExecution(7);
    vi.advanceTimersByTime(5000);
    metrics.stop();
    expect(reportMeasurement).not.toHaveBeenCalled();
  });

  // Frames stop while the tab is hidden; the first one back must not count
  // the whole absence as one frame.
  it("restarts the frame interval when the tab's visibility changes", () => {
    const metrics = new GameMetrics("game1234", undefined, 1000);
    metrics.start();
    metrics.recordFrame(0);
    metrics.recordFrame(16);
    document.dispatchEvent(new Event("visibilitychange"));
    metrics.recordFrame(60_000);
    metrics.recordFrame(60_016);
    metrics.flush();
    expect(reportMeasurement).toHaveBeenCalledWith(
      "game_perf",
      {
        frame_time_p50: 16,
        frame_time_p90: 16,
        frame_time_p99: 16,
        frame_time_count: 2,
      },
      expect.anything(),
    );
  });
});
