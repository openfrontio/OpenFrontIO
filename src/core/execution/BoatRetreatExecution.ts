import { consolex } from "../Consolex";
import { Execution, Game, Player, PlayerID, UnitType } from "../game/Game";

export class BoatRetreatExecution implements Execution {
  private active = true;
  private player: Player | undefined;
  constructor(
    private playerID: PlayerID,
    private unitID: number,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.playerID)) {
      console.warn(
        `BoatRetreatExecution: Player ${this.player.id()} not found`,
      );
      this.active = false;
      return;
    }
    this.player = mg.player(this.playerID);
  }

  tick(ticks: number): void {
    const unit = this.player
      .units()
      .find(
        (unit) =>
          unit.id() == this.unitID && unit.type() == UnitType.TransportShip,
      );

    if (!unit) {
      consolex.warn(`Didn't find outgoing boat with id ${this.unitID}`);
      return;
    }

    unit.orderBoatRetreat();
    this.active = false;
  }

  owner(): Player {
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
