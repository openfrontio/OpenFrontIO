import { RateLimiter } from "limiter";
import { ClientID } from "../core/Schemas";

const INTENTS_PER_SECOND = 10;
const INTENTS_PER_MINUTE = 150;
const MAX_INTENT_SIZE = 2000;
const TOTAL_BYTES = 5 * 1024 * 1024; // 5MB per client
export type RateLimitResult = "ok" | "limit" | "kick";

// Per-intent-type caps for social/diplomatic actions that a human never
// legitimately issues in rapid succession. They sit *under* the global intent
// limit above: a spammy category (e.g. a scripted quick-chat loop) is throttled
// on its own without shrinking the budget available for normal high-tempo play
// like attacks, boats, or warship micro.
//
// Exceeding a per-type cap drops the single message ("limit"), it never kicks,
// so a rare burst from lag costs at most one dropped social action rather than a
// disconnect.
const PER_INTENT_LIMITS: Record<
  string,
  { perSecond: number; perMinute: number }
> = {
  quick_chat: { perSecond: 4, perMinute: 40 },
  emoji: { perSecond: 4, perMinute: 40 },
  allianceRequest: { perSecond: 3, perMinute: 30 },
  embargo: { perSecond: 5, perMinute: 40 },
  embargo_all: { perSecond: 2, perMinute: 20 },
};

interface TypeBucket {
  perSecond: RateLimiter;
  perMinute: RateLimiter;
}

interface ClientBucket {
  perSecond: RateLimiter;
  perMinute: RateLimiter;
  perIntentType: Map<string, TypeBucket>;
  totalBytes: number;
}

export class ClientMsgRateLimiter {
  private buckets = new Map<ClientID, ClientBucket>();

  /**
   * @param intentType When `type === "intent"`, the intent's own sub-type
   *   (e.g. "quick_chat"). Used to apply per-intent-type caps on top of the
   *   global intent limit. Optional so non-intent callers are unaffected.
   */
  check(
    clientID: ClientID,
    type: string,
    bytes: number,
    intentType?: string,
  ): RateLimitResult {
    const bucket = this.getOrCreate(clientID);
    bucket.totalBytes += bytes;

    if (bucket.totalBytes >= TOTAL_BYTES) return "kick";

    if (type === "intent") {
      // Intents are stored in turn history for the duration of the game, so
      // oversized intents would accumulate and fill up server RAM.
      // Intents are also sent to all players, so it increase outgoing
      // data.
      // Intents should never be larger than MAX_INTENT_SIZE, so we assume the client is malicious.
      if (bytes > MAX_INTENT_SIZE) {
        return "kick";
      }
      if (
        !bucket.perSecond.tryRemoveTokens(1) ||
        !bucket.perMinute.tryRemoveTokens(1)
      ) {
        return "limit";
      }
      // Tighter per-type cap for spammy social/diplomatic intents.
      if (intentType !== undefined) {
        const limits = PER_INTENT_LIMITS[intentType];
        if (limits !== undefined) {
          const typeBucket = this.getOrCreateTypeBucket(
            bucket,
            intentType,
            limits,
          );
          if (
            !typeBucket.perSecond.tryRemoveTokens(1) ||
            !typeBucket.perMinute.tryRemoveTokens(1)
          ) {
            return "limit";
          }
        }
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
      perIntentType: new Map<string, TypeBucket>(),
      totalBytes: 0,
    };
    this.buckets.set(clientID, bucket);
    return bucket;
  }

  private getOrCreateTypeBucket(
    bucket: ClientBucket,
    intentType: string,
    limits: { perSecond: number; perMinute: number },
  ): TypeBucket {
    const existing = bucket.perIntentType.get(intentType);
    if (existing) {
      return existing;
    }
    const typeBucket: TypeBucket = {
      perSecond: new RateLimiter({
        tokensPerInterval: limits.perSecond,
        interval: "second",
      }),
      perMinute: new RateLimiter({
        tokensPerInterval: limits.perMinute,
        interval: "minute",
      }),
    };
    bucket.perIntentType.set(intentType, typeBucket);
    return typeBucket;
  }
}
