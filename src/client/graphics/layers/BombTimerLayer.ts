import { UnitType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { translateText } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class BombTimerLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D | null;

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
  ) {
    this.canvas = document.createElement("canvas");
    this.context = this.canvas.getContext("2d");
    this.redraw();
  }

  shouldTransform(): boolean {
    return true;
  }

  init() {
    // No initialization needed
  }

  tick() {
    this.redraw();
  }

  renderLayer(context: CanvasRenderingContext2D) {
    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }

  redraw() {
    if (this.context === null) {
      return;
    }

    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();

    // Clear the canvas
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      return;
    }

    // Find all active bombs (AtomBomb and HydrogenBomb only)
    const bombs = this.game
      .units()
      .filter(
        (unit) =>
          (unit.type() === UnitType.AtomBomb ||
            unit.type() === UnitType.HydrogenBomb) &&
          unit.isActive() &&
          unit.targetTile() !== undefined &&
          unit.trajectoryIndex() !== undefined &&
          unit.trajectoryLength() !== undefined,
      );

    for (const bomb of bombs) {
      const targetTile = bomb.targetTile();
      if (!targetTile) continue;

      const trajectoryIndex = bomb.trajectoryIndex();
      const trajectoryLength = bomb.trajectoryLength();
      if (trajectoryIndex === undefined || trajectoryLength === undefined) {
        continue;
      }

      // Calculate remaining ticks and seconds
      const remainingTicks = trajectoryLength - trajectoryIndex;
      const remainingSeconds = Math.max(0, Math.ceil(remainingTicks / 10));

      // Determine if bomb is outbound (launched by my player or teammate) or inbound (targeting my player or teammate)
      const isOutbound =
        bomb.owner() === myPlayer || myPlayer.isOnSameTeam(bomb.owner());
      const targetOwner = this.game.owner(targetTile);
      const isInbound =
        targetOwner.isPlayer() &&
        (targetOwner.id() === myPlayer.id() ||
          myPlayer.isOnSameTeam(targetOwner));

      // Only show timer for bombs that are either outbound or inbound
      if (!isOutbound && !isInbound) {
        continue;
      }

      // Get world coordinates of target tile
      const worldX = this.game.x(targetTile);
      const worldY = this.game.y(targetTile);

      // Draw timer text
      const incomingText = isInbound
        ? translateText("bomb_timer.incoming")
        : "";
      const impactText = translateText("bomb_timer.til_impact", {
        seconds: remainingSeconds,
      });
      const text = incomingText ? `${incomingText} ${impactText}` : impactText;

      // Set text style
      this.context.font = "bold 10px sans-serif";
      this.context.textAlign = "center";
      this.context.textBaseline = "middle";

      // Measure text for background sizing
      const textMetrics = this.context.measureText(text);
      const padding = 3;
      const bgWidth = textMetrics.width + padding * 2;
      const bgHeight = 12 + padding * 2;
      const offsetY = 25; // Offset further up to avoid blocking

      const bgX = worldX - bgWidth / 2;
      const bgY = worldY - offsetY - bgHeight / 2;

      // Draw transparent background
      this.context.fillStyle = "rgba(0, 0, 0, 0.4)";
      this.context.fillRect(bgX, bgY, bgWidth, bgHeight);

      // Set text color based on direction
      if (isInbound) {
        // Red for inbound
        this.context.fillStyle = "#ff6666";
        this.context.strokeStyle = "rgba(0, 0, 0, 0.5)";
      } else {
        // Yellow/orange for outbound
        this.context.fillStyle = "#ffcc66";
        this.context.strokeStyle = "rgba(0, 0, 0, 0.5)";
      }

      // Draw text with lighter stroke for less blocking
      this.context.lineWidth = 1;
      this.context.strokeText(text, worldX, worldY - offsetY);
      this.context.fillText(text, worldX, worldY - offsetY);
    }
  }
}
