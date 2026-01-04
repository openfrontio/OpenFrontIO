import { Cell, Game, Player } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { calculateBoundingBox } from "../../Util";

export function randTerritoryTileArray(
  random: PseudoRandom,
  mg: Game,
  player: Player,
  numTiles: number,
): TileRef[] {
  const boundingBox = calculateBoundingBox(mg, player.borderTiles());
  const tiles: TileRef[] = [];
  for (let i = 0; i < numTiles; i++) {
    const tile = randTerritoryTile(random, mg, player, boundingBox);
    if (tile !== null) {
      tiles.push(tile);
    }
  }
  return tiles;
}

function randTerritoryTile(
  random: PseudoRandom,
  mg: Game,
  p: Player,
  boundingBox: { min: Cell; max: Cell } | null = null,
): TileRef | null {
  // Prefer sampling inside the bounding box first (fast, usually good enough)
  boundingBox ??= calculateBoundingBox(mg, p.borderTiles());
  for (let i = 0; i < 100; i++) {
    const randX = random.nextInt(boundingBox.min.x, boundingBox.max.x);
    const randY = random.nextInt(boundingBox.min.y, boundingBox.max.y);
    if (!mg.isOnMap(new Cell(randX, randY))) {
      // Sanity check should never happen
      continue;
    }
    const randTile = mg.ref(randX, randY);
    if (mg.owner(randTile) === p) {
      return randTile;
    }
  }

  if (p.numTilesOwned() <= 100) {
    return random.randElement(Array.from(p.tiles()));
  }

  return null;
}
