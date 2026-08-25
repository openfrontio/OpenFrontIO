import { LitElement, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { UserSettings } from "../../core/game/UserSettings";
import "../hud/layers/ColumnPicker";
import {
  type ColumnAlignment,
  type ColumnDef,
  columnsFor,
} from "../hud/layers/lib/StatsColumns";
import { type ColumnId, type StatsTableKind } from "../StatsConstants";
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

const ALIGNMENT_CLASS: Record<ColumnAlignment, string> = {
  start: "justify-start text-left",
  center: "justify-center text-center",
  end: "justify-end text-right",
};
const CELL_CLASS = "h-6 md:h-8 lg:h-9 min-w-0 px-1 flex items-center";
const DIVIDER_CLASS = "border-l border-l-slate-600/40";
const HEADER_DIVIDER_CLASS = "border-l border-l-slate-500";

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
    // the rows keep the order buildRows produced.
    const orderable = columns.filter((column) => column.isOrderable);
    if (
      orderable.length > 0 &&
      !orderable.some((column) => column.id === this.sortKey)
    ) {
      this.sortKey = orderable[0].id;
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

  private renderHeaderVisual(column: ColumnDef, label: string) {
    const visual = column.headerVisual;
    if (visual === undefined) return html`<span>${label}</span>`;
    if (visual.kind === "text") {
      return html`<span>${translateText(visual.text)}</span>`;
    }
    return html`<span class="inline-flex items-start">
      <img
        class="size-[1.1rem] object-contain ${visual.white === true
          ? "brightness-0 invert"
          : ""}"
        src=${visual.src}
        alt=""
        aria-hidden="true"
      />${visual.superscript
        ? "src" in visual.superscript
          ? html`<img
              class="size-[0.825rem] object-contain -ml-0.5 ${visual.superscript
                .white === true
                ? "brightness-0 invert"
                : ""}"
              src=${visual.superscript.src}
              alt=""
              aria-hidden="true"
            />`
          : html`<span class="text-[0.6rem] ml-0.5 self-center leading-none"
              >${visual.superscript.text}</span
            >`
        : nothing}
    </span>`;
  }

  private renderHeaderCell(column: ColumnDef, index: number) {
    const label = translateText(column.labelKey);
    const visual = this.renderHeaderVisual(column, label);
    const sorted = this.sortKey === column.id;
    return html`
      <div
        class="stats-table-header-cell ${CELL_CLASS} justify-center text-center whitespace-nowrap border-b border-b-slate-500 ${index >
        0
          ? HEADER_DIVIDER_CLASS
          : ""}"
        role="columnheader"
        title=${label}
        aria-sort=${column.isOrderable
          ? sorted
            ? this.sortOrder === "asc"
              ? "ascending"
              : "descending"
            : "none"
          : nothing}
      >
        ${column.isOrderable
          ? html`<button
              class="inline-flex items-center justify-center gap-1 hover:text-sky-200 transition-colors"
              aria-label=${label}
              @click=${() => this.setSort(column.id)}
            >
              ${visual}
              ${sorted
                ? html`<span class="text-sky-300" aria-hidden="true"
                    >${this.sortOrder === "asc" ? "↑" : "↓"}</span
                  >`
                : nothing}
            </button>`
          : visual}
      </div>
    `;
  }

  private renderCell(
    column: ColumnDef,
    index: number,
    text: string,
    borderClass: string,
  ) {
    return html`
      <div
        class="stats-table-cell ${CELL_CLASS} ${ALIGNMENT_CLASS[
          column.align
        ]} tabular-nums ${index > 0 ? DIVIDER_CLASS : ""} ${borderClass}"
        role="cell"
      >
        <span class="block w-full truncate">${text}</span>
      </div>
    `;
  }

  private renderRow(
    game: GameView,
    columns: readonly ColumnDef[],
    { row, position }: PlacedRow,
    borderClass: string,
    pinned = false,
  ) {
    return html`
      <div
        class="stats-table-row grid col-span-full hover:bg-slate-600/60 ${pinned
          ? "stats-table-pinned-row bg-gray-700/95"
          : ""} ${row.emphasized ? "font-bold" : ""} ${row.onClick
          ? "cursor-pointer"
          : ""}"
        style="grid-template-columns: subgrid; grid-column: 1 / -1;"
        role="row"
        @click=${row.onClick ?? nothing}
      >
        ${repeat(
          columns,
          (column) => column.id,
          (column, index) =>
            this.renderCell(
              column,
              index,
              column.cell(
                { ...row, position, value: row.values.get(column.id) ?? 0 },
                game,
              ),
              borderClass,
            ),
        )}
        <div
          class="h-6 md:h-8 lg:h-9 ${DIVIDER_CLASS} ${borderClass}"
          aria-hidden="true"
        ></div>
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
    const scrollHeight =
      pinnedRow === null
        ? "max-h-[7.5rem] md:max-h-[10rem] lg:max-h-[11.25rem]"
        : "max-h-[6rem] md:max-h-[8rem] lg:max-h-[9rem]";

    return html`
      <div class="stats-table relative mt-1 text-white text-xs lg:text-sm">
        <div
          class="overflow-x-auto rounded-lg bg-gray-800/85"
          @contextmenu=${(event: Event) => event.preventDefault()}
        >
          <div
            class="stats-table-content grid w-max min-w-full"
            style="grid-template-columns: ${gridTemplate};"
            role="table"
          >
            <div
              class="stats-table-header grid col-span-full font-bold bg-gray-700/95"
              style="grid-template-columns: subgrid; grid-column: 1 / -1;"
              role="row"
            >
              ${repeat(
                columns,
                (column) => column.id,
                (column, index) => this.renderHeaderCell(column, index),
              )}
              <div
                class="${CELL_CLASS} justify-center border-b border-b-slate-500 ${HEADER_DIVIDER_CLASS}"
                role="columnheader"
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
              class="stats-table-scroll ${scrollHeight} grid col-span-full overflow-y-scroll overflow-x-hidden"
              style="grid-template-columns: subgrid; grid-column: 1 / -1;"
              role="rowgroup"
              @scroll=${this.onScroll}
            >
              ${topSpacerPx > 0
                ? html`<div
                    class="stats-table-spacer col-span-full"
                    style="height: ${topSpacerPx}px"
                    aria-hidden="true"
                  ></div>`
                : nothing}
              ${repeat(
                scrollableRows,
                (placed) => placed.row.key,
                (placed, index) =>
                  this.renderRow(
                    game,
                    columns,
                    placed,
                    index < scrollableRows.length - 1 ||
                      pinnedRow !== null ||
                      bottomSpacerPx > 0
                      ? "border-b border-b-slate-500"
                      : "",
                  ),
              )}
              ${bottomSpacerPx > 0
                ? html`<div
                    class="stats-table-spacer col-span-full"
                    style="height: ${bottomSpacerPx}px"
                    aria-hidden="true"
                  ></div>`
                : nothing}
            </div>

            ${pinnedRow === null
              ? nothing
              : this.renderRow(game, columns, pinnedRow, "", true)}
          </div>
        </div>
      </div>
    `;
  }
}
