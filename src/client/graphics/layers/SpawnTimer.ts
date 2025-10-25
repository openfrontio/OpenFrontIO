import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameMode, Team } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

@customElement("spawn-timer")
export class SpawnTimer extends LitElement implements Layer {
  public game: GameView;
  public transformHandler: TransformHandler;

  private ratios = [0];
  private colors = ["rgba(0, 128, 255, 0.7)", "rgba(0, 0, 0, 0.5)"];

  private isVisible = false;

  @state()
  private timerText: string = "";

  private secondsToHms = (d: number): string => {
    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const s = Math.floor((d % 3600) % 60);
    let time = d === 0 ? "-" : `${s}s`;
    if (m > 0) time = `${m}m` + time;
    if (h > 0) time = `${h}h` + time;
    return time;
  };

  createRenderRoot() {
    this.style.position = "fixed";
    this.style.top = "0";
    this.style.left = "0";
    this.style.width = "100%";
    this.style.height = "7px";
    this.style.zIndex = "1000";
    this.style.pointerEvents = "none";
    return this;
  }

  init() {
    this.isVisible = true;
  }

  tick() {
    const isNukeWars =
      this.game.config().gameConfig().gameMode === GameMode.NukeWars;
    const spawnTurns = this.game.config().numSpawnPhaseTurns();
    const prepTurns = this.game.config().numPreparationPhaseTurns();
    const ticks = this.game.ticks();

    if (ticks <= spawnTurns) {
      // During spawn phase, only one segment filling full width
      this.ratios = [ticks / spawnTurns];
      this.colors = ["rgba(0, 128, 255, 0.7)"];
      this.requestUpdate();
      return;
    } else if (isNukeWars && ticks <= spawnTurns + prepTurns) {
      // Nuke Wars Prep phase
      const elapsedInPrep = ticks - spawnTurns;
      const remainingSeconds = Math.max(0, (prepTurns - elapsedInPrep) / 10);
      this.timerText = this.secondsToHms(remainingSeconds);
      this.requestUpdate();
      return;
    }

    // Existing logic for team territory ratios
    this.ratios = [];
    this.colors = [];

    if (this.game.config().gameConfig().gameMode !== GameMode.Team) {
      this.requestUpdate();
      return;
    }

    const teamTiles: Map<Team, number> = new Map();
    for (const player of this.game.players()) {
      const team = player.team();
      if (team === null) throw new Error("Team is null");
      const tiles = teamTiles.get(team) ?? 0;
      teamTiles.set(team, tiles + player.numTilesOwned());
    }

    const theme = this.game.config().theme();
    const total = sumIterator(teamTiles.values());
    if (total === 0) {
      this.requestUpdate();
      return;
    }

    for (const [team, count] of teamTiles) {
      const ratio = count / total;
      this.ratios.push(ratio);
      this.colors.push(theme.teamColor(team).toRgbString());
    }
    this.requestUpdate();
  }

  shouldTransform(): boolean {
    return false;
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    const isNukeWars =
      this.game.config().gameConfig().gameMode === GameMode.NukeWars;
    const spawnTurns = this.game.config().numSpawnPhaseTurns();
    const prepTurns = this.game.config().numPreparationPhaseTurns();
    const ticks = this.game.ticks();

    if (isNukeWars && ticks > spawnTurns && ticks <= spawnTurns + prepTurns) {
      // Display countdown timer for Nuke Wars Prep phase
      return html`
        <div
          class="w-full h-full flex justify-center items-center bg-gray-800/70 text-white text-lg font-bold"
        >
          ${this.timerText}
        </div>
      `;
    }

    if (this.ratios.length === 0 || this.colors.length === 0) {
      return html``;
    }

    if (
      !this.game.inSpawnPhase() &&
      this.game.config().gameConfig().gameMode !== GameMode.Team
    ) {
      return html``;
    }

    return html`
      <div class="w-full h-full flex z-[999]">
        ${this.ratios.map((ratio, i) => {
          const color = this.colors[i] || "rgba(0, 0, 0, 0.5)";
          return html`
            <div
              class="h-full transition-all duration-100 ease-in-out"
              style="width: ${ratio * 100}%; background-color: ${color};"
            ></div>
          `;
        })}
      </div>
    `;
  }
}

function sumIterator(values: MapIterator<number>) {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}
