import { Game, Player, Relation, UnitType } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { closestTwoTiles } from "../Util";

export function structureSpawnTileValue(
  mg: Game,
  player: Player,
  type: UnitType,
): (tile: TileRef) => number {
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
        const closestBorder = closestTwoTiles(mg, borderTiles, [tile]);
        if (closestBorder !== null) {
          const d = mg.manhattanDist(closestBorder.x, tile);
          w += Math.min(d, borderSpacing);
        }

        // Prefer to be away from other structures of the same type
        const otherTiles: Set<TileRef> = new Set(otherUnits.map((u) => u.tile()));
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
        const otherTiles: Set<TileRef> = new Set(otherUnits.map((u) => u.tile()));
        otherTiles.delete(tile);
        const closestOther = closestTwoTiles(mg, otherTiles, [tile]);
        if (closestOther !== null) {
          const d = mg.manhattanDist(closestOther.x, tile);
          w += Math.min(d, structureSpacing);
        }

        return w;
      };
    }
    case UnitType.DefensePost: {
      return (tile) => {
        let w = 0;

        // Prefer higher elevations
        w += mg.magnitude(tile);

        const closestBorder = closestTwoTiles(mg, borderTiles, [tile]);
        if (closestBorder !== null) {
          // Prefer to be borderSpacing tiles from the border
          const d = mg.manhattanDist(closestBorder.x, tile);
          w += Math.max(0, borderSpacing - Math.abs(borderSpacing - d));

          // Prefer adjacent players who are hostile
          const neighbors: Set<Player> = new Set();
          for (const tile of mg.neighbors(closestBorder.x)) {
            if (!mg.isLand(tile)) continue;
            const id = mg.ownerID(tile);
            if (id === player.smallID()) continue;
            const neighbor = mg.playerBySmallID(id);
            if (!neighbor.isPlayer()) continue;
            neighbors.add(neighbor);
          }
          for (const neighbor of neighbors) {
            w += borderSpacing * (Relation.Friendly - player.relation(neighbor));
          }
        }

        // Prefer to be away from other structures of the same type
        const otherTiles: Set<TileRef> = new Set(otherUnits.map((u) => u.tile()));
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
        const otherTiles: Set<TileRef> = new Set(otherUnits.map((u) => u.tile()));
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
