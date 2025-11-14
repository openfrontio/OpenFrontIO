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
    const color = owner.borderColor(tile, isDefended);

    const segments = [
      {
        dx: 0,
        dy: -1,
        startX: x,
        startY: y,
        endX: x + 1,
        endY: y,
      },
      {
        dx: 1,
        dy: 0,
        startX: x + 1,
        startY: y,
        endX: x + 1,
        endY: y + 1,
      },
      {
        dx: 0,
        dy: 1,
        startX: x,
        startY: y + 1,
        endX: x + 1,
        endY: y + 1,
      },
      {
        dx: -1,
        dy: 0,
        startX: x,
        startY: y,
        endX: x,
        endY: y + 1,
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
