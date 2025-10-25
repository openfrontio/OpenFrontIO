import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameMode } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

@customElement("nukewars-prep-timer")
export class NukeWarsPrepTimer extends LitElement implements Layer {
  public game: GameView;

  @state()
  private timer: number = 0;

  private isVisible = false;

  createRenderRoot() {
    this.style.position = "fixed";
    this.style.top = "10px"; // Adjust position as needed
    this.style.left = "50%";
    this.style.transform = "translateX(-50%)";
    this.style.zIndex = "1001"; // Above other elements
    this.style.pointerEvents = "none";
    return this;
  }

  init() {
    this.isVisible = false; // Only visible during Nuke Wars prep phase
  }

  tick() {
    const isNukeWars =
      this.game.config().gameConfig().gameMode === GameMode.NukeWars;
    const spawnTurns = this.game.config().numSpawnPhaseTurns();
    const prepTurns = this.game.config().numPreparationPhaseTurns();
    const ticks = this.game.ticks();

    if (isNukeWars && ticks > spawnTurns && ticks <= spawnTurns + prepTurns) {
      this.isVisible = true;
      const elapsedInPrep = ticks - spawnTurns;
      this.timer = Math.max(0, (prepTurns - elapsedInPrep) / 10);
    } else {
      this.isVisible = false;
    }
  }

  private secondsToHms = (d: number): string => {
    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const s = Math.floor((d % 3600) % 60);
    let time = d === 0 ? "-" : `${s}s`;
    if (m > 0) time = `${m}m` + time;
    if (h > 0) time = `${h}h` + time;
    return time;
  };

  render() {
    if (!this.isVisible) {
      return html``;
    }

    return html`
      <div
        class="w-[70px] h-8 lg:w-24 lg:h-10 border border-slate-400 p-0.5 text-xs md:text-sm lg:text-base flex items-center justify-center text-white px-1"
        style="${this.timer < 60 ? "color: #ff8080;" : ""}"
      >
        ${this.secondsToHms(this.timer)}
      </div>
    `;
  }
}
