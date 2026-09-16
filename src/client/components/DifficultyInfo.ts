import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Difficulty } from "../../core/game/Game";
import { translateText } from "../Utils";

/**
 * Nation troop cap per difficulty, as a percentage of a human player's.
 * Locked to Config.startManpower/maxTroops by a test.
 */
export const DIFFICULTY_TROOP_PERCENT: Record<Difficulty, number> = {
  [Difficulty.Easy]: 50,
  [Difficulty.Medium]: 75,
  [Difficulty.Hard]: 100,
  [Difficulty.Impossible]: 125,
};

/** Difficulties that public games are hosted on (see MapPlaylist). */
const DIFFICULTIES_WITH_NOTE: ReadonlySet<Difficulty> = new Set([
  Difficulty.Medium,
  Difficulty.Hard,
]);

@customElement("difficulty-info")
export class DifficultyInfo extends LitElement {
  @property({ type: String }) difficultyKey = "";

  createRenderRoot() {
    return this;
  }

  render() {
    const difficulty = this.difficultyKey as Difficulty;
    const percent = DIFFICULTY_TROOP_PERCENT[difficulty];
    if (percent === undefined) return nothing;

    const key = this.difficultyKey.toLowerCase();
    const troops =
      percent === 100
        ? translateText("difficulty.info_troops_same")
        : translateText("difficulty.info_troops", { percent });

    // Same strip/bubble layout as <cosmetic-info>: the strip spans the card so
    // the bubble (right-aligned under the "?") is capped at the card's width
    // and wraps, instead of running past the modal edge and getting clipped.
    // It also stays outside the card's own button, which may not nest a control.
    return html`<div
      data-difficulty-info
      class="group/difficulty-info pointer-events-none absolute inset-x-2 top-2 z-10 flex justify-end hover:z-20 focus-within:z-20"
      @click=${(event: Event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label=${translateText("difficulty.info_label")}
        class="pointer-events-auto flex h-6 w-6 cursor-help items-center justify-center rounded-full bg-black/55 text-xs font-black text-white/80 ring-1 ring-white/20 opacity-0 transition-opacity duration-200 hover:bg-black/80 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 group-hover/difficulty-card:opacity-100 pointer-coarse:opacity-100"
      >
        ?
      </button>
      <div
        role="tooltip"
        class="pointer-events-none absolute right-0 top-8 hidden w-max max-w-full flex-col gap-1 whitespace-normal rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-left text-xs normal-case tracking-normal text-white/90 shadow-xl group-hover/difficulty-info:flex group-focus-within/difficulty-info:flex"
      >
        <div>
          ${translateText("difficulty.info", {
            smarts: translateText(`difficulty.info_smarts_${key}`),
            troops,
          })}
        </div>
        ${DIFFICULTIES_WITH_NOTE.has(difficulty)
          ? html`<div class="text-white/60">
              ${translateText(`difficulty.info_note_${key}`)}
            </div>`
          : nothing}
      </div>
    </div>`;
  }
}
