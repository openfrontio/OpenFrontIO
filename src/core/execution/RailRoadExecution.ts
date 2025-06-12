import { Execution, Game } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { GameUpdateType } from "../game/GameUpdates";
import { RailRoad } from "../game/RailNetwork";

export class RailRoadExecution implements Execution {
  private mg: Game;
  private active: boolean = true;
  private headIndex: number = 0;
  private tailIndex: number = 0;
  private increment: number = 3;
  constructor(private railRoad: RailRoad) {
    this.tailIndex = railRoad.tiles.length;
  }

  isActive(): boolean {
    return this.active;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.mg === null) {
      throw new Error("Not initialized");
    }
    if (!this.activeSourceOrDestination() || this.headIndex > this.tailIndex) {
      this.active = false;
      return;
    }

    let tiles: TileRef[];
    // Check if remaining tiles can be done all at once
    if (this.tailIndex - this.headIndex <= 2 * this.increment) {
      tiles = this.railRoad.tiles.slice(this.headIndex, this.tailIndex);
      this.active = false;
    } else {
      tiles = this.railRoad.tiles.slice(
        this.headIndex,
        this.headIndex + this.increment,
      );
      tiles = tiles.concat(
        this.railRoad.tiles.slice(
          this.tailIndex - this.increment,
          this.tailIndex,
        ),
      );
      this.headIndex += 3;
      this.tailIndex -= 3;
    }
    if (tiles) {
      this.mg.addUpdate({
        type: GameUpdateType.RailRoadEvent,
        isActive: true,
        tiles: tiles,
      });
    }
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private activeSourceOrDestination(): boolean {
    return this.railRoad.from.isActive() && this.railRoad.to.isActive();
  }
}
