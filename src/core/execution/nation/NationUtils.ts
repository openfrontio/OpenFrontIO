import { Cell, Game, Player, Structures, UnitType } from "../../game/Game";
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

  if (p.numTilesOwned() > 0 && p.numTilesOwned() <= 100) {
    return random.randElement(Array.from(p.tiles()));
  }

  return null;
}

// Ranks candidates by structures, troop-cap headroom, and tiles (normalized), returning the juiciest
export function findJuiciestTarget(
  game: Game,
  candidates: Player[],
): Player | null {
  if (candidates.length === 0) return null;

  const stats = candidates.map((p) => {
    // Defense posts and missile silos are defensive, not a prize worth
    // capturing - only count the rest of the structures.
    const structureCount = p
      .units()
      .reduce(
        (sum, u) =>
          Structures.has(u.type()) &&
          u.type() !== UnitType.DefensePost &&
          u.type() !== UnitType.MissileSilo
            ? sum + u.level()
            : sum,
        0,
      );
    const maxTroops = game.config().maxTroops(p);
    const troopGapRatio = maxTroops > 0 ? 1 - p.troops() / maxTroops : 0;
    return {
      player: p,
      structureCount,
      troopGapRatio,
      tiles: p.numTilesOwned(),
    };
  });

  const normalize = (value: number, values: number[]): number => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return max > min ? (value - min) / (max - min) : 0;
  };
  const structureCounts = stats.map((s) => s.structureCount);
  const troopGapRatios = stats.map((s) => s.troopGapRatio);
  const tileCounts = stats.map((s) => s.tiles);

  let best: Player | null = null;
  let bestScore = -Infinity;
  for (const s of stats) {
    const juiciness =
      normalize(s.structureCount, structureCounts) +
      normalize(s.troopGapRatio, troopGapRatios) +
      normalize(s.tiles, tileCounts);
    if (juiciness > bestScore) {
      bestScore = juiciness;
      best = s.player;
    }
  }
  return best;
}
