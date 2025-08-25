import { Game, Player, UnitType } from "../../game/Game";
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
    case UnitType.Port:
      return (tile) => {
        let w = 0;

        // Prefer to be far away from other structures of the same type
        const otherTiles: Set<TileRef> = new Set(otherUnits.map((u) => u.tile()));
        otherTiles.delete(tile);
        const closestOther = closestTwoTiles(mg, otherTiles, [tile]);
        if (closestOther !== null) {
          const d = mg.manhattanDist(closestOther.x, tile);
          w += Math.min(d, structureSpacing);
        }

        return w;
      };
    case UnitType.City:
    case UnitType.Factory:
    case UnitType.MissileSilo:
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
    default:
      throw new Error(`Value function not implemented for ${type}`);
  }
}
