import { Execution, Game, Player, Structures, Unit } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { BomberExecution } from "./BomberExecution";

export class AirfieldExecution implements Execution {
  private active = true;
  private mg: Game;
  private lastSpawnTick: number = -1;

  constructor(private airfield: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.lastSpawnTick = ticks;
  }

  tick(ticks: number): void {
    if (!this.airfield.isActive()) {
      this.active = false;
      return;
    }
    if (this.airfield.isUnderConstruction()) return;

    const cooldown = this.mg.config().airfieldSpawnCooldown();
    if (ticks - this.lastSpawnTick < cooldown) return;

    const target = this.findTargetTile();
    if (target === null) return;

    this.mg.addExecution(new BomberExecution(this.airfield, target));
    this.lastSpawnTick = ticks;
  }

  private findTargetTile(): TileRef | null {
    const owner = this.airfield.owner();
    const range = this.mg.config().airfieldBomberRange();
    const candidates = this.mg.nearbyUnits(
      this.airfield.tile(),
      range,
      Structures.types,
      ({ unit }) =>
        unit.owner() !== owner &&
        !owner.isFriendly(unit.owner() as Player) &&
        unit.isActive() &&
        !unit.isUnderConstruction(),
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.distSquared - b.distSquared);
    return candidates[0].unit.tile();
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
