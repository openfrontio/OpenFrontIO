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
      console.warn(`BoatRetreatExecution: Player ${this.playerID} not found`);
      this.active = false;
      return;
    }
    this.player = mg.player(this.playerID);
  }

  tick(ticks: number): void {
    if (!this.player) {
      console.warn(`BoatRetreatExecution: Player ${this.playerID} not found`);
      this.active = false;
      return;
    }

    const unit = this.player
      .units()
      .find(
        (unit) =>
          unit.id() === this.unitID && unit.type() === UnitType.TransportShip,
      );

    if (!unit) {
      console.warn(`Didn't find outgoing boat with id ${this.unitID}`);
      this.active = false;
      return;
    }

    unit.orderBoatRetreat();
    this.active = false;
  }

  owner(): Player {
    if (this.player === undefined) {
      throw new Error("Not initialized");
    }
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
