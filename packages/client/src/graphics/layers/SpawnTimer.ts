import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class SpawnTimer implements Layer {
  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
  ) {}

  init() {}
  tick() {}
  shouldTransform(): boolean {
    return false;
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (!this.game.inSpawnPhase()) {
      return;
    }

    const barHeight = 15;
    const barBackgroundWidth = this.transformHandler.width();

    const ratio = this.game.ticks() / this.game.config().numSpawnPhaseTurns();

    // Draw bar background
    context.fillStyle = "rgba(0, 0, 0, 0.5)";
    context.fillRect(0, 0, barBackgroundWidth, barHeight);

    context.fillStyle = "rgba(0, 128, 255, 0.7)";
    context.fillRect(0, 0, barBackgroundWidth * ratio, barHeight);
  }
}
