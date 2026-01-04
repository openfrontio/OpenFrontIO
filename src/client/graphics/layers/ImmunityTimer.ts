import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { GameMode } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

@customElement("immunity-timer")
export class ImmunityTimer extends LitElement implements Layer {
  public game: GameView;

  private isVisible = false;
  private isActive = false;
  private progressRatio = 0;

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
    if (!this.game || !this.isVisible) {
      return;
    }

    const showTeamOwnershipBar =
      this.game.config().gameConfig().gameMode === GameMode.Team &&
      !this.game.inSpawnPhase();

    this.style.top = showTeamOwnershipBar ? "7px" : "0px";

    const immunityDuration = this.game.config().spawnImmunityDuration();
    const spawnPhaseTurns = this.game.config().numSpawnPhaseTurns();

    if (immunityDuration <= 5 * 10 || this.game.inSpawnPhase()) {
      this.setInactive();
      return;
    }

    const immunityEnd = spawnPhaseTurns + immunityDuration;
    const ticks = this.game.ticks();

    if (ticks >= immunityEnd || ticks < spawnPhaseTurns) {
      this.setInactive();
      return;
    }

    const elapsedTicks = Math.max(0, ticks - spawnPhaseTurns);
    this.progressRatio = Math.min(
      1,
      Math.max(0, elapsedTicks / immunityDuration),
    );
    this.isActive = true;
    this.requestUpdate();
  }

  private setInactive() {
    if (this.isActive) {
      this.isActive = false;
      this.requestUpdate();
    }
  }

  shouldTransform(): boolean {
    return false;
  }

  render() {
    if (!this.isVisible || !this.isActive) {
      return html``;
    }

    const widthPercent = this.progressRatio * 100;

    return html`
      <div class="w-full h-full flex z-[999]">
        <div
          class="h-full transition-all duration-100 ease-in-out"
          style="width: ${widthPercent}%; background-color: rgba(255, 165, 0, 0.9);"
        ></div>
      </div>
    `;
  }
}
