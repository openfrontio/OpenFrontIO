import { EventBus } from "../../../core/EventBus";
import { TileRef } from "../../../core/game/GameMap";
import { GameView } from "../../../core/game/GameView";
import { PingType } from "../../../core/game/Ping";
import { MouseMoveEvent, PingSelectedEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class PingTrajectoryPreviewLayer implements Layer {
  private mousePos = { x: 0, y: 0 };
  private pingTargetTile: TileRef | null = null;
  private currentPingType: PingType | null = null;
  private lastPingUpdate: number = 0;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {}

  shouldTransform(): boolean {
    return true;
  }

  destroy() {
    this.eventBus.off(MouseMoveEvent, this.handleMouseMove);
    this.eventBus.off(PingSelectedEvent, this.handlePingSelected);
  }

  init() {
    this.eventBus.on(MouseMoveEvent, this.handleMouseMove);
    this.eventBus.on(PingSelectedEvent, this.handlePingSelected);
  }

  private handleMouseMove = (e: MouseMoveEvent) => {
    this.mousePos.x = e.x;
    this.mousePos.y = e.y;
  };

  private handlePingSelected = (e: PingSelectedEvent) => {
    this.currentPingType = e.pingType;
  };

  tick() {
    this.updatePingPreview();
  }

  renderLayer(context: CanvasRenderingContext2D) {
    this.drawPingPreview(context);
  }

  private updatePingPreview() {
    if (this.currentPingType === null) {
      this.pingTargetTile = null;
      return;
    }

    const now = performance.now();
    if (now - this.lastPingUpdate < 50) {
      return;
    }
    this.lastPingUpdate = now;

    const rect = this.transformHandler.boundingRect();
    if (!rect) {
      this.pingTargetTile = null;
      return;
    }

    const localX = this.mousePos.x - rect.left;
    const localY = this.mousePos.y - rect.top;
    const worldCoords = this.transformHandler.screenToWorldCoordinates(
      localX,
      localY,
    );

    if (!this.game.isValidCoord(worldCoords.x, worldCoords.y)) {
      this.pingTargetTile = null;
      return;
    }

    this.pingTargetTile = this.game.ref(worldCoords.x, worldCoords.y);
  }

  private getPingColor(): string {
    switch (this.currentPingType) {
      case PingType.Attack:
        return "rgba(255, 0, 0, 0.7)"; // Red
      case PingType.Retreat:
        return "rgba(0, 255, 0, 0.7)"; // Green
      case PingType.Defend:
        return "rgba(0, 0, 255, 0.7)"; // Blue
      case PingType.WatchOut:
        return "rgba(255, 255, 0, 0.7)"; // Yellow
      default:
        return "rgba(128, 128, 128, 0.7)"; // Gray fallback
    }
  }

  private static readonly PING_PREVIEW_RADIUS = 10;
  private drawPingPreview(context: CanvasRenderingContext2D) {
    if (this.currentPingType === null || this.pingTargetTile === null) {
      return;
    }

    const pingColor = this.getPingColor();

    const offsetX = -this.game.width() / 2;
    const offsetY = -this.game.height() / 2;

    const x = this.game.x(this.pingTargetTile) + offsetX;
    const y = this.game.y(this.pingTargetTile) + offsetY;

    context.save();
    context.fillStyle = pingColor;
    context.beginPath();
    context.arc(
      x,
      y,
      PingTargetPreviewLayer.PING_PREVIEW_RADIUS,
      0,
      2 * Math.PI,
    );
    context.fill();
    context.restore();
  }
}
