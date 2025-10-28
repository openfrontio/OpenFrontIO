import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

type Item = { id: string; name: string };

@customElement("of-presets-bar")
export class PresetsBar extends LitElement {
  @property({ type: Array }) items: Item[] = [];
  @property({ type: String }) selectedId: string | null = null;
  @property({ type: String }) nameInput = "";
  @property({ type: String }) error = "";
  @property({ type: Number }) limit = 10;

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <footer
        class="sticky bottom-0 flex items-center justify-between border-t border-white/15 bg-gradient-to-t from-zinc-900/95 to-zinc-900/70 px-3 py-2 backdrop-blur"
      >
        <div class="flex items-center gap-1.5 flex-wrap">
          <select
            class="h-9 rounded-lg border border-white/15 bg-zinc-900 px-2 text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 appearance-none"
            .value=${this.selectedId ?? ""}
            @change=${(e: Event) =>
              this.emit(
                "select",
                (e.target as HTMLSelectElement).value || null,
              )}
            aria-label="Select preset"
            title="Select preset"
          >
            <option class="bg-zinc-900 text-zinc-100" value="">
              — Presets —
            </option>
            ${this.items.map(
              (p) => html`
                <option class="bg-zinc-900 text-zinc-100" value=${p.id}>
                  ${p.name}
                </option>
              `,
            )}
          </select>

          <span class="text-xs text-zinc-400 ml-1"
            >(${this.items.length}/${this.limit})</span
          >

          <input
            type="text"
            placeholder="Name"
            class="h-9 w-36 rounded-lg border border-white/15 bg-zinc-900 px-2 text-zinc-100 placeholder:text-zinc-400 outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70"
            .value=${this.nameInput}
            @input=${(e: InputEvent) =>
              this.emit("name-input", (e.target as HTMLInputElement).value)}
            aria-label="Preset name"
          />

          <button
            class="h-9 w-9 grid place-items-center rounded-lg border border-blue-400/40 bg-blue-500/15 text-blue-50 hover:bg-blue-500/25 disabled:opacity-50"
            @click=${() => this.emit("save")}
            ?disabled=${!this.nameInput.trim() ||
            this.items.length >= this.limit}
            aria-label="Save new preset"
            title="Save new preset"
          >
            💾
          </button>

          <button
            class="h-9 w-9 grid place-items-center rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 disabled:opacity-50"
            @click=${() => this.emit("update")}
            ?disabled=${!this.selectedId || !this.nameInput.trim()}
            aria-label="Update selected preset"
            title="Update selected preset"
          >
            ⟳
          </button>

          <button
            class="h-9 w-9 grid place-items-center rounded-lg border border-red-400/40 bg-red-500/15 text-red-50 hover:bg-red-500/25 disabled:opacity-50"
            @click=${() => this.emit("delete")}
            ?disabled=${!this.selectedId}
            aria-label="Delete selected preset"
            title="Delete selected preset"
          >
            🗑️
          </button>

          ${this.error
            ? html`<span class="ml-1 text-xs text-red-400">${this.error}</span>`
            : null}
        </div>

        <slot name="right"></slot>
      </footer>
    `;
  }

  private emit(
    type: "select" | "save" | "update" | "delete" | "name-input",
    detail?: any,
  ) {
    this.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true }),
    );
  }
}
