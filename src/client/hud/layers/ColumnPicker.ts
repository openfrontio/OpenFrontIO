import { html, LitElement, nothing, render as litRender } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "../../components/OfIcon";
import { renderColumnVisual, TABLE_NAME } from "../../components/StatsTable";
import type { ColumnId, StatsTableKind } from "../../StatsConstants";
import { UserSettings } from "../../UserSettings";
import { translateText } from "../../Utils";
import { keepPressKeysFromGame } from "../HudKeys";
import { HUD_ICON_BUTTON, HUD_LABEL } from "../HudModal";
import { columnsFor, type ColumnDef } from "./lib/StatsColumns";

// Look. Sizes, colours, radii and spacing of each part live here, so a
// change of look is one edit. The templates below only hold structure.

// Opaque, as every HUD surface that is read. Above the replay viewer (z 9000),
// which also opens it, and under the game's modals (9998 and up).
const MENU =
  "fixed z-9500 hud-modal rounded-xl p-1 flex flex-col w-max max-w-[calc(100vw-1rem)] text-white whitespace-nowrap animate-hud-rise motion-reduce:animate-none";
const HEAD = "flex shrink-0 items-center gap-2 ps-2";
const BODY = "min-h-0 overflow-y-auto overscroll-contain";
const SECTION = "not-first:mt-1 not-first:border-t not-first:border-white/12";
const SECTION_TITLE =
  "px-2 pt-2 pb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-aquarius";
// Two columns as wide as their items. A group alone spreads its items across
// both, two to a line; two groups side by side take a column each.
const GRID = "grid grid-cols-[repeat(2,minmax(0,auto))] gap-x-1";
const GROUP = "flex min-w-0 flex-col";
const WIDE_GROUP = "col-span-2 grid grid-cols-subgrid";
// Quieter than a section's title: it only sorts the list.
const GROUP_TITLE =
  "col-span-full px-2 pt-1.5 pb-0.5 text-[11px] leading-4 font-semibold uppercase tracking-[0.08em] text-white/45";
// The whole line is the checkbox's label; the box itself is only for the
// keyboard and screen readers, so the line shows its focus.
const ITEM =
  "flex h-7 cursor-pointer items-center gap-2 rounded-lg px-2 text-[13px] text-white/70 transition-colors hover:bg-white/10 active:bg-white/15 has-checked:text-white has-disabled:cursor-default has-disabled:opacity-60 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-aquarius";
// As wide as the widest visual (an icon with "/m"). Icons sit at its end, so
// each is as far from its name as the others and every name starts on the
// same line.
const VISUAL = "flex w-8 shrink-0 items-center justify-end";
const VISUAL_SIZE = 16;
const NAME = "min-w-0 flex-1 truncate";
const CHECK = "ms-2 shrink-0 text-aquarius invisible peer-checked:visible";

interface MenuGroup {
  readonly title: string;
  readonly columns: readonly ColumnId[];
}

// The menu's groups, top to bottom: a pair sits side by side, a group alone
// spreads across the menu. A column no group names joins the first group, so
// a new one is never missing from the menu.
const MENU_GROUPS: readonly (readonly MenuGroup[])[] = [
  [{ title: "leaderboard.group_identity", columns: ["clan", "playerType"] }],
  [
    {
      title: "leaderboard.group_economy",
      columns: [
        "tiles",
        "gold",
        "goldIncomePerMin",
        "shipTradeGoldPerMin",
        "piracyGoldPerMin",
        "trainTradeGoldPerMin",
      ],
    },
    {
      title: "leaderboard.group_units",
      columns: ["cities", "ports", "factories", "silos", "sams", "warships"],
    },
  ],
  [{ title: "leaderboard.group_military", columns: ["troops", "maxtroops"] }],
  [{ title: "leaderboard.group_diplomacy", columns: ["allies", "betrayals"] }],
];
const GROUPED: ReadonlySet<ColumnId> = new Set(
  MENU_GROUPS.flat().flatMap((group) => group.columns),
);

