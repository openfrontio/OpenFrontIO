import { UnitType } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { GameView, PlayerView, UnitView } from "../../core/game/GameView";

const HOVER_UNIT_TYPES: UnitType[] = [
  UnitType.Warship,
  UnitType.TradeShip,
  UnitType.TransportShip,
];
const HOVER_DISTANCE_PX = 5;

function euclideanDistWorld(
  coord: { x: number; y: number },
  tileRef: TileRef,
  game: GameView,
): number {
  const x = game.x(tileRef);
  const y = game.y(tileRef);
  const dx = coord.x - x;
  const dy = coord.y - y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distSortUnitWorld(
  coord: { x: number; y: number },
  game: GameView,
): (a: UnitView, b: UnitView) => number {
  return (a, b) => {
    const distA = euclideanDistWorld(coord, a.tile(), game);
    const distB = euclideanDistWorld(coord, b.tile(), game);
    return distA - distB;
  };
}

export interface HoverTargetResolution {
  player: PlayerView | null;
  unit: UnitView | null;
}

export function resolveHoverTarget(
  game: GameView,
  worldCoord: { x: number; y: number },
): HoverTargetResolution {
  const tile = game.ref(worldCoord.x, worldCoord.y);
  if (!tile) {
    return { player: null, unit: null };
  }

  const owner = game.owner(tile);
  if (owner && owner.isPlayer()) {
    return { player: owner as PlayerView, unit: null };
  }

  if (game.isLand(tile)) {
    return { player: null, unit: null };
  }

  const units = game
    .units(...HOVER_UNIT_TYPES)
    .filter(
      (u) => euclideanDistWorld(worldCoord, u.tile(), game) < HOVER_DISTANCE_PX,
    )
    .sort(distSortUnitWorld(worldCoord, game));

  if (units.length > 0) {
    return { player: units[0].owner(), unit: units[0] };
  }

  return { player: null, unit: null };
}
