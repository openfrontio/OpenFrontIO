import { LitElement, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import "../hud/layers/ColumnPicker";
import "./OfIcon";
import {
  type ColumnAlignment,
  type ColumnDef,
  columnsFor,
} from "../hud/layers/lib/StatsColumns";
import { type ColumnId, type StatsTableKind } from "../StatsConstants";
import { UserSettings } from "../UserSettings";
import { translateText } from "../Utils";
import type { GameView } from "../view";

export interface StatsRow {
  key: string;
  name: string;
  clanTag?: string | null;
  values: ReadonlyMap<ColumnId, number>;
  emphasized?: boolean;
  pinned?: boolean;
  onClick?: () => void;
}

/** A row plus the rank it renders at (list-wide, not window-relative). */
interface PlacedRow {
  row: StatsRow;
  position: number;
}

// Fallbacks cover the first render before measurement and jsdom (tests),
// which reports zero element sizes.
const FALLBACK_ROW_HEIGHT_PX = 24;
const FALLBACK_VIEWPORT_HEIGHT_PX = 180;
const OVERSCAN_ROWS = 4;
// The pinned row only renders separately when the viewer sits below the
// always-visible top ranks of the scroll window.
const PINNED_VISIBLE_THRESHOLD = 4;
// Trailing chrome track holding the ⚙️ menu, not a column of data.
const PICKER_TRACK = "32px";

type RowState = "me" | "mate" | "other";

// Look. Sizes, colours, radii and spacing of each part live here, so a
// change of look is one edit. The templates below only hold structure.

// The table has no surface of its own: it sits on the panel. Scrollbars keep
// a fixed colour so they still show over the map at 0% HUD opacity.
const TABLE = "relative mt-1 text-xs md:text-[13px] text-white";
const SCROLLBAR =
  "[scrollbar-width:thin] [scrollbar-color:rgb(255_255_255_/_0.35)_transparent]";
const HEADER = "h-5.5 md:h-6 lg:h-6.5 border-b border-white/15 font-bold";
const HEADER_CELL = "min-w-0 whitespace-nowrap";
// What a header cell holds; for a sortable column it is the sort button, so
// the whole cell takes the click.
const HEADER_BOX = "flex h-full w-full items-center gap-0.5";
const HEADER_PADDING = "px-1";
const SORT_BUTTON =
  "group cursor-pointer pointer-fine:hover:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-aquarius";
const HEADER_TONE = { sorted: "text-white", other: "text-white/70" } as const;
const HEADER_ICON_SIZE = 15;
// Always drawn, so a header keeps its width when it becomes the sorted one.
// Down for descending, which is what a first click gives.
const CHEVRON =
  "shrink-0 transition-transform duration-200 motion-reduce:transition-none";
// Where the chevron sits, so the header's icon or text lines up with the
// values below. Before an end-aligned visual, so both end on the same edge.
// Out of the flow at the cell's end for a centred one, with its width as
// padding on both sides, so the visual stays on the column's centre.
const CHEVRON_PLACE: Record<
  ColumnAlignment,
  { button: string; chevron: string }
> = {
  start: { button: HEADER_PADDING, chevron: "" },
  center: {
    button: "relative px-2.5",
    chevron: "absolute end-0 top-1/2 -translate-y-1/2",
  },
  end: { button: HEADER_PADDING, chevron: "order-first" },
};
const CHEVRON_STATE = {
  none: "rotate-90 opacity-0 pointer-fine:group-hover:opacity-60",
  desc: "rotate-90 text-aquarius",
  asc: "-rotate-90 text-aquarius",
} as const;
// Rows are 24px, 28px from 768px wide, the line under a row included. The
// font draws its glyphs low in their line box: one pixel less at the bottom
// puts them on the row's middle.
const ROW = "h-6 md:h-7 pb-px not-last:border-b not-last:border-white/5";
// Your row and your teammates' are bold, not told apart by colour alone.
const ROW_STATE: Record<RowState, string> = {
  me: "bg-malibu-blue/25 font-bold text-white",
  mate: "font-bold text-white",
  other: "",
};
// Only rows with a click get a hover, and only for a mouse: after a tap it
// would stay lit.
const ROW_HOVER: Record<RowState, string> = {
  me: "pointer-fine:hover:bg-malibu-blue/35",
  mate: "pointer-fine:hover:bg-white/6",
  other: "pointer-fine:hover:bg-white/6",
};
// Your row is also marked on its start edge.
const ME_EDGE = "border-s-2 border-aquarius";
const CELL = "flex min-w-0 items-center px-1 tabular-nums";
const ALIGNMENT_CLASS: Record<ColumnAlignment, string> = {
  start: "justify-start text-start",
  center: "justify-center text-center",
  end: "justify-end text-end",
};
// Names a step larger and ranks a step smaller than the numbers.
const CELL_SIZE: Partial<Record<ColumnId, string>> = {
  rank: "text-[11px] md:text-xs",
  player: "md:text-sm",
  team: "md:text-sm",
};
// In other players' rows; yours and your teammates' are white throughout.
const NAME_TONE = "font-medium text-white";
const CELL_TONE: Partial<Record<ColumnId, string>> = {
  rank: "text-white/55",
  player: NAME_TONE,
  team: NAME_TONE,
};
const VALUE_TONE = "text-white/70";
// Zeros, and the dash of a player without a clan, recede in every row.
const ZERO_TONE = "text-white/40";
// Faint rules between columns, so none read as merged.
const DIVIDER_CLASS = "border-s border-white/8";
const HEADER_DIVIDER_CLASS = "border-s border-white/12";

// An icon with a mark ("/m", the limit sign) is one box: the mark sits on
// the icon's baseline. "/m" has a slot of its own fixed width, so the four
// per-minute headers have the same width and line up. With no line height
// the text does not make the box taller than the icon, which stays centred
// like the other headers' icons. The limit sign tucks into the icon's corner
// as before, so max troops stays as narrow as its values.
const MARKED_VISUAL = "inline-flex items-baseline gap-0.5";
const MARK = "w-3.5 text-[11px] font-bold leading-0 text-white/55";
const MARK_ICON = "-ms-1 text-white/55";

/** A column's header icon (with its mark) or text, `size` px tall. */
export function renderColumnVisual(column: ColumnDef, size: number) {
  const visual = column.headerVisual;
  if (visual === undefined) {
    return html`<span>${translateText(column.labelKey)}</span>`;
  }
  if (visual.kind === "text") {
    return html`<span>${translateText(visual.text)}</span>`;
  }
  const superscript = visual.superscript;
  return html`<span class=${MARKED_VISUAL}>
    <of-icon
      class=${visual.color ?? nothing}
      name=${visual.icon}
      size=${size}
    ></of-icon>
    ${
      superscript === undefined
        ? nothing
        : "icon" in superscript
          ? html`<of-icon
              class=${MARK_ICON}
              name=${superscript.icon}
              size=${size - 5}
            ></of-icon>`
          : html`<span class=${MARK}>${translateText(superscript.text)}</span>`
    }
  </span>`;
}

export abstract class StatsTable extends LitElement {
  public game: GameView | null = null;

  @property({ type: Boolean }) visible = false;

  protected abstract readonly tableKind: StatsTableKind;
  protected abstract buildRows(
    game: GameView,
    columns: readonly ColumnDef[],
  ): StatsRow[];

  private readonly userSettings = new UserSettings();
  private rows: StatsRow[] = [];

  @state()
  private sortKey: ColumnId | null = null;

  @state()
  private sortOrder: "asc" | "desc" = "desc";

  @state()
  private scrollOffsetPx = 0;

  private rowHeightPx = FALLBACK_ROW_HEIGHT_PX;
  private viewportHeightPx = FALLBACK_VIEWPORT_HEIGHT_PX;

  createRenderRoot() {
    return this;
  }

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has("visible") && this.visible) {
      // The scroll container is recreated at scroll offset 0 when the table
      // was hidden, so the remembered offset would misplace the window.
      this.scrollOffsetPx = 0;
      this.updateStats();
    }
  }

  updated() {
    const scroller = this.querySelector(".stats-table-scroll");
    if (!(scroller instanceof HTMLElement)) return;
    const row = scroller.querySelector(".stats-table-row");
    const rowHeight = row instanceof HTMLElement ? row.offsetHeight : 0;
    const viewportHeight = scroller.clientHeight;
    let changed = false;
    if (rowHeight > 0 && rowHeight !== this.rowHeightPx) {
      this.rowHeightPx = rowHeight;
      changed = true;
    }
    if (viewportHeight > 0 && viewportHeight !== this.viewportHeightPx) {
      this.viewportHeightPx = viewportHeight;
      changed = true;
    }
    if (changed) this.requestUpdate();
  }

  private onScroll(event: Event) {
    this.scrollOffsetPx = (event.target as HTMLElement).scrollTop;
  }

  refresh() {
    if (this.visible) this.updateStats();
  }

  /**
   * Columns this render shows: every non-hideable column plus the hideable
   * ones the ⚙️ menu has selected, in registry order.
   */
  private visibleColumns(): readonly ColumnDef[] {
    const selected = this.userSettings.statsColumns(this.tableKind);
    return columnsFor(this.tableKind).filter(
      (column) => !column.isHideable || selected.includes(column.id),
    );
  }

  private setSort(key: ColumnId) {
    if (this.sortKey === key) {
      this.sortOrder = this.sortOrder === "asc" ? "desc" : "asc";
    } else {
      this.sortKey = key;
      this.sortOrder = "desc";
    }
    this.updateStats();
  }

  private onColumnsChanged(event: CustomEvent<ColumnId[]>) {
    this.userSettings.setStatsColumns(this.tableKind, event.detail);
    this.updateStats();
  }

  private updateStats() {
    if (this.game === null) return;

    const columns = this.visibleColumns();
    // Only orderable columns have a number to sort on. When none is visible
    // the rows keep the order buildRows produced. Without a choice, sort by
    // land; Type comes first in the registry but is a poor default.
    const orderable = columns.filter((column) => column.isOrderable);
    if (
      orderable.length > 0 &&
      !orderable.some((column) => column.id === this.sortKey)
    ) {
      this.sortKey = (
        orderable.find((column) => column.id === "tiles") ??
        orderable.find((column) => column.id !== "playerType") ??
        orderable[0]
      ).id;
      this.sortOrder = "desc";
    }

    const sortKey = this.sortKey;
    const rows = this.buildRows(this.game, columns);
    const direction = this.sortOrder === "asc" ? 1 : -1;
    this.rows =
      orderable.length === 0 || sortKey === null
        ? rows
        : rows.sort(
            (a, b) =>
              direction *
              ((a.values.get(sortKey) ?? 0) - (b.values.get(sortKey) ?? 0)),
          );
    this.requestUpdate();
  }

  private renderHeaderCell(column: ColumnDef, index: number) {
    const label = translateText(column.labelKey);
    const visual = renderColumnVisual(column, HEADER_ICON_SIZE);
    const sorted = this.sortKey === column.id;
    const align = column.headerAlign ?? column.align;
    const box = `${HEADER_BOX} ${ALIGNMENT_CLASS[align]} ${
      HEADER_TONE[sorted ? "sorted" : "other"]
    }`;
    const place = CHEVRON_PLACE[align];
    return html`
      <div
        class="stats-table-header-cell ${HEADER_CELL} ${
          index > 0 ? HEADER_DIVIDER_CLASS : ""
        }"
        role="columnheader"
        title=${label}
        data-column=${column.id}
        data-align=${align}
        ?data-rule=${index > 0}
        aria-sort=${
          column.isOrderable
            ? sorted
              ? this.sortOrder === "asc"
                ? "ascending"
                : "descending"
              : "none"
            : nothing
        }
      >
        ${
          column.isOrderable
            ? html`<button
                type="button"
                class="${box} ${place.button} ${SORT_BUTTON}"
                aria-label=${label}
                @click=${() => this.setSort(column.id)}
              >
                ${visual}
                <of-icon
                  class="${CHEVRON} ${place.chevron} ${
                    CHEVRON_STATE[sorted ? this.sortOrder : "none"]
                  }"
                  name="chevron-right"
                  size="10"
                ></of-icon>
              </button>`
            : html`<span class="${box} ${HEADER_PADDING}">${visual}</span>`
        }
      </div>
    `;
  }

  private renderCell(
    column: ColumnDef,
    index: number,
    text: string,
    value: number,
    state: RowState,
  ) {
    // A player without a clan shows a dash. Zeros recede, but not the Type
    // column's: there 0 reads "Player".
    const noClan = column.id === "clan" && text === "";
    const zero =
      noClan ||
      (column.value !== undefined && column.id !== "playerType" && value === 0);
    let tone = state === "other" ? (CELL_TONE[column.id] ?? VALUE_TONE) : "";
    if (zero) tone = ZERO_TONE;
    // Names may be right-to-left: dir="auto" reads them so while they stay
    // at the start of their column, and the title gives a cut name in full.
    const isName = column.id === "player" || column.id === "team";
    return html`
      <div
        class="stats-table-cell ${CELL} ${ALIGNMENT_CLASS[column.align]} ${
          CELL_SIZE[column.id] ?? ""
        } ${tone} ${index > 0 ? DIVIDER_CLASS : ""} ${
          index === 0 && state === "me" ? ME_EDGE : ""
        }"
        role="cell"
        data-column=${column.id}
        data-align=${column.align}
        ?data-rule=${index > 0}
        ?data-zero=${zero}
      >
        <span
          class="min-w-0 truncate"
          dir=${isName ? "auto" : nothing}
          title=${isName ? text : nothing}
          >${noClan ? "–" : text}</span
        >
      </div>
    `;
  }

  private renderRow(
    game: GameView,
    columns: readonly ColumnDef[],
    { row, position }: PlacedRow,
    pinned = false,
  ) {
    const state: RowState = row.pinned
      ? "me"
      : row.emphasized
        ? "mate"
        : "other";
    // translate="no": a page translator must not rewrite player names.
    return html`
      <div
        class="stats-table-row ${
          pinned ? "stats-table-pinned-row" : ""
        } grid col-span-full ${ROW} ${ROW_STATE[state]} ${
          row.onClick ? `cursor-pointer ${ROW_HOVER[state]}` : ""
        }"
        style="grid-template-columns: subgrid; grid-column: 1 / -1;"
        role="row"
        translate="no"
        ?data-me=${state === "me"}
        ?data-mate=${state === "mate"}
        @click=${row.onClick ?? nothing}
      >
        ${repeat(
          columns,
          (column) => column.id,
          (column, index) => {
            const value = row.values.get(column.id) ?? 0;
            return this.renderCell(
              column,
              index,
              column.cell({ ...row, position, value }, game),
              value,
              state,
            );
          },
        )}
        <div class=${DIVIDER_CLASS} aria-hidden="true"></div>
      </div>
    `;
  }

  render() {
    const game = this.game;
    if (!this.visible || game === null) return html``;

    const columns = this.visibleColumns();
    const pinnedIndex = this.rows.findIndex((row) => row.pinned);
    const pinnedRow: PlacedRow | null =
      pinnedIndex > PINNED_VISIBLE_THRESHOLD
        ? { row: this.rows[pinnedIndex], position: pinnedIndex + 1 }
        : null;
    const listRows =
      pinnedRow === null
        ? this.rows
        : this.rows.filter((_, index) => index !== pinnedIndex);
    // Virtualize: only rows near the scroll viewport get DOM; spacers keep
    // the scrollbar geometry for the rest. Positions stay list-wide.
    const firstIndex = Math.max(
      0,
      Math.floor(this.scrollOffsetPx / this.rowHeightPx) - OVERSCAN_ROWS,
    );
    const lastIndex = Math.min(
      listRows.length,
      Math.ceil(
        (this.scrollOffsetPx + this.viewportHeightPx) / this.rowHeightPx,
      ) + OVERSCAN_ROWS,
    );
    const scrollableRows: PlacedRow[] = listRows
      .slice(firstIndex, lastIndex)
      .map((row, sliceIndex) => {
        const index = firstIndex + sliceIndex;
        return {
          row,
          position:
            pinnedRow !== null && index >= pinnedIndex ? index + 2 : index + 1,
        };
      });
    const topSpacerPx = firstIndex * this.rowHeightPx;
    const bottomSpacerPx = (listRows.length - lastIndex) * this.rowHeightPx;
    // "auto" tracks stay content-sized intrinsically, then split only the
    // spare width supplied by a wider sibling; fixed tracks never stretch.
    const gridTemplate = `${columns
      .map((column) => column.width)
      .join(" ")} ${PICKER_TRACK}`;
    // Five rows, or four above the copy of yours.
    const scrollHeight =
      pinnedRow === null
        ? "max-h-[7.5rem] md:max-h-[8.125rem]"
        : "max-h-[6rem] md:max-h-[6.5rem]";

    return html`
      <div class="stats-table ${TABLE}">
        <div
          class="overflow-x-auto ${SCROLLBAR}"
          @contextmenu=${(event: Event) => event.preventDefault()}
        >
          <div
            class="stats-table-content grid w-max min-w-full"
            style="grid-template-columns: ${gridTemplate};"
            role="table"
          >
            <div
              class="stats-table-header grid col-span-full ${HEADER}"
              style="grid-template-columns: subgrid; grid-column: 1 / -1;"
              role="row"
            >
              ${repeat(
                columns,
                (column) => column.id,
                (column, index) => this.renderHeaderCell(column, index),
              )}
              <div
                class="${HEADER_CELL} flex items-center justify-center ${HEADER_DIVIDER_CLASS}"
                role="columnheader"
                data-rule
              >
                <column-picker
                  class="inline-flex"
                  .columns=${columnsFor(this.tableKind).filter(
                    (column) => column.isHideable,
                  )}
                  .selected=${this.userSettings.statsColumns(this.tableKind)}
                  @columns-changed=${this.onColumnsChanged}
                ></column-picker>
              </div>
            </div>

            <div
              class="stats-table-scroll ${scrollHeight} grid col-span-full overflow-y-scroll overflow-x-hidden overscroll-contain ${SCROLLBAR}"
              style="grid-template-columns: subgrid; grid-column: 1 / -1;"
              role="rowgroup"
              @scroll=${this.onScroll}
            >
              ${
                topSpacerPx > 0
                  ? html`<div
                      class="stats-table-spacer col-span-full"
                      style="height: ${topSpacerPx}px"
                      aria-hidden="true"
                    ></div>`
                  : nothing
              }
              ${repeat(
                scrollableRows,
                (placed) => placed.row.key,
                (placed) => this.renderRow(game, columns, placed),
              )}
              ${
                bottomSpacerPx > 0
                  ? html`<div
                      class="stats-table-spacer col-span-full"
                      style="height: ${bottomSpacerPx}px"
                      aria-hidden="true"
                    ></div>`
                  : nothing
              }
            </div>

            ${
              pinnedRow === null
                ? nothing
                : this.renderRow(game, columns, pinnedRow, true)
            }
          </div>
        </div>
      </div>
    `;
  }
}
