import {
  MessageType,
  PlayerType,
  Relation,
} from "@openfront/engine-api/game/GameTypes";
import {
  CallToArmsIntent,
  DonateUraniumIntent,
  MarketTradeIntent,
  SetTariffIntent,
  TradeAgreementIntent,
  TradeOfferIntent,
  TradeOfferReplyIntent,
} from "@openfront/engine-api/Schemas";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/** The BrokenFront intents that take effect at once (diplomacy and trade). */
export type InstantBrokenfrontIntent =
  | Omit<CallToArmsIntent, "clientID">
  | Omit<DonateUraniumIntent, "clientID">
  | Omit<TradeAgreementIntent, "clientID">
  | Omit<SetTariffIntent, "clientID">
  | Omit<TradeOfferIntent, "clientID">
  | Omit<TradeOfferReplyIntent, "clientID">
  | Omit<MarketTradeIntent, "clientID">;

/**
 * Applies one instant BrokenFront intent on its first tick: call to arms,
 * uranium donations, trade agreements, tariffs, resource offers and market
 * trades. All the state lives in the TradeBook or on players; this
 * execution only validates and dispatches.
 */
export class BrokenfrontIntentExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(
    private player: Player,
    private intent: InstantBrokenfrontIntent,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    this.active = false;
    if (!this.player.isAlive()) return;
    const intent = this.intent;
    switch (intent.type) {
      case "call_to_arms":
        this.callToArms(intent.target);
        return;
      case "donate_uranium":
        this.donateUranium(intent.recipient, intent.amount);
        return;
      case "trade_agreement":
        this.tradeAgreement(intent.action, intent.other);
        return;
      case "set_tariff":
        if (this.mg.config().brokenfrontFeature("tradeDeals")) {
          this.mg.trade().setTariff(this.player, intent.pct);
        }
        return;
      case "trade_offer": {
        const to = this.lookup(intent.recipient);
        if (to === null || !this.mg.config().brokenfrontFeature("tradeDeals")) {
          return;
        }
        this.mg
          .trade()
          .createOffer(
            this.player,
            to,
            intent.giveGold,
            intent.giveUranium,
            intent.wantGold,
            intent.wantUranium,
          );
        return;
      }
      case "trade_offer_reply":
        this.mg.trade().reply(this.player, intent.offerId, intent.accept);
        return;
      case "market_trade":
        this.mg.trade().marketTrade(this.player, intent.side, intent.amount);
        return;
    }
  }

  private lookup(id: string): Player | null {
    if (!this.mg.hasPlayer(id)) return null;
    const p = this.mg.player(id);
    return p === this.player ? null : p;
  }

  /**
   * Rallies every ally against `targetID`: each gets a message, and AI allies
   * that like the caller (Friendly or better) target the enemy themselves.
   */
  private callToArms(targetID: string): void {
    const target = this.lookup(targetID);
    if (target === null || !target.isAlive()) return;
    if (this.player.isFriendly(target)) return;
    const book = this.mg.trade();
    if (!book.canCallToArms(this.player)) return;
    book.recordCallToArms(this.player);
    if (this.player.canTarget(target)) {
      this.player.target(target);
    }
    for (const ally of this.player.allies()) {
      if (ally === target || ally.isFriendly(target)) continue;
      this.mg.displayMessage(
        "events_display.call_to_arms",
        MessageType.CALL_TO_ARMS,
        ally.id(),
        undefined,
        { name: this.player.displayName(), target: target.displayName() },
      );
      if (
        ally.type() !== PlayerType.Human &&
        ally.relation(this.player) >= Relation.Friendly &&
        ally.canTarget(target)
      ) {
        ally.target(target);
        target.updateRelation(ally, -40);
      }
    }
  }

  private donateUranium(recipientID: string, amount: number | null): void {
    const recipient = this.lookup(recipientID);
    if (recipient === null) return;
    if (!this.player.canDonateGold(recipient)) return;
    const give = Math.min(
      this.player.uranium(),
      amount ?? Math.floor(this.player.uranium() / 3),
    );
    if (give <= 0) return;
    this.player.removeUranium(give);
    recipient.addUranium(give);
    this.mg.displayMessage(
      "events_display.received_uranium",
      MessageType.DONATION_RECEIVED,
      recipient.id(),
      undefined,
      { name: this.player.displayName(), amount: String(give) },
    );
  }

  private tradeAgreement(
    action: TradeAgreementIntent["action"],
    otherID: string,
  ): void {
    const other = this.lookup(otherID);
    if (other === null) return;
    const book = this.mg.trade();
    switch (action) {
      case "request":
        book.request(this.player, other);
        // AI nations weigh the offer on the spot.
        if (
          other.type() === PlayerType.Nation &&
          other.relation(this.player) >= Relation.Neutral &&
          book.hasRequest(this.player, other)
        ) {
          book.accept(this.player, other);
        }
        return;
      case "accept":
        book.accept(other, this.player);
        return;
      case "reject":
        book.reject(other, this.player);
        return;
      case "cancel":
        book.cancel(this.player, other, "events_display.trade_agreement_ended");
        return;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return BrokenfrontIntentExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      player: w.player(this.player),
      intent: JSON.stringify(this.intent),
    });
  }

  restoreSnapshot(s: BrokenfrontIntentState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.player = r.player(s.player);
    this.intent = JSON.parse(s.intent) as InstantBrokenfrontIntent;
  }
}

const BrokenfrontIntentStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  player: zPlayerRef(),
  // The intent as validated JSON (plain numbers, strings and booleans).
  intent: z.string(),
});
type BrokenfrontIntentState = z.infer<typeof BrokenfrontIntentStateSchema>;

export const BrokenfrontIntentExecutionSnapshot = execSnapshotType({
  name: "BrokenfrontIntent",
  version: 1,
  schema: BrokenfrontIntentStateSchema,
  cls: () => BrokenfrontIntentExecution,
});
