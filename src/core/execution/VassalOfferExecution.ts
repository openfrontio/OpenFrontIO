import { Execution, Game, MessageType, Player, PlayerID, PlayerType, UnitType } from "../game/Game";
import { GameUpdateType } from "../game/GameUpdates";
import { calculateBoundingBox, inscribed } from "../Util";
import { isClusterSurroundedBy } from "./utils/surround";

/**
  * Negotiated vassalage offer. Target auto-accepts if desperate or very long ally.
  */
export class VassalOfferExecution implements Execution {
  private active = true;
  private target: Player | null = null;
  private mg: Game | null = null;
  private expiresAt: number | null = null;
  private requestSent = false;

  constructor(
    private readonly requestor: Player,
    private readonly targetID: PlayerID,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game): void {
    if (!mg.config().vassalsEnabled()) {
      this.active = false;
      return;
    }
    if (!mg.hasPlayer(this.targetID)) {
      console.warn(`VassalOfferExecution: target ${this.targetID} not found`);
      this.active = false;
      return;
    }
    this.mg = mg;
    this.target = mg.player(this.targetID);
    if (
      this.requestor.type() === PlayerType.Bot ||
      this.target.type() === PlayerType.Bot
    ) {
      this.active = false;
      return;
    }
    this.expiresAt = mg.ticks() + mg.config().vassalOfferDuration();
  }

  // bots should accept vasslage if clearlyWeaker AND
  // have been in a long alliance or surrounded (similar to annexation but with vassals included)
  // OR are MUCH weaker and underattack or have been heavily nuked
  // nuked state estimated by bordering fallout tiles and low troop count % to max
  private shouldAccept(): boolean {
    if (!this.mg || !this.target) return false;
    if (this.target === this.requestor) return false; // if we're vassalizing ourselves
    if (this.target.overlord()) return false; // if we already have an overlord
    // Human players must explicitly accept
    if (this.target.type() === PlayerType.Human) return false;

    // Extreme weakness accepts
    const troopRatio = this.target.troops() / this.requestor.troops();
    const tileRatio = this.target.troops() / this.requestor.troops();
    const massivelyOutgunned = troopRatio < 0.1 && tileRatio < 0.1;
    if(massivelyOutgunned) return true;

    // must generally be weaker to even consider it
    const clearlyWeaker = troopRatio < 0.7 && tileRatio < 0.7;

    // Weak + Loyal: long-standing alliance or Surrounded/annex-imminent
    const alliance = this.requestor.allianceWith(this.target);
    if (alliance) {
        const longAlliance = this.mg.ticks() - alliance.createdAt() > 4 * this.mg.config().allianceDuration();
        if (clearlyWeaker && longAlliance) return true;

        // Surrounded heuristic using annex-style bounding box with allowed owners (requestor + vassals).
        // only checked if allied since they'll simply be annexed otherwise
        // TODO actually make annexation work with coordinated vassals
        const surrounded = (() => {
            const borders = this.target.borderTiles();
            if (borders.size === 0) return false;
            const allowedOwners = new Set<number>([
                this.requestor.smallID(),
                ...this.requestor.vassals().map((v) => v.smallID()),
            ]);
                return isClusterSurroundedBy(
                    this.mg,
                    borders,
                    this.target.smallID(),
                    allowedOwners,
                );
        })();
        const allianceTimeLeft = alliance.expiresAt() - this.mg.ticks() / 10;
        // surrounded and imminent annexation
        // this gives time for say a nuke to land and give them a way out
        // or an existing transport boat to land an attack etc.
        // TODO maybe instead check just prior to annexation if there's an
        // awaiting request from surrounding player/hierarchy?
        if (surrounded && allianceTimeLeft < 3) return true;
    }

    // Desperation: much weaker AND under attack or heavily Nuked
    const troopsGap = this.requestor.troops() >= this.target.troops() * 3;
    const tileGap = this.requestor.numTilesOwned() >= this.target.numTilesOwned() * 3;
    if (!(troopsGap && tileGap)) return false;

    const underAttack = this.target.incomingAttacks().some((a) => {
      const attacker = a.attacker();
      if (attacker === this.requestor) return true;
      // Treat attacks from the requestor's direct vassals as pressure too
      // (does not recurse through deeper hierarchy).
      return (
        attacker.overlord &&
        attacker.overlord() &&
        attacker.overlord()!.smallID() === this.requestor.smallID()
      );
    });
    if (troopsGap && tileGap && underAttack) return true;

    // Fallout pressure: tiles adjacent to fallout count as "nuke pressure"
    let heavilyNukedAndWeak = false;
    if (!underAttack) {
      const mg = this.mg!;
      const target = this.target!;
      let borderingFalloutCount = 0;
      const targetTiles = Array.from(target.tiles());
      const falloutThreshold = 300; // rough approximation of 1/2 hydro perimeter
      for (const t of targetTiles) {
        const neighbors = mg.neighbors(t);
        if (neighbors.some((n) => mg.hasFallout(n))) {
          borderingFalloutCount++;
          if (borderingFalloutCount >= falloutThreshold) break; // short-circuit
        }
      }
      heavilyNukedAndWeak = borderingFalloutCount >= falloutThreshold &&
        target.troops() < mg.config().maxTroops(target) * 0.3;
    }
    return heavilyNukedAndWeak;
  }

  tick(): void {
    if (this.mg === null || this.target === null) {
      throw new Error("VassalOfferExecution not initialized");
    }
    if (this.shouldAccept()) {
      this.mg.vassalize(this.target, this.requestor);
      const message = `${this.target.displayName()} accepted vassalage to ${this.requestor.displayName()}`;
      // Show to everyone with the vassal's icon
      this.mg.displayMessage(
        message,
        MessageType.VASSAL_ACCEPTED,
        this.target.id(),
        undefined,
        { target: this.requestor.displayName() },
      );
      this.mg.displayMessage(
        message,
        MessageType.VASSAL_ACCEPTED,
        this.requestor.id(),
        undefined,
        { target: this.target.displayName() },
      );
      this.active = false;
      return;
    }

    // For humans, send a single request then stop; reply is handled elsewhere.
    if (this.target.type() === PlayerType.Human && !this.requestSent) {
      this.mg.addUpdate({
        type: GameUpdateType.VassalOfferRequest,
        requestorID: this.requestor.smallID(),
        recipientID: this.target.smallID(),
      });
      this.requestSent = true;
      this.active = false;
      return;
    }

    if (this.target.type() === PlayerType.Human) {
      // Send a request message and keep the execution alive until reply/expiry.
      const message = `${this.requestor.displayName()} offered you vassalage`;
      this.mg.displayMessage(
        message,
        MessageType.VASSAL_REQUEST,
        this.target.id(),
        undefined,
        { target: this.requestor.displayName() },
      );
    }

    // Expire silently after a short duration to avoid dangling offers
    if (this.expiresAt !== null && this.mg.ticks() > this.expiresAt) {
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }
}
