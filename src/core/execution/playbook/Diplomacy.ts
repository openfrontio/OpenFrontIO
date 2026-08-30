// Diplomacy: alliances (accept, request, renew or let lapse), embargoes, and the reaction to an ended alliance.

import { Player, PlayerType } from "../../game/Game";
import { AllianceExtensionExecution } from "../alliance/AllianceExtensionExecution";
import { AllianceRequestExecution } from "../alliance/AllianceRequestExecution";
import { DonateTroopsExecution } from "../DonateTroopExecution";
import { BotContext } from "./Context";
import { Economy } from "./Economy";
import { Military } from "./Military";
import { SituationQueries } from "./Situation";

export class Diplomacy {
  private plannedTarget_: Player | null = null; // ally whose alliance we let lapse on purpose

  constructor(
    private ctx: BotContext,
    private q: SituationQueries,
    private military: Military,
    private economy: Economy,
  ) {}

  /** Ally whose alliance we let lapse on purpose (read by Military.fight / maybeBomb). */
  get plannedTarget(): Player | null {
    return this.plannedTarget_;
  }

  // ---------------------------------------------------------------- alliances
  acceptAlliances(): void {
    for (const req of this.ctx.me.incomingAllianceRequests()) {
      const r = req.requestor();
      if (r.type() === PlayerType.Bot) continue;
      if (r === this.military.currentTarget || r === this.plannedTarget_) continue;
      if (this.isPrey(r) || this.q.annexable(r)) continue;
      req.accept();
    }
  }
  /** A weaker neighbour is food: with two or more neighbours we keep the weakest one unallied so the army has somewhere to go. */
  private isPrey(o: Player): boolean {
    const me = this.ctx.me;
    // Crown, not survival: the single weakest neighbour is never allied when we can take it (2× its army within our
    // share), from 30 s on — an alliance made at 1:00 otherwise locks the whole mid game until 11:00.
    if (this.ctx.mg.ticks() < 300) return false;
    if (o.troops() < me.troops() * 0.5 && this.ctx.mg.ticks() >= 1200) return true;
    const all = [...this.q.neighbours().rivals, ...this.q.neighbours().friends].filter((p) => p.type() !== PlayerType.Bot);
    if (all.length < 2) return false;
    const weakest = all.reduce((a, b) => (b.troops() < a.troops() ? b : a));
    return o === weakest && o.troops() * 2 < me.troops() * this.ctx.p.fightMaxShare && o.numTilesOwned() <= me.numTilesOwned() * 1.5;
  }

  requestAlliances(): void {
    const me = this.ctx.me;
    const { rivals } = this.q.neighbours();
    rivals.sort((a, b) => b.troops() - a.troops());
    for (const o of rivals) {
      if (o === this.military.currentTarget || o === this.plannedTarget_) continue;
      if (this.isPrey(o) || this.q.annexable(o)) continue; // an ally can never be annexed
      if (!me.canSendAllianceRequest(o)) continue;
      this.ctx.mg.addExecution(new AllianceRequestExecution(me, o.id()));
    }
  }

  /** 30 s before an alliance ends: renew it unless the ally has become prey we can take, in which case let it lapse and queue the attack. */
  manageExpiries(): void {
    const me = this.ctx.me;
    const offset = this.ctx.mg.config().allianceExtensionPromptOffset();
    for (const al of me.alliances()) {
      const other = al.other(me);
      const left = al.expiresAt() - this.ctx.mg.ticks();
      if (left > offset || left < 0) continue;
      const { rivals, friends } = this.q.neighbours();
      const prey = (friends.includes(other) && other.troops() < me.troops() * 0.4 && me.troops() > this.q.cap() * this.ctx.p.fightAbove && rivals.length <= 1) || this.q.annexable(other) || (this.ctx.p.endgameV2 && this.q.phaseOr(9000, "endgame") && other.troops() < me.troops() * 0.5 && other.numTilesOwned() < me.numTilesOwned());
      // A Hard nation renews only if we are as strong as it, a threat to it, or on friendly terms.
      // A gift of 1/7 of its cap makes it friendly (+50): cheap insurance when we are the weaker side.
      // C1 (`nationAware`): "weaker side" = its own attack rules would let it hit us at expiry, not the 0.9× heuristic.
      const weakerSide = this.ctx.p.nationAware ? this.q.rivals.couldAttackAtExpiry(other, me.troops()).can : me.troops() < other.troops() * 0.9;
      if (this.ctx.p.nationAware && weakerSide !== me.troops() < other.troops() * 0.9) this.ctx.fire("nationAware");
      if (!prey && other.type() === PlayerType.Nation && weakerSide && me.canDonateTroops(other)) {
        const gift = Math.ceil(this.ctx.mg.config().maxTroops(other) / 7) + 1000;
        if (gift < me.troops() * 0.3 && gift <= this.ctx.mg.config().maxTroops(other) - other.troops()) {
          this.ctx.mg.addExecution(new DonateTroopsExecution(me, other.id(), gift));
          this.ctx.log(`t${this.ctx.mg.ticks()} gift ${Math.round(gift / 1000)}k troops to ${other.name()} before renewal`);
        }
      }
      if (prey) {
        this.plannedTarget_ = other;
        this.ctx.log(`t${this.ctx.mg.ticks()} let alliance with ${other.name()} lapse (${Math.round(other.troops() / 1000)}k vs our ${Math.round(me.troops() / 1000)}k)`);
        continue;
      }
      this.ctx.mg.addExecution(new AllianceExtensionExecution(me, other.id()));
    }
    if (this.plannedTarget_ && (me.isFriendly(this.plannedTarget_) === false && !this.plannedTarget_.isAlive())) this.plannedTarget_ = null;
  }
  /** Trade feeds whoever you trade with: embargo anyone attacking us or targeted by us; lift it when we ally. */
  manageEmbargoes(): void {
    const me = this.ctx.me;
    // Embargoes cost 20 relation with nations, so they are reserved for the player we are actually at war with.
    for (const e of me.getEmbargoes()) {
      const atWarWith = e.target === this.military.currentTarget && this.q.outgoingTo(e.target) !== undefined;
      if (me.isFriendly(e.target) || !e.target.isAlive() || (!atWarWith && this.ctx.mg.ticks() - (this.military.embargoedAt.get(e.target) ?? 0) > 1200)) me.stopEmbargo(e.target);
    }
  }

  /** An alliance ended (expired or broken): bring the army home, mark the post, and treat them as the threat. */
  onAllianceEnded(p: Player): void {
    const me = this.ctx.me;
    if (me.isFriendly(p)) return;
    this.ctx.log(`t${this.ctx.sit.tick} ALLIANCE ENDED ${p.name()} ${Math.round(p.troops() / 1000)}k vs our ${Math.round(this.ctx.sit.troops / 1000)}k`);
    // if they are stronger, every tribe wave comes home now — the nation attacks within seconds of a lapse
    if (p.troops() > this.ctx.sit.troops * 0.8) {
      for (const a of this.ctx.sit.outgoing) { const t = a.target(); if (t.isPlayer() && (t as Player).type() === PlayerType.Bot) this.military.retreat(a); }
    }
    this.economy.postFailed.delete(p);
  }
}
