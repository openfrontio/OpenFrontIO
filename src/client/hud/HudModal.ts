import { html, TemplateResult } from "lit";
import "../components/OfIcon";
import { translateText } from "../Utils";

/** Small uppercase heading of a section inside a dialog. */
export const HUD_LABEL =
  "text-[11px] font-bold uppercase tracking-[0.12em] text-white/70";

/** A 32px square button holding one icon (close, back). */
export const HUD_ICON_BUTTON =
  "grid size-8 shrink-0 place-items-center rounded-lg text-white/70 " +
  "transition-colors hover:bg-white/10 hover:text-white active:bg-white/15 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aquarius";

const BUTTON =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border px-4 " +
  "text-center text-sm font-bold uppercase tracking-widest text-white transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aquarius " +
  "disabled:opacity-50";
/** The action a dialog expects (keep playing, got it). */
export const HUD_BUTTON_MAIN = `${BUTTON} border-aquarius/50 bg-malibu-blue hover:bg-aquarius`;
/** The other actions (leave, skip). */
export const HUD_BUTTON_QUIET = `${BUTTON} border-white/15 bg-white/5 hover:bg-white/10`;

export function hudModalHeader(props: {
  title: string;
  titleId: string;
  onClose: () => void;
  /** Shown after the title, e.g. who a message goes to. */
  subtitle?: string;
  /** Controls between the title and the close button. */
  actions?: TemplateResult | null;
}): TemplateResult {
  const close = translateText("common.close");
  return html`
    <div
      class="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 ps-4 pe-2"
    >
      <h2
        id=${props.titleId}
        class="hud-caps m-0 shrink-0 text-sm font-bold uppercase tracking-[0.12em] text-white"
      >
        ${props.title}
      </h2>
      ${
        props.subtitle
          ? html`
              <span class="min-w-0 truncate text-sm text-white/70">
                ${props.subtitle}
              </span>
            `
          : ""
      }
      <span class="ms-auto flex shrink-0 items-center gap-1">
        ${props.actions}
        <button
          type="button"
          class=${HUD_ICON_BUTTON}
          aria-label=${close}
          title=${close}
          @click=${props.onClose}
        >
          <of-icon name="close" size="16"></of-icon>
        </button>
      </span>
    </div>
  `;
}

/** The track and thumb of a switch; the button around it carries role="switch". */
export function hudSwitch(checked: boolean): TemplateResult {
  return html`
    <span
      class="relative inline-block h-4.5 w-8 rounded-full transition-colors ${
        checked ? "bg-malibu-blue" : "bg-white/15"
      }"
    >
      <span
        class="absolute start-0.5 top-0.5 size-3.5 rounded-full bg-white transition-transform ${
          checked ? "translate-x-3.5 rtl:-translate-x-3.5" : ""
        }"
      ></span>
    </span>
  `;
}
