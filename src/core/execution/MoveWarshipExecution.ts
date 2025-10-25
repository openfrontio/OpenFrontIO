import {
  Execution,
  Game,
  GameMapType,
  GameMode,
  Player,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";

export class MoveWarshipExecution implements Execution {
  constructor(
    private readonly owner: Player,
    private readonly unitId: number,
    private readonly position: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.isValidRef(this.position)) {
      console.warn(`MoveWarshipExecution: position ${this.position} not valid`);
      return;
    }
    const warship = this.owner
      .units(UnitType.Warship)
      .find((u) => u.id() === this.unitId);
    if (!warship) {
      console.warn("MoveWarshipExecution: warship not found");
      return;
    }
    if (!warship.isActive()) {
      console.warn("MoveWarshipExecution: warship is not active");
      return;
    }
    // In Nuke Wars on Baikal, prevent assigning patrols that cross the midpoint.
    const gc = mg.config().gameConfig();
    if (
      gc.gameMode === GameMode.NukeWars &&
      gc.gameMap === GameMapType.Baikal
    ) {
      const mapWidth = mg.width();
      const wantLeft = this.owner.smallID() % 2 === 1;
      const posLeft = mg.x(this.position) < Math.floor(mapWidth / 2);
      if (wantLeft !== posLeft) {
        // reject the move
        console.warn(
          "MoveWarshipExecution: cannot assign warship patrol across midpoint in Nuke Wars",
        );
        return;
      }
    }

    warship.setPatrolTile(this.position);
    warship.setTargetTile(undefined);
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
