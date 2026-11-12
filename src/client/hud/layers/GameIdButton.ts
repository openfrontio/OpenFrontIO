import { html, type TemplateResult } from "lit";
import "../../components/OfIcon";
import { translateText } from "../../Utils";
import { keepPressKeysFromGame } from "../HudKeys";

// Look. Sizes, colours, radii and spacing of each part live here, so a
// change of look is one edit. The templates below only hold structure.
// The ID sits in the bar's top end corner, out of the icons' way. It and
// "Copied!" share one grid cell, so the button keeps its width.
const BUTTON =
  "group ms-auto grid h-6 shrink-0 self-start place-items-center rounded-md px-2 text-[11px] leading-4 tabular-nums text-white/70 cursor-copy select-all transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-aquarius";
const ID =
  "col-start-1 row-start-1 transition-opacity duration-150 motion-reduce:transition-none group-data-copied:opacity-0";
const COPIED =
  "col-start-1 row-start-1 inline-flex items-center gap-1 font-semibold text-aquarius opacity-0 group-data-copied:animate-hud-copied motion-reduce:group-data-copied:animate-hud-copied-swap";

/** The game ID as a button that copies it. "Copied!" shows in its place for
 *  as long as its animation runs, so the button holds no state of its own. */
export function gameIdButton(id: string, className = ""): TemplateResult {
  return html`
    <button
      type="button"
      class="${BUTTON} ${className}"
      data-game-id
      translate="no"
      title=${translateText("common.click_to_copy")}
      aria-label=${`${translateText("help_modal.game_id_tooltip")} ${id}`}
      @mousedown=${(e: MouseEvent) => {
        // Without a clipboard the ID is copied by hand, so let the press
        // select it.
        if (navigator.clipboard) e.preventDefault();
      }}
      @click=${(e: MouseEvent) => {
        const button = e.currentTarget as HTMLElement;
        navigator.clipboard?.writeText(id).then(
          () => button.toggleAttribute("data-copied", true),
          () => {},
        );
      }}
      @animationend=${(e: AnimationEvent) =>
        (e.currentTarget as HTMLElement).removeAttribute("data-copied")}
      @keydown=${keepPressKeysFromGame}
      @keyup=${keepPressKeysFromGame}
    >
      <span class=${ID}>${id}</span>
      <span class=${COPIED}>
        <of-icon name="check" size="12"></of-icon>
        ${translateText("common.copied")}
      </span>
    </button>
  `;
}
