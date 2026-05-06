import { RateLimiter } from "limiter";
import { ClientID } from "../core/Schemas";

const INTENTS_PER_SECOND = 10;
const INTENTS_PER_MINUTE = 150;
const MAX_INTENT_SIZE = 500;
const MAX_CONFIG_INTENT_SIZE = 2000;
const TOTAL_BYTES = 2 * 1024 * 1024; // 2MB per client per window
const BYTE_WINDOW_MS = 60_000; // Reset byte counter every 60 seconds
export type RateLimitResult = "ok" | "limit" | "kick";

interface ClientBucket {
  perSecond: RateLimiter;
  perMinute: RateLimiter;
  byteEvents: Array<{ at: number; bytes: number }>;
  totalBytes: number;
}

export class ClientMsgRateLimiter {
  private buckets = new Map<ClientID, ClientBucket>();

  check(
    clientID: ClientID,
    type: string,
    bytes: number,
    intentType?: string,
  ): RateLimitResult {
    const bucket = this.getOrCreate(clientID);

    // Rolling-window byte accounting: evict events older than BYTE_WINDOW_MS
    // so throughput is measured over a true sliding window instead of
    // a fixed window that allows burst bypass at boundaries.
    const now = Date.now();
    const cutoff = now - BYTE_WINDOW_MS;
    while (bucket.byteEvents.length > 0 && bucket.byteEvents[0].at < cutoff) {
      const evicted = bucket.byteEvents.shift()!;
      bucket.totalBytes -= evicted.bytes;
    }

    bucket.byteEvents.push({ at: now, bytes });
    bucket.totalBytes += bytes;

    if (bucket.totalBytes >= TOTAL_BYTES) return "kick";

    if (type === "intent") {
      // Config updates are lobby-only and not stored in turn history,
      // so they can be larger than regular intents.
      const maxSize =
        intentType === "update_game_config"
          ? MAX_CONFIG_INTENT_SIZE
          : MAX_INTENT_SIZE;
      // Intents are stored in turn history for the duration of the game, so
      // oversized intents would accumulate and fill up server RAM.
      // Intents are also sent to all players, so it increase outgoing
      // data.
      // Intents should never be larger than MAX_INTENT_SIZE, so we assume the client is malicious.
      if (bytes > maxSize) {
        return "kick";
      }
      if (
        !bucket.perSecond.tryRemoveTokens(1) ||
        !bucket.perMinute.tryRemoveTokens(1)
      ) {
        return "limit";
      }
    }

    return "ok";
  }

  private getOrCreate(clientID: ClientID): ClientBucket {
    const existing = this.buckets.get(clientID);
    if (existing) {
      return existing;
    }
    const bucket = {
      perSecond: new RateLimiter({
        tokensPerInterval: INTENTS_PER_SECOND,
        interval: "second",
      }),
      perMinute: new RateLimiter({
        tokensPerInterval: INTENTS_PER_MINUTE,
        interval: "minute",
      }),
      byteEvents: [],
      totalBytes: 0,
    };
    this.buckets.set(clientID, bucket);
    return bucket;
  }
}
