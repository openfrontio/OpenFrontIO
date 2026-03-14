import { RateLimiter } from "limiter";
import { ClientID } from "../core/Schemas";

const INTENTS_PER_SECOND = 10;
const INTENTS_PER_MINUTE = 150;

export class IntentRateLimiter {
  private perSecond = new Map<ClientID, RateLimiter>();
  private perMinute = new Map<ClientID, RateLimiter>();

  tryConsume(clientID: ClientID): boolean {
    let second = this.perSecond.get(clientID);
    if (!second) {
      second = new RateLimiter({
        tokensPerInterval: INTENTS_PER_SECOND,
        interval: "second",
      });
      this.perSecond.set(clientID, second);
    }

    let minute = this.perMinute.get(clientID);
    if (!minute) {
      minute = new RateLimiter({
        tokensPerInterval: INTENTS_PER_MINUTE,
        interval: "minute",
      });
      this.perMinute.set(clientID, minute);
    }

    return second.tryRemoveTokens(1) && minute.tryRemoveTokens(1);
  }
}
