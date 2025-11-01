import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { Difficulty, GameMapType, GameMode } from "../../../core/game/Game";

@customElement("settings-summary")
export class SettingsSummary extends LitElement {
  @property({ type: String }) selectedMap: GameMapType = GameMapType.World;
  @property({ type: String }) selectedDifficulty: Difficulty =
    Difficulty.Medium;
  @property({ type: String }) gameMode: GameMode = GameMode.FFA;
  @property({ type: Number }) bots = 0;
  @property({ type: Boolean }) useRandomMap = false;

  private keyOf(enumObj, value) {
    return Object.keys(enumObj).find((k) => enumObj[k] === value) ?? "";
  }

  createRenderRoot() {
    return this;
  }

  render() {
    const mapKey = this.keyOf(GameMapType, this.selectedMap);
    const diffKey = this.keyOf(Difficulty, this.selectedDifficulty);
    return html`
      <section
        class="rounded-xl border border-white/15 bg-white/5 p-4 md:p-5 text-zinc-100"
      >
        <dl class="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
          <div class="space-y-1">
            <dt class="text-xs text-zinc-300">${translateText("map.map")}</dt>
            <dd class="font-semibold">
              ${this.useRandomMap
                ? translateText("map.random")
                : translateText(`map.${mapKey.toLowerCase()}`)}
            </dd>
          </div>
          <div class="space-y-1">
            <dt class="text-xs text-zinc-300">
              ${translateText("difficulty.difficulty")}
            </dt>
            <dd class="font-semibold">
              ${translateText(`difficulty.${diffKey}`)}
            </dd>
          </div>
          <div class="space-y-1">
            <dt class="text-xs text-zinc-300">
              ${translateText("settings_summary.mode")}
            </dt>
            <dd class="font-semibold">
              ${this.gameMode === GameMode.FFA
                ? translateText("game_mode.ffa")
                : translateText("game_mode.teams")}
            </dd>
          </div>
          <div class="space-y-1">
            <dt class="text-xs text-zinc-300">
              ${translateText("settings_summary.bots")}
            </dt>
            <dd class="font-semibold">${this.bots}</dd>
          </div>
        </dl>
      </section>
    `;
  }
}
