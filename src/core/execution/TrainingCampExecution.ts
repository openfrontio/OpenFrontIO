import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class TrainingCampExecution implements Execution {
  private trainingCamp: Unit | null = null;
  private active: boolean = true;
  private game: Game;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.game = mg;
  }

  tick(ticks: number): void {
    if (this.trainingCamp === null) {
      const spawnTile = this.player.canBuild(UnitType.TrainingCamp, this.tile);
      if (spawnTile === false) {
        this.active = false;
        return;
      }
      this.trainingCamp = this.player.buildUnit(
        UnitType.TrainingCamp,
        spawnTile,
        {},
      );
    }

    if (!this.trainingCamp.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.trainingCamp.owner()) {
      this.player = this.trainingCamp.owner();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
