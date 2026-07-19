import { html, LitElement, render as litRender } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ColumnId } from "../../../core/game/StatsConstants";
import { translateText } from "../../Utils";
import type { ColumnDef } from "./StatsColumns";

/**
 * ⚙️ button + checkbox popover for choosing which stat columns a panel
 * shows. Emits `columns-changed` (CustomEvent<ColumnId[]>) with the new
 * selection in registry order; the host persists and re-renders.
 */
@customElement("column-picker")
export class ColumnPicker extends LitElement {
  @property({ attribute: false }) columns: readonly ColumnDef[] = [];
  @property({ attribute: false }) selected: readonly ColumnId[] = [];

  @state() private open = false;
  private portal: HTMLDivElement | null = null;

  createRenderRoot() {
    return this; // light DOM for Tailwind
  }

  private onDocumentClick = (e: MouseEvent) => {
    const target = e.target as Node;
    if (this.open && !this.contains(target) && !this.portal?.contains(target)) {
      this.open = false;
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

  private toggle(id: ColumnId) {
    const isSelected = this.selected.includes(id);
    if (isSelected && this.selected.length === 1) return; // keep at least one
    const next = this.columns
      .map((c) => c.id)
      .filter((cid) =>
        cid === id ? !isSelected : this.selected.includes(cid),
      );
    this.dispatchEvent(
      new CustomEvent<ColumnId[]>("columns-changed", {
        detail: next,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private renderPortal() {
    if (!this.open || !this.isConnected) {
      this.removePortal();
      return;
    }

    const trigger = this.querySelector("button");
    if (trigger === null) return;

    if (this.portal === null) {
      this.portal = document.createElement("div");
      this.portal.className = "column-picker-portal";
      document.body.appendChild(this.portal);
    }

    const rect = trigger.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - rect.right);
    const top = rect.bottom + 4;
    const maxHeight = Math.max(
      80,
      Math.min(window.innerHeight * 0.4, window.innerHeight - top - 8),
    );

    litRender(
      html`
        <div
          class="column-picker-popover fixed z-2000 bg-gray-800/95 border border-slate-500 rounded-md p-2 flex flex-col gap-1 overflow-y-auto whitespace-nowrap"
          style="top: ${top}px; right: ${right}px; max-height: ${maxHeight}px;"
        >
          ${this.columns.map((column) => {
            const checked = this.selected.includes(column.id);
            return html`
              <label
                class="flex items-center gap-2 text-xs lg:text-sm text-white cursor-pointer"
              >
                <input
                  type="checkbox"
                  .checked=${checked}
                  ?disabled=${checked && this.selected.length === 1}
                  @change=${() => this.toggle(column.id)}
                />
                ${translateText(column.labelKey)}
              </label>
            `;
          })}
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
    return html`
      <button
        class="px-0.5 leading-none text-xs lg:text-sm border rounded-md border-slate-500 transition-colors text-white hover:bg-white/10 bg-gray-700/50"
        title=${translateText("leaderboard.configure_columns")}
        aria-expanded=${this.open}
        aria-haspopup="menu"
        @click=${() => (this.open = !this.open)}
      >
        ⚙️
      </button>
    `;
  }
}
