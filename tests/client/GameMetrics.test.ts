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

  it("reports each series once per window and starts the window over", () => {
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
      ["frame_time", { p50: 16, p90: 52, p99: 52, count: 4 }, context],
      ["tick_execution", { p50: 3, p90: 9, p99: 9, count: 2 }, context],
      ["tick_interval", { p50: 101, p90: 400, p99: 400, count: 3 }, context],
    ]);

    reportMeasurement.mockClear();
    metrics.recordTickExecution(5);
    vi.advanceTimersByTime(1000);
    expect(reportMeasurement.mock.calls).toEqual([
      ["tick_execution", { p50: 5, p90: 5, p99: 5, count: 1 }, context],
    ]);
  });

  it("reports the WebSocket round trip as ws_rtt", () => {
    const metrics = new GameMetrics("game1234", "c0000001", 1000);
    metrics.start();
    metrics.recordRoundTrip(40);
    metrics.recordRoundTrip(60);
    vi.advanceTimersByTime(1000);
    expect(reportMeasurement).toHaveBeenCalledWith(
      "ws_rtt",
      { p50: 40, p90: 60, p99: 60, count: 2 },
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
      "tick_execution",
      { p50: 7, p90: 7, p99: 7, count: 1 },
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
      "frame_time",
      { p50: 16, p90: 16, p99: 16, count: 2 },
      expect.anything(),
    );
  });
});
