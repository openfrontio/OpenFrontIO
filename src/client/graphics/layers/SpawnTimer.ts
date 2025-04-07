import { blue, red } from "../../../core/configuration/Colors";
import { GameMode, Team } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class SpawnTimer implements Layer {
  private ratio = 0;
  private leftColor = "rgba(0, 128, 255, 0.7)";
  private rightColor = "rgba(0, 0, 0, 0.5)";

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
  ) {}

  init() {}

  tick() {
    if (this.game.inSpawnPhase()) {
      this.ratio = this.game.ticks() / this.game.config().numSpawnPhaseTurns();
      return;
    }
    if (this.game.config().gameConfig().gameMode != GameMode.Team) {
      this.ratio = 0;
      return;
    }

    const numBlueTiles = this.game
      .players()
      .filter((p) => p.team() == Team.Blue)
      .reduce((acc, p) => acc + p.numTilesOwned(), 0);

    const numRedTiles = this.game
      .players()
      .filter((p) => p.team() == Team.Red)
      .reduce((acc, p) => acc + p.numTilesOwned(), 0);

    this.ratio = numBlueTiles / (numBlueTiles + numRedTiles);
    this.leftColor = blue.toRgbString();
    this.rightColor = red.toRgbString();
  }

  shouldTransform(): boolean {
    return false;
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (this.ratio == 0) {
      return;
    }

    const barHeight = 10;
    const barBackgroundWidth = this.transformHandler.width();

    // Draw bar background
    context.fillStyle = this.rightColor;
    context.fillRect(0, 0, barBackgroundWidth, barHeight);

    context.fillStyle = this.leftColor;
    context.fillRect(0, 0, barBackgroundWidth * this.ratio, barHeight);
  }
}
