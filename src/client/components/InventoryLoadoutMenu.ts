import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../Utils";

/**
 * The loadout slot bar: one button per saved slot, a button to add another,
 * and the clear-everything action. The active slot mirrors whatever is
 * equipped, so there is nothing to save by hand.
 */
@customElement("inventory-loadout-menu")
export class InventoryLoadoutMenu extends LitElement {
  @property({ attribute: false })
  names: readonly string[] = [];

  /** The slot equip changes are written into, or "" when none is. */
  @property({ type: String })
  active = "";

  @property({ type: Boolean })
  canAdd = false;

  @property({ type: Boolean })
  canUnequip = false;

  @property({ attribute: false })
  onSelect?: (name: string) => void;

  @property({ attribute: false })
  onAdd?: () => void;

  @property({ attribute: false })
  onDelete?: (name: string) => void;

  @property({ attribute: false })
  onUnequipAll?: () => void;

  createRenderRoot() {
    return this;
  }

  private renderSlot(name: string) {
    const isActive = name === this.active;
    return html`<div
      class="flex items-stretch overflow-hidden rounded-lg border ${isActive
        ? "border-blue-400 bg-blue-500/20"
        : "border-white/15 bg-white/5"}"
    >
      <button
        type="button"
        data-loadout-slot=${name}
        aria-pressed=${isActive ? "true" : "false"}
        aria-label=${translateText("inventory.loadout_slot", { name })}
        class="px-3 py-1.5 text-xs font-black uppercase tracking-wider transition-colors ${isActive
          ? "text-white"
          : "text-white/75 hover:bg-white/10"}"
        @click=${() => this.onSelect?.(name)}
      >
        ${name}
      </button>
      ${isActive
        ? html`<button
            type="button"
            data-loadout-delete=${name}
            aria-label=${translateText("inventory.loadout_delete_target", {
              name,
            })}
            class="border-l border-white/15 px-2 text-xs font-black text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            @click=${() => this.onDelete?.(name)}
          >
            ✕
          </button>`
        : nothing}
    </div>`;
  }

  render() {
    return html`<section
      data-inventory-loadout-menu
      aria-label=${translateText("inventory.loadout_presets")}
      class="flex flex-wrap items-center gap-2 px-3 pt-3"
    >
      ${this.names.map((name) => this.renderSlot(name))}
      <button
        type="button"
        data-loadout-add
        ?disabled=${!this.canAdd}
        aria-label=${translateText("inventory.loadout_add")}
        class="rounded-lg border border-dashed border-white/25 px-3 py-1.5 text-xs font-black text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        @click=${() => this.onAdd?.()}
      >
        +
      </button>
      <button
        type="button"
        data-inventory-unequip-all
        ?disabled=${!this.canUnequip}
        class="ml-auto rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        @click=${() => this.onUnequipAll?.()}
      >
        ${translateText("inventory.unequip_all")}
      </button>
    </section>`;
  }
}
