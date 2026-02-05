import {
  Game,
  GameMode,
  Gold,
  Player,
  PlayerType,
  Relation,
  UnitType,
} from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { ConstructionExecution } from "../ConstructionExecution";
import { closestTile, closestTwoTiles } from "../Util";
import { randTerritoryTileArray } from "./NationUtils";

export class NationStructureBehavior {
  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
  ) {}

  handleUnits(): boolean {
    const hasCoastalTiles = this.hasCoastalTiles();
    const isTeamGame =
      this.game.config().gameConfig().gameMode === GameMode.Team;
    return (
      this.maybeSpawnStructure(UnitType.City, (num) => num) ||
      this.maybeSpawnStructure(UnitType.Port, (num) => num) ||
      this.maybeSpawnStructure(UnitType.Factory, (num) =>
        hasCoastalTiles ? num * 3 : num,
      ) ||
      this.maybeSpawnStructure(UnitType.DefensePost, (num) => (num + 2) ** 2) ||
      this.maybeSpawnStructure(UnitType.SAMLauncher, (num) =>
        isTeamGame ? num : num ** 2,
      ) ||
      this.maybeSpawnStructure(UnitType.MissileSilo, (num) => num ** 2)
    );
  }

  private hasCoastalTiles(): boolean {
    for (const tile of this.player.borderTiles()) {
      if (this.game.isOceanShore(tile)) return true;
    }
    return false;
  }

  private maybeSpawnStructure(
    type: UnitType,
    multiplier: (num: number) => number,
  ): boolean {
    const owned = this.player.unitsOwned(type);
    const perceivedCostMultiplier = multiplier(owned + 1);
    const realCost = this.cost(type);
    const perceivedCost = realCost * BigInt(perceivedCostMultiplier);
    if (this.player.gold() < perceivedCost) {
      return false;
    }
    const tile = this.structureSpawnTile(type);
    if (tile === null) {
      return false;
    }
    const canBuild = this.player.canBuild(type, tile);
    if (canBuild === false) {
      return false;
    }
    this.game.addExecution(new ConstructionExecution(this.player, type, tile));
    return true;
  }

  private structureSpawnTile(type: UnitType): TileRef | null {
    const tiles =
      type === UnitType.Port
        ? this.randCoastalTileArray(25)
        : randTerritoryTileArray(this.random, this.game, this.player, 25);
    if (tiles.length === 0) return null;
    const valueFunction = structureSpawnTileValue(this.game, this.player, type);
    if (valueFunction === null) return null;
    let bestTile: TileRef | null = null;
    let bestValue = 0;
    for (const t of tiles) {
      const v = valueFunction(t);
      if (v <= bestValue && bestTile !== null) continue;
      if (!this.player.canBuild(type, t)) continue;
      // Found a better tile
      bestTile = t;
      bestValue = v;
    }
    return bestTile;
  }

  private randCoastalTileArray(numTiles: number): TileRef[] {
    const tiles = Array.from(this.player.borderTiles()).filter((t) =>
      this.game.isOceanShore(t),
    );
    return Array.from(this.arraySampler(tiles, numTiles));
  }

  private *arraySampler<T>(a: T[], sampleSize: number): Generator<T> {
    if (a.length <= sampleSize) {
      // Return all elements
      yield* a;
    } else {
      // Sample `sampleSize` elements
      const remaining = new Set<T>(a);
      while (sampleSize--) {
        const t = this.random.randFromSet(remaining);
        remaining.delete(t);
        yield t;
      }
    }
  }

  private cost(type: UnitType): Gold {
    return this.game.unitInfo(type).cost(this.game, this.player);
  }
}

