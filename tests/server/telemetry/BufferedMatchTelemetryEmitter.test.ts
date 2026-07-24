import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BufferedMatchTelemetryEmitter,
  createMatchTelemetryEmitter,
} from "../../../src/server/telemetry/BufferedMatchTelemetryEmitter";
import type { MatchTelemetryEvent } from "../../../src/server/telemetry/MatchTelemetry";
import type { EnabledMatchTelemetryConfig } from "../../../src/server/telemetry/MatchTelemetryConfig";

const config: EnabledMatchTelemetryConfig = {
  enabled: true,
  ingestUrl: "https://telemetry.internal/v1/events",
  signingSecret: "secret",
  batchSize: 2,
  flushIntervalMs: 1_000,
  requestTimeoutMs: 500,
  maxQueueSize: 2,
  maxQueueBytes: 10_000,
  maxEventBytes: 5_000,
  perPlayerPerTickCap: 2,
};

const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as any;
const identity = {
  clientId: "client-1",
  publicId: "public-1",
};

function intentEvent(
  sequence: number,
  tick = 4,
): Extract<MatchTelemetryEvent, { type: "intent_observed" }> {
  return {
    schemaVersion: 1,
    type: "intent_observed",
    matchId: "match-1",
    sequence,
    observedAt: 1_700_000_000_000 + sequence,
    serverTick: tick,
    payload: {
      identity,
      intentType: "spawn",
      outcome: "accepted",
      intent: { type: "spawn", tile: sequence },
    },
  };
}

