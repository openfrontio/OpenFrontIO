import {
  Execution,
  Game,
  MAX_MISSILE_BARRAGE_ROCKETS,
  MISSILE_BARRAGE_STRUCTURE_TYPES,
  MissileBarrageStructureType,
  MissileBarrageTargetMode,
  Player,
  PlayerID,
  Structures,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { randTerritoryTileArray } from "./nation/NationUtils";
import { NukeExecution } from "./NukeExecution";

export class MissileBarrageExecution implements Execution {
  private game: Game;
  private active = true;

  constructor(
    private player: Player,
    private targetID: PlayerID,
    private requestedAmount: number,
    private mode: MissileBarrageTargetMode,
    private targetTypes: MissileBarrageStructureType[] = [],
  ) {}

  init(game: Game, ticks: number): void {
    this.game = game;
  }

  tick(ticks: number): void {
    this.active = false;
    if (
      !this.player.isAlive() ||
      this.game.config().isUnitDisabled(UnitType.MIRV) ||
      this.game.config().isUnitDisabled(UnitType.AtomBomb)
    ) {
      return;
    }

    let target: Player;
    try {
      target = this.game.player(this.targetID);
    } catch {
      return;
    }
    if (
      !target.isAlive() ||
      target === this.player ||
      this.player.isOnSameTeam(target)
    ) {
      return;
    }

    const cost = this.game
      .unitInfo(UnitType.AtomBomb)
      .cost(this.game, this.player);
    const ready = this.readyMissileCount();
    const affordable =
      cost === 0n
        ? MAX_MISSILE_BARRAGE_ROCKETS
        : Number(this.player.gold() / cost);
    const amount = Math.min(
      Math.max(0, Math.floor(this.requestedAmount)),
      ready,
      affordable,
      MAX_MISSILE_BARRAGE_ROCKETS,
    );
    if (amount === 0) return;

    const targets = this.resolveTargets(target, amount);
    if (targets.length === 0) return;
    for (let i = 0; i < amount; i++) {
      this.game.addExecution(
        new NukeExecution(
          UnitType.AtomBomb,
          this.player,
          targets[i % targets.length],
        ),
      );
    }
  }

  private readyMissileCount(): number {
    return this.player
      .units(UnitType.MissileSilo)
      .filter((silo) => silo.isActive() && !silo.isUnderConstruction())
      .reduce(
        (sum, silo) =>
          sum + Math.max(0, silo.level() - silo.missileTimerQueue().length),
        0,
      );
  }

  private resolveTargets(target: Player, amount: number): TileRef[] {
    if (this.mode === "territory") {
      const random = new PseudoRandom(
        this.game.ticks() +
          simpleHash(this.player.id()) +
          simpleHash(target.id()),
      );
      const sampled = randTerritoryTileArray(
        random,
        this.game,
        target,
        Math.max(amount * 2, 20),
      );
      const unique = [...new Set(sampled)].filter(
        (tile) => this.game.owner(tile) === target,
      );
      if (unique.length === 0) {
        for (const tile of target.tiles()) {
          unique.push(tile);
          if (unique.length >= amount) break;
        }
      }
      const minimumSpread = this.game
        .config()
        .nukeMagnitudes(UnitType.AtomBomb).outer;
      const minimumSpreadSquared = minimumSpread * minimumSpread;
      const spread: TileRef[] = [];
      const nearby: TileRef[] = [];
      for (const tile of unique) {
        if (
          spread.every(
            (chosen) =>
              this.game.euclideanDistSquared(chosen, tile) >=
              minimumSpreadSquared,
          )
        ) {
          spread.push(tile);
        } else {
          nearby.push(tile);
        }
      }
      return [...spread, ...nearby];
    }

    const allowed = new Set(MISSILE_BARRAGE_STRUCTURE_TYPES);
    const types =
      this.mode === "all_buildings"
        ? Structures.types
        : this.targetTypes.filter((type) => allowed.has(type));
    if (types.length === 0) return [];
    return target
      .units(types)
      .filter((unit) => unit.isActive())
      .sort((a, b) => a.id() - b.id())
      .map((unit) => unit.tile());
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
