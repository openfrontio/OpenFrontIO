import { createHmac, randomUUID } from "crypto";
import type { Logger } from "winston";
import {
  noopMatchTelemetryEmitter,
  zeroCounters,
  type MatchTelemetryCounters,
  type MatchTelemetryEmitter,
  type MatchTelemetryEvent,
} from "./MatchTelemetry";
import {
  loadMatchTelemetryConfig,
  type EnabledMatchTelemetryConfig,
} from "./MatchTelemetryConfig";

interface QueueEntry {
  event: MatchTelemetryEvent;
  bytes: number;
}

interface ResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  body?: {
    cancel(): Promise<void>;
  } | null;
}

interface EmitterDependencies {
  fetch: (url: string, init: RequestInit) => Promise<ResponseLike>;
  now: () => number;
  randomUUID: () => string;
}

export interface MatchTelemetryServerIdentity {
  buildHash: string;
  instanceId: string;
  workerId?: number;
}

export class BufferedMatchTelemetryEmitter implements MatchTelemetryEmitter {
  private readonly queue: QueueEntry[] = [];
  private queuedBytes = 0;
  private readonly counts = zeroCounters();
  private readonly capState = new Map<
    string,
    { tick: number; count: number }
  >();
  private inFlight = false;
  private stopped = false;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly config: EnabledMatchTelemetryConfig,
    private readonly log: Pick<Logger, "error" | "warn" | "info">,
    private readonly dependencies: EmitterDependencies = {
      fetch: globalThis.fetch,
      now: Date.now,
      randomUUID,
    },
    private readonly serverIdentity: MatchTelemetryServerIdentity = {
      buildHash: "DEV",
      instanceId: "",
    },
  ) {
    this.timer = setInterval(() => this.flush(), config.flushIntervalMs);
    this.timer.unref();
  }

  emit(event: MatchTelemetryEvent): "enqueued" | "dropped" {
    this.counts.observed++;
    if (event.type === "match_finished") this.clearMatchCapState(event.matchId);
    if (this.stopped) {
      this.counts.droppedDisabled++;
      return "dropped";
    }
    if (event.type === "intent_observed" && !this.admitIntent(event)) {
      this.counts.droppedCap++;
      return "dropped";
    }

    let serializedEvent: string;
    let snapshot: MatchTelemetryEvent;
    let bytes: number;
    try {
      serializedEvent = JSON.stringify(event);
      snapshot = JSON.parse(serializedEvent) as MatchTelemetryEvent;
      bytes = Buffer.byteLength(serializedEvent, "utf8");
    } catch {
      this.counts.droppedSerialization++;
      return "dropped";
    }
    if (bytes > this.config.maxEventBytes) {
      this.counts.droppedEventBytes++;
      return "dropped";
    }
    if (this.queue.length >= this.config.maxQueueSize) {
      this.counts.droppedQueueCount++;
      return "dropped";
    }
    if (this.queuedBytes + bytes > this.config.maxQueueBytes) {
      this.counts.droppedQueueBytes++;
      return "dropped";
    }

    this.queue.push({ event: snapshot, bytes });
    this.queuedBytes += bytes;
    this.counts.enqueued++;
    return "enqueued";
  }

  counters(): MatchTelemetryCounters {
    return { ...this.counts };
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
  }

  private admitIntent(
    event: Extract<MatchTelemetryEvent, { type: "intent_observed" }>,
  ): boolean {
    const key = `${event.matchId}\u0000${event.payload.identity.clientId}`;
    const state = this.capState.get(key);
    if (state === undefined) {
      if (this.capState.size >= this.config.maxQueueSize) return false;
      this.capState.set(key, { tick: event.serverTick, count: 1 });
      return true;
    }
    if (state.tick !== event.serverTick) {
      state.tick = event.serverTick;
      state.count = 1;
      return true;
    }
    if (state.count >= this.config.perPlayerPerTickCap) return false;
    state.count++;
    return true;
  }

  private clearMatchCapState(matchId: string): void {
    const prefix = `${matchId}\u0000`;
    for (const key of this.capState.keys()) {
      if (key.startsWith(prefix)) this.capState.delete(key);
    }
  }

  private flush(): void {
    if (this.stopped || this.inFlight || this.queue.length === 0) return;
    const entries = this.queue.splice(0, this.config.batchSize);
    for (const entry of entries) this.queuedBytes -= entry.bytes;
    this.inFlight = true;
    void this.sendBatch(entries)
      .catch(() => undefined)
      .finally(() => {
        this.inFlight = false;
      });
  }

  private async sendBatch(entries: QueueEntry[]): Promise<void> {
    let batchId = "";
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let failureCategory = "request_failed";
    let status: number | undefined;
    try {
      const createdAt = this.dependencies.now();
      batchId = this.dependencies.randomUUID();
      let body: string;
      try {
        body = JSON.stringify({
          schemaVersion: 1,
          batchId,
          createdAt,
          server: this.serverIdentity,
          events: entries.map((entry) => entry.event),
        });
      } catch {
        failureCategory = "serialization_failed";
        throw new Error("batch serialization failed");
      }
      const signature = createHmac("sha256", this.config.signingSecret)
        .update(body)
        .digest("hex");
      const controller = new AbortController();
      timeout = setTimeout(
        () => controller.abort(),
        this.config.requestTimeoutMs,
      );
      const response = await this.dependencies.fetch(this.config.ingestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telemetry-Timestamp": String(createdAt),
          "X-Telemetry-Batch-ID": batchId,
          "X-Telemetry-Signature": `v1=${signature}`,
        },
        body,
        signal: controller.signal,
        redirect: "error",
      });
      await response.body?.cancel();
      if (!response.ok) {
        failureCategory = "http_response";
        status = response.status;
        throw new Error("ingest rejected batch");
      }
      this.counts.sent += entries.length;
      this.counts.batchesSucceeded++;
    } catch {
      this.counts.droppedDelivery += entries.length;
      this.counts.batchesFailed++;
      this.log.warn("match telemetry batch dropped", {
        batchId,
        failureCategory,
        ...(status === undefined ? {} : { status }),
      });
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}

export function createMatchTelemetryEmitter(
  env: Record<string, string | undefined>,
  log: Pick<Logger, "error" | "warn" | "info">,
  serverIdentity: MatchTelemetryServerIdentity,
  dependencies?: EmitterDependencies,
): MatchTelemetryEmitter {
  const config = loadMatchTelemetryConfig(env);
  if (!config.enabled) {
    if (config.error)
      log.error("match telemetry disabled: invalid configuration", {
        error: config.error,
      });
    return noopMatchTelemetryEmitter;
  }
  return new BufferedMatchTelemetryEmitter(
    config,
    log,
    dependencies,
    serverIdentity,
  );
}
