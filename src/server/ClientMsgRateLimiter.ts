import { RateLimiter } from "limiter";
import { ClientID } from "../core/Schemas";

const INTENTS_PER_SECOND = 10;
const INTENTS_PER_MINUTE = 150;
const MAX_BYTES_PER_MINUTE = 25 * 1024; // 25KB/min per client
const MAX_INTENT_BYTES = 500; // intents are stored in turns, keep them small
export type RateLimitResult = "ok" | "limit" | "kick";

interface ClientBucket {
  perSecond: RateLimiter;
  perMinute: RateLimiter;
  bytesPerMinute: RateLimiter;
  hasSentWinnerMsg: boolean;
}

export class ClientMsgRateLimiter {
  private buckets = new Map<ClientID, ClientBucket>();

  check(clientID: ClientID, type: string, bytes: number): RateLimitResult {
    const bucket = this.getOrCreate(clientID);

    // Winner message contains stats for all players and can be large (100s of KB).
    // It bypasses the byte rate limit but is strictly limited to one per client.
    if (type === "winner") {
      if (bucket.hasSentWinnerMsg) return "kick";
      bucket.hasSentWinnerMsg = true;
      return "ok";
    }

    // Intents are stored in turn history for the duration of the game, so
    // oversized intents would accumulate and fill up server RAM.
    if (type === "intent" && bytes > MAX_INTENT_BYTES) return "kick";

    if (!bucket.bytesPerMinute.tryRemoveTokens(bytes)) return "kick";

    if (
      !bucket.perSecond.tryRemoveTokens(1) ||
      !bucket.perMinute.tryRemoveTokens(1)
    )
      return "limit";

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
      bytesPerMinute: new RateLimiter({
        tokensPerInterval: MAX_BYTES_PER_MINUTE,
        interval: "minute",
      }),
      hasSentWinnerMsg: false,
    };
    this.buckets.set(clientID, bucket);
    return bucket;
  }
}
