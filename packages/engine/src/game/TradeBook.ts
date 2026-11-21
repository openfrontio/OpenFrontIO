import { MessageType, PlayerID, Tick } from "@openfront/engine-api/game/GameTypes";
import { TradeView } from "@openfront/engine-api/game/GameUpdates";
import {
  zInt,
  zPlayerRef,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import type { SnapshotReader, SnapshotWriter } from "../snapshot/SnapshotContext";
import type { Game, Player } from "./Game";

/**
 * BrokenFront international trade: bilateral trade agreements, per-player
 * tariffs, player-to-player resource offers, the world uranium market and
 * the call-to-arms cooldown. One book per game, snapshotted with it; every
 * list is kept in insertion order so iteration is deterministic.
 */

export interface TradeAgreement {
  a: Player;
  b: Player;
  expiresAt: Tick;
}

export interface TradeRequest {
  from: Player;
  to: Player;
  createdAt: Tick;
}

export interface TradeOffer {
  id: number;
  from: Player;
  to: Player;
  giveGold: number;
  giveUranium: number;
  wantGold: number;
  wantUranium: number;
  expiresAt: Tick;
}

export const TRADE_AGREEMENT_TICKS = 10 * 60 * 10; // 10 minutes
export const TRADE_REQUEST_TICKS = 20 * 10; // 20 seconds
export const TRADE_OFFER_TICKS = 30 * 10; // 30 seconds
export const CALL_TO_ARMS_COOLDOWN_TICKS = 30 * 10; // 30 seconds
export const ALLOWED_TARIFFS: readonly number[] = [0, 10, 25];

// World uranium market (gold per unit of uranium).
const MARKET_BASE_PRICE = 60_000;
const MARKET_MIN_PRICE = 20_000;
const MARKET_MAX_PRICE = 300_000;
const MARKET_PRICE_STEP_PER_MILLE = 15; // +1.5% per unit of net demand
const MARKET_SPREAD_PCT = 10; // buy at +10%, sell at -10%
const MARKET_DECAY_TICKS = 50; // net demand drifts 1 unit toward 0 this often

export class TradeBook {
  private agreements: TradeAgreement[] = [];
  private requests: TradeRequest[] = [];
  private offers: TradeOffer[] = [];
  private tariffs = new Map<Player, number>();
  private callToArmsAt = new Map<Player, Tick>();
  private netFlow = 0;
  private nextOfferId = 1;
  /** Bumped on any change, so player updates can skip rebuilding views. */
  private _version = 0;

  constructor(private mg: Game) {}

  version(): number {
    return this._version;
  }

  private changed(): void {
    this._version++;
  }

  // --- Agreements -------------------------------------------------------

  isPartner(a: Player, b: Player): boolean {
    if (a === b) return false;
    return this.agreements.some(
      (ag) => (ag.a === a && ag.b === b) || (ag.a === b && ag.b === a),
    );
  }

  partnersOf(p: Player): TradeAgreement[] {
    return this.agreements.filter((ag) => ag.a === p || ag.b === p);
  }

  hasRequest(from: Player, to: Player): boolean {
    return this.requests.some((r) => r.from === from && r.to === to);
  }

  canRequest(from: Player, to: Player): boolean {
    return (
      this.mg.config().brokenfrontFeature("tradeDeals") &&
      from !== to &&
      from.isAlive() &&
      to.isAlive() &&
      from.canTrade(to) &&
      !this.isPartner(from, to) &&
      !this.hasRequest(from, to)
    );
  }

  /** Proposes an agreement; a matching reverse request is accepted at once. */
  request(from: Player, to: Player): void {
    if (this.hasRequest(to, from)) {
      this.accept(to, from);
      return;
    }
    if (!this.canRequest(from, to)) return;
    this.requests.push({ from, to, createdAt: this.mg.ticks() });
    this.mg.displayMessage(
      "events_display.trade_agreement_request",
      MessageType.TRADE_DEAL,
      to.id(),
      undefined,
      { name: from.displayName() },
    );
    this.changed();
  }

  /** `to` accepts the agreement `from` proposed. */
  accept(from: Player, to: Player): void {
    const idx = this.requests.findIndex((r) => r.from === from && r.to === to);
    if (idx === -1) return;
    this.requests.splice(idx, 1);
    if (!from.canTrade(to) || this.isPartner(from, to)) {
      this.changed();
      return;
    }
    this.agreements.push({
      a: from,
      b: to,
      expiresAt: this.mg.ticks() + TRADE_AGREEMENT_TICKS,
    });
    from.updateRelation(to, 50);
    to.updateRelation(from, 50);
    for (const [p, other] of [
      [from, to],
      [to, from],
    ] as const) {
      this.mg.displayMessage(
        "events_display.trade_agreement_signed",
        MessageType.TRADE_DEAL,
        p.id(),
        undefined,
        { name: other.displayName() },
      );
    }
    this.changed();
  }

  reject(from: Player, to: Player): void {
    const before = this.requests.length;
    this.requests = this.requests.filter(
      (r) => !(r.from === from && r.to === to),
    );
    if (this.requests.length !== before) this.changed();
  }

  /** Ends any agreement (or pending request) between the two players. */
  cancel(a: Player, b: Player, reason?: string): void {
    const before = this.agreements.length + this.requests.length;
    this.agreements = this.agreements.filter(
      (ag) => !((ag.a === a && ag.b === b) || (ag.a === b && ag.b === a)),
    );
    this.requests = this.requests.filter(
      (r) => !((r.from === a && r.to === b) || (r.from === b && r.to === a)),
    );
    if (this.agreements.length + this.requests.length !== before) {
      if (reason !== undefined) {
        for (const [p, other] of [
          [a, b],
          [b, a],
        ] as const) {
          this.mg.displayMessage(
            reason,
            MessageType.TRADE_DEAL,
            p.id(),
            undefined,
            { name: other.displayName() },
          );
        }
      }
      this.changed();
    }
  }

  // --- Tariffs ------------------------------------------------------------

  tariff(p: Player): number {
    return this.tariffs.get(p) ?? 0;
  }

  setTariff(p: Player, pct: number): void {
    if (!ALLOWED_TARIFFS.includes(pct)) return;
    if (this.tariff(p) === pct) return;
    if (pct === 0) this.tariffs.delete(p);
    else this.tariffs.set(p, pct);
    this.changed();
  }

  /**
   * Splits a trade-ship payout between the source and destination port
   * owners: partners get the agreement bonus, otherwise the destination's
   * tariff moves a share from the source owner to the destination owner.
   */
  tradeShipSplit(
    src: Player,
    dst: Player,
    gold: bigint,
  ): { src: bigint; dst: bigint } {
    if (this.isPartner(src, dst)) {
      const bonus = (gold * 25n) / 100n;
      return { src: gold + bonus, dst: gold + bonus };
    }
    const pct = BigInt(this.tariff(dst));
    const levy = (gold * pct) / 100n;
    return { src: gold - levy, dst: gold + levy };
  }

  // --- Offers -------------------------------------------------------------

  offersFor(p: Player): TradeOffer[] {
    return this.offers.filter((o) => o.from === p || o.to === p);
  }

  createOffer(
    from: Player,
    to: Player,
    giveGold: number,
    giveUranium: number,
    wantGold: number,
    wantUranium: number,
  ): TradeOffer | null {
    if (from === to || !from.isAlive() || !to.isAlive()) return null;
    if (!from.canTrade(to)) return null;
    if (giveGold + giveUranium + wantGold + wantUranium === 0) return null;
    if (from.gold() < BigInt(giveGold) || from.uranium() < giveUranium) {
      return null;
    }
    // At most one open offer per pair and direction.
    this.offers = this.offers.filter((o) => !(o.from === from && o.to === to));
    const offer: TradeOffer = {
      id: this.nextOfferId++,
      from,
      to,
      giveGold,
      giveUranium,
      wantGold,
      wantUranium,
      expiresAt: this.mg.ticks() + TRADE_OFFER_TICKS,
    };
    this.offers.push(offer);
    this.mg.displayMessage(
      "events_display.trade_offer_received",
      MessageType.TRADE_DEAL,
      to.id(),
      undefined,
      { name: from.displayName() },
    );
    this.changed();
    return offer;
  }

  /**
   * `replier` answers offer `id` (only its recipient may accept; either side
   * may decline). On accept both balances are re-checked and the swap is
   * all-or-nothing.
   */
  reply(replier: Player, id: number, accept: boolean): boolean {
    const idx = this.offers.findIndex((o) => o.id === id);
    if (idx === -1) return false;
    const offer = this.offers[idx];
    if (replier !== offer.to && replier !== offer.from) return false;
    this.offers.splice(idx, 1);
    this.changed();
    if (!accept || replier !== offer.to) return false;
    const { from, to } = offer;
    if (!from.isAlive() || !to.isAlive() || !from.canTrade(to)) return false;
    if (
      from.gold() < BigInt(offer.giveGold) ||
      from.uranium() < offer.giveUranium ||
      to.gold() < BigInt(offer.wantGold) ||
      to.uranium() < offer.wantUranium
    ) {
      return false;
    }
    from.removeGold(BigInt(offer.giveGold));
    to.addGold(BigInt(offer.giveGold));
    from.removeUranium(offer.giveUranium);
    to.addUranium(offer.giveUranium);
    to.removeGold(BigInt(offer.wantGold));
    from.addGold(BigInt(offer.wantGold));
    to.removeUranium(offer.wantUranium);
    from.addUranium(offer.wantUranium);
    this.mg.displayMessage(
      "events_display.trade_offer_accepted",
      MessageType.TRADE_DEAL,
      from.id(),
      undefined,
      { name: to.displayName() },
    );
    return true;
  }

  // --- World uranium market ---------------------------------------------

  /** Mid price in gold per unit of uranium. */
  marketPrice(): number {
    const raw = Math.floor(
      (MARKET_BASE_PRICE * (1000 + MARKET_PRICE_STEP_PER_MILLE * this.netFlow)) /
        1000,
    );
    return Math.max(MARKET_MIN_PRICE, Math.min(MARKET_MAX_PRICE, raw));
  }

  marketBuyPrice(amount: number): bigint {
    return (
      (BigInt(this.marketPrice()) * BigInt(amount) * BigInt(100 + MARKET_SPREAD_PCT)) /
      100n
    );
  }

  marketSellPrice(amount: number): bigint {
    return (
      (BigInt(this.marketPrice()) * BigInt(amount) * BigInt(100 - MARKET_SPREAD_PCT)) /
      100n
    );
  }

  /** Buys or sells uranium on the world market; false if it can't. */
  marketTrade(p: Player, side: "buy" | "sell", amount: number): boolean {
    if (!this.mg.config().brokenfrontFeature("uranium")) return false;
    if (amount <= 0 || !p.isAlive()) return false;
    if (side === "buy") {
      const cost = this.marketBuyPrice(amount);
      if (p.gold() < cost) return false;
      p.removeGold(cost);
      p.addUranium(amount);
      this.netFlow += amount;
    } else {
      if (p.uranium() < amount) return false;
      const proceeds = this.marketSellPrice(amount);
      p.removeUranium(amount);
      p.addGold(proceeds);
      this.netFlow -= amount;
    }
    this.changed();
    return true;
  }

  // --- Call to arms -----------------------------------------------------

  canCallToArms(p: Player): boolean {
    const last = this.callToArmsAt.get(p);
    return last === undefined || this.mg.ticks() - last >= CALL_TO_ARMS_COOLDOWN_TICKS;
  }

  recordCallToArms(p: Player): void {
    this.callToArmsAt.set(p, this.mg.ticks());
    this.changed();
  }

  callToArmsReadyAt(p: Player): Tick {
    const last = this.callToArmsAt.get(p);
    return last === undefined ? 0 : last + CALL_TO_ARMS_COOLDOWN_TICKS;
  }

  // --- Upkeep ---------------------------------------------------------------

  /** Expires agreements, requests and offers; drifts market demand to 0. */
  tick(ticks: Tick): void {
    let dirty = false;
    const keepAgreement = (ag: TradeAgreement) => {
      if (ag.expiresAt <= ticks) {
        for (const [p, other] of [
          [ag.a, ag.b],
          [ag.b, ag.a],
        ] as const) {
          this.mg.displayMessage(
            "events_display.trade_agreement_expired",
            MessageType.TRADE_DEAL,
            p.id(),
            undefined,
            { name: other.displayName() },
          );
        }
        return false;
      }
      return ag.a.isAlive() && ag.b.isAlive() && ag.a.canTrade(ag.b);
    };
    const agreements = this.agreements.filter(keepAgreement);
    if (agreements.length !== this.agreements.length) {
      this.agreements = agreements;
      dirty = true;
    }
    const requests = this.requests.filter(
      (r) =>
        ticks - r.createdAt < TRADE_REQUEST_TICKS &&
        r.from.isAlive() &&
        r.to.isAlive(),
    );
    if (requests.length !== this.requests.length) {
      this.requests = requests;
      dirty = true;
    }
    const offers = this.offers.filter(
      (o) => o.expiresAt > ticks && o.from.isAlive() && o.to.isAlive(),
    );
    if (offers.length !== this.offers.length) {
      this.offers = offers;
      dirty = true;
    }
    if (this.netFlow !== 0 && ticks % MARKET_DECAY_TICKS === 0) {
      this.netFlow += this.netFlow > 0 ? -1 : 1;
      dirty = true;
    }
    if (dirty) this.changed();
  }

  /** What `p`'s client needs to show its trade panel. */
  viewFor(p: Player): TradeView {
    const id = (x: Player): PlayerID => x.id();
    return {
      tariffPct: this.tariff(p),
      partners: this.partnersOf(p).map((ag) => ({
        other: id(ag.a === p ? ag.b : ag.a),
        expiresAt: ag.expiresAt,
      })),
      incomingRequests: this.requests.filter((r) => r.to === p).map((r) => id(r.from)),
      outgoingRequests: this.requests.filter((r) => r.from === p).map((r) => id(r.to)),
      offers: this.offersFor(p).map((o) => ({
        id: o.id,
        from: id(o.from),
        to: id(o.to),
        giveGold: o.giveGold,
        giveUranium: o.giveUranium,
        wantGold: o.wantGold,
        wantUranium: o.wantUranium,
        expiresAt: o.expiresAt,
      })),
      marketPrice: this.marketPrice(),
      callToArmsReadyAt: this.callToArmsReadyAt(p),
    };
  }

  // --- Snapshot -------------------------------------------------------------

  snapshot(w: SnapshotWriter): TradeBookState {
    return {
      agreements: this.agreements.map((ag) => ({
        a: w.player(ag.a),
        b: w.player(ag.b),
        expiresAt: ag.expiresAt,
      })),
      requests: this.requests.map((r) => ({
        from: w.player(r.from),
        to: w.player(r.to),
        createdAt: r.createdAt,
      })),
      offers: this.offers.map((o) => ({
        id: o.id,
        from: w.player(o.from),
        to: w.player(o.to),
        giveGold: o.giveGold,
        giveUranium: o.giveUranium,
        wantGold: o.wantGold,
        wantUranium: o.wantUranium,
        expiresAt: o.expiresAt,
      })),
      tariffs: [...this.tariffs].map(([p, pct]) => [w.player(p), pct]),
      callToArmsAt: [...this.callToArmsAt].map(([p, t]) => [w.player(p), t]),
      netFlow: this.netFlow,
      nextOfferId: this.nextOfferId,
    };
  }

  restoreSnapshot(s: TradeBookState, r: SnapshotReader): void {
    this.agreements = s.agreements.map((ag) => ({
      a: r.player(ag.a),
      b: r.player(ag.b),
      expiresAt: ag.expiresAt,
    }));
    this.requests = s.requests.map((q) => ({
      from: r.player(q.from),
      to: r.player(q.to),
      createdAt: q.createdAt,
    }));
    this.offers = s.offers.map((o) => ({
      ...o,
      from: r.player(o.from),
      to: r.player(o.to),
    }));
    this.tariffs = new Map(s.tariffs.map(([p, pct]) => [r.player(p), pct]));
    this.callToArmsAt = new Map(
      s.callToArmsAt.map(([p, t]) => [r.player(p), t]),
    );
    this.netFlow = s.netFlow;
    this.nextOfferId = s.nextOfferId;
    this._version++;
  }
}

export const TradeBookSchema = z.object({
  agreements: z.array(
    z.object({ a: zPlayerRef(), b: zPlayerRef(), expiresAt: zInt() }),
  ),
  requests: z.array(
    z.object({ from: zPlayerRef(), to: zPlayerRef(), createdAt: zInt() }),
  ),
  offers: z.array(
    z.object({
      id: zInt(),
      from: zPlayerRef(),
      to: zPlayerRef(),
      giveGold: zInt(),
      giveUranium: zInt(),
      wantGold: zInt(),
      wantUranium: zInt(),
      expiresAt: zInt(),
    }),
  ),
  tariffs: z.array(z.tuple([zPlayerRef(), zInt()])),
  callToArmsAt: z.array(z.tuple([zPlayerRef(), zInt()])),
  netFlow: zInt(),
  nextOfferId: zInt(),
});
export type TradeBookState = z.infer<typeof TradeBookSchema>;
