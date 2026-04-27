import { Execution, Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

/**
 * Orders a warship to retreat toward a friendly port for healing.
 * Only works with friendly ports owned by the same player.
 */
export class HealAtPortExecution implements Execution {
  constructor(
    private readonly owner: Player,
    private readonly warshipId: number,
    private readonly portTile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.isValidRef(this.portTile)) {
      console.warn(`HealAtPortExecution: port tile ${this.portTile} not valid`);
      return;
    }

    const warship = mg.unit(this.warshipId);

    if (!warship || warship.owner() !== this.owner) {
      console.warn("HealAtPortExecution: warship not found or not owned");
      return;
    }

    if (!warship.isActive()) {
      console.warn("HealAtPortExecution: warship is not active");
      return;
    }

    const isFriendlyPort = this.owner
      .units(UnitType.Port)
      .some((port) => port.tile() === this.portTile);
    if (!isFriendlyPort) {
      console.warn("HealAtPortExecution: target port is not friendly");
      return;
    }

    // Set warship to go to the port
    warship.setPatrolTile(this.portTile);
    warship.setTargetTile(this.portTile);
    warship.setWarshipState("retreating"); // Enable healing behavior
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
