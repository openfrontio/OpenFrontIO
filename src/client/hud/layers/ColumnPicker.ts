import { html, LitElement, render as litRender } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { TABLE_NAME } from "../../components/StatsTable";
import type { ColumnId, StatsTableKind } from "../../StatsConstants";
import { UserSettings } from "../../UserSettings";
import { translateText } from "../../Utils";
import { columnsFor } from "./lib/StatsColumns";

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
    return html`
      <div class="flex flex-col gap-1" data-column-section=${kind}>
        ${
          this.tables.length > 1
            ? html`<div class="text-xs text-white/70">
                ${translateText(TABLE_NAME[kind])}
              </div>`
            : null
        }
        ${columnsFor(kind)
          .filter((column) => column.isHideable)
          .map((column) => {
            const checked = selected.includes(column.id);
            return html`
              <label
                class="flex items-center gap-2 text-xs lg:text-sm text-white cursor-pointer"
              >
                <input
                  type="checkbox"
                  .checked=${checked}
                  ?disabled=${checked && selected.length === 1}
                  @change=${() => this.toggle(kind, column.id)}
                />
                ${translateText(column.labelKey)}
              </label>
            `;
          })}
      </div>
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

    // Under a button its end edges line up with the button's; a right-click
    // opens it at the pointer.
    let top: number;
    let side: string;
    if (anchor instanceof HTMLElement) {
      const rect = anchor.getBoundingClientRect();
      top = rect.bottom + 4;
      side = `right: ${Math.max(8, window.innerWidth - rect.right)}px`;
    } else {
      top = anchor.y;
      side = `left: ${anchor.x}px`;
    }
    const maxHeight = Math.max(
      80,
      Math.min(window.innerHeight * 0.4, window.innerHeight - top - 8),
    );

    // Above the replay viewer (z 9000), which also opens it, and under the
    // game's modals (9998 and up).
    litRender(
      html`
        <div
          class="column-picker-popover fixed z-9500 hud-modal rounded-md p-2 flex flex-col gap-2 overflow-y-auto whitespace-nowrap"
          style="top: ${top}px; ${side}; max-height: ${maxHeight}px;"
          data-column-menu
        >
          ${this.tables.map((kind) => this.renderSection(kind))}
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
