import { renderNumber } from "../../client/Utils";
import { Execution, Game, MessageType, Unit } from "../game/Game";

export class OilRigExecution implements Execution {
  private active = true;
  private mg!: Game;
  private checkOffset = 0;

  constructor(private oilRig: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.checkOffset = mg.ticks() % Math.max(1, mg.config().oilRigIncomeInterval());
  }

  tick(ticks: number): void {
    if (!this.oilRig.isActive()) {
      this.active = false;
      return;
    }

    if (this.oilRig.isUnderConstruction()) {
      return;
    }

    if (!this.shouldGenerateCoins(ticks)) {
      return;
    }

    this.generateCoins(ticks);
  }

  private shouldGenerateCoins(ticks: number): boolean {
    const interval = Math.max(1, this.mg.config().oilRigIncomeInterval());

    // TODOHERE: replace the simple timer gate with the full oil rig payout rules.
    // possible future checks:
    // - require adjacency to some resource node / offshore deposit
    // - disable output while blockaded or captured recently
    // - add warmup / depletion / storage mechanics
    void ticks;
    return (this.mg.ticks() + this.checkOffset) % interval === 0;
  }

  private generateCoins(ticks: number): void {
    const gold = this.resolveIncomeAmount();

    // TODOHERE: wire in the real oil rig economy behavior.
    // For now this method is intentionally a placeholder seam only.
    // Likely follow-up work:
    // - add gold to owner
    // - display a dedicated oil-rig income message
    // - record stats separately from trade income
    void ticks;

    if (gold <= 0n) {
      return;
    }

    this.oilRig.owner().addGold(gold, this.oilRig.tile());
    this.mg.displayMessage(
      "events_display.received_gold_from_trade",
      MessageType.RECEIVED_GOLD_FROM_TRADE,
      this.oilRig.owner().id(),
      gold,
      {
        gold: renderNumber(gold),
        name: "Oil Rig",
      },
    );
  }

  private resolveIncomeAmount() {
    // TODOHERE: this is the main balance hook for oil rig income.
    return this.mg.config().oilRigIncome(this.oilRig.level());
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
