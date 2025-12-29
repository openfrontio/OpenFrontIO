import { Game, MutableVassalage, Player, Tick } from "./Game";

/**
 * Directed vassalage relationship: `vassal` submits to `overlord`.
 * Tribute ratios are stored on the relation so they can be tuned per pair.
 */
export class VassalageImpl implements MutableVassalage {
  constructor(
    private readonly mg: Game,
    private readonly overlord_: Player,
    private readonly vassal_: Player,
    private readonly createdAt_: Tick,
    private goldRatio_: number,
    private troopRatio_: number,
  ) {}

  overlord(): Player {
    return this.overlord_;
  }

  vassal(): Player {
    return this.vassal_;
  }

  createdAt(): Tick {
    return this.createdAt_;
  }

  goldTributeRatio(): number {
    return this.goldRatio_;
  }

  troopTributeRatio(): number {
    return this.troopRatio_;
  }

  setGoldTributeRatio(ratio: number): void {
    this.goldRatio_ = Math.max(0, Math.min(1, ratio));
  }

  setTroopTributeRatio(ratio: number): void {
    this.troopRatio_ = Math.max(0, Math.min(1, ratio));
  }
}