// Where the menu opens: under a button, or at a right-click.
type Anchor = HTMLElement | { x: number; y: number };

/**
 * The menu that chooses which stat columns each table shows, one section per
 * table in `tables`. It draws nothing in place: the host opens it from its
 * own button or from a right-click on a table's header. A tick is stored
 * here, then `columns-changed` tells the host to refresh its tables.
 */
@customElement("column-picker")
export class ColumnPicker extends LitElement {
  @property({ attribute: false }) tables: readonly StatsTableKind[] = [];

  @state() private open = false;
  private anchor: Anchor | null = null;
  private portal: HTMLDivElement | null = null;
  private readonly userSettings = new UserSettings();

  createRenderRoot() {
    return this; // light DOM for Tailwind
  }

  private onDocumentClick = (e: MouseEvent) => {
    const target = e.target as Node;
    // The button the menu came from toggles it itself.
    const opener = this.anchor instanceof HTMLElement ? this.anchor : null;
    if (
      this.open &&
      !this.portal?.contains(target) &&
      !opener?.contains(target)
    ) {
      this.close();
    }
  };

  private onViewportChange = (event: Event) => {
    const target = event.target;
    if (
      this.open &&
      !(target instanceof Node && this.portal?.contains(target))
    ) {
      this.renderPortal();
    }
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this.onDocumentClick);
    window.addEventListener("resize", this.onViewportChange);
    window.addEventListener("scroll", this.onViewportChange, true);
  }

  disconnectedCallback() {
    document.removeEventListener("click", this.onDocumentClick);
    window.removeEventListener("resize", this.onViewportChange);
    window.removeEventListener("scroll", this.onViewportChange, true);
    this.removePortal();
    super.disconnectedCallback();
  }

  protected updated() {
    this.renderPortal();
  }

  /** Opens the menu under `button`, or closes it when it is open. */
  openFrom(button: HTMLElement) {
    if (this.open) {
      this.close();
      return;
    }
    button.setAttribute("aria-expanded", "true");
    this.anchor = button;
    this.open = true;
  }

  /** Opens the menu at a point of the window, or closes it when it is open. */
  toggleAt(x: number, y: number) {
    if (this.open) {
      this.close();
      return;
    }
    this.anchor = { x, y };
    this.open = true;
  }

  close() {
    if (this.anchor instanceof HTMLElement) {
      this.anchor.setAttribute("aria-expanded", "false");
    }
    this.anchor = null;
    this.open = false;
  }

  private toggle(kind: StatsTableKind, id: ColumnId) {
    const selected = this.userSettings.statsColumns(kind);
    const isSelected = selected.includes(id);
    if (isSelected && selected.length === 1) return; // keep at least one
    const next = columnsFor(kind)
      .map((c) => c.id)
      .filter((cid) => (cid === id ? !isSelected : selected.includes(cid)));
    this.userSettings.setStatsColumns(kind, next);
    this.requestUpdate();
    this.dispatchEvent(
      new Event("columns-changed", { bubbles: true, composed: true }),
    );
  }

  private renderSection(kind: StatsTableKind) {
    const selected = this.userSettings.statsColumns(kind);
    const hideable = columnsFor(kind).filter((column) => column.isHideable);
    const name = translateText(TABLE_NAME[kind]);
    const rows = MENU_GROUPS.map((row, i) =>
      row
        .map((group, j) => ({
          title: group.title,
          columns: hideable.filter(
            (column) =>
              group.columns.includes(column.id) ||
              (i === 0 && j === 0 && !GROUPED.has(column.id)),
          ),
        }))
        .filter((group) => group.columns.length > 0),
    ).filter((row) => row.length > 0);
    return html`
      <div
        class=${SECTION}
        role="group"
        aria-label=${name}
        data-column-section=${kind}
      >
        ${
          this.tables.length > 1
            ? html`<div class=${SECTION_TITLE} aria-hidden="true">${name}</div>`
            : nothing
        }
        <div class=${GRID}>
          ${rows.map((row) =>
            row.map((group) =>
              this.renderGroup(kind, group, selected, row.length === 1),
            ),
          )}
        </div>
      </div>
    `;
  }

  private renderGroup(
    kind: StatsTableKind,
    group: { title: string; columns: readonly ColumnDef[] },
    selected: readonly ColumnId[],
    wide: boolean,
  ) {
    const title = translateText(group.title);
    return html`
      <div class=${wide ? WIDE_GROUP : GROUP} role="group" aria-label=${title}>
        <div class=${GROUP_TITLE} aria-hidden="true">${title}</div>
        ${group.columns.map((column) => this.renderItem(kind, column, selected))}
      </div>
    `;
  }

  private renderItem(
    kind: StatsTableKind,
    column: ColumnDef,
    selected: readonly ColumnId[],
  ) {
    const checked = selected.includes(column.id);
    const name = translateText(column.labelKey);
    return html`
      <label class=${ITEM} data-column=${column.id}>
        <input
          type="checkbox"
          class="peer sr-only"
          .checked=${checked}
          ?disabled=${checked && selected.length === 1}
          @change=${() => this.toggle(kind, column.id)}
        />
        <span class=${VISUAL} aria-hidden="true">
          ${
            column.menuIcon !== undefined
              ? html`<of-icon
                  name=${column.menuIcon}
                  size=${VISUAL_SIZE}
                ></of-icon>`
              : renderColumnVisual(column, VISUAL_SIZE)
          }
        </span>
        <span class=${NAME} title=${name}>${name}</span>
        <of-icon class=${CHECK} name="check" size="14"></of-icon>
      </label>
    `;
  }

  private renderPortal() {
    const anchor = this.anchor;
    if (!this.open || anchor === null || !this.isConnected) {
      this.removePortal();
      return;
    }

    if (this.portal === null) {
      this.portal = document.createElement("div");
      this.portal.className = "column-picker-portal";
      document.body.appendChild(this.portal);
    }

    // Under a button its start edges line up with the button's: both hosts
    // keep their button near the window's left edge, and the menu is wider
    // than the room left of it. A right-click opens it at the pointer.
    let top: number;
    let left: number;
    if (anchor instanceof HTMLElement) {
      const rect = anchor.getBoundingClientRect();
      top = rect.bottom + 4;
      left = rect.left;
    } else {
      top = anchor.y;
      left = anchor.x;
    }
    const maxHeight = Math.max(
      80,
      Math.min(window.innerHeight * 0.4, window.innerHeight - top - 8),
    );

    const title = translateText("leaderboard.configure_columns");
    const close = translateText("common.close");
    litRender(
      html`
        <div
          class="column-picker-popover ${MENU}"
          style="top: ${top}px; left: ${left}px; max-height: ${maxHeight}px;"
          role="dialog"
          aria-label=${title}
          data-column-menu
        >
          <div class=${HEAD}>
            <span class="${HUD_LABEL} hud-caps">${title}</span>
            <button
              type="button"
              class="${HUD_ICON_BUTTON} ms-auto"
              aria-label=${close}
              title=${close}
              @mousedown=${(e: MouseEvent) => e.preventDefault()}
              @keydown=${keepPressKeysFromGame}
              @keyup=${keepPressKeysFromGame}
              @click=${() => this.close()}
            >
              <of-icon name="close" size="14"></of-icon>
            </button>
          </div>
          <div class=${BODY}>
            ${this.tables.map((kind) => this.renderSection(kind))}
          </div>
        </div>
      `,
      this.portal,
    );
  }

  private removePortal() {
    this.portal?.remove();
    this.portal = null;
  }

  render() {
    return null;
  }
}
