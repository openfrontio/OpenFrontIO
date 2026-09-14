// The WebSocket server's max payload (see Worker.ts). Telemetry events are
// capped to this so a single event can never exceed the transport frame.
export const MAX_WEBSOCKET_PAYLOAD_BYTES = 1024 * 1024;

// Batches are signed with HMAC-SHA256, so the secret should carry at least a
// full digest's worth of entropy.
const MIN_SIGNING_SECRET_LENGTH = 32;

export interface EnabledMatchTelemetryConfig {
  enabled: true;
  ingestUrl: string;
  signingSecret: string;
  batchSize: number;
  flushIntervalMs: number;
  requestTimeoutMs: number;
  maxQueueSize: number;
  maxQueueBytes: number;
  maxEventBytes: number;
  perPlayerPerTickCap: number;
}

export type MatchTelemetryConfigResult =
  | { enabled: false; error?: string }
  | EnabledMatchTelemetryConfig;

// Numeric env fields with their env var name and default. Keys line up exactly
// with the numeric members of EnabledMatchTelemetryConfig.
const INTEGER_FIELDS = {
  batchSize: { env: "TELEMETRY_BATCH_SIZE", fallback: 200 },
  flushIntervalMs: { env: "TELEMETRY_FLUSH_INTERVAL_MS", fallback: 1_000 },
  requestTimeoutMs: { env: "TELEMETRY_REQUEST_TIMEOUT_MS", fallback: 5_000 },
  maxQueueSize: { env: "TELEMETRY_MAX_QUEUE_SIZE", fallback: 20_000 },
  maxQueueBytes: {
    env: "TELEMETRY_MAX_QUEUE_BYTES",
    fallback: 32 * 1024 * 1024,
  },
  maxEventBytes: {
    env: "TELEMETRY_MAX_EVENT_BYTES",
    fallback: MAX_WEBSOCKET_PAYLOAD_BYTES,
  },
  perPlayerPerTickCap: {
    env: "TELEMETRY_PER_PLAYER_PER_TICK_CAP",
    fallback: 32,
  },
} as const satisfies Record<string, { env: string; fallback: number }>;

type IntegerField = keyof typeof INTEGER_FIELDS;

function disabled(error: string): MatchTelemetryConfigResult {
  return { enabled: false, error };
}

// Returns the parsed value, the fallback when unset, or null when the value is
// present but not a positive integer.
function parsePositiveInteger(
  raw: string | undefined,
  fallback: number,
): number | null {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function loadMatchTelemetryConfig(
  env: Record<string, string | undefined>,
): MatchTelemetryConfigResult {
  if (env.TELEMETRY_ENABLED !== "true") return { enabled: false };

  const ingestUrl = env.TELEMETRY_INGEST_URL;
  if (!ingestUrl) return disabled("TELEMETRY_INGEST_URL is required");
  try {
    if (new URL(ingestUrl).protocol !== "https:") {
      return disabled("TELEMETRY_INGEST_URL must use HTTPS");
    }
  } catch {
    return disabled("TELEMETRY_INGEST_URL must be a valid HTTPS URL");
  }

  const signingSecret = env.TELEMETRY_SIGNING_SECRET;
  if (!signingSecret) return disabled("TELEMETRY_SIGNING_SECRET is required");
  if (signingSecret.length < MIN_SIGNING_SECRET_LENGTH) {
    return disabled(
      `TELEMETRY_SIGNING_SECRET must be at least ${MIN_SIGNING_SECRET_LENGTH} characters`,
    );
  }

  const integers = {} as Record<IntegerField, number>;
  for (const field of Object.keys(INTEGER_FIELDS) as IntegerField[]) {
    const { env: key, fallback } = INTEGER_FIELDS[field];
    const value = parsePositiveInteger(env[key], fallback);
    if (value === null) return disabled(`${key} must be a positive integer`);
    integers[field] = value;
  }

  if (integers.maxEventBytes > MAX_WEBSOCKET_PAYLOAD_BYTES) {
    return disabled(
      `TELEMETRY_MAX_EVENT_BYTES must not exceed ${MAX_WEBSOCKET_PAYLOAD_BYTES}`,
    );
  }

  return { enabled: true, ingestUrl, signingSecret, ...integers };
}
