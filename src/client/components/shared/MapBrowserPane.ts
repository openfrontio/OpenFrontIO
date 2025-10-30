import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { GameMapType, mapCategories } from "../../../core/game/Game";

type FilterKey = "all" | keyof typeof mapCategories;

@customElement("map-browser-pane")
export class MapBrowserPane extends LitElement {
  @property({ type: Number }) selectedMap: GameMapType = GameMapType.World;
  @property({ type: Boolean }) useRandomMap = false;

  @state() private query = "";
  @state() private filter: FilterKey = "all";

  private norm(s: string) {
    return s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  private getFilteredMaps() {
    const q = this.norm(this.query.trim());
    const items: Array<{
      value: GameMapType;
      key: keyof typeof GameMapType;
      category: string;
      name: string;
    }> = [];

    for (const [category, categoryMaps] of Object.entries(mapCategories)) {
      for (const mapValue of Object.values(categoryMaps) as GameMapType[]) {
        const key = (
          Object.keys(GameMapType) as Array<keyof typeof GameMapType>
        ).find((k) => GameMapType[k] === mapValue) as keyof typeof GameMapType;
        const name = translateText(`map.${String(key).toLowerCase()}`);
        items.push({ value: mapValue, key, category, name });
      }
    }
    let filtered = items;
    if (this.filter !== "all")
      filtered = filtered.filter((m) => m.category === this.filter);
    if (q)
      filtered = filtered.filter(
        (m) =>
          this.norm(m.name).includes(q) || this.norm(String(m.key)).includes(q),
      );
    return filtered;
  }

  private selectMap(value: GameMapType) {
    this.dispatchEvent(
      new CustomEvent("map-select", {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private toggleRandom() {
    this.dispatchEvent(
      new CustomEvent("toggle-random", { bubbles: true, composed: true }),
    );
  }

  createRenderRoot() {
    return this;
  }

  render() {
    const maps = this.getFilteredMaps();
    return html`
      <aside
        aria-label=${translateText("map.browser")}
        class="min-h-80 flex flex-col overflow-hidden rounded-xl border border-white/15 bg-zinc-900/40"
      >
        <div class="flex flex-col gap-2 border-b border-white/10 p-3">
          <input
            type="search"
            placeholder="${translateText("common.search")}"
            class="h-11 w-full rounded-xl border border-white/15 bg-zinc-900/60 px-3 text-zinc-100 placeholder:text-zinc-400 outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70"
            .value=${this.query}
            @input=${(e: InputEvent) =>
              (this.query = (e.target as HTMLInputElement).value)}
          />
          <div class="flex flex-wrap gap-2">
            ${["all", ...Object.keys(mapCategories)].map(
              (f) => html`
                <button
                  type="button"
                  class="h-9 cursor-pointer rounded-full border px-3 
                  transition-colors ${this.filter === f
                    ? "border-blue-400/50 bg-blue-500/25 text-blue-50"
                    : "border-white/15 bg-white/5 text-zinc-100 hover:border-white/25"}"
                  aria-pressed=${String(this.filter === f)}
                  @click=${() => (this.filter = f)}
                >
                  ${f === "all"
                    ? translateText("common.all")
                    : translateText(`map_categories.${f}`)}
                </button>
              `,
            )}
            <button
              type="button"
              class="h-9 rounded-full border px-3 flex items-center gap-1.5 transition-all ${this
                .useRandomMap
                ? "border-blue-400/60 bg-gradient-to-r from-blue-500/30 to-blue-600/30 text-blue-50 font-medium shadow-[0_0_8px_rgba(59,130,246,0.35)]"
                : "border-white/15 bg-white/5 text-zinc-200 hover:bg-gradient-to-r hover:from-blue-500/15 hover:to-blue-600/15 hover:border-blue-400/30"}"
              title=${translateText("map.random")}
              aria-pressed=${String(this.useRandomMap)}
              @click=${this.toggleRandom}
            >
              <span
                class="inline-block transition-transform ${this.useRandomMap
                  ? "rotate-[15deg]"
                  : ""}"
                >🎲</span
              >
              <span>${translateText("map.random")}</span>
              ${this.useRandomMap
                ? html`<span
                    class="ml-1 inline-flex items-center justify-center h-5 w-5 rounded-full bg-blue-400/30 text-xs font-bold"
                    >✓</span
                  >`
                : ""}
            </button>
          </div>
        </div>

        <div
          class="grid flex-1 grid-cols-1 gap-4 overflow-auto p-3"
          role="listbox"
          aria-multiselectable="false"
        >
          <div
            class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            role="listbox"
            aria-label="Maps"
          >
            ${maps.length
              ? maps.map(({ value, key, name }) => {
                  const selected =
                    !this.useRandomMap && this.selectedMap === value;
                  return html` <div
                    @click=${() => this.selectMap(value)}
                    @keydown=${(e: KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        this.selectMap(value);
                      }
                    }}
                    tabindex="0"
                    role="option"
                    aria-selected=${String(selected)}
                    class="w-full h-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 rounded-xl"
                  >
                    <map-display
                      .mapKey=${key}
                      .selected=${selected}
                      .translation=${name}
                    ></map-display>
                  </div>`;
                })
              : html`<div class="col-span-full text-sm text-zinc-400">
                  ${translateText("common.no_results") ?? "No maps found."}
                </div>`}
          </div>
        </div>
      </aside>
    `;
  }
}
