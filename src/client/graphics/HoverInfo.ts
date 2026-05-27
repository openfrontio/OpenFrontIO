import { UnitType } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { GameView, PlayerView, UnitView } from "../../core/game/GameView";

export type HoverInfo = {
  player: PlayerView | null;
  unit: UnitView | null;
  isWilderness: boolean;
  isIrradiatedWilderness: boolean;
};

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

function distSortUnitWorld(coord: { x: number; y: number }, game: GameView) {
  return (a: UnitView, b: UnitView) => {
    const distA = euclideanDistWorld(coord, a.tile(), game);
    const distB = euclideanDistWorld(coord, b.tile(), game);
    return distA - distB;
  };
}

export function getHoverInfo(
  game: GameView,
  worldCoord: { x: number; y: number },
): HoverInfo {
  const info: HoverInfo = {
    player: null,
    unit: null,
    isWilderness: false,
    isIrradiatedWilderness: false,
  };

  if (!game.isValidCoord(worldCoord.x, worldCoord.y)) {
    return info;
  }

  const tile = game.ref(worldCoord.x, worldCoord.y);
  const owner = game.owner(tile);

  if (owner && owner.isPlayer()) {
    info.player = owner as PlayerView;
    return info;
  }

  if (owner && !owner.isPlayer() && game.isLand(tile)) {
    info.isIrradiatedWilderness = game.hasFallout(tile);
    info.isWilderness = !info.isIrradiatedWilderness;
    return info;
  }

  if (!game.isLand(tile)) {
    const units = game
      .units(UnitType.Warship, UnitType.TradeShip, UnitType.TransportShip)
      .filter((u) => euclideanDistWorld(worldCoord, u.tile(), game) < 50)
      .sort(distSortUnitWorld(worldCoord, game));

    if (units.length > 0) {
      info.unit = units[0];
    }
  }

  return info;
}
