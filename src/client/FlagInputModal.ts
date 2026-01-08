import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import Countries from "resources/countries.json" with { type: "json" };
import { translateText } from "./Utils";

@customElement("flag-input-modal")
export class FlagInputModal extends LitElement {
  @property({ type: Boolean }) inline = false;
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
    onClose?: () => void;
  };

  @state() private search = "";
  public returnTo = "";

  connectedCallback() {
    super.connectedCallback();
    if (this.hasAttribute("inline")) {
      this.inline = true;
    }
    window.addEventListener("keydown", this.handleKeyDown);
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties);
  }

  firstUpdated() {
    if (this.modalEl) {
      this.modalEl.onClose = () => {
        if (this.returnTo) {
          const returnEl = document.querySelector(this.returnTo) as any;
          if (returnEl?.open) {
            returnEl.open();
          }
          this.returnTo = "";
        }
      };
    }
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleKeyDown);
    super.disconnectedCallback();
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      e.preventDefault();
      this.close();
    }
  };

  render() {
    const content = html`
      <div
        class="h-full flex flex-col bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 shadow-xl overflow-hidden"
      >
        <div
          class="flex items-center mb-4 pb-2 border-b border-white/10 gap-2 shrink-0 p-6"
        >
          <div class="flex items-center gap-4 flex-1">
            <button
              @click=${() => this.close()}
              class="group flex items-center justify-center w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 transition-all border border-white/10"
              aria-label="Back"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-5 h-5 text-gray-400 group-hover:text-white transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
            </button>
            <span
              class="text-white text-xl sm:text-2xl md:text-3xl font-bold uppercase tracking-widest"
            >
              ${translateText("flag_input.title")}
            </span>
          </div>
        </div>

        <div class="flex justify-center w-full px-6 pb-4 shrink-0">
          <input
            class="h-12 w-full max-w-md border border-white/10 bg-black/40
            rounded-xl shadow-inner text-xl text-center focus:outline-none
            focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 text-white placeholder-white/30 transition-all"
            type="text"
            placeholder=${translateText("flag_input.search_flag")}
            @change=${this.handleSearch}
            @keyup=${this.handleSearch}
          />
        </div>

        <div
          class="flex-1 overflow-y-auto px-6 pb-6 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
        >
          <div class="flex flex-wrap justify-center gap-4 min-h-min">
            ${Countries.filter(
              (country) =>
                !country.restricted && this.includedInSearch(country),
            ).map(
              (country) => html`
                <button
                  @click=${() => {
                    this.setFlag(country.code);
                    this.close();
                  }}
                  class="group relative flex flex-col items-center gap-2 p-3 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer
                      w-[100px] sm:w-[120px]"
                >
                  <img
                    class="w-full h-auto rounded shadow-sm group-hover:scale-105 transition-transform duration-200"
                    src="/flags/${country.code}.svg"
                    loading="lazy"
                    @error=${(e: Event) => {
                      const img = e.currentTarget as HTMLImageElement;
                      const fallback = "/flags/xx.svg";
                      if (img.src && !img.src.endsWith(fallback)) {
                        img.src = fallback;
                      }
                    }}
                  />
                  <span
                    class="text-xs font-bold text-gray-300 group-hover:text-white text-center leading-tight w-full truncate"
                    >${country.name}</span
                  >
                </button>
              `,
            )}
          </div>
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        id="flag-input-modal"
        title=${translateText("flag_input.title")}
        ?inline=${this.inline}
        hideHeader
        hideCloseButton
      >
        ${content}
      </o-modal>
    `;
  }

  createRenderRoot() {
    return this;
  }

  private includedInSearch(country: { name: string; code: string }): boolean {
    return (
      country.name.toLowerCase().includes(this.search.toLowerCase()) ||
      country.code.toLowerCase().includes(this.search.toLowerCase())
    );
  }

  private handleSearch(event: Event) {
    this.search = (event.target as HTMLInputElement).value;
  }

  private setFlag(flag: string) {
    localStorage.setItem("flag", flag);
    this.dispatchEvent(
      new CustomEvent("flag-change", {
        detail: { flag },
        bubbles: true,
        composed: true,
      }),
    );
  }

  public open() {
    if (this.inline) {
      const needsShow =
        this.classList.contains("hidden") || this.style.display === "none";
      if (needsShow && (window as any).showPage) {
        (window as any).showPage(this.id || "flag-input-modal");
      }
    } else {
      this.modalEl?.open();
    }
  }
  public close() {
    if (this.inline) {
      if (this.returnTo) {
        const returnEl = document.querySelector(this.returnTo) as any;
        if (returnEl?.open) {
          returnEl.open();
        }
        this.returnTo = "";
      } else if ((window as any).showPage) {
        (window as any).showPage("page-play");
      }
    } else {
      this.modalEl?.close();
    }
  }
}
