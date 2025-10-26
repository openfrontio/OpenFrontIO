import { GameMapType, GameMode, TeamGameType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

export class NukeWarsTopBanner implements Layer {
  private game: GameView;

  constructor(game: GameView) {
    this.game = game;
  }

  init() {}

  tick() {}

  shouldTransform(): boolean {
    return false;
  }

  renderLayer(context: CanvasRenderingContext2D) {
    const config = this.game.config().gameConfig();
    if (!(config.gameMode === GameMode.Team && config.teamGameType === TeamGameType.NukeWars)) return;
    if (config.gameMap !== GameMapType.Baikal) return;
    const canvasWidth = context.canvas.width;
    const padding = 12;
    const fontSize = Math.max(14, Math.floor(canvasWidth * 0.02));
    context.save();
    context.font = `bold ${fontSize}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "top";

    // During spawn phase show spawn timer centered
    if (this.game.inSpawnPhase()) {
      const numSpawn = this.game.config().numSpawnPhaseTurns();
      const remainingTicks = Math.max(0, numSpawn - this.game.ticks());
      const remainingSeconds = Math.ceil(remainingTicks / 10);
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      const timeStr = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

      const textMetrics = context.measureText(timeStr);
      const textWidth = textMetrics.width;
      const rectWidth = textWidth + padding * 2;
      const rectHeight = fontSize + padding * 2;
      const x = canvasWidth / 2 - rectWidth / 2;
      const y = 8;

      context.fillStyle = "rgba(0,0,0,0.55)";
      roundRect(context, x, y, rectWidth, rectHeight, 8);
      context.fill();

      context.fillStyle = "#ffcc00";
      context.fillText(timeStr, canvasWidth / 2, y + padding);
    }

    // During preparation phase show prep countdown centered and elapsed timer top-right
    if (this.game.inPreparationPhase()) {
      const spawn = this.game.config().numSpawnPhaseTurns();
      const prep = this.game.config().numPreparationPhaseTurns();
      const remainingTicks = Math.max(0, spawn + prep - this.game.ticks());
      const remainingSeconds = Math.ceil(remainingTicks / 10);
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      const prepStr = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

      // center prep timer
      const textMetrics = context.measureText(prepStr);
      const textWidth = textMetrics.width;
      const rectWidth = textWidth + padding * 2;
      const rectHeight = fontSize + padding * 2;
      const x = canvasWidth / 2 - rectWidth / 2;
      const y = 8;

      context.fillStyle = "rgba(0,0,0,0.55)";
      roundRect(context, x, y, rectWidth, rectHeight, 8);
      context.fill();
      context.fillStyle = "#ffcc00";
      context.fillText(prepStr, canvasWidth / 2, y + padding);

      // elapsed game time (top-right)
      const elapsedSeconds = Math.floor(this.game.ticks() / 10);
      const eMinutes = Math.floor(elapsedSeconds / 60);
      const eSeconds = elapsedSeconds % 60;
      const elapsedStr = `${String(eMinutes).padStart(2, "0")}:${String(eSeconds).padStart(2, "0")}`;
      context.textAlign = "right";
      context.textBaseline = "top";
      const elTextMetrics = context.measureText(elapsedStr);
      const elRectWidth = elTextMetrics.width + padding * 2;
      const ex = canvasWidth - 8 - elRectWidth;
      const ey = 8;
      context.fillStyle = "rgba(0,0,0,0.4)";
      roundRect(context, ex, ey, elRectWidth, rectHeight, 8);
      context.fill();
      context.fillStyle = "#ffffff";
      context.fillText(elapsedStr, canvasWidth - 8 - padding, ey + padding);

      // restore text alignment for any following draws
      context.textAlign = "center";
    }

    // After preparation phase show elapsed game timer centered
    if (!this.game.inSpawnPhase() && !this.game.inPreparationPhase()) {
      const elapsedSeconds = Math.floor(this.game.ticks() / 10);
      const eMinutes = Math.floor(elapsedSeconds / 60);
      const eSeconds = elapsedSeconds % 60;
      const elapsedStr = `${String(eMinutes).padStart(2, "0")}:${String(eSeconds).padStart(2, "0")}`;
      const textMetrics = context.measureText(elapsedStr);
      const textWidth = textMetrics.width;
      const rectWidth = textWidth + padding * 2;
      const rectHeight = fontSize + padding * 2;
      const x = canvasWidth / 2 - rectWidth / 2;
      const y = 8;

      context.fillStyle = "rgba(0,0,0,0.45)";
      roundRect(context, x, y, rectWidth, rectHeight, 8);
      context.fill();
      context.fillStyle = "#ffffff";
      context.fillText(elapsedStr, canvasWidth / 2, y + padding);
    }

    context.restore();
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
