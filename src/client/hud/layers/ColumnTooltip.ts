import { html, LitElement, nothing, render as litRender } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ColumnId } from "../../StatsConstants";
import { translateText } from "../../Utils";
import type { ColumnDef } from "./lib/StatsColumns";

/**
 * What a column counts, for the columns whose name does not say it. Found by
 * the column's id, so a translated name can never miss its line.
 */
export const COLUMN_MEANING: Partial<Record<ColumnId, string>> = {
  playerType: "leaderboard.desc_playerType",
  tiles: "leaderboard.desc_owned",
  goldIncomePerMin: "leaderboard.desc_goldIncomePerMin",
  shipTradeGoldPerMin: "leaderboard.desc_shipTradeGoldPerMin",
  piracyGoldPerMin: "leaderboard.desc_piracyGoldPerMin",
  trainTradeGoldPerMin: "leaderboard.desc_trainTradeGoldPerMin",
  maxtroops: "leaderboard.desc_maxtroops",
};

// Look. Opaque at any HUD opacity, since it is read.
const TOOLTIP =
  "fixed z-2000 hud-modal rounded-lg max-w-62 px-2.5 py-1.5 pointer-events-none text-white animate-hud-rise motion-reduce:animate-none";
const NAME = "text-[13px] font-bold";
const MEANING = "text-xs text-white/70";
const HINT = "mt-1 border-t border-white/12 pt-1 text-[11px] text-white/55";

// Away from the header, and from the window's edges.
const GAP_PX = 6;
const EDGE_PX = 8;

/**
 * A leaderboard header's tooltip: the column's name, what it counts, and,
 * for a mouse, how to choose the columns. Drawn under <body>, like the column
 * menu, so the panel neither clips it nor traps it in its backdrop filter.
 */
@customElement("column-tooltip")
export class ColumnTooltip extends LitElement {
  @property({ attribute: false }) column: ColumnDef | null = null;
  @property({ attribute: false }) anchor: HTMLElement | null = null;
  @property({ type: Boolean }) hint = false;
  /** The id a header's `aria-describedby` points at. */
  @property({ attribute: false }) tooltipId = "";

  private portal: HTMLDivElement | null = null;

  createRenderRoot() {
    return this;
  }

  disconnectedCallback() {
    this.removePortal();
    super.disconnectedCallback();
  }

  protected updated() {
    const column = this.column;
    const anchor = this.anchor;
    if (column === null || anchor === null || !anchor.isConnected) {
      this.removePortal();
      return;
    }
    if (this.portal === null) {
      this.portal = document.createElement("div");
      document.body.appendChild(this.portal);
    }
    const meaning = COLUMN_MEANING[column.id];
    litRender(
      html`<div
        id=${this.tooltipId}
        class=${TOOLTIP}
        role="tooltip"
        data-column-tooltip
      >
        <div class=${NAME}>${translateText(column.labelKey)}</div>
        ${
          meaning === undefined
            ? nothing
            : html`<div class=${MEANING}>${translateText(meaning)}</div>`
        }
        ${
          this.hint
            ? html`<div class=${HINT}>
                ${translateText("leaderboard.columns_hint")}
              </div>`
            : nothing
        }
      </div>`,
      this.portal,
    );

    // Centred under the header, inside the window; above it when there is
    // no room below. offsetWidth, not the rectangle: the entrance moves it.
    const box = this.portal.firstElementChild as HTMLElement;
    const rect = anchor.getBoundingClientRect();
    const left = Math.max(
      EDGE_PX,
      Math.min(
        rect.left + (rect.width - box.offsetWidth) / 2,
        window.innerWidth - EDGE_PX - box.offsetWidth,
      ),
    );
    const below = rect.bottom + GAP_PX;
    const top =
      below + box.offsetHeight + EDGE_PX <= window.innerHeight
        ? below
        : rect.top - GAP_PX - box.offsetHeight;
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }

  private removePortal() {
    this.portal?.remove();
    this.portal = null;
  }
}
