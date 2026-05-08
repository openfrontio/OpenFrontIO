import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { type ClanBrowseResponse, fetchClans } from "../../ClanApi";
import { translateText } from "../../Utils";
import "./ClanCard";
import { type ClanRole, renderLoadingSpinner } from "./ClanShared";

export interface BrowseState {
  data: ClanBrowseResponse | null;
  page: number;
  query: string;
}

@customElement("clan-browse-view")
export class ClanBrowseView extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) myClanRoles: Map<string, ClanRole> = new Map();
  @property({ type: Array }) myPendingRequests: { tag: string }[] = [];
  @property({ type: Object }) cachedState: BrowseState | null = null;

  @state() private searchQuery = "";
  @state() private browseData: ClanBrowseResponse | null = null;
  @state() private browsePage = 1;
  @state() private loading = false;
  @state() private errorMsg = "";
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;
  private asyncGeneration = 0;

  private emitState() {
    this.dispatchEvent(
      new CustomEvent("browse-updated", {
        detail: {
          data: this.browseData,
          page: this.browsePage,
          query: this.searchQuery,
        } satisfies BrowseState,
        bubbles: true,
        composed: true,
      }),
    );
  }

  async loadBrowse() {
    const gen = ++this.asyncGeneration;
    this.loading = true;
    this.errorMsg = "";
    try {
      const data = await fetchClans(
        this.searchQuery || undefined,
        this.browsePage,
      );
      if (gen !== this.asyncGeneration) return;
      if (data === false) throw new Error("fetch failed");
      this.browseData = data;
      this.emitState();
    } catch {
      if (gen !== this.asyncGeneration) return;
      this.errorMsg = translateText("clan_modal.error_loading");
    } finally {
      if (gen === this.asyncGeneration) this.loading = false;
    }
  }

  private onSearchInput(e: Event) {
    this.searchQuery = (e.target as HTMLInputElement).value;
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.browsePage = 1;
      this.loadBrowse();
    }, 400);
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.cachedState?.data) {
      this.browseData = this.cachedState.data;
      this.browsePage = this.cachedState.page;
      this.searchQuery = this.cachedState.query;
    } else {
      this.loadBrowse();
    }
  }

  disconnectedCallback() {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    super.disconnectedCallback();
  }

  render() {
    if (this.loading && !this.browseData) return renderLoadingSpinner();

    const totalPages = this.browseData
      ? Math.ceil(this.browseData.total / this.browseData.limit)
      : 0;
    const pendingTags = new Set(this.myPendingRequests.map((r) => r.tag));
    const filtered = (this.browseData?.results ?? []).filter(
      (clan) => !this.myClanRoles.has(clan.tag),
    );

    return html`
      <div class="space-y-4">
        <div class="relative">
          <input
            type="text"
            .value=${this.searchQuery}
            @input=${(e: Event) => this.onSearchInput(e)}
            class="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium hover:bg-white/10 text-sm"
            placeholder="${translateText("clan_modal.search_placeholder")}"
          />
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="w-4 h-4 text-white/30 absolute left-3 top-1/2 -translate-y-1/2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </div>

        ${this.errorMsg
          ? html`<p class="text-red-400 text-sm text-center py-4">
              ${this.errorMsg}
            </p>`
          : ""}

        <div class="space-y-3">
          ${filtered.length === 0 && this.browseData
            ? html`<p class="text-white/40 text-sm text-center py-8">
                ${translateText("clan_modal.no_results")}
              </p>`
            : filtered.map(
                (clan) =>
                  html`<clan-card
                    .clan=${clan}
                    ?pending=${pendingTags.has(clan.tag)}
                  ></clan-card>`,
              )}
        </div>

        ${totalPages > 1
          ? html`
              <div class="flex items-center justify-center gap-2 pt-2">
                <button
                  @click=${() => {
                    this.browsePage = Math.max(1, this.browsePage - 1);
                    this.loadBrowse();
                  }}
                  ?disabled=${this.browsePage <= 1}
                  class="px-2 py-1 text-xs font-bold rounded-lg transition-all ${this
                    .browsePage <= 1
                    ? "text-white/20 cursor-not-allowed"
                    : "text-white/60 hover:text-white hover:bg-white/10"}"
                >
                  &lt;
                </button>
                <span class="text-xs text-white/50 font-medium">
                  ${this.browsePage} / ${totalPages}
                </span>
                <button
                  @click=${() => {
                    this.browsePage = Math.min(totalPages, this.browsePage + 1);
                    this.loadBrowse();
                  }}
                  ?disabled=${this.browsePage >= totalPages}
                  class="px-2 py-1 text-xs font-bold rounded-lg transition-all ${this
                    .browsePage >= totalPages
                    ? "text-white/20 cursor-not-allowed"
                    : "text-white/60 hover:text-white hover:bg-white/10"}"
                >
                  &gt;
                </button>
              </div>
            `
          : ""}
      </div>
    `;
  }
}
