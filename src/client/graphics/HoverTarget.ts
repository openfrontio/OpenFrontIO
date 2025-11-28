import { UnitType } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { GameView, PlayerView, UnitView } from "../../core/game/GameView";

export interface HoverTargetResolution {
  player: PlayerView | null;
  unit: UnitView | null;
}

const HOVER_UNIT_TYPES: UnitType[] = [
  UnitType.Warship,
  UnitType.TradeShip,
  UnitType.TransportShip,
];

const HOVER_DISTANCE_PX = 5;

function distSquared(
  game: GameView,
  tile: TileRef,
  coord: { x: number; y: number },
): number {
  const dx = game.x(tile) - coord.x;
  const dy = game.y(tile) - coord.y;
  return dx * dx + dy * dy;
}

export function resolveHoverTarget(
  game: GameView,
  worldCoord: { x: number; y: number },
): HoverTargetResolution {
  if (!game.isValidCoord(worldCoord.x, worldCoord.y)) {
    return { player: null, unit: null };
  }
  const tile = game.ref(worldCoord.x, worldCoord.y);
  const owner = game.owner(tile);
  if ((owner as any).isPlayer?.()) {
    return { player: owner as PlayerView, unit: null };
  }

  if (game.isLand(tile)) {
    return { player: null, unit: null };
  }

  const units = game
    .units(...HOVER_UNIT_TYPES)
    .filter(
      (u) =>
        distSquared(game, u.tile(), worldCoord) <
        HOVER_DISTANCE_PX * HOVER_DISTANCE_PX,
    )
    .sort(
      (a, b) =>
        distSquared(game, a.tile(), worldCoord) -
        distSquared(game, b.tile(), worldCoord),
    );

  if (units.length > 0) {
    return { player: units[0].owner(), unit: units[0] };
  }

  return { player: null, unit: null };
}
