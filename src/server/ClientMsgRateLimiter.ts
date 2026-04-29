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
  totalBytes: number;
  byteWindowStart: number;
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

    // Reset the byte counter if the current window has elapsed.
    // This prevents legitimate long-running clients from being
    // kicked after accumulating bytes over the entire game duration.
    const now = Date.now();
    if (now - bucket.byteWindowStart >= BYTE_WINDOW_MS) {
      bucket.totalBytes = 0;
      bucket.byteWindowStart = now;
    }

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
      totalBytes: 0,
      byteWindowStart: Date.now(),
    };
    this.buckets.set(clientID, bucket);
    return bucket;
  }
}