describe("BufferedMatchTelemetryEmitter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("enforces queue count without throwing", () => {
    const emitter = new BufferedMatchTelemetryEmitter(config, logger, {
      fetch: vi.fn(),
      now: () => 1_700_000_000_000,
      randomUUID: () => "batch-1",
    });
    expect(emitter.emit(intentEvent(0))).toBe("enqueued");
    expect(emitter.emit(intentEvent(1))).toBe("enqueued");
    expect(emitter.emit(intentEvent(2, 5))).toBe("dropped");
    expect(emitter.counters().droppedQueueCount).toBe(1);
    emitter.stop();
  });

  it("caps intent observations per match, player, and tick", () => {
    const emitter = new BufferedMatchTelemetryEmitter(
      { ...config, maxQueueSize: 20 },
      logger,
      { fetch: vi.fn(), now: () => 1, randomUUID: () => "batch-1" },
    );
    expect(emitter.emit(intentEvent(0, 9))).toBe("enqueued");
    expect(emitter.emit(intentEvent(1, 9))).toBe("enqueued");
    expect(emitter.emit(intentEvent(2, 9))).toBe("dropped");
    expect(emitter.emit(intentEvent(3, 10))).toBe("enqueued");
    expect(emitter.counters().droppedCap).toBe(1);
    emitter.stop();
  });

  it("drops an oversized event whole", () => {
    const emitter = new BufferedMatchTelemetryEmitter(
      { ...config, maxEventBytes: 50 },
      logger,
      { fetch: vi.fn(), now: () => 1, randomUUID: () => "batch-1" },
    );
    expect(emitter.emit(intentEvent(0))).toBe("dropped");
    expect(emitter.counters().droppedEventBytes).toBe(1);
    emitter.stop();
  });

  it("enforces the serialized queue-byte budget", () => {
    const event = intentEvent(0);
    const eventBytes = Buffer.byteLength(JSON.stringify(event), "utf8");
    const emitter = new BufferedMatchTelemetryEmitter(
      { ...config, maxQueueSize: 20, maxQueueBytes: eventBytes },
      logger,
      { fetch: vi.fn(), now: () => 1, randomUUID: () => "batch-1" },
    );
    expect(emitter.emit(event)).toBe("enqueued");
    expect(emitter.emit(intentEvent(1))).toBe("dropped");
    expect(emitter.counters().droppedQueueBytes).toBe(1);
    emitter.stop();
  });

  it("drops an unserializable event without throwing", () => {
    const event = intentEvent(0);
    (event.payload as any).intent = {};
    (event.payload as any).intent.self = (event.payload as any).intent;
    const emitter = new BufferedMatchTelemetryEmitter(config, logger, {
      fetch: vi.fn(),
      now: () => 1,
      randomUUID: () => "batch-1",
    });
    expect(() => emitter.emit(event)).not.toThrow();
    expect(emitter.counters().droppedSerialization).toBe(1);
    emitter.stop();
  });

  it("unrefs its timer and drops immediately after stop", () => {
    const emitter = new BufferedMatchTelemetryEmitter(config, logger, {
      fetch: vi.fn(),
      now: () => 1,
      randomUUID: () => "batch-1",
    });
    expect((emitter as any).timer.hasRef()).toBe(false);
    emitter.stop();
    expect(emitter.emit(intentEvent(0))).toBe("dropped");
    expect(emitter.counters().droppedDisabled).toBe(1);
  });
  it("posts FIFO batches with an exact HMAC signature", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 202, statusText: "Accepted" });
    const emitter = new BufferedMatchTelemetryEmitter(config, logger, {
      fetch,
      now: () => 1_700_000_000_500,
      randomUUID: () => "batch-123",
    });
    emitter.emit(intentEvent(0));
    emitter.emit(intentEvent(1));

    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    const body = init.body as string;
    const expected = createHmac("sha256", "secret").update(body).digest("hex");
    expect(url).toBe(config.ingestUrl);
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Telemetry-Timestamp": "1700000000500",
      "X-Telemetry-Batch-ID": "batch-123",
      "X-Telemetry-Signature": `v1=${expected}`,
    });
    const parsedBody = JSON.parse(body);
    expect(parsedBody.server).toEqual({
      buildHash: "DEV",
      instanceId: "",
    });
    expect(
      parsedBody.events.map((event: MatchTelemetryEvent) => event.sequence),
    ).toEqual([0, 1]);
    expect(emitter.counters()).toMatchObject({ sent: 2, batchesSucceeded: 1 });
    emitter.stop();
  });

  it("drops a 307 response without retry and cancels its body", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 307,
      statusText: "Temporary Redirect",
      body: { cancel },
    });
    const emitter = new BufferedMatchTelemetryEmitter(config, logger, {
      fetch,
      now: () => 1,
      randomUUID: () => "batch-1",
    });
    emitter.emit(intentEvent(0));

    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].redirect).toBe("error");
    expect(cancel).toHaveBeenCalledOnce();
    expect(emitter.counters()).toMatchObject({
      droppedDelivery: 1,
      batchesFailed: 1,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledOnce();
    emitter.stop();
  });

  it("cancels a successful response body before declaring success", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      statusText: "Accepted",
      body: { cancel },
    });
    const emitter = new BufferedMatchTelemetryEmitter(config, logger, {
      fetch,
      now: () => 1,
      randomUUID: () => "batch-1",
    });
    emitter.emit(intentEvent(0));

    await vi.advanceTimersByTimeAsync(1_000);

    expect(cancel).toHaveBeenCalledOnce();
    expect(emitter.counters()).toMatchObject({
      sent: 1,
      batchesSucceeded: 1,
    });
    emitter.stop();
  });

  it("sanitizes a response body cancellation failure", async () => {
    const canary = "response-body-cancellation-canary";
    const cancel = vi.fn().mockRejectedValue(new Error(canary));
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      statusText: "Accepted",
      body: { cancel },
    });
    const emitter = new BufferedMatchTelemetryEmitter(config, logger, {
      fetch,
      now: () => 1,
      randomUUID: () => "batch-1",
    });
    emitter.emit(intentEvent(0));

    await vi.advanceTimersByTimeAsync(1_000);

    expect(cancel).toHaveBeenCalledOnce();
    expect(emitter.counters()).toMatchObject({
      droppedDelivery: 1,
      batchesFailed: 1,
    });
    expect(logger.warn).toHaveBeenLastCalledWith(
      "match telemetry batch dropped",
      { batchId: "batch-1", failureCategory: "request_failed" },
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(canary);
    emitter.stop();
  });

  it("keeps a response with pending body cancellation in flight", async () => {
    let resolveCancellation!: () => void;
    const cancel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCancellation = resolve;
        }),
    );
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      statusText: "Accepted",
      body: { cancel },
    });
    const emitter = new BufferedMatchTelemetryEmitter(
      { ...config, batchSize: 1, maxQueueSize: 3 },
      logger,
      { fetch, now: () => 1, randomUUID: () => "batch-1" },
    );
    emitter.emit(intentEvent(0));
    emitter.emit(intentEvent(1));

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(emitter.counters().batchesSucceeded).toBe(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledOnce();

    resolveCancellation();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    emitter.stop();
  });

  it("does not overlap flushes and drops a failed batch without retry", async () => {
    let rejectRequest!: (error: Error) => void;
    const fetch = vi
      .fn()
      .mockReturnValue(
        new Promise((_resolve, reject) => (rejectRequest = reject)),
      );
    const emitter = new BufferedMatchTelemetryEmitter(config, logger, {
      fetch,
      now: () => 1,
      randomUUID: () => "batch-1",
    });
    emitter.emit(intentEvent(0));
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledOnce();
    rejectRequest(new Error("offline"));
    await Promise.resolve();
    expect(emitter.counters()).toMatchObject({
      droppedDelivery: 1,
      batchesFailed: 1,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledOnce();
    emitter.stop();
  });

  it("aborts a timed-out request and never requeues it", async () => {
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<{ ok: boolean; status: number; statusText: string }>(
          (_resolve, reject) =>
            init.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            ),
        ),
    );
    const emitter = new BufferedMatchTelemetryEmitter(config, logger, {
      fetch,
      now: () => 1,
      randomUUID: () => "batch-1",
    });
    emitter.emit(intentEvent(0));
    await vi.advanceTimersByTimeAsync(1_500);
    expect(emitter.counters()).toMatchObject({
      droppedDelivery: 1,
      batchesFailed: 1,
    });
    emitter.stop();
  });
  it("returns a non-throwing disabled sink for invalid configuration", () => {
    const emitter = createMatchTelemetryEmitter(
      {
        TELEMETRY_ENABLED: "true",
        TELEMETRY_INGEST_URL: "http://unsafe.test/events",
        TELEMETRY_SIGNING_SECRET: "must-not-appear-in-logs",
      },
      logger,
      { buildHash: "DEV", instanceId: "test-worker" },
    );
    expect(emitter.emit(intentEvent(0))).toBe("dropped");
    // The disabled sink is stateless: it drops without accumulating counters
    // (it previously mutated a shared module-global "zero" object, so counts
    // leaked across every disabled game and test).
    expect(emitter.counters().observed).toBe(0);
    expect(emitter.counters().droppedDisabled).toBe(0);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      "must-not-appear-in-logs",
    );
  });
  it("delivers an immutable admission snapshot after the caller mutates the event", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 202, statusText: "Accepted" });
    const emitter = new BufferedMatchTelemetryEmitter(config, logger, {
      fetch,
      now: () => 1,
      randomUUID: () => "batch-1",
    });
    const event = intentEvent(0);
    expect(emitter.emit(event)).toBe("enqueued");
    (event.payload as any).intent = {};
    (event.payload as any).intent.self = (event.payload as any).intent;

    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetch).toHaveBeenCalledOnce();
    const body = fetch.mock.calls[0][1].body as string;
    expect(JSON.parse(body).events[0].payload.intent).toEqual({
      type: "spawn",
      tile: 0,
    });
    expect(emitter.counters()).toMatchObject({ sent: 1, batchesSucceeded: 1 });
    emitter.stop();
  });

  it("does not log delivery error text that could contain telemetry data", async () => {
    const canary = "telemetry-secret-and-payload-canary";
    const fetch = vi.fn().mockRejectedValue(new Error(canary));
    const emitter = new BufferedMatchTelemetryEmitter(config, logger, {
      fetch,
      now: () => 1,
      randomUUID: () => "batch-1",
    });
    emitter.emit(intentEvent(0));

    await vi.advanceTimersByTimeAsync(1_000);

    expect(logger.warn).toHaveBeenLastCalledWith(
      "match telemetry batch dropped",
      {
        batchId: "batch-1",
        failureCategory: "request_failed",
      },
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(canary);
    emitter.stop();
  });

  it("bounds cap bookkeeping while retaining existing identities", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 202, statusText: "Accepted" });
    const emitter = new BufferedMatchTelemetryEmitter(
      { ...config, maxQueueSize: 2 },
      logger,
      { fetch, now: () => 1, randomUUID: () => "batch-1" },
    );
    const secondIdentityEvent = intentEvent(1, 9);
    secondIdentityEvent.payload.identity = {
      ...identity,
      clientId: "client-2",
    };
    expect(emitter.emit(intentEvent(0, 9))).toBe("enqueued");
    expect(emitter.emit(secondIdentityEvent)).toBe("enqueued");
    await vi.advanceTimersByTimeAsync(1_000);

    const thirdIdentityEvent = intentEvent(3, 10);
    thirdIdentityEvent.payload.identity = { ...identity, clientId: "client-3" };
    expect(emitter.emit(intentEvent(2, 10))).toBe("enqueued");
    expect(emitter.emit(thirdIdentityEvent)).toBe("dropped");
    expect(emitter.counters().droppedCap).toBe(1);
    emitter.stop();
  });
});
