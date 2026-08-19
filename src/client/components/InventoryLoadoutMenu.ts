import { html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../Utils";
import { styledSelect } from "./ui/StyledSelect";

/**
 * Saved-loadout controls for the inventory: pick a saved set to equip, store
 * the current set under a name, drop one, or clear every slot at once.
 */
@customElement("inventory-loadout-menu")
export class InventoryLoadoutMenu extends LitElement {
  @property({ attribute: false })
  names: readonly string[] = [];

  /** The saved loadout matching the equipped cosmetics, or "" when none does. */
  @property({ type: String })
  selected = "";

  @property({ type: Boolean })
  canUnequip = false;

  @property({ attribute: false })
  onApply?: (name: string) => void;

  @property({ attribute: false })
  onSave?: (name: string) => void;

  @property({ attribute: false })
  onDelete?: (name: string) => void;

  @property({ attribute: false })
  onUnequipAll?: () => void;

  /** The name typed for the next save; empty means "overwrite the target". */
  @state() private draftName = "";

  /** The controls stay folded away until asked for — they're a power tool. */
  @state() private expanded = false;

  /**
   * The loadout an unnamed save overwrites and Delete removes. It sticks to
   * the last loadout that was equipped as a set, because `selected` goes
   * blank the moment a single slot is changed — which is exactly when the
   * player wants to save that tweak back over the loadout they started from.
   */
  @state() private target = "";

  createRenderRoot() {
    return this;
  }

  willUpdate(changed: PropertyValues<this>) {
    if (changed.has("selected") && this.selected !== "") {
      this.target = this.selected;
    }
    // Drop a target the saved list no longer has: deleted here, deleted in
    // another tab, or a refused save that never made it to storage.
    if (this.target !== "" && !this.names.includes(this.target)) {
      this.target = "";
    }
  }

  /** Typing a name saves a new loadout; otherwise the target is replaced. */
  private saveTarget(): string {
    const typed = this.draftName.trim();
    return typed === "" ? this.target : typed;
  }

  private handleSave() {
    const target = this.saveTarget();
    if (target === "") return;
    this.onSave?.(target);
    this.draftName = "";
  }

  render() {
    return html`<section
      data-inventory-loadout-menu
      aria-label=${translateText("inventory.loadout_presets")}
      class="px-3 pt-3"
    >
      <div class="flex justify-start">
        <button
          type="button"
          data-loadout-toggle
          aria-expanded=${this.expanded ? "true" : "false"}
          aria-controls="inventory-loadout-controls"
          class="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-white/10"
          @click=${() => {
            this.expanded = !this.expanded;
          }}
        >
          ${translateText("inventory.loadout_presets")}
          <svg
            class="h-3.5 w-3.5 transition-transform ${this.expanded
              ? "rotate-180"
              : ""}"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fill-rule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08z"
              clip-rule="evenodd"
            />
          </svg>
        </button>
      </div>
      ${this.expanded ? this.renderControls() : nothing}
    </section>`;
  }

  private renderControls() {
    const options = [
      { value: "", label: translateText("inventory.loadout_none") },
      ...this.names.map((name) => ({ value: name, label: name })),
    ];
    // Both buttons act on a target the dropdown stops showing once the
    // equipped set drifts from it, so they name it themselves.
    const typed = this.draftName.trim();
    const overwrites =
      typed === "" && this.target !== ""
        ? translateText("inventory.loadout_save_over", { name: this.target })
        : "";
    const deletes =
      this.target === ""
        ? ""
        : translateText("inventory.loadout_delete_target", {
            name: this.target,
          });
    return html`<div
      id="inventory-loadout-controls"
      data-loadout-controls
      class="mt-2 flex flex-wrap items-center justify-start gap-2"
    >
      ${styledSelect({
        options,
        value: this.selected,
        ariaLabel: translateText("inventory.loadout_select"),
        className: "w-full max-w-56",
        onChange: (value: string) => {
          if (value === "") return;
          this.onApply?.(value);
        },
      })}
      <input
        type="text"
        data-loadout-name
        class="h-8 w-full max-w-40 rounded-lg border border-white/20 bg-black/40 px-3 text-xs text-white placeholder-white/40 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        placeholder=${translateText("inventory.loadout_name")}
        aria-label=${translateText("inventory.loadout_name")}
        .value=${this.draftName}
        @input=${(event: Event) => {
          this.draftName = (event.target as HTMLInputElement).value;
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === "Enter") this.handleSave();
        }}
      />
      <button
        type="button"
        data-loadout-save
        title=${overwrites === "" ? nothing : overwrites}
        aria-label=${overwrites === "" ? nothing : overwrites}
        ?disabled=${this.saveTarget() === ""}
        class="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        @click=${() => this.handleSave()}
      >
        ${translateText("inventory.loadout_save")}
      </button>
      <button
        type="button"
        data-loadout-delete
        title=${deletes === "" ? nothing : deletes}
        aria-label=${deletes === "" ? nothing : deletes}
        ?disabled=${this.target === ""}
        class="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        @click=${() => {
          if (this.target === "") return;
          this.onDelete?.(this.target);
        }}
      >
        ${translateText("inventory.loadout_delete")}
      </button>
      <button
        type="button"
        data-inventory-unequip-all
        ?disabled=${!this.canUnequip}
        class="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        @click=${() => this.onUnequipAll?.()}
      >
        ${translateText("inventory.unequip_all")}
      </button>
    </div>`;
  }
}
