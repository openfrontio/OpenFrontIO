import {
  Execution,
  Game,
  Player,
  Unit,
  upgradableStructureTypes,
} from "../game/Game";
import { TileRef } from "../game/GameMap";

export class UpgradeStructureExecution implements Execution {
  private player: Player;
  private structure: Unit | null = null;
  private mg: Game;
  private active: boolean = true;

  private cost: bigint;

  constructor(
    private owner: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.hasPlayer(this.owner.id())) {
      console.warn(`UpgradeExecution: owner ${this.owner.id()} not found`);
      this.active = false;
      return;
    }
    this.player = mg.player(this.owner.id());
  }

  tick(ticks: number): void {
    if (this.structure === null) {
      this.structure =
        this.player
          .units(...upgradableStructureTypes)
          .find((unit) => unit.tile() === this.tile) ?? null;
      if (!this.structure) {
        this.active = false;
        return;
      }
      const info = this.mg.unitInfo(this.structure?.type());
      if (info.constructionDuration === undefined) {
        this.active = false;
        return;
      }
      this.cost = this.mg.unitInfo(this.structure?.type()).cost(this.player);
      if (this.player.gold() < this.cost) {
        this.active = false;
        return;
      }
      this.player.upgradeUnit(this.structure, {});
      this.active = false;
      return;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
