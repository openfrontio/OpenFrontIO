import { GameMapType, GameMode } from "../../../core/game/Game";
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
    if (config.gameMode !== GameMode.NukeWars) return;
    if (config.gameMap !== GameMapType.Baikal) return;
    if (!this.game.inSpawnPhase()) return;

    const numSpawn = this.game.config().numSpawnPhaseTurns();
    const remainingTicks = Math.max(0, numSpawn - this.game.ticks());
    // 1 second = 10 ticks (100ms per tick)
    const remainingSeconds = Math.ceil(remainingTicks / 10);
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    const timeStr = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    const canvasWidth = context.canvas.width;

    const padding = 12;
    const fontSize = Math.max(16, Math.floor(canvasWidth * 0.02));
    context.save();
    context.font = `bold ${fontSize}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "top";

    // background rounded rectangle
    const textMetrics = context.measureText(timeStr);
    const textWidth = textMetrics.width;
    const rectWidth = textWidth + padding * 2;
    const rectHeight = fontSize + padding * 2;
    const x = canvasWidth / 2 - rectWidth / 2;
    const y = 8;

    // shadow / backdrop
    context.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(context, x, y, rectWidth, rectHeight, 8);
    context.fill();

    // text
    context.fillStyle = "#ffcc00";
    context.fillText(timeStr, canvasWidth / 2, y + padding);

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
