import {
  Execution,
  Game,
  isStructureType,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";

const SPRITE_RADIUS = 16;

export class LandMineExecution implements Execution {
  private mg: Game;
  private active: boolean = true;
  private originalOwner: Player;

  constructor(private mine: Unit) {
    this.originalOwner = mine.owner();
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  tick(ticks: number): void {
    if (!this.mine.isActive()) {
      this.active = false;
      return;
    }

    // Do nothing while the structure is under construction
    if (this.mine.isUnderConstruction()) {
      return;
    }

    // Check if the mine's tile has been captured by an enemy
    const currentOwner = this.mg.owner(this.mine.tile());
    if (!currentOwner.isPlayer()) {
      // Tile is now terra nullius, delete the mine
      this.mine.delete();
      this.active = false;
      return;
    }

    // If the tile is still owned by the original owner, do nothing
    if (currentOwner === this.originalOwner) {
      return;
    }

    // If captured by an ally of the original owner, transfer ownership
    if (currentOwner.isFriendly(this.originalOwner)) {
      // Update owner without detonating
      this.originalOwner = currentOwner;
      return;
    }

    // An enemy has captured the tile - DETONATE!
    this.detonate(currentOwner);
  }

  private tilesToDestroy(attacker: Player): Set<TileRef> {
    const magnitude = this.mg.config().nukeMagnitudes(UnitType.LandMine);
    const rand = new PseudoRandom(this.mg.ticks());
    const inner2 = magnitude.inner * magnitude.inner;
    const outer2 = magnitude.outer * magnitude.outer;
    const tile = this.mine.tile();

    // Only include tiles owned by the attacker
    return this.mg.bfs(tile, (_, n: TileRef) => {
      const owner = this.mg.owner(n);
      if (!owner.isPlayer() || owner !== attacker) {
        return false;
      }
      const d2 = this.mg.euclideanDistSquared(tile, n);
      return d2 <= outer2 && (d2 <= inner2 || rand.chance(2));
    });
  }

  private detonate(attacker: Player) {
    const magnitude = this.mg.config().nukeMagnitudes(UnitType.LandMine);
    const tile = this.mine.tile();
    const toDestroy = this.tilesToDestroy(attacker);

    // Calculate max troops for death factor
    const maxTroops = this.mg.config().maxTroops(attacker);

    // Only damage the attacker's territory and troops
    for (const t of toDestroy) {
      attacker.relinquish(t);
      attacker.removeTroops(
        this.mg
          .config()
          .nukeDeathFactor(
            UnitType.AtomBomb, // Use atom bomb death factor calculation
            attacker.troops(),
            attacker.numTilesOwned(),
            maxTroops,
          ),
      );

      if (this.mg.isLand(t)) {
        this.mg.setFallout(t, true);
      }
    }

    // Also damage attacker's outgoing attacks
    attacker.outgoingAttacks().forEach((attack) => {
      const deaths = this.mg
        .config()
        .nukeDeathFactor(
          UnitType.AtomBomb,
          attack.troops(),
          attacker.numTilesOwned(),
          maxTroops,
        );
      attack.setTroops(attack.troops() - deaths);
    });

    // Destroy attacker's units in blast radius (excluding nukes in flight)
    const outer2 = magnitude.outer * magnitude.outer;
    for (const unit of this.mg.units()) {
      // Skip units not owned by the attacker
      if (unit.owner() !== attacker) {
        continue;
      }

      if (
        unit.type() !== UnitType.AtomBomb &&
        unit.type() !== UnitType.HydrogenBomb &&
        unit.type() !== UnitType.MIRVWarhead &&
        unit.type() !== UnitType.MIRV
      ) {
        if (this.mg.euclideanDistSquared(tile, unit.tile()) < outer2) {
          unit.delete(true, this.originalOwner);
        }
      }
    }

    // Notify the attacker
    this.mg.displayMessage(
      `You triggered a land mine placed by ${this.originalOwner.displayName()}!`,
      MessageType.NUKE_INBOUND,
      attacker.id(),
    );

    // Notify the mine owner
    this.mg.displayMessage(
      `Your land mine was triggered by ${attacker.displayName()}!`,
      MessageType.CAPTURED_ENEMY_UNIT,
      this.originalOwner.id(),
    );

    // Redraw buildings in the area
    this.redrawBuildings(magnitude.outer + SPRITE_RADIUS);

    // Delete the mine
    this.mine.delete(false);
    this.active = false;
  }

  private redrawBuildings(range: number) {
    const tile = this.mine.tile();
    const rangeSquared = range * range;
    for (const unit of this.mg.units()) {
      if (isStructureType(unit.type())) {
        if (this.mg.euclideanDistSquared(tile, unit.tile()) < rangeSquared) {
          unit.touch();
        }
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }
}

