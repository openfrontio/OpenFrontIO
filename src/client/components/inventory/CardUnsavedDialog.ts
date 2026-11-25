import { html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../Utils";

export type CardGuardChoice = "save" | "discard" | "keep";

/**
 * "You have N unsaved changes to your card", shown when the player leaves
 * the Player card tab (In game, Back, closing the Inventory) with changes
 * not saved: Save, Discard or Keep editing. Escape keeps editing. Save is
 * off while the changes hold an item the player doesn't own yet.
 */
@customElement("card-unsaved-dialog")
export class CardUnsavedDialog extends LitElement {
  @property({ type: Number }) count = 0;
  @property({ attribute: false }) lines: readonly string[] = [];
  @property({ type: Boolean }) canSave = true;
  /** An item in the changes isn't owned yet: the note says to buy it. */
  @property({ type: Boolean }) buyFirst = false;
  @property({ type: Boolean }) saving = false;
  @property({ attribute: false }) onChoose?: (choice: CardGuardChoice) => void;

  private returnFocusTo: HTMLElement | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    const active = document.activeElement;
    this.returnFocusTo =
      active instanceof HTMLElement && active !== document.body ? active : null;
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
  }

  disconnectedCallback(): void {
    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    super.disconnectedCallback();
    if (this.returnFocusTo?.isConnected) this.returnFocusTo.focus();
    this.returnFocusTo = null;
  }

  protected firstUpdated(changed: PropertyValues): void {
    super.firstUpdated(changed);
    this.querySelector<HTMLElement>(
      "[data-card-guard] button:not([disabled])",
    )?.focus();
  }

  private buttons(): HTMLElement[] {
    return [
      ...this.querySelectorAll<HTMLElement>(
        "[data-card-guard] button:not([disabled])",
      ),
    ];
  }

  // Capture phase: Escape is this dialog's, never the Inventory's behind it.
  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Tab") {
      const items = this.buttons();
      // Every button disabled (a save running): focus stays where it is,
      // never on the page behind this modal dialog.
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && this.contains(active);
      if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key !== "Escape") return;
    event.stopPropagation();
    event.preventDefault();
    this.onChoose?.("keep");
  };

  render() {
    return html`<div
      class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4"
    >
      <div
        data-card-guard
        data-count=${this.count}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="card-guard-title"
        aria-describedby="card-guard-lines"
        class="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-white/10 bg-slate-900 p-5 text-white shadow-2xl"
      >
        <h2 id="card-guard-title" class="text-lg font-bold">
          ${translateText("inventory_card.guard_title", { count: this.count })}
        </h2>
        <div id="card-guard-lines" class="flex flex-col gap-1">
          ${this.lines.map(
            (line) =>
              html`<p data-card-guard-line class="text-sm text-white/70">
                ${line}
              </p>`,
          )}
          ${
            !this.buyFirst
              ? nothing
              : html`<p
                  data-card-guard-buy-first
                  class="text-sm text-amber-200"
                >
                  ${translateText("inventory_card.guard_buy_first")}
                </p>`
          }
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            data-card-guard-save
            ?disabled=${!this.canSave || this.saving}
            class="min-h-11 flex-1 rounded-lg bg-sky-600 px-4 text-sm font-bold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
            @click=${() => this.onChoose?.("save")}
          >
            ${translateText(
              this.saving
                ? "inventory_card.saving"
                : "inventory_card.guard_save",
            )}
          </button>
          <button
            type="button"
            data-card-guard-discard
            ?disabled=${this.saving}
            class="min-h-11 flex-1 rounded-lg border border-white/15 bg-white/5 px-4 text-sm font-bold text-white hover:bg-white/10 disabled:opacity-40"
            @click=${() => this.onChoose?.("discard")}
          >
            ${translateText("inventory_card.discard")}
          </button>
          <button
            type="button"
            data-card-guard-keep
            ?disabled=${this.saving}
            class="min-h-11 flex-1 rounded-lg px-4 text-sm font-bold text-white/80 hover:text-white disabled:opacity-40"
            @click=${() => this.onChoose?.("keep")}
          >
            ${translateText("inventory_card.guard_keep")}
          </button>
        </div>
      </div>
    </div>`;
  }
}
