import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  approveClanRequest,
  type ClanInfo,
  type ClanJoinRequest,
  denyClanRequest,
  fetchClanRequests,
} from "../../ClanApi";
import { translateText } from "../../Utils";
import "../CopyButton";
import { modalHeader } from "../ui/ModalHeader";
import {
  filterRequestsBySearch,
  formatClanDate,
  modalContainerClass,
  renderLoadingSpinner,
  renderMemberSearchInput,
  renderServerPagination,
  showToast,
} from "./ClanShared";

@customElement("clan-requests-view")
export class ClanRequestsView extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property() clanTag = "";
  @property({ type: Object }) selectedClan: ClanInfo | null = null;
  @state() private requests: ClanJoinRequest[] = [];
  @state() private requestsTotal = 0;
  @state() private requestsPage = 1;
  @state() private requestsLimit = 20;
  @state() private memberActionPending = false;
  @state() private loading = false;
  private memberSearch = "";
  private memberSearchDebounce: ReturnType<typeof setTimeout> | null = null;
  connectedCallback() {
    super.connectedCallback();
    this.loadRequests(1);
  }

  disconnectedCallback() {
    if (this.memberSearchDebounce) clearTimeout(this.memberSearchDebounce);
    super.disconnectedCallback();
  }
  private async loadRequests(page: number, showLoading = true) {
    if (showLoading) this.loading = true;
    else this.memberActionPending = true;
    try {
      const data = await fetchClanRequests(this.clanTag, page);
      if (!data) {
        if (showLoading)
          showToast(translateText("clan_modal.failed_to_load_requests"), "red");
        return;
      }
      this.requests = data.results;
      this.requestsTotal = data.total;
      this.requestsLimit = data.limit;
      this.requestsPage = page;
    } finally {
      if (showLoading) this.loading = false;
      else this.memberActionPending = false;
    }
  }

  private async handleApprove(publicId: string) {
    if (this.memberActionPending) return;
    this.memberActionPending = true;
    try {
      const result = await approveClanRequest(this.clanTag, publicId);
      if (result !== true) {
        showToast(translateText(result.error), "red");
        return;
      }
      this.requests = this.requests.filter((r) => r.publicId !== publicId);
      this.requestsTotal--;
      this.dispatchEvent(
        new CustomEvent("request-approved", {
          detail: { publicId },
          bubbles: true,
          composed: true,
        }),
      );
      showToast(translateText("clan_modal.request_approved"), "green");
    } finally {
      this.memberActionPending = false;
    }
  }

  private async handleDeny(publicId: string) {
    if (this.memberActionPending) return;
    this.memberActionPending = true;
    try {
      const result = await denyClanRequest(this.clanTag, publicId);
      if (result !== true) {
        showToast(translateText(result.error), "red");
        return;
      }
      this.requests = this.requests.filter((r) => r.publicId !== publicId);
      this.requestsTotal--;
      this.dispatchEvent(
        new CustomEvent("request-denied", {
          detail: { publicId },
          bubbles: true,
          composed: true,
        }),
      );
      showToast(translateText("clan_modal.request_denied"), "green");
    } finally {
      this.memberActionPending = false;
    }
  }

  private onSearchInput(e: Event) {
    if (this.memberSearchDebounce) clearTimeout(this.memberSearchDebounce);
    this.memberSearchDebounce = setTimeout(() => {
      this.memberSearch = (e.target as HTMLInputElement).value;
      this.requestUpdate();
    }, 200);
  }

  render() {
    if (this.loading)
      return html`<div class="${modalContainerClass}">
        ${modalHeader({
          title: translateText("clan_modal.join_requests"),
          onBack: () => this.back(),
          ariaLabel: translateText("common.back"),
        })}${renderLoadingSpinner()}
      </div>`;

    const totalPages = Math.ceil(this.requestsTotal / this.requestsLimit);
    const filtered = filterRequestsBySearch(this.requests, this.memberSearch);
    return html`
      <div class="${modalContainerClass}">
        ${modalHeader({
          title: translateText("clan_modal.join_requests"),
          onBack: () => this.back(),
          ariaLabel: translateText("common.back"),
          rightContent: html`<span
            class="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-white/10 text-white/50 border border-white/10"
            >${this.requestsTotal}</span
          >`,
        })}
        <div class="flex-1 overflow-y-auto custom-scrollbar mr-1 p-4 lg:p-6">
          ${renderMemberSearchInput(
            (e) => this.onSearchInput(e),
            "clan_modal.search_requests_placeholder",
          )}
          ${filtered.length === 0
            ? html`<div
                class="flex flex-col items-center justify-center p-12 text-center"
              >
                <p class="text-white/40 text-sm">
                  ${translateText("clan_modal.no_requests")}
                </p>
              </div>`
            : html`
                <div class="space-y-3">
                  ${filtered.map(
                    (req) => html`
                      <div
                        class="flex items-center gap-3 bg-white/5 rounded-xl border border-white/10 p-4"
                      >
                        <div class="flex-1 min-w-0">
                          <copy-button
                            compact
                            .copyText=${req.publicId}
                            .displayText=${req.publicId}
                            .showVisibilityToggle=${false}
                            .showCopyIcon=${false}
                          ></copy-button>
                          <span class="text-white/30 text-[10px]">
                            ${translateText("clan_modal.requested_on", {
                              tag: this.selectedClan?.tag ?? this.clanTag,
                              date: formatClanDate(req.createdAt),
                            })}
                          </span>
                        </div>
                        <div class="flex items-center gap-2 shrink-0">
                          <button
                            @click=${() => this.handleApprove(req.publicId)}
                            ?disabled=${this.memberActionPending}
                            class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-all disabled:opacity-50 disabled:pointer-events-none"
                          >
                            ${translateText("clan_modal.approve")}
                          </button>
                          <button
                            @click=${() => this.handleDeny(req.publicId)}
                            ?disabled=${this.memberActionPending}
                            class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-all disabled:opacity-50 disabled:pointer-events-none"
                          >
                            ${translateText("clan_modal.deny")}
                          </button>
                        </div>
                      </div>
                    `,
                  )}
                </div>
                ${totalPages > 1
                  ? renderServerPagination(this.requestsPage, totalPages, (p) =>
                      this.loadRequests(p, false),
                    )
                  : ""}
              `}
        </div>
      </div>
    `;
  }

  private back() {
    this.dispatchEvent(
      new CustomEvent("navigate-back", { bubbles: true, composed: true }),
    );
  }
}
