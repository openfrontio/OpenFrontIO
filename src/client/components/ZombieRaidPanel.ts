import {
  CURE_TARGET,
  SURVIVOR_BUFF_KINDS,
  SURVIVOR_BUFF_PERCENT_PER_STACK,
  SurvivorBuffKind,
} from "@openfront/engine-lib/game/ModRules";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../Utils";
import { GameView } from "../view";

// Font Awesome Free icons (CC BY 4.0), see resources/icons/fa/LICENSE.txt.
const ICONS = {
  virus: assetUrl("icons/fa/virus.svg"),
  skull: assetUrl("icons/fa/skull.svg"),
  syringe: assetUrl("icons/fa/syringe.svg"),
  shelter: assetUrl("icons/fa/person-shelter.svg"),
} as const;

const BUFF_ICONS: Record<SurvivorBuffKind, string> = {
  medic: assetUrl("icons/fa/heart-pulse.svg"),
  scavenger: assetUrl("icons/fa/sack-dollar.svg"),
  researcher: assetUrl("icons/fa/microscope.svg"),
  gunner: assetUrl("icons/fa/crosshairs.svg"),
};

/**
 * The Zombie Raid readout: outbreak countdown, your cure progress, survivors
 * rescued and the stackable buffs they gave you. Hidden unless the mode is on.
 * Mounted by game-right-sidebar under the game timer, like the Doomsday Clock.
 */
@customElement("zombie-raid-panel")
export class ZombieRaidPanel extends LitElement {
  @property({ attribute: false }) game!: GameView;
  @property({ attribute: false }) hasWinner = false;
  // Bumped by the parent each tick so the countdown advances.
  @property({ attribute: false }) refreshKey = 0;

  createRenderRoot() {
    return this;
  }

  private mmss(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m < 10 ? `0${m}` : m}:${r < 10 ? `0${r}` : r}`;
  }

  private icon(src: string, cls = "w-4 h-4") {
    // Icons are white glyphs; the panel is dark so they read as-is.
    return html`<img src=${src} class="${cls} shrink-0" alt="" />`;
  }

  render() {
    const cfg = this.game?.config().zombieRaidConfig();
    const visible = !!cfg?.enabled && !this.hasWinner;
    this.style.display = visible ? "block" : "none";
    if (!visible || !cfg) return html``;

    const raid = this.game.zombieRaid();
    const me = this.game.myPlayer();
    const outbroken = raid?.outbroken ?? false;

    // Before the first server update, count down from the lobby setting.
    const secondsToOutbreak = raid
      ? (raid.outbreakTick - this.game.ticks()) / 10
      : cfg.outbreakMinutes * 60 - this.game.elapsedGameSeconds();

    const mine = me
      ? raid?.players.find((p) => p.smallID === me.smallID())
      : undefined;
    const curePoints = Math.min(CURE_TARGET, mine?.curePoints ?? 0);
    const curePct = Math.floor((curePoints / CURE_TARGET) * 100);
    const cured = curePoints >= CURE_TARGET;
    const panel =
      "w-fit flex flex-col gap-1.5 py-2 px-4 bg-gray-800/92 backdrop-blur-sm shadow-xs rounded-l-lg text-white text-sm";

    if (!outbroken) {
      return html`
        <div class=${panel}>
          <div class="flex items-center gap-2 font-bold text-green-300">
            ${this.icon(ICONS.virus)}
            <span>${translateText("game_settings.zombie_raid")}</span>
          </div>
          <div>
            ${translateText("zombie_raid.outbreak_in")}
            <span class="font-mono">${this.mmss(secondsToOutbreak)}</span>
          </div>
        </div>
      `;
    }

    return html`
      <div class=${panel}>
        <div class="flex items-center gap-2 font-bold text-green-400">
          ${this.icon(ICONS.skull)}
          <span>${translateText("zombie_raid.outbreak_active")}</span>
        </div>
        <div class="flex items-center gap-2">
          ${this.icon(ICONS.syringe)}
          <span
            >${translateText(cured ? "zombie_raid.cured" : "zombie_raid.cure")}</span
          >
          <div class="w-24 h-2 bg-white/15 rounded overflow-hidden">
            <div
              class="h-full ${cured ? "bg-green-400" : "bg-sky-400"}"
              style="width:${curePct}%"
            ></div>
          </div>
          <span class="font-mono text-xs">${curePct}%</span>
        </div>
        <div class="flex items-center gap-2">
          ${this.icon(ICONS.shelter)}
          <span>
            ${translateText("zombie_raid.survivors")}:
            ${raid?.survivorsRescued ?? 0}
          </span>
          <span class="text-white/60 text-xs">
            (${raid?.survivorsLeft ?? 0}
            ${translateText("zombie_raid.camps_left")})
          </span>
        </div>
        <div class="flex items-center gap-3">
          ${SURVIVOR_BUFF_KINDS.map((kind, i) => {
            const stacks = mine?.buffs[i] ?? 0;
            return html`<span
              class="flex items-center gap-1 ${stacks === 0 ? "opacity-40" : ""}"
              title="${translateText(`survivor_buff.${kind}`)}: +${
                stacks * SURVIVOR_BUFF_PERCENT_PER_STACK
              }%"
            >
              ${this.icon(BUFF_ICONS[kind], "w-3.5 h-3.5")}
              <span class="font-mono text-xs">x${stacks}</span>
            </span>`;
          })}
        </div>
      </div>
    `;
  }
}
