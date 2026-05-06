import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { invalidateUserMe } from "../../Api";
import {
  type ClanInfo,
  type ClanMember,
  fetchClanMembers,
  transferLeadership,
} from "../../ClanApi";
import { translateText } from "../../Utils";
import "../ConfirmDialog";
import "../CopyButton";
import { modalHeader } from "../ui/ModalHeader";
import {
  filterMembersBySearch,
  modalContainerClass,
  renderLoadingSpinner,
  renderMemberSearchInput,
  renderRoleIcon,
  renderServerPagination,
  showToast,
  translateClanRole,
} from "./ClanShared";

@customElement("clan-transfer-view")
export class ClanTransferView extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property() clanTag = "";
  @property({ type: Object }) selectedClan: ClanInfo | null = null;

  @state() private transferTarget: string | null = null;
  @state() private actionPending = false;
  @state() private members: ClanMember[] = [];
  @state() private membersTotal = 0;
  @state() private memberPage = 1;
  @state() private membersPerPage = 10;
  @state() private loading = false;
  @state() private errorMsg = "";
  @state() private confirmAction: "transfer" | null = null;
  private memberSearch = "";
  private memberSearchDebounce: ReturnType<typeof setTimeout> | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.loadMembers(1);
  }

  disconnectedCallback() {
    if (this.memberSearchDebounce) clearTimeout(this.memberSearchDebounce);
    super.disconnectedCallback();
  }

  private async loadMembers(page: number) {
    if (page === 1) this.loading = true;
    const res = await fetchClanMembers(this.clanTag, page, this.membersPerPage);
    if (!res) {
      this.loading = false;
      return;
    }
    if (res.results.length === 0 && page > 1) {
      await this.loadMembers(1);
      return;
    }
    this.members = res.results;
    this.membersTotal = res.total;
    this.memberPage = res.page;
    this.transferTarget = null;
    this.loading = false;
  }

  private async handleTransfer() {
    if (!this.transferTarget || this.actionPending) return;
    this.actionPending = true;
    this.errorMsg = "";
    try {
      const result = await transferLeadership(
        this.clanTag,
        this.transferTarget,
      );
      if (result !== true) {
        showToast(translateText(result.error), "red");
        this.errorMsg = translateText(result.error);
        return;
      }
      invalidateUserMe();
      this.dispatchEvent(
        new CustomEvent("leadership-transferred", {
          detail: { tag: this.clanTag },
          bubbles: true,
          composed: true,
        }),
      );
      showToast(translateText("clan_modal.leadership_transferred"), "green");
    } finally {
      this.actionPending = false;
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
          title: translateText("clan_modal.transfer_leadership"),
          onBack: () => this.back(),
          ariaLabel: translateText("common.back"),
        })}${renderLoadingSpinner()}
      </div>`;

    const nonLeaders = this.members.filter(
      (m: ClanMember) => m.role !== "leader",
    );
    const totalMemberPages = Math.ceil(this.membersTotal / this.membersPerPage);

    return html`
      ${this.renderContent(nonLeaders, totalMemberPages)}
      ${this.renderConfirmOverlay()}
    `;
  }

  private renderConfirmOverlay() {
    if (this.confirmAction !== "transfer" || !this.transferTarget) return "";
    return html`<confirm-dialog
      .message=${translateText("clan_modal.confirm_transfer", {
        name: this.transferTarget,
      })}
      variant="warning"
      ?disabled=${this.actionPending}
      @confirm=${() => {
        this.confirmAction = null;
        this.handleTransfer();
      }}
      @cancel=${() => {
        this.confirmAction = null;
      }}
    ></confirm-dialog>`;
  }

  private renderContent(nonLeaders: ClanMember[], totalMemberPages: number) {
    return html`
      <div class="${modalContainerClass}">
        ${modalHeader({
          title: translateText("clan_modal.transfer_leadership"),
          onBack: () => this.back(),
          ariaLabel: translateText("common.back"),
        })}
        <div class="flex-1 overflow-y-auto custom-scrollbar mr-1 p-4 lg:p-6">
          <div class="space-y-6">
            ${this.errorMsg
              ? html`<p class="text-red-400 text-sm">${this.errorMsg}</p>`
              : ""}

            <div
              class="bg-amber-500/10 rounded-xl border border-amber-500/20 p-4"
            >
              <p class="text-amber-400/80 text-sm">
                ${translateText("clan_modal.transfer_warning")}
              </p>
            </div>

            ${renderMemberSearchInput((e) => this.onSearchInput(e))}

            <div class="space-y-2">
              ${filterMembersBySearch(nonLeaders, this.memberSearch).map(
                (m) => html`
                  <button
                    @click=${() => (this.transferTarget = m.publicId)}
                    class="w-full flex items-center gap-3 py-2.5 px-3 rounded-xl border cursor-pointer transition-all text-left focus:outline-none focus:ring-2 focus:ring-amber-500/50
                      ${this.transferTarget === m.publicId
                      ? "bg-amber-500/10 border-amber-500/20"
                      : "bg-white/5 border-white/10 hover:bg-white/10"}"
                    aria-selected=${this.transferTarget === m.publicId}
                  >
                    <div
                      class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/50 text-xs font-bold shrink-0"
                    >
                      ${renderRoleIcon(m.role)}
                    </div>
                    <div class="flex-1 min-w-0">
                      <copy-button
                        compact
                        .copyText=${m.publicId}
                        .displayText=${m.publicId}
                        .showVisibilityToggle=${false}
                        .showCopyIcon=${false}
                      ></copy-button>
                    </div>
                    <span
                      class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0
                        ${m.role === "officer"
                        ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                        : "bg-white/10 text-white/40 border border-white/10"}"
                    >
                      ${translateClanRole(m.role)}
                    </span>
                    ${this.transferTarget === m.publicId
                      ? html`<svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="w-5 h-5 text-amber-400 shrink-0"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>`
                      : ""}
                  </button>
                `,
              )}
            </div>

            ${totalMemberPages > 1
              ? renderServerPagination(this.memberPage, totalMemberPages, (p) =>
                  this.loadMembers(p),
                )
              : ""}

            <button
              @click=${() => (this.confirmAction = "transfer")}
              class="w-full px-6 py-3 text-sm font-bold text-white uppercase tracking-wider rounded-xl transition-all border disabled:opacity-50 disabled:pointer-events-none
                ${this.transferTarget && !this.actionPending
                ? "bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 shadow-lg hover:shadow-amber-900/40 border-white/5"
                : "bg-white/5 border-white/10 text-white/30 cursor-not-allowed"}"
              ?disabled=${!this.transferTarget || this.actionPending}
            >
              ${this.transferTarget
                ? translateText("clan_modal.confirm_transfer", {
                    name: this.transferTarget,
                  })
                : translateText("clan_modal.select_new_leader")}
            </button>
          </div>
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
