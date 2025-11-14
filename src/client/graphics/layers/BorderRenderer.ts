import { TileRef } from "../../../core/game/GameMap";
import { PlayerView } from "../../../core/game/GameView";

export interface BorderRenderer {
  setAlternativeView(enabled: boolean): void;
  setHoveredPlayerId(playerSmallId: number | null): void;

  updateBorder(
    tile: TileRef,
    owner: PlayerView | null,
    isBorder: boolean,
    isDefended: boolean,
    hasFallout: boolean,
  ): void;

  clearTile(tile: TileRef): void;

  render(context: CanvasRenderingContext2D): void;
}

export class NullBorderRenderer implements BorderRenderer {
  setAlternativeView() {}

  setHoveredPlayerId() {}

  updateBorder() {}

  clearTile() {}

  render() {}
}
