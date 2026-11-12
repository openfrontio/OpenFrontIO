import {
  html,
  LitElement,
  nothing,
  render as litRender,
  type PropertyValues,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "../../components/OfIcon";
import { renderColumnVisual, TABLE_NAME } from "../../components/StatsTable";
import type { ColumnId, StatsTableKind } from "../../StatsConstants";
import { UserSettings } from "../../UserSettings";
import { translateText } from "../../Utils";
import { keepPressKeysFromGame } from "../HudKeys";
import { HUD_ICON_BUTTON, HUD_LABEL } from "../HudModal";
import { gameIdButton } from "./GameIdButton";
import { columnsFor, type ColumnDef } from "./lib/StatsColumns";

// Look. Sizes, colours, radii and spacing of each part live here, so a
// change of look is one edit. The templates below only hold structure.

// Opaque, as every HUD surface that is read. Above the replay viewer (z 9000),
// which also opens it, and under the game's modals (9998 and up). Placed by
// `--menu-x` and `--menu-y`, set once it is drawn and its size is known. On a
// phone it is a sheet along the bottom edge instead, over a scrim.
const MENU =
  "fixed left-(--menu-x) top-(--menu-y) z-9500 hud-modal rounded-xl p-1 flex flex-col w-max max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] text-white whitespace-nowrap animate-hud-rise motion-reduce:animate-none hud-sheet:inset-x-0 hud-sheet:top-auto hud-sheet:bottom-0 hud-sheet:w-auto hud-sheet:max-w-none hud-sheet:max-h-[85dvh] hud-sheet:rounded-b-none hud-sheet:pb-[calc(0.25rem+env(safe-area-inset-bottom))]";
// Under the sheet, over the map: a press there closes the sheet and goes no
// further.
const SCRIM = "fixed inset-0 z-9500 hidden bg-black/50 hud-sheet:block";
const HEAD = "flex shrink-0 items-center gap-2 ps-2";
const BODY = "min-h-0 overflow-y-auto overscroll-contain";
const SECTION = "not-first:mt-1 not-first:border-t not-first:border-white/12";
const SECTION_TITLE =
  "px-2 pt-2 pb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-aquarius";
// Two columns as wide as their items. A group alone spreads its items across
// both, two to a line; two groups side by side take a column each.
// In a sheet, where names wrap, the columns share its width evenly but none
// narrows below its longest word: when two cannot, they go one under the
// other. On a phone held sideways the sheet is wide and short: there the
// groups flow in three columns across it.
const GRID =
  "grid grid-cols-[repeat(2,minmax(0,auto))] gap-x-1 hud-sheet:flex hud-sheet:flex-wrap hud-sheet:landscape:block hud-sheet:landscape:columns-3";
const GROUP =
  "flex min-w-0 flex-col hud-sheet:grow hud-sheet:basis-0 hud-sheet:min-w-min hud-sheet:landscape:break-inside-avoid";
const WIDE_GROUP =
  "col-span-2 grid grid-cols-subgrid hud-sheet:flex hud-sheet:w-full hud-sheet:flex-wrap hud-sheet:gap-x-1 hud-sheet:[&>label]:grow hud-sheet:[&>label]:basis-0 hud-sheet:[&>label]:min-w-min hud-sheet:landscape:break-inside-avoid";
// Quieter than a section's title: it only sorts the list.
const GROUP_TITLE =
  "col-span-full px-2 pt-1.5 pb-0.5 text-[11px] leading-4 font-semibold uppercase tracking-[0.08em] text-white/45 hud-sheet:w-full";
// The whole line is the checkbox's label; the box itself is only for the
// keyboard and screen readers, so the line shows its focus. Taller in a
// sheet, for a thumb, and as tall as its name when that wraps; a little
// shorter on a phone on its side, so the list fits its height.
const ITEM =
  "flex h-7 cursor-pointer items-center gap-2 rounded-lg px-2 text-[13px] text-white/70 transition-colors hover:bg-white/10 active:bg-white/15 has-checked:text-white has-disabled:cursor-default has-disabled:opacity-60 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-aquarius hud-sheet:h-auto hud-sheet:min-h-9 hud-sheet:py-1 hud-sheet:landscape:min-h-8";
// As wide as the widest visual (an icon with "/m"). Icons sit at its end, so
// each is as far from its name as the others and every name starts on the
// same line.
const VISUAL = "flex w-8 shrink-0 items-center justify-end";
const VISUAL_SIZE = 16;
// Truncated in the popover, where the title gives the whole name; a sheet
// has no pointer to hover with, so its names wrap.
const NAME = "min-w-0 flex-1 truncate hud-sheet:whitespace-normal";
const CHECK = "ms-2 shrink-0 text-aquarius invisible peer-checked:visible";
const FOOT =
  "mt-1 flex shrink-0 items-center gap-2 border-t border-white/12 pt-1 ps-2";
const FOOT_LABEL = "text-[11px] text-white/55";
// The least room the menu leaves to each edge of the window: half the
// `1rem` its width and height are capped by.
const EDGE = 8;

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
  /** Shown in the footer when not empty: the host's bar hides its own copy on
   *  portrait phones. */
  @property({ attribute: false }) gameId = "";

  @state() private open = false;
  private anchor: Anchor | null = null;
  private returnFocus: HTMLElement | null = null;
  private portal: HTMLDivElement | null = null;
  // The icons inside draw a moment after the menu, and change its size: it
  // is placed again then. Not in jsdom, which has no ResizeObserver.
  private readonly menuResize =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(([entry]) => {
          if (this.anchor !== null) {
            this.place(entry.target as HTMLElement, this.anchor);
          }
        });
  private readonly userSettings = new UserSettings();

  createRenderRoot() {
    return this; // light DOM for Tailwind
  }

  // Listened to on the press, and in the capture phase: the menu goes as the
  // map or anything else is touched, whatever their own handlers stop.
  private onDocumentPointerDown = (e: PointerEvent) => {
    const target = e.target as Node;
    if (!this.open || this.portal?.contains(target)) return;
    // The button the menu came from and a right-click on a header toggle it
    // themselves.
    const opener = this.anchor instanceof HTMLElement ? this.anchor : null;
    if (opener?.contains(target)) return;
    if (
      e.button === 2 &&
      target instanceof Element &&
      target.closest(".stats-table-header")
    ) {
      // The header would take focus, and the menu would close on losing it
      // before the right-click could.
      e.preventDefault();
      return;
    }
    this.close();
  };

  // Tab out of the menu closes it. A press on its padding or a name focuses
  // the box itself (it has tabindex -1), so that never counts as leaving.
  private onFocusOut = (e: FocusEvent) => {
    const next = e.relatedTarget;
    if (this.open && !(next instanceof Node && this.portal?.contains(next))) {
      this.close();
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    // The game would also take it: it drops a building being placed.
    e.stopPropagation();
    this.closeAndReturnFocus();
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
    document.addEventListener("pointerdown", this.onDocumentPointerDown, true);
    window.addEventListener("resize", this.onViewportChange);
    window.addEventListener("scroll", this.onViewportChange, true);
  }

  disconnectedCallback() {
    document.removeEventListener(
      "pointerdown",
      this.onDocumentPointerDown,
      true,
    );
    window.removeEventListener("resize", this.onViewportChange);
    window.removeEventListener("scroll", this.onViewportChange, true);
    this.removePortal();
    super.disconnectedCallback();
  }

  protected updated(changed: PropertyValues) {
    this.renderPortal();
    if (changed.has("open") && this.open) {
      this.portal?.querySelector<HTMLInputElement>("input:enabled")?.focus();
    }
  }

  /** Opens the menu under `button`, or closes it when it is open. */
  openFrom(button: HTMLElement) {
    if (this.open) {
      this.closeAndReturnFocus();
      return;
    }
    button.setAttribute("aria-expanded", "true");
    this.show(button);
  }

  /** Opens the menu at a point of the window, or closes it when it is open. */
  toggleAt(x: number, y: number) {
    if (this.open) {
      this.close();
      return;
    }
    this.show({ x, y });
  }

  private show(anchor: Anchor) {
    // Focus comes back only to a keyboard user's control. After a mouse press
    // nothing keeps it, so the game's keys work at once.
    const focused = document.activeElement;
    this.returnFocus =
      focused instanceof HTMLElement && focused.matches(":focus-visible")
        ? focused
        : null;
    this.anchor = anchor;
    this.open = true;
  }

  close() {
    if (this.anchor instanceof HTMLElement) {
      this.anchor.setAttribute("aria-expanded", "false");
    }
    this.anchor = null;
    this.returnFocus = null;
    this.open = false;
  }

  private closeAndReturnFocus() {
    const returnFocus = this.returnFocus;
    this.close();
    returnFocus?.focus();
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

    const title = translateText("leaderboard.configure_columns");
    const close = translateText("common.close");
    litRender(
      html`
        <!--
          Closed once the press ends, not as it starts: gone any sooner, the
          release and a right-click's context menu would land on the map.
          Until then the press keeps focus in the menu.
        -->
        <div
          class=${SCRIM}
          data-column-scrim
          @pointerdown=${(e: PointerEvent) => e.preventDefault()}
          @click=${() => this.close()}
          @contextmenu=${(e: MouseEvent) => {
            e.preventDefault();
            this.close();
          }}
        ></div>
        <div
          class="column-picker-popover ${MENU}"
          role="dialog"
          aria-label=${title}
          tabindex="-1"
          data-column-menu
          @keydown=${this.onKeyDown}
          @focusout=${this.onFocusOut}
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
              @click=${() => this.closeAndReturnFocus()}
            >
              <of-icon name="close" size="14"></of-icon>
            </button>
          </div>
          <div class=${BODY}>
            ${this.tables.map((kind) => this.renderSection(kind))}
          </div>
          ${
            this.gameId
              ? html`
                  <div class=${FOOT} data-menu-game-id>
                    <span class=${FOOT_LABEL} aria-hidden="true">
                      ${translateText("help_modal.game_id_tooltip")}
                    </span>
                    ${gameIdButton(this.gameId)}
                  </div>
                `
              : nothing
          }
        </div>
      `,
      this.portal,
    );
    const box = this.portal.lastElementChild as HTMLElement;
    this.place(box, anchor);
    this.menuResize?.observe(box);
  }

  // From its measured size, once drawn: under its anchor, or above it when it
  // fits there and not below, then held 8px inside every edge. Under a button
  // the start edges line up: both hosts keep theirs near the window's left
  // edge. A right-click opens it at the pointer.
  private place(box: HTMLElement, anchor: Anchor) {
    const { width, height } = box.getBoundingClientRect();
    let x: number;
    let below: number;
    let above: number;
    if (anchor instanceof HTMLElement) {
      const rect = anchor.getBoundingClientRect();
      x = rect.left;
      below = rect.bottom + 4;
      above = rect.top - 4 - height;
    } else {
      x = anchor.x;
      below = anchor.y;
      above = anchor.y - height;
    }
    const maxX = window.innerWidth - EDGE - width;
    const maxY = window.innerHeight - EDGE - height;
    const y = below > maxY && above >= EDGE ? above : below;
    box.style.setProperty("--menu-x", `${Math.max(EDGE, Math.min(x, maxX))}px`);
    box.style.setProperty("--menu-y", `${Math.max(EDGE, Math.min(y, maxY))}px`);
  }

  private removePortal() {
    this.menuResize?.disconnect();
    this.portal?.remove();
    this.portal = null;
  }

  render() {
    return null;
  }
}
