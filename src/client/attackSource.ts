import { PlayerID } from "../core/game/Game";
import { TileRef } from "../core/game/GameMap";
import { GameView, PlayerView } from "../core/game/GameView";

export async function resolveAttackSourceTile(
  game: GameView,
  player: PlayerView,
  targetId: PlayerID | null,
  clickedTile: TileRef,
): Promise<TileRef | null> {
  const { borderTiles } = await player.borderTiles();
  let bestTile: TileRef | null = null;
  let bestDistance = Infinity;

  for (const borderTile of borderTiles) {
    if (!bordersTarget(game, borderTile, targetId)) {
      continue;
    }
    const distance = game.manhattanDist(borderTile, clickedTile);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestTile = borderTile;
    }
  }

  return bestTile;
}

function bordersTarget(
  game: GameView,
  borderTile: TileRef,
  targetId: PlayerID | null,
): boolean {
  for (const neighbor of game.neighbors(borderTile)) {
    if (game.owner(neighbor).id() === targetId) {
      return true;
    }
  }
  return false;
}
