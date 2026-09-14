import { describe, expect, it } from "vitest";
import { loadMatchTelemetryConfig } from "../../../src/server/telemetry/MatchTelemetryConfig";

const validEnv = {
  TELEMETRY_ENABLED: "true",
  TELEMETRY_INGEST_URL: "https://telemetry.internal/v1/events",
  TELEMETRY_SIGNING_SECRET: "test-signing-secret-padding-1234",
};

describe("loadMatchTelemetryConfig", () => {
  it("defaults off when TELEMETRY_ENABLED is absent", () => {
    expect(loadMatchTelemetryConfig({})).toEqual({ enabled: false });
  });

  it("loads finite defaults when explicitly enabled", () => {
    expect(loadMatchTelemetryConfig(validEnv)).toEqual({
      enabled: true,
      ingestUrl: "https://telemetry.internal/v1/events",
      signingSecret: "test-signing-secret-padding-1234",
      batchSize: 200,
      flushIntervalMs: 1_000,
      requestTimeoutMs: 5_000,
      maxQueueSize: 20_000,
      maxQueueBytes: 32 * 1024 * 1024,
      maxEventBytes: 1024 * 1024,
      perPlayerPerTickCap: 32,
    });
  });

  it.each([
    [{ ...validEnv, TELEMETRY_INGEST_URL: "http://localhost/events" }, "HTTPS"],
    [{ ...validEnv, TELEMETRY_SIGNING_SECRET: "" }, "SIGNING_SECRET"],
    [{ ...validEnv, TELEMETRY_SIGNING_SECRET: "too-short" }, "at least 32"],
    [{ ...validEnv, TELEMETRY_BATCH_SIZE: "0" }, "BATCH_SIZE"],
    [{ ...validEnv, TELEMETRY_MAX_EVENT_BYTES: "1048577" }, "MAX_EVENT_BYTES"],
  ])("disables invalid enabled configuration", (env, message) => {
    const result = loadMatchTelemetryConfig(env);
    expect(result.enabled).toBe(false);
    if (result.enabled) throw new Error("expected disabled telemetry config");
    expect(result.error).toContain(message);
  });

  it("accepts positive integer overrides", () => {
    expect(
      loadMatchTelemetryConfig({
        ...validEnv,
        TELEMETRY_BATCH_SIZE: "25",
        TELEMETRY_FLUSH_INTERVAL_MS: "250",
        TELEMETRY_REQUEST_TIMEOUT_MS: "750",
        TELEMETRY_MAX_QUEUE_SIZE: "500",
        TELEMETRY_MAX_QUEUE_BYTES: "4096",
        TELEMETRY_MAX_EVENT_BYTES: "2048",
        TELEMETRY_PER_PLAYER_PER_TICK_CAP: "7",
      }),
    ).toMatchObject({
      enabled: true,
      batchSize: 25,
      flushIntervalMs: 250,
      requestTimeoutMs: 750,
      maxQueueSize: 500,
      maxQueueBytes: 4096,
      maxEventBytes: 2048,
      perPlayerPerTickCap: 7,
    });
  });
});
