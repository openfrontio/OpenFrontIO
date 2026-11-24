import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../Utils";

/**
 * The In game tab's device loadouts: a dropdown of the saved loadouts
 * (choosing one equips it), "<name> · edited" with Update when the current
 * look differs from the active loadout, "Save as new loadout…", and Delete
 * and Unequip all as small text actions.
 */
@customElement("inventory-loadout-select")
export class InventoryLoadoutSelect extends LitElement {
  @property({ attribute: false }) names: readonly string[] = [];
  /** The active loadout's name, or "" for none. */
  @property({ type: String }) active = "";
  /** The current look differs from the active loadout. */
  @property({ type: Boolean }) edited = false;
  @property({ type: Boolean }) canAdd = true;
  @property({ type: Boolean }) canUnequip = true;
  @property({ attribute: false }) onSelect?: (name: string) => void;
  @property({ attribute: false }) onAdd?: () => void;
  @property({ attribute: false }) onUpdate?: (name: string) => void;
  @property({ attribute: false }) onDelete?: (name: string) => void;
  @property({ attribute: false }) onUnequipAll?: () => void;

  createRenderRoot() {
    return this;
  }

  // Options re-render under the select; keep its value on the active one.
  protected updated(): void {
    const select = this.querySelector<HTMLSelectElement>(
      "[data-loadout-select]",
    );
    if (select !== null) {
      select.value = this.names.includes(this.active) ? this.active : "";
    }
  }

  private label(name: string): string {
    return translateText("inventory.loadout_slot", { name });
  }

  render() {
    const active = this.names.includes(this.active) ? this.active : "";
    return html`<section
      data-inventory-loadout-menu
      aria-label=${translateText("inventory.loadout_presets")}
      class="flex flex-col gap-2"
    >
      <div class="flex items-center gap-2">
        <select
          data-loadout-select
          aria-label=${translateText("inventory.loadout_presets")}
          class="min-h-11 min-w-0 flex-1 rounded-lg border border-white/15 bg-black/40 px-3 text-sm font-bold text-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          @change=${(event: Event) => {
            const name = (event.target as HTMLSelectElement).value;
            if (name !== "") this.onSelect?.(name);
          }}
        >
          ${
            active === ""
              ? html`<option value="" selected disabled>
                  ${translateText(
                    this.names.length === 0
                      ? "inventory.loadout_none_saved"
                      : "inventory.loadout_none_active",
                  )}
                </option>`
              : nothing
          }
          ${this.names.map(
            (name) =>
              html`<option
                data-loadout-slot=${name}
                value=${name}
                ?selected=${name === active}
              >
                ${this.label(name)}
              </option>`,
          )}
        </select>
        ${
          active !== "" && this.edited
            ? html`<button
                type="button"
                data-loadout-update
                class="min-h-11 shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-500"
                @click=${() => this.onUpdate?.(active)}
              >
                ${translateText("inventory.loadout_update")}
              </button>`
            : nothing
        }
      </div>
      ${
        active !== "" && this.edited
          ? html`<span
              data-loadout-edited
              class="px-1 text-xs font-semibold text-amber-200"
              >${translateText("inventory.loadout_edited", {
                name: this.label(active),
              })}</span
            >`
          : nothing
      }
      <div class="flex flex-wrap items-center gap-x-3">
        <button
          type="button"
          data-loadout-add
          ?disabled=${!this.canAdd}
          class="min-h-11 text-left text-xs font-semibold text-white/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          @click=${() => this.onAdd?.()}
        >
          ${translateText("inventory.loadout_save_new")}
        </button>
        ${
          active !== ""
            ? html`<button
                type="button"
                data-loadout-delete=${active}
                aria-label=${translateText("inventory.loadout_delete_target", {
                  name: this.label(active),
                })}
                class="min-h-11 text-xs font-semibold text-white/50 hover:text-white"
                @click=${() => this.onDelete?.(active)}
              >
                ${translateText("inventory.loadout_delete")}
              </button>`
            : nothing
        }
        <button
          type="button"
          data-inventory-unequip-all
          ?disabled=${!this.canUnequip}
          class="ml-auto min-h-11 text-xs font-semibold text-white/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          @click=${() => this.onUnequipAll?.()}
        >
          ${translateText("inventory.unequip_all")}
        </button>
      </div>
    </section>`;
  }
}
