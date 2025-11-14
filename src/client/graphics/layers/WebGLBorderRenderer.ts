import { Theme } from "../../../core/configuration/Config";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { BorderRenderer } from "./BorderRenderer";
import {
  BorderEdge,
  TerritoryBorderWebGL,
  TileRelation,
} from "./TerritoryBorderWebGL";

export class WebGLBorderRenderer implements BorderRenderer {
  private readonly renderer: TerritoryBorderWebGL | null;

  constructor(
    private readonly game: GameView,
    private readonly theme: Theme,
  ) {
    this.renderer = TerritoryBorderWebGL.create(
      game.width(),
      game.height(),
      theme,
    );
  }

  drawsOwnBorders(): boolean {
    return true;
  }

  isSupported(): boolean {
    return this.renderer !== null;
  }

  isActive(): boolean {
    return this.renderer !== null;
  }

  setAlternativeView(enabled: boolean): void {
    this.renderer?.setAlternativeView(enabled);
  }

  setHoveredPlayerId(playerSmallId: number | null): void {
    this.renderer?.setHoveredPlayerId(playerSmallId);
  }

  setDebugPulseEnabled(enabled: boolean): void {
    this.renderer?.setDebugPulseEnabled(enabled);
  }

  updateBorder(
    tile: TileRef,
    owner: PlayerView | null,
    isBorder: boolean,
    isDefended: boolean,
    _hasFallout: boolean,
  ): void {
    if (!this.renderer) {
      return;
    }
    if (!owner || !isBorder) {
      this.renderer.clearTile(tile as number);
      return;
    }
    const edges = this.buildBorderEdges(tile, owner, isDefended);
    if (edges.length === 0) {
      this.renderer.clearTile(tile as number);
      return;
    }
    this.renderer.updateEdges(tile as number, edges);
  }

  clearTile(tile: TileRef): void {
    this.renderer?.clearTile(tile as number);
  }

  render(context: CanvasRenderingContext2D): void {
    if (!this.renderer) {
      return;
    }
    this.renderer.render();
    context.drawImage(
      this.renderer.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }

  private buildBorderEdges(
    tile: TileRef,
    owner: PlayerView,
    isDefended: boolean,
  ): BorderEdge[] {
    const edges: BorderEdge[] = [];
    const x = this.game.x(tile);
    const y = this.game.y(tile);
    const ownerId = owner.smallID();
    const relation = this.resolveRelation(owner);
    const color = owner.borderColor();
    const { hasEmbargo, hasFriendly } = owner.borderRelationFlags(tile);
    const lightTile =
      (x % 2 === 0 && y % 2 === 0) || (y % 2 === 1 && x % 2 === 1);
    const flags =
      (isDefended ? 1 : 0) |
      (hasFriendly ? 2 : 0) |
      (hasEmbargo ? 4 : 0) |
      (lightTile ? 8 : 0);

    // Inset borders by 1 tile (0.1 tiles inward) so both countries' borders can be drawn
    const inset = 0.1;

    const segments = [
      {
        dx: 0,
        dy: -1,
        startX: x + inset,
        startY: y + inset,
        endX: x + 1 - inset,
        endY: y + inset,
      },
      {
        dx: 1,
        dy: 0,
        startX: x + 1 - inset,
        startY: y + inset,
        endX: x + 1 - inset,
        endY: y + 1 - inset,
      },
      {
        dx: 0,
        dy: 1,
        startX: x + inset,
        startY: y + 1 - inset,
        endX: x + 1 - inset,
        endY: y + 1 - inset,
      },
      {
        dx: -1,
        dy: 0,
        startX: x + inset,
        startY: y + inset,
        endX: x + inset,
        endY: y + 1 - inset,
      },
    ];

    for (const segment of segments) {
      const neighborOwner = this.ownerSmallIdAt(x + segment.dx, y + segment.dy);
      if (neighborOwner === ownerId) {
        continue;
      }
      edges.push({
        startX: segment.startX,
        startY: segment.startY,
        endX: segment.endX,
        endY: segment.endY,
        color,
        ownerSmallId: ownerId,
        relation,
        flags,
      });
    }

    return edges;
  }

  private resolveRelation(owner: PlayerView | null): TileRelation {
    const myPlayer = this.game.myPlayer();
    if (!owner || !myPlayer) {
      return TileRelation.Unknown;
    }
    if (owner.smallID() === myPlayer.smallID()) {
      return TileRelation.Self;
    }
    if (owner.isFriendly(myPlayer)) {
      return TileRelation.Friendly;
    }
    if (!owner.hasEmbargo(myPlayer)) {
      return TileRelation.Neutral;
    }
    return TileRelation.Enemy;
  }

  private ownerSmallIdAt(x: number, y: number): number | null {
    if (!this.game.isValidCoord(x, y)) {
      return null;
    }
    const neighbor = this.game.ref(x, y);
    if (!this.game.hasOwner(neighbor)) {
      return null;
    }
    return this.game.ownerID(neighbor);
  }
}
