import { LitElement, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { keepPressKeysFromGame } from "../hud/HudKeys";
import { COLUMN_MEANING } from "../hud/layers/ColumnTooltip";
import "./OfIcon";
import {
  type ColumnAlignment,
  type ColumnDef,
  columnsFor,
} from "../hud/layers/lib/StatsColumns";
import { type ColumnId, type StatsTableKind } from "../StatsConstants";
import { UserSettings } from "../UserSettings";
import { prefersReducedMotion } from "../utilities/ReducedMotion";
import { translateText } from "../Utils";
import type { GameView } from "../view";
import type { OfIconName } from "./OfIcon";

/** What a player is to you, shown after their name. */
export type RowMark = "attack" | "traitor" | "ally" | "embargo" | "offline";

export interface StatsRow {
  key: string;
  name: string;
  clanTag?: string | null;
  /** The colour shown by the name, as a CSS colour. */
  color?: string;
  /** For a team: how many of its players are alive, out of how many. */
  alive?: { count: number; total: number };
  values: ReadonlyMap<ColumnId, number>;
  emphasized?: boolean;
  pinned?: boolean;
  /** At most two, most urgent first. */
  marks?: readonly RowMark[];
  /** How full the player's troops are, 0 to 1: draws the troop gauge. */
  troopFill?: number;
  onClick?: () => void;
}

/** A row plus the rank it renders at (list-wide, not window-relative). */
interface PlacedRow {
  row: StatsRow;
  position: number;
}

/**
 * What the list draws: a row, or a spacer `spacer` px tall standing for the
 * rows from index `from` that have no DOM.
 */
type ListItem = { spacer: number; from: number } | { placed: PlacedRow };

/**
 * Your row and the rows held with it: the list's indexes from `from` to
 * before `to`, and the edge they rest on while their place is out of view.
 */
interface HeldBlock {
  from: number;
  to: number;
  edge: "top" | "bottom" | null;
}

// Fallbacks cover the first render before measurement and jsdom (tests),
// which reports zero element sizes.
const FALLBACK_ROW_HEIGHT_PX = 24;
const FALLBACK_VIEWPORT_HEIGHT_PX = 180;
const OVERSCAN_ROWS = 4;
// Rows glide to a new rank. More rows in view than this changing place in
// one refresh is a reshuffle (early in a game most rows trade places every
// second): they snap. A row from further away glides the last few rows.
const GLIDE_MAX_ROWS = 4;
const GLIDE_MAX_DISTANCE = 3;
const GLIDE: KeyframeAnimationOptions = {
  duration: 220,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
};
// What each table is called, by a screen reader and in the column menu.
export const TABLE_NAME: Record<StatsTableKind, string> = {
  player: "leaderboard.players_table",
  team: "leaderboard.teams_table",
};

type RowState = "me" | "mate" | "other";
type GaugeLevel = "ok" | "high" | "full";
// The troop gauge warns from these shares of a player's max troops.
const GAUGE_HIGH = 0.8;
const GAUGE_FULL = 0.95;

// Look. Sizes, colours, radii and spacing of each part live here, so a
// change of look is one edit. The templates below only hold structure.

// The table has no surface of its own: it sits on the panel. Scrollbars keep
// a fixed colour so they still show over the map at 0% HUD opacity.
// Names get more room on large windows, where it costs nothing. The narrowest
// phones drop the colour chips and their room.
const TABLE =
  "relative mt-1 text-xs md:text-[13px] text-white 2xl:[--stats-name:10rem] max-[360px]:[--stats-chip:0px]";
const SCROLLBAR =
  "[scrollbar-width:thin] [scrollbar-color:rgb(255_255_255_/_0.35)_transparent]";
const HEADER = "h-5.5 md:h-6 lg:h-6.5 border-b border-white/15 font-bold";
const HEADER_CELL = "min-w-0 whitespace-nowrap";
// What a header cell holds; for a sortable column it is the sort button, so
// the whole cell takes the click.
const HEADER_BOX = "flex h-full w-full items-center gap-0.5";
const HEADER_PADDING = "px-0.75";
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
// Your row stays in the list and is held at its top or bottom edge when it
// is out of view. Its blue band lies over the panel's navy, which fades with
// the HUD opacity like the panel: the rows passing under it are hidden, or
// blurred like the map below full opacity, so no text shows through yours.
const ROW_STATE: Record<RowState, string> = {
  me: "bg-hud-panel bg-linear-to-r from-malibu-blue/25 to-malibu-blue/25 backdrop-blur-hud font-bold text-white",
  mate: "font-bold text-white",
  other: "",
};
// A row that climbs is drawn over the rows it passes while it glides, but
// under your row and the rows held with it (HOLD), which keep their z.
const CLIMBING = "data-climbing:z-1 data-climbing:bg-hud-panel";
const HELD_CLIMBING = "data-climbing:bg-hud-panel";
// Only rows with a click get a hover, and only for a mouse: after a tap it
// would stay lit.
const ROW_HOVER: Record<RowState, string> = {
  me: "pointer-fine:hover:from-malibu-blue/35 pointer-fine:hover:to-malibu-blue/35",
  mate: "pointer-fine:hover:bg-white/6",
  other: "pointer-fine:hover:bg-white/6",
};
// Your row is also marked on its start edge.
const ME_EDGE = "border-s-2 border-aquarius";
// When you rank below the rows the list shows, the rows either side of
// yours are held at the edge with it. Each row of that block sticks at its
// own place in it, so held they rest one against the other, in order.
const HOLD = "sticky z-2";
const HOLD_TOP = [
  "top-0",
  "top-(--stats-row)",
  "top-[calc(2*var(--stats-row))]",
];
const HOLD_BOTTOM = [
  "bottom-0",
  "bottom-(--stats-row)",
  "bottom-[calc(2*var(--stats-row))]",
];
// Held, your neighbours hide the rows passing under them as yours does. The
// hover lies over that fill instead of replacing it.
const NEAR_HELD = "bg-hud-panel backdrop-blur-hud";
const NEAR_HELD_HOVER =
  "pointer-fine:hover:bg-linear-to-r pointer-fine:hover:from-white/6 pointer-fine:hover:to-white/6";
// A dashed line on the held block's open side stands for the ranks between
// it and the rows in view. Drawn apart from the row's own rule.
const GAP: Record<"top" | "bottom", string> = {
  bottom:
    "before:absolute before:inset-x-1 before:top-0 before:border-t before:border-dashed before:border-white/30",
  top: "after:absolute after:inset-x-1 after:bottom-0 after:border-b after:border-dashed after:border-white/30",
};
// 3px a side, as in the header: the default columns then fit in the panel's
// width of before.
const CELL = "flex min-w-0 items-center px-0.75 tabular-nums";
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
// The player's or team's colour before the name. The dark hairline keeps a
// pale colour apart from the map when the panel is see-through.
const CHIP =
  "me-1 size-2 shrink-0 rounded-xs inset-ring inset-ring-black/40 max-[360px]:hidden";
// A team's players alive after its name, quieter than the name.
const ALIVE = "ms-auto shrink-0 ps-1 text-[11px]";
const ALIVE_TONE = "text-white/55";
const CELL_TONE: Partial<Record<ColumnId, string>> = {
  rank: "text-white/55",
  player: NAME_TONE,
  team: NAME_TONE,
};
const VALUE_TONE = "text-white/70";
// Zeros, and the dash of a player without a clan, recede in every row.
const ZERO_TONE = "text-white/40";
// The marks after a name. The name gives way to them, so they always show.
const ROW_MARK: Record<
  RowMark,
  { icon: OfIconName; tone: string; label: string }
> = {
  attack: {
    icon: "sword",
    tone: "text-red-400",
    label: "leaderboard.mark_attacking_you",
  },
  traitor: {
    icon: "traitor",
    tone: "text-orange-400",
    label: "leaderboard.mark_traitor",
  },
  ally: {
    icon: "alliance",
    tone: "text-green-400",
    label: "leaderboard.mark_ally",
  },
  embargo: {
    icon: "embargo",
    tone: "text-amber-400",
    label: "leaderboard.mark_embargo",
  },
  offline: {
    icon: "disconnected",
    tone: "text-white/50",
    label: "leaderboard.mark_disconnected",
  },
};
const ROW_MARK_BOX = "ms-1 flex shrink-0";
const ROW_MARK_SIZE = 11;
// Faint rules between columns, so none read as merged.
const DIVIDER_CLASS = "border-s border-white/8";
const HEADER_DIVIDER_CLASS = "border-s border-white/12";
// How full a player's troops are: a line under the number in the Troops
// column (in Max Troops when Troops is hidden), in the bottom bar's troop
// blue, amber then red near the player's max. A pixel lower in the shorter
// phone rows, so it clears the digits there too. Left out below 360px, where
// the table is at its most crowded.
const GAUGE =
  "absolute inset-x-0.75 bottom-px md:bottom-0.5 h-[3px] overflow-hidden rounded-full bg-black/40 max-[360px]:hidden";
const GAUGE_FILL: Record<GaugeLevel, string> = {
  ok: "bg-malibu-blue",
  high: "bg-amber-400",
  full: "bg-red-500",
};
// A row nobody sees, holding each column's widest texts one per line: the
// browser sizes every shared track from real glyphs. Bold like your row, with
// the cells' padding and rules.
const SIZER = "grid col-span-full h-0 overflow-hidden invisible";
const SIZER_CELL =
  "flex flex-col px-0.75 font-bold tabular-nums whitespace-nowrap";

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

function renderGauge(fill: number) {
  const level: GaugeLevel =
    fill >= GAUGE_FULL ? "full" : fill >= GAUGE_HIGH ? "high" : "ok";
  return html`<div
    class=${GAUGE}
    aria-hidden="true"
    data-gauge
    data-gauge-level=${level}
  >
    <div
      class="h-full ${GAUGE_FILL[level]}"
      style="width: ${fill * 100}%"
    ></div>
  </div>`;
}

export abstract class StatsTable extends LitElement {
  public game: GameView | null = null;

  @property({ type: Boolean }) visible = false;
  // Caps the list at five rows, so a second table fits under it.
  @property({ type: Boolean }) short = false;

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

  /** The header whose tooltip shows, and whether it is the mouse's. */
  @state()
  private tip: {
    column: ColumnDef;
    anchor: HTMLElement;
    hint: boolean;
  } | null = null;

  private rowHeightPx = FALLBACK_ROW_HEIGHT_PX;
  private viewportHeightPx = FALLBACK_VIEWPORT_HEIGHT_PX;

  // Each row's index at the last refresh, with the sort and the tick it was
  // taken at, and the rows that changed place since, for updated() to glide.
  private lastIndex = new Map<string, number>();
  private lastSort = "";
  private lastTick = 0;
  private moves = new Map<string, { from: number; to: number }>();

  createRenderRoot() {
    return this;
  }

  willUpdate(changed: Map<string, unknown>) {
    // A hidden table takes its headers, and so their tooltip, with it.
    if (changed.has("visible") && !this.visible) this.tip = null;
    // Opened again, it has no order of before to glide from.
    if (changed.has("visible") && !this.visible) this.lastIndex.clear();
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
    this.glideMovedRows(scroller);
  }

  // Rows that changed place glide from where they were. Your row and its
  // neighbours snap when they are held at an edge: they are not where their
  // index puts them.
  private glideMovedRows(scroller: HTMLElement) {
    const moves = this.moves;
    if (moves.size === 0) return;
    this.moves = new Map();
    if (!("animate" in scroller) || prefersReducedMotion()) return;
    const moved = [
      ...scroller.querySelectorAll<HTMLElement>(".stats-table-row"),
    ].flatMap((row) => {
      const move = moves.get(row.dataset.key ?? "");
      return move === undefined ? [] : [{ row, ...move }];
    });
    // Counted in view, with the row partly above it: the rows drawn beyond
    // it trade places all game long, unseen.
    const top = this.scrollOffsetPx - this.rowHeightPx;
    const bottom = this.scrollOffsetPx + this.viewportHeightPx;
    const seen = moved.filter(({ to }) => {
      const at = to * this.rowHeightPx;
      return at >= top && at < bottom;
    });
    if (seen.length > GLIDE_MAX_ROWS) return;
    const held =
      this.heldBlock(this.rows.findIndex((row) => row.pinned)).edge !== null;
    for (const { row, from, to } of moved) {
      if (
        (row.hasAttribute("data-me") || row.hasAttribute("data-near")) &&
        (held || this.outOfView(from) || this.outOfView(to))
      ) {
        continue;
      }
      const rows = Math.max(
        -GLIDE_MAX_DISTANCE,
        Math.min(GLIDE_MAX_DISTANCE, from - to),
      );
      const glide = row.animate(
        [
          { transform: `translateY(${rows * this.rowHeightPx}px)` },
          { transform: "none" },
        ],
        GLIDE,
      );
      if (to < from) {
        row.toggleAttribute("data-climbing", true);
        void glide.finished.then(() => row.removeAttribute("data-climbing"));
      }
    }
  }

  private outOfView(index: number) {
    const top = index * this.rowHeightPx;
    return (
      top < this.scrollOffsetPx ||
      top + this.rowHeightPx > this.scrollOffsetPx + this.viewportHeightPx
    );
  }

  private onScroll(event: Event) {
    this.scrollOffsetPx = (event.target as HTMLElement).scrollTop;
  }

  refresh() {
    if (this.visible) this.updateStats();
  }

  /**
   * Columns this render shows: every non-hideable column plus the hideable
   * ones the column menu has selected, in registry order.
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

  private tooltipId() {
    return `${this.tableKind}-column-tooltip`;
  }

  private hideTip(column: ColumnDef) {
    if (this.tip?.column.id === column.id) this.tip = null;
  }

  // The browser's own menu never opens on the table. On the header row a
  // right-click asks the host for the column menu, at the pointer.
  private onContextMenu(event: MouseEvent) {
    event.preventDefault();
    const target = event.target;
    if (
      !(target instanceof Element) ||
      !target.closest(".stats-table-header")
    ) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent<{ x: number; y: number }>("columns-menu", {
        detail: { x: event.clientX, y: event.clientY },
        bubbles: true,
      }),
    );
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
    this.noteMoves(this.game);
    this.requestUpdate();
  }

  /**
   * Your row, and when you rank below the rows the list shows, the row above
   * it and, on a list of seven rows or more, the row below. Empty when no
   * row is yours.
   */
  private heldBlock(myIndex: number): HeldBlock {
    if (myIndex < 0) return { from: 0, to: 0, edge: null };
    const shown = Math.round(this.viewportHeightPx / this.rowHeightPx);
    const below = myIndex >= shown;
    const from = below ? myIndex - 1 : myIndex;
    const to =
      below && shown >= 7
        ? Math.min(myIndex + 2, this.rows.length)
        : myIndex + 1;
    const top = from * this.rowHeightPx;
    const bottom = to * this.rowHeightPx;
    let edge: HeldBlock["edge"] = null;
    if (top < this.scrollOffsetPx) edge = "top";
    else if (bottom > this.scrollOffsetPx + this.viewportHeightPx) {
      edge = "bottom";
    }
    return { from, to, edge };
  }

  // Notes the rows whose index changed since the last refresh. None when the
  // sort changed, or when the clock went back (a replay seek): the old order
  // means nothing then.
  private noteMoves(game: GameView) {
    const sort = `${this.sortKey} ${this.sortOrder}`;
    const tick = game.ticks();
    const comparable = sort === this.lastSort && tick >= this.lastTick;
    const index = new Map<string, number>();
    this.moves = new Map();
    this.rows.forEach((row, to) => {
      index.set(row.key, to);
      const from = this.lastIndex.get(row.key);
      if (comparable && from !== undefined && from !== to) {
        this.moves.set(row.key, { from, to });
      }
    });
    this.lastIndex = index;
    this.lastSort = sort;
    this.lastTick = tick;
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
        aria-label=${column.isOrderable ? nothing : label}
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
        @pointerenter=${(event: PointerEvent) => {
          // A mouse only: on a touch screen a tap sorts.
          if (event.pointerType === "mouse") {
            const anchor = event.currentTarget as HTMLElement;
            this.tip = { column, anchor, hint: true };
          }
        }}
        @pointerleave=${() => this.hideTip(column)}
        @contextmenu=${() => this.hideTip(column)}
      >
        ${
          column.isOrderable
            ? html`<button
                type="button"
                class="${box} ${place.button} ${SORT_BUTTON}"
                aria-label=${label}
                aria-describedby=${
                  this.tip?.column.id === column.id &&
                  COLUMN_MEANING[column.id] !== undefined
                    ? this.tooltipId()
                    : nothing
                }
                @mousedown=${(event: MouseEvent) => {
                  // Focus stays where it was, so Space still holds the
                  // alternate view after a click on a header.
                  event.preventDefault();
                }}
                @click=${() => this.setSort(column.id)}
                @focus=${(event: FocusEvent) => {
                  // The keyboard's only.
                  const anchor = event.currentTarget as HTMLElement;
                  if (anchor.matches(":focus-visible")) {
                    this.tip = { column, anchor, hint: false };
                  }
                }}
                @blur=${() => this.hideTip(column)}
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
    color: string | undefined,
    alive: StatsRow["alive"],
    troopFill: number | undefined,
    marks: readonly RowMark[] = [],
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
    const gauge = troopFill !== undefined;
    return html`
      <div
        class="stats-table-cell ${CELL} ${gauge ? "relative" : ""} ${ALIGNMENT_CLASS[column.align]} ${
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
        ${
          isName && color !== undefined
            ? html`<span
                class=${CHIP}
                style="background: ${color}"
                aria-hidden="true"
                data-chip
              ></span>`
            : nothing
        }
        ${gauge ? renderGauge(troopFill) : nothing}
        <span
          class="min-w-0 truncate"
          dir=${isName ? "auto" : nothing}
          title=${isName ? text : nothing}
          >${noClan ? "–" : text}</span
        >${marks.map((mark) => this.renderMark(mark))}
        ${isName && alive !== undefined ? this.renderAlive(alive) : nothing}
      </div>
    `;
  }

  // Named for screen readers and on hover; on screen the numbers are enough.
  private renderAlive({ count, total }: NonNullable<StatsRow["alive"]>) {
    const label = translateText("leaderboard.players_alive");
    return html`<span
      class="${ALIVE} ${count === 0 ? ZERO_TONE : ALIVE_TONE}"
      title="${label} ${count}/${total}"
      data-alive
      ?data-zero=${count === 0}
      ><span class="sr-only">${label} </span>${count}/${total}</span
    >`;
  }

  private renderMark(mark: RowMark) {
    const { icon, tone, label } = ROW_MARK[mark];
    const name = translateText(label);
    return html`<span
      class="${ROW_MARK_BOX} ${tone}"
      role="img"
      aria-label=${name}
      title=${name}
      data-mark=${mark}
      ><of-icon name=${icon} size=${ROW_MARK_SIZE}></of-icon
    ></span>`;
  }

  private renderRow(
    game: GameView,
    columns: readonly ColumnDef[],
    { row, position }: PlacedRow,
    block: HeldBlock,
  ) {
    const state: RowState = row.pinned
      ? "me"
      : row.emphasized
        ? "mate"
        : "other";
    const gaugeColumn: ColumnId = columns.some(
      (column) => column.id === "troops",
    )
      ? "troops"
      : "maxtroops";
    const index = position - 1;
    const held = index >= block.from && index < block.to;
    const near = held && !row.pinned;
    const nearHeld = near && block.edge !== null;
    // Held with neighbours, the block's open side gets the gap: under it at
    // the top, over it at the bottom.
    const outer = block.edge === "bottom" ? block.from : block.to - 1;
    const gap =
      block.to - block.from > 1 && index === outer ? block.edge : null;
    // translate="no": a page translator must not rewrite player names.
    return html`
      <div
        class="stats-table-row grid col-span-full ${ROW} ${
          held ? HELD_CLIMBING : CLIMBING
        } ${ROW_STATE[state]} ${
          held
            ? `${HOLD} ${HOLD_TOP[index - block.from]} ${
                HOLD_BOTTOM[block.to - 1 - index]
              }`
            : ""
        } ${nearHeld ? NEAR_HELD : ""} ${gap === null ? "" : GAP[gap]} ${
          row.onClick
            ? `cursor-pointer ${nearHeld ? NEAR_HELD_HOVER : ROW_HOVER[state]}`
            : ""
        }"
        style="grid-template-columns: subgrid; grid-column: 1 / -1;"
        role="row"
        aria-rowindex=${position + 1}
        translate="no"
        data-key=${row.key}
        ?data-me=${state === "me"}
        ?data-mate=${state === "mate"}
        ?data-near=${near}
        ?data-gap=${gap !== null}
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
              row.color,
              row.alive,
              column.id === gaugeColumn ? row.troopFill : undefined,
              column.id === "player" ? row.marks : undefined,
            );
          },
        )}
        <!-- The list's scrollbar lands on this cell: the browser counts the
        bar's width as the cell's margin and the end track grows to fit it,
        so the bar never covers the last column. -->
        <div aria-hidden="true"></div>
      </div>
    `;
  }

  render() {
    const game = this.game;
    if (!this.visible || game === null) return html``;

    const columns = this.visibleColumns();
    // Virtualize: only rows near the scroll viewport get DOM; spacers keep
    // the scrollbar geometry for the rest. Positions stay list-wide.
    const firstIndex = Math.max(
      0,
      Math.floor(this.scrollOffsetPx / this.rowHeightPx) - OVERSCAN_ROWS,
    );
    const lastIndex = Math.min(
      this.rows.length,
      Math.ceil(
        (this.scrollOffsetPx + this.viewportHeightPx) / this.rowHeightPx,
      ) + OVERSCAN_ROWS,
    );
    // Your row and those held with it are drawn wherever they are, so that
    // they can be held at the edge; the spacer they fall in is split around
    // them. Those spacers change while the list scrolls, so the list keeps
    // no scroll anchor: the browser must not answer them by moving the
    // scroll position.
    const block = this.heldBlock(this.rows.findIndex((row) => row.pinned));
    const items: ListItem[] = [];
    let next = 0; // the first row not yet in items
    const spaceTo = (index: number) => {
      if (index > next) {
        items.push({ spacer: (index - next) * this.rowHeightPx, from: next });
      }
    };
    const place = (index: number) => {
      spaceTo(index);
      items.push({ placed: { row: this.rows[index], position: index + 1 } });
      next = index + 1;
    };
    for (let index = block.from; index < block.to; index++) {
      if (index < firstIndex) place(index);
    }
    for (let index = firstIndex; index < lastIndex; index++) place(index);
    for (let index = block.from; index < block.to; index++) {
      if (index >= lastIndex) place(index);
    }
    spaceTo(this.rows.length);
    // "auto" tracks stay content-sized intrinsically, then split only the
    // spare width supplied by a wider sibling; fixed tracks never stretch.
    // The empty last track is room the host can leave for a button over the
    // end of the header row; it only grows to a scrollbar.
    const gridTemplate = [
      ...columns.map((column) => column.width),
      "minmax(var(--stats-end-track, 0px), max-content)",
    ].join(" ");

    return html`
      <div
        class="stats-table ${TABLE}"
        @keydown=${keepPressKeysFromGame}
        @keyup=${keepPressKeysFromGame}
      >
        <div
          class="overflow-x-auto ${SCROLLBAR}"
          @contextmenu=${this.onContextMenu}
        >
          <div
            class="stats-table-content grid w-max min-w-full"
            style="grid-template-columns: ${gridTemplate};"
            role="table"
            aria-label=${translateText(TABLE_NAME[this.tableKind])}
            aria-rowcount=${this.rows.length + 1}
          >
            <div
              class="stats-table-header grid col-span-full ${HEADER}"
              style="grid-template-columns: subgrid; grid-column: 1 / -1;"
              role="row"
              aria-rowindex="1"
            >
              ${repeat(
                columns,
                (column) => column.id,
                (column, index) => this.renderHeaderCell(column, index),
              )}
            </div>

            <div
              class=${SIZER}
              style="grid-template-columns: subgrid; grid-column: 1 / -1;"
              aria-hidden="true"
              data-sizer
            >
              ${columns.map(
                (column, index) =>
                  html`<div
                    class="${SIZER_CELL} ${index > 0 ? DIVIDER_CLASS : ""}"
                  >
                    ${column.widest().map((text) => html`<span>${text}</span>`)}
                  </div>`,
              )}
            </div>

            <div
              class="stats-table-scroll stats-rows grid col-span-full overflow-y-scroll overflow-x-hidden overscroll-contain [overflow-anchor:none] ${SCROLLBAR} ${this.short ? "[--stats-max-rows:5]" : ""}"
              style="grid-template-columns: subgrid; grid-column: 1 / -1;"
              role="rowgroup"
              @scroll=${this.onScroll}
            >
              ${repeat(
                items,
                (item) =>
                  "spacer" in item
                    ? `spacer-${item.from}`
                    : `row-${item.placed.row.key}`,
                (item) =>
                  "spacer" in item
                    ? html`<div
                        class="stats-table-spacer col-span-full"
                        style="height: ${item.spacer}px"
                        aria-hidden="true"
                      ></div>`
                    : this.renderRow(game, columns, item.placed, block),
              )}
            </div>
          </div>
        </div>
        <column-tooltip
          .column=${this.tip?.column ?? null}
          .anchor=${this.tip?.anchor ?? null}
          .hint=${this.tip?.hint ?? false}
          .tooltipId=${this.tooltipId()}
        ></column-tooltip>
      </div>
    `;
  }
}