export function structureSpawnTileValue(
  mg: Game,
  player: Player,
  type: UnitType,
): ((tile: TileRef) => number) | null {
  const borderTiles = player.borderTiles();
  const otherUnits = player.units(type);
  // Prefer spacing structures out of atom bomb range
  const borderSpacing = mg.config().nukeMagnitudes(UnitType.AtomBomb).outer;
  const structureSpacing = borderSpacing * 2;
  switch (type) {
    case UnitType.City:
    case UnitType.Factory:
    case UnitType.MissileSilo: {
      return (tile) => {
        let w = 0;

        // Prefer higher elevations
        w += mg.magnitude(tile);

        // Prefer to be away from the border
        const [, closestBorderDist] = closestTile(mg, borderTiles, tile);
        w += Math.min(closestBorderDist, borderSpacing);

        // Prefer to be away from other structures of the same type
        const otherTiles: Set<TileRef> = new Set(
          otherUnits.map((u) => u.tile()),
        );
        otherTiles.delete(tile);
        const closestOther = closestTwoTiles(mg, otherTiles, [tile]);
        if (closestOther !== null) {
          const d = mg.manhattanDist(closestOther.x, tile);
          w += Math.min(d, structureSpacing);
        }

        // TODO: Cities and factories should consider train range limits
        return w;
      };
    }
    case UnitType.Port: {
      return (tile) => {
        let w = 0;

        // Prefer to be away from other structures of the same type
        const otherTiles: Set<TileRef> = new Set(
          otherUnits.map((u) => u.tile()),
        );
        otherTiles.delete(tile);
        const [, closestOtherDist] = closestTile(mg, otherTiles, tile);
        w += Math.min(closestOtherDist, structureSpacing);

        return w;
      };
    }
    case UnitType.DefensePost: {
      // Check if we have any non-friendly non-bot neighbors
      const hasHostileNeighbor =
        player
          .neighbors()
          .filter(
            (n): n is Player =>
              n.isPlayer() &&
              player.isFriendly(n) === false &&
              n.type() !== PlayerType.Bot,
          ).length > 0;

      // Don't build defense posts if there is no danger
      if (!hasHostileNeighbor) {
        return null;
      }

      return (tile) => {
        let w = 0;

        // Prefer higher elevations
        w += mg.magnitude(tile);

        const [closest, closestBorderDist] = closestTile(mg, borderTiles, tile);
        if (closest !== null) {
          // Prefer to be borderSpacing tiles from the border
          w += Math.max(
            0,
            borderSpacing - Math.abs(borderSpacing - closestBorderDist),
          );

          // Prefer adjacent players who are hostile
          const neighbors: Set<Player> = new Set();
          for (const tile of mg.neighbors(closest)) {
            if (!mg.isLand(tile)) continue;
            const id = mg.ownerID(tile);
            if (id === player.smallID()) continue;
            const neighbor = mg.playerBySmallID(id);
            if (!neighbor.isPlayer()) continue;
            if (neighbor.type() === PlayerType.Bot) continue;
            neighbors.add(neighbor);
          }
          for (const neighbor of neighbors) {
            w +=
              borderSpacing * (Relation.Friendly - player.relation(neighbor));
          }
        }

        // Prefer to be away from other structures of the same type
        const otherTiles: Set<TileRef> = new Set(
          otherUnits.map((u) => u.tile()),
        );
        otherTiles.delete(tile);
        const closestOther = closestTwoTiles(mg, otherTiles, [tile]);
        if (closestOther !== null) {
          const d = mg.manhattanDist(closestOther.x, tile);
          w += Math.min(d, structureSpacing);
        }

        return w;
      };
    }
    case UnitType.SAMLauncher: {
      const protectTiles: Set<TileRef> = new Set();
      for (const unit of player.units()) {
        switch (unit.type()) {
          case UnitType.City:
          case UnitType.Factory:
          case UnitType.MissileSilo:
          case UnitType.Port:
            protectTiles.add(unit.tile());
        }
      }
      const range = mg.config().defaultSamRange();
      const rangeSquared = range * range;
      return (tile) => {
        let w = 0;

        // Prefer higher elevations
        w += mg.magnitude(tile);

        // Prefer to be away from the border
        const closestBorder = closestTwoTiles(mg, borderTiles, [tile]);
        if (closestBorder !== null) {
          const d = mg.manhattanDist(closestBorder.x, tile);
          w += Math.min(d, borderSpacing);
        }

        // Prefer to be away from other structures of the same type
        const otherTiles: Set<TileRef> = new Set(
          otherUnits.map((u) => u.tile()),
        );
        otherTiles.delete(tile);
        const closestOther = closestTwoTiles(mg, otherTiles, [tile]);
        if (closestOther !== null) {
          const d = mg.manhattanDist(closestOther.x, tile);
          w += Math.min(d, structureSpacing);
        }

        // Prefer to be in range of other structures
        for (const maybeProtected of protectTiles) {
          const distanceSquared = mg.euclideanDistSquared(tile, maybeProtected);
          if (distanceSquared > rangeSquared) continue;
          w += structureSpacing;
        }

        return w;
      };
    }
    default:
      throw new Error(`Value function not implemented for ${type}`);
  }
}
