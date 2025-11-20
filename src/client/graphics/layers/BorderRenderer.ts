import { TileRef } from "../../../core/game/GameMap";
import { PlayerView } from "../../../core/game/GameView";

export interface BorderRenderer {
  setAlternativeView(enabled: boolean): void;
  setHoveredPlayerId(playerSmallId: number | null): void;
  drawsOwnBorders(): boolean;

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
  drawsOwnBorders(): boolean {
    return false;
  }

  setAlternativeView() {}

  setHoveredPlayerId() {}

  updateBorder() {}

  clearTile() {}

  render() {}
}
