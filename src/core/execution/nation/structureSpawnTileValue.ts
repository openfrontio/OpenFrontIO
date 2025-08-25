import { Game, Player, Unit, UnitType } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { closestTwoTiles } from "../Util";

// Prefer to be away from other structures of the same type
function distanceStructureFromSimilars(otherUnits: Unit[], tile: TileRef, mg: Game, w: number,
  structureSpacing: number) {
  const otherTiles: Set<TileRef> = new Set(otherUnits.map((u) => u.tile()));
  otherTiles.delete(tile);
  const closestOther = closestTwoTiles(mg, otherTiles, [tile]);
  if (closestOther !== null) {
    const d = mg.manhattanDist(closestOther.x, tile);
    w += Math.min(d, structureSpacing);
  }
  return w;
}

// Prefer to be away from the border
function distanceStructureFromBorder(borderTiles: ReadonlySet<TileRef>, tile: TileRef, mg: Game,
  w: number, borderSpacing: number) {
  const closestBorder = closestTwoTiles(mg, borderTiles, [tile]);
  if (closestBorder !== null) {
    const d = mg.manhattanDist(closestBorder.x, tile);
    w += Math.min(d, borderSpacing);
  }
  return w;
}

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
    case UnitType.Port:
      return (tile) => {
        // Prefer to be away from other structures of the same type
        return distanceStructureFromSimilars(otherUnits, tile, mg, 0, structureSpacing);
      };
    case UnitType.City:
    case UnitType.Factory:
    case UnitType.MissileSilo:
      return (tile) => {
        let w = 0;

        // Prefer higher elevations
        w += mg.magnitude(tile);

        // Prefer to be away from the border
        w = distanceStructureFromBorder(borderTiles, tile, mg, w, borderSpacing);

        // TODO: Cities and factories should consider train range limits
        // Prefer to be away from other structures of the same type
        return distanceStructureFromSimilars(otherUnits, tile, mg, w, structureSpacing);
      };
    case UnitType.SAMLauncher:
      const structureTiles: TileRef[] = [];
      for (const unit of player.units()) {
        switch(unit.type()) {
          case UnitType.City:
          case UnitType.Factory:
          case UnitType.MissileSilo:
          case UnitType.Port:
          case UnitType.DefensePost:
          case UnitType.SAMLauncher:
            structureTiles.push(unit.tile());

        }
      }
      return (tile) => {
        if (player === null) throw new Error("Not initialised.");
        let w = 0;

        // According to the inner radius of a hydrogen bomb around each structure:
        // - Increase points for how much closer the tile is to the structure
        // in relation to the perimeter.
        // - Decrease points for how much farther the tile is to the structure
        // in relation to the perimeter.
        // This pushes the nation to focus SAMs in a "goldilocks zone" that is neither
        // too close nor too far from their structure clusters.
        const hydrogenSpacing = mg.config().nukeMagnitudes(UnitType.HydrogenBomb).inner;

        for (const certainTile of structureTiles) {
          const dx = mg.x(certainTile) - mg.x(tile);
          const dy = mg.y(certainTile) - mg.y(tile);
          const distanceMagnitude = dx * dx + dy * dy;
          if (distanceMagnitude > hydrogenSpacing) { w -= (distanceMagnitude - hydrogenSpacing); }
          else if (distanceMagnitude < hydrogenSpacing) { w += (hydrogenSpacing - distanceMagnitude); }
        }

        // Prefer higher elevations
        w += mg.magnitude(tile);

        // Prefer to be away from border.
        return distanceStructureFromBorder(borderTiles, tile, mg, w, borderSpacing);
      };
    default:
      throw new Error(`Value function not implemented for ${type}`);
  }
}
