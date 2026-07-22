import { LitElement, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { UserSettings } from "../../core/game/UserSettings";
import { profileIcon } from "../hud/HotbarIcons";
import "../hud/layers/ColumnPicker";
import {
  COLUMN_DEFS,
  type ColumnDef,
  columnById,
} from "../hud/layers/lib/StatsColumns";
import {
  type ColumnId,
  DEFAULT_STATS_COLUMNS,
  type StatsTableKind,
} from "../StatsConstants";
import { translateText } from "../Utils";
import type { GameView } from "../view";

export interface StatsRow {
  key: string;
  name: string;
  values: ReadonlyMap<ColumnId, number>;
  emphasized?: boolean;
  pinned?: boolean;
  onClick?: () => void;
}

interface RenderedStatsRow extends Omit<StatsRow, "values"> {
  position: number;
  cells: readonly string[];
}

// Fallbacks cover the first render before measurement and jsdom (tests),
// which reports zero element sizes.
const FALLBACK_ROW_HEIGHT_PX = 24;
const FALLBACK_VIEWPORT_HEIGHT_PX = 180;
const OVERSCAN_ROWS = 4;
// The pinned row only renders separately when the viewer sits below the
// always-visible top ranks of the scroll window.
const PINNED_VISIBLE_THRESHOLD = 4;

export abstract class StatsTable extends LitElement {
  public game: GameView | null = null;

  @property({ type: Boolean }) visible = false;

  protected abstract readonly tableKind: StatsTableKind;
  protected abstract readonly nameLabelKey: string;
  protected abstract buildRows(
    game: GameView,
    columns: readonly ColumnDef[],
  ): StatsRow[];

  private readonly userSettings = new UserSettings();
  private rows: StatsRow[] = [];

  @state()
  private sortKey: ColumnId = DEFAULT_STATS_COLUMNS[0];

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

  private selectedColumns(): ColumnDef[] {
    return this.userSettings.statsColumns(this.tableKind).map(columnById);
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

    const selected = this.selectedColumns();
    if (!selected.some((column) => column.id === this.sortKey)) {
      this.sortKey = selected[0].id;
      this.sortOrder = "desc";
    }

    const direction = this.sortOrder === "asc" ? 1 : -1;
    this.rows = this.buildRows(this.game, selected).sort(
      (a, b) =>
        direction *
        ((a.values.get(this.sortKey) ?? 0) - (b.values.get(this.sortKey) ?? 0)),
    );
    this.requestUpdate();
  }

  render() {
    const game = this.game;
    if (!this.visible || game === null) return html``;

    const selected = this.selectedColumns();
    const toRendered = (
      { values, ...row }: StatsRow,
      position: number,
    ): RenderedStatsRow => ({
      ...row,
      position,
      cells: selected.map((column) =>
        column.renderValue(values.get(column.id) ?? 0, game),
      ),
    });
    const pinnedIndex = this.rows.findIndex((row) => row.pinned);
    const pinnedRow =
      pinnedIndex > PINNED_VISIBLE_THRESHOLD
        ? toRendered(this.rows[pinnedIndex], pinnedIndex + 1)
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
    const scrollableRows = listRows
      .slice(firstIndex, lastIndex)
      .map((row, sliceIndex) => {
        const index = firstIndex + sliceIndex;
        return toRendered(
          row,
          pinnedRow !== null && index >= pinnedIndex ? index + 2 : index + 1,
        );
      });
    const topSpacerPx = firstIndex * this.rowHeightPx;
    const bottomSpacerPx = (listRows.length - lastIndex) * this.rowHeightPx;
    // Stat tracks stay content-sized intrinsically, then split only the spare
    // width supplied by a wider sibling. Rank, name, and picker remain fixed.
    const gridTemplate = `30px 100px${" auto".repeat(selected.length)} 32px`;
    const scrollHeight =
      pinnedRow === null
        ? "max-h-[7.5rem] md:max-h-[10rem] lg:max-h-[11.25rem]"
        : "max-h-[6rem] md:max-h-[8rem] lg:max-h-[9rem]";

    const renderRow = (
      row: RenderedStatsRow,
      borderClass: string,
      pinned = false,
    ) => html`
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
        <div
          class="h-6 md:h-8 lg:h-9 flex items-center justify-center ${borderClass}"
          role="cell"
        >
          ${row.position}
        </div>
        <div
          class="h-6 md:h-8 lg:h-9 min-w-0 px-1 flex items-center text-left ${borderClass}"
          role="cell"
        >
          <span class="block w-full truncate">${row.name}</span>
        </div>
        ${repeat(
          row.cells,
          (_cell, index) => selected[index].id,
          (cell, index) => {
            const alignment =
              selected[index].valueAlignment === "center"
                ? "justify-center text-center"
                : "justify-end text-right";
            return html`
              <div
                class="h-6 md:h-8 lg:h-9 px-1 flex items-center ${alignment} tabular-nums whitespace-nowrap border-l border-l-slate-600/40 ${borderClass}"
                role="cell"
              >
                ${cell}
              </div>
            `;
          },
        )}
        <div
          class="h-6 md:h-8 lg:h-9 border-l border-l-slate-600/40 ${borderClass}"
          aria-hidden="true"
        ></div>
      </div>
    `;

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
              <div
                class="h-6 md:h-8 lg:h-9 flex items-center justify-center border-b border-b-slate-500"
                role="columnheader"
              >
                #
              </div>
              <div
                class="h-6 md:h-8 lg:h-9 min-w-0 px-1 flex items-center justify-center text-center border-b border-b-slate-500"
                role="columnheader"
                title=${translateText(this.nameLabelKey)}
              >
                <img
                  class="size-[1.1rem] object-contain"
                  src=${profileIcon}
                  alt=${translateText(this.nameLabelKey)}
                />
              </div>
              ${repeat(
                selected,
                (column) => column.id,
                (column) => {
                  const label = translateText(column.labelKey);
                  return html`
                    <div
                      class="h-6 md:h-8 lg:h-9 px-1 flex items-center justify-center text-center border-b border-b-slate-500 border-l border-l-slate-500 whitespace-nowrap"
                      role="columnheader"
                      aria-sort=${this.sortKey === column.id
                        ? this.sortOrder === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"}
                    >
                      <button
                        class="inline-flex items-center justify-center gap-1 hover:text-sky-200 transition-colors"
                        title=${column.headerVisual === undefined
                          ? nothing
                          : label}
                        aria-label=${label}
                        @click=${() => this.setSort(column.id)}
                      >
                        ${column.headerVisual?.kind === "icon"
                          ? html`<span class="inline-flex items-start">
                              <img
                                class="size-[1.1rem] object-contain ${column
                                  .headerVisual.white === true
                                  ? "brightness-0 invert"
                                  : ""}"
                                src=${column.headerVisual.src}
                                alt=""
                                aria-hidden="true"
                              />${column.headerVisual.superscript
                                ? html`<img
                                    class="size-[0.825rem] object-contain -ml-0.5 ${column
                                      .headerVisual.superscript.white === true
                                      ? "brightness-0 invert"
                                      : ""}"
                                    src=${column.headerVisual.superscript.src}
                                    alt=""
                                    aria-hidden="true"
                                  />`
                                : nothing}
                            </span>`
                          : column.headerVisual?.kind === "emoji"
                            ? html`<span
                                class="text-[1.1rem] leading-none"
                                aria-hidden="true"
                                >${column.headerVisual.text}</span
                              >`
                            : html`<span>${label}</span>`}
                        ${this.sortKey === column.id
                          ? html`<span class="text-sky-300" aria-hidden="true"
                              >${this.sortOrder === "asc" ? "↑" : "↓"}</span
                            >`
                          : nothing}
                      </button>
                    </div>
                  `;
                },
              )}
              <div
                class="h-6 md:h-8 lg:h-9 px-1 flex items-center justify-center border-b border-b-slate-500 border-l border-l-slate-500"
                role="columnheader"
              >
                <column-picker
                  class="inline-flex"
                  .columns=${COLUMN_DEFS}
                  .selected=${selected.map((column) => column.id)}
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
                (row) => row.key,
                (row, index) =>
                  renderRow(
                    row,
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

            ${pinnedRow === null ? nothing : renderRow(pinnedRow, "", true)}
          </div>
        </div>
      </div>
    `;
  }
}
