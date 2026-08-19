import { html, LitElement } from "lit";
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

  /** The name typed for the next save; empty means "overwrite the selection". */
  @state() private draftName = "";

  createRenderRoot() {
    return this;
  }

  /** Typing a name saves a new loadout; otherwise the selected one is replaced. */
  private saveTarget(): string {
    const typed = this.draftName.trim();
    return typed === "" ? this.selected : typed;
  }

  private handleSave() {
    const target = this.saveTarget();
    if (target === "") return;
    this.onSave?.(target);
    this.draftName = "";
  }

  render() {
    const options = [
      { value: "", label: translateText("inventory.loadout_none") },
      ...this.names.map((name) => ({ value: name, label: name })),
    ];
    return html`<section
      data-inventory-loadout-menu
      aria-label=${translateText("inventory.loadout_presets")}
      class="flex flex-wrap items-center justify-center gap-2 px-3 pt-3"
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
        ?disabled=${this.saveTarget() === ""}
        class="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        @click=${() => this.handleSave()}
      >
        ${translateText("inventory.loadout_save")}
      </button>
      <button
        type="button"
        data-loadout-delete
        ?disabled=${this.selected === ""}
        class="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        @click=${() => {
          if (this.selected === "") return;
          this.onDelete?.(this.selected);
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
    </section>`;
  }
}
