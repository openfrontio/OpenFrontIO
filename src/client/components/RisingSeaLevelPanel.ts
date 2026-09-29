import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { risingSeaLevelState } from "../../core/game/RisingSeaLevel";
import { translateText } from "../Utils";
import { GameView } from "../view";

/**
 * The Rising sea level readout: the dry-grace countdown before the flood
 * starts, then how much of the map the sea has already taken and how long until
 * everything is under water. Embedded by game-right-sidebar so it stacks under
 * the game timer like the doomsday-clock and overtime panels.
 *
 * Everything here is derived from the game clock plus the very schedule the sim
 * floods to (RisingSeaLevel.ts), so the panel needs no wire channel of its own
 * and cannot drift from the sim. Flooding is global information, so spectators
 * and eliminated players see the full readout too.
 */
@customElement("rising-sea-level-panel")
export class RisingSeaLevelPanel extends LitElement {
  @property({ attribute: false }) game!: GameView;
  @property({ attribute: false }) hasWinner = false;
  // Bumped by the parent each tick so the countdown advances every second.
  @property({ attribute: false }) refreshKey = 0;

  // Light DOM so Tailwind classes apply and it stacks in the parent's flex.
  createRenderRoot() {
    return this;
  }

  private secondsToHms(d: number): string {
    const pad = (n: number) => (n < 10 ? `0${n}` : n);
    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const s = Math.floor((d % 3600) % 60);
    return h !== 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  render() {
    const cfg = this.game?.config().risingSeaLevelConfig();
    const visible = !!cfg?.enabled && !this.hasWinner;
    this.style.display = visible ? "block" : "none";
    if (!visible || !cfg) return html``;

    const elapsed = Math.floor(this.game.elapsedGameSeconds());
    const state = risingSeaLevelState(cfg.speed, elapsed);

    const panel =
      "w-fit flex flex-col gap-1.5 py-2 px-4 bg-gray-800/92 backdrop-blur-sm shadow-xs rounded-bl-lg text-white text-sm";

    const detail = state.inGrace
      ? translateText("rising_sea_level.starts_in", {
          time: this.secondsToHms(state.secondsToStart),
        })
      : translateText("rising_sea_level.full_in", {
          time: this.secondsToHms(state.secondsToFull),
        });

    return html`
      <div class="${panel}">
        <div class="flex items-center justify-between gap-3">
          <span class="font-bold tracking-wide text-sky-400">
            ${translateText("rising_sea_level.title")}
          </span>
          <span
            class=${state.inGrace ? "text-green-400" : "text-sky-300 font-bold"}
          >
            ${state.inGrace
              ? translateText("rising_sea_level.calm")
              : translateText("rising_sea_level.rising")}
          </span>
        </div>
        <div class="relative h-2.5 w-52 overflow-hidden rounded bg-gray-600/60">
          <!-- share of the map the sea has already taken -->
          <div
            class="absolute inset-y-0 left-0 bg-sky-400"
            style="width:${state.floodedPercent}%"
          ></div>
        </div>
        <div class="text-gray-300">
          ${translateText("rising_sea_level.submerged", {
            pct: state.floodedPercent,
          })}
        </div>
        <div class="text-xs text-gray-400">${detail}</div>
      </div>
    `;
  }
}
