import { GameMode, Team } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class SpawnTimer implements Layer {
  private ratios = [0];
  private colors = ["rgba(0, 128, 255, 0.7)", "rgba(0, 0, 0, 0.5)"];

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
  ) {}

  init() {}

  tick() {
    if (this.game.inSpawnPhase()) {
      this.ratios[0] =
        this.game.ticks() / this.game.config().numSpawnPhaseTurns();
      return;
    }

    this.ratios = [];
    this.colors = [];

    if (this.game.config().gameConfig().gameMode !== GameMode.Team) {
      return;
    }

    const teamTiles: Map<Team, number> = new Map();
    for (const player of this.game.players()) {
      const team = player.team();
      if (team === null) throw new Error("Team is null");
      const tiles = teamTiles.get(team) ?? 0;
      const sum = tiles + player.numTilesOwned();
      teamTiles.set(team, sum);
    }

    const theme = this.game.config().theme();
    const total = sumIterator(teamTiles.values());
    if (total === 0) return;
    for (const [team, count] of teamTiles) {
      const ratio = count / total;
      const color = theme.teamColor(team).toRgbString();
      this.ratios.push(ratio);
      this.colors.push(color);
    }
  }

  shouldTransform(): boolean {
    return false;
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (this.ratios === null) return;
    if (this.ratios.length === 0) return;
    if (this.colors.length === 0) return;

    const barHeight = 10;
    const barWidth = this.transformHandler.width();

    let x = 0;
    let filledRatio = 0;
    for (let i = 0; i < this.ratios.length && i < this.colors.length; i++) {
      const ratio = this.ratios[i] ?? 1 - filledRatio;
      const segmentWidth = barWidth * ratio;

      context.fillStyle = this.colors[i];
      context.fillRect(x, 0, segmentWidth, barHeight);

      x += segmentWidth;
      filledRatio += ratio;
    }
  }
}

function sumIterator(values: MapIterator<number>) {
  // To use reduce, we'd need to allocate an array:
  // return Array.from(values).reduce((sum, v) => sum + v, 0);
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}
