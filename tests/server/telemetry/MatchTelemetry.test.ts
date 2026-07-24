import { describe, expect, it } from "vitest";
import {
  noopMatchTelemetryEmitter,
  zeroCounters,
  type MatchTelemetryEvent,
} from "../../../src/server/telemetry/MatchTelemetry";

const event: MatchTelemetryEvent = {
  schemaVersion: 1,
  type: "match_finished",
  matchId: "match-1",
  sequence: 0,
  observedAt: 0,
  serverTick: 0,
  payload: {
    endedAt: 0,
    totalTurns: 0,
    buildHash: "DEV",
    replayArchiveAttempted: false,
  },
};

describe("noopMatchTelemetryEmitter", () => {
  it("drops every event", () => {
    expect(noopMatchTelemetryEmitter.emit(event)).toBe("dropped");
  });

  it("always reports zeroed counters regardless of prior emits", () => {
    for (let i = 0; i < 5; i++) noopMatchTelemetryEmitter.emit(event);
    // The disabled sink is stateless: counters never accumulate, so a reader
    // sees zeros even after other code has emitted through the shared singleton.
    expect(noopMatchTelemetryEmitter.counters()).toEqual(zeroCounters());
  });

  it("hands back a fresh counters object each call", () => {
    const first = noopMatchTelemetryEmitter.counters();
    first.observed = 999;
    expect(noopMatchTelemetryEmitter.counters().observed).toBe(0);
  });
});
