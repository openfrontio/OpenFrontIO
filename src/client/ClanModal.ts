import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  type ClanBrowseResponse,
  type ClanInfo,
  type ClanJoinRequest,
  type ClanMember,
  approveClanRequest,
  demoteMember,
  denyClanRequest,
  disbandClan,
  fetchClanDetail,
  fetchClanMembers,
  fetchClanRequests,
  fetchClans,
  getUserMe,
  joinClan,
  kickMember,
  leaveClan,
  promoteMember,
  transferLeadership,
  updateClan,
} from "./Api";
import { BaseModal } from "./components/BaseModal";
import "./components/CopyButton";
import { modalHeader } from "./components/ui/ModalHeader";
import { translateText } from "./Utils";

type ClanRole = "leader" | "officer" | "member";
type Tab = "my-clans" | "browse";
type View = "list" | "detail" | "manage" | "transfer" | "requests";

@customElement("clan-modal")
export class ClanModal extends BaseModal {
  @state() private activeTab: Tab = "my-clans";
  @state() private view: View = "list";
  @state() private loading = false;
  @state() private errorMsg = "";

  // My clans (fetched from real API on open)
  @state() private myClans: ClanInfo[] = [];
  @state() private myPendingRequests: {
    tag: string;
    name: string;
    createdAt: string;
  }[] = [];

  // Browse state
  @state() private searchQuery = "";
  @state() private browseData: ClanBrowseResponse | null = null;
  @state() private browsePage = 1;
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  // Detail state
  @state() private selectedClan: ClanInfo | null = null;
  @state() private myRole: ClanRole | null = null;
  @state() private members: ClanMember[] = [];
  @state() private membersTotal = 0;
  @state() private memberPage = 1;
  @state() private membersPerPage = 10;
  @state() private memberSearch = "";
  @state() private pendingRequestCount = 0;

  // Manage state
  @state() private manageName = "";
  @state() private manageDescription = "";
  @state() private manageIsOpen = true;
  @state() private saving = false;

  // Transfer state
  @state() private transferTarget: string | null = null;

  // Requests state
  @state() private requests: ClanJoinRequest[] = [];
  @state() private requestsTotal = 0;
  @state() private requestsPage = 1;

  private myPublicId: string | null = null;
  private myClanRoles = new Map<string, ClanRole>();

  private readonly perPageOptions = [10, 25, 50];

  connectedCallback() {
    super.connectedCallback();
    getUserMe().then((me) => {
      if (!me) return;
      this.myPublicId = me.player.publicId;
      for (const c of me.player.clans ?? []) {
        this.myClanRoles.set(c.tag, c.role);
      }
    });
  }

  render() {
    const content = this.renderInner();
    if (this.inline) return content;
    return html`
      <o-modal
        id="clan-modal"
        title=""
        ?hideCloseButton=${true}
        ?inline=${this.inline}
        hideHeader
      >
        ${content}
      </o-modal>
    `;
  }

  protected onOpen(): void {
    this.loadMyClans();
    if (this.activeTab === "browse" && !this.browseData) {
      this.loadBrowse();
    }
  }

  private async loadMyClans() {
    const me = await getUserMe();
    if (!me) return;
    this.myPendingRequests = me.player.clanRequests ?? [];
    const tags = me.player.clans?.map((c) => c.tag) ?? [];
    const results = await Promise.all(tags.map((tag) => fetchClanDetail(tag)));
    this.myClans = results.filter((r): r is ClanInfo => r !== false);
  }

  protected onClose(): void {
    this.view = "list";
    this.selectedClan = null;
    this.searchQuery = "";
    this.transferTarget = null;
    this.memberPage = 1;
    this.memberSearch = "";
    this.errorMsg = "";
    this.browseData = null;
  }

  private renderInner() {
    if (this.loading) {
      return html`
        <div class="${this.modalContainerClass}">
          ${modalHeader({
            title: translateText("clan_modal.title"),
            onBack: () => this.close(),
            ariaLabel: translateText("common.back"),
          })}
          ${this.renderLoadingSpinner()}
        </div>
      `;
    }

    if (this.selectedClan) {
      if (this.view === "manage") return this.renderManage();
      if (this.view === "transfer") return this.renderTransfer();
      if (this.view === "requests") return this.renderRequests();
      if (this.view === "detail") return this.renderClanDetail();
    }

    return html`
      <div class="${this.modalContainerClass}">
        ${modalHeader({
          title: translateText("clan_modal.title"),
          onBack: () => this.close(),
          ariaLabel: translateText("common.back"),
        })}
        ${this.renderTabs()}
        <div class="flex-1 overflow-y-auto custom-scrollbar mr-1">
          ${this.activeTab === "my-clans"
            ? this.renderMyClans()
            : this.renderBrowse()}
        </div>
      </div>
    `;
  }

  // ── Tabs & My Clans ─────────────────────────────────────────────

  private renderTabs() {
    const tabs: { key: Tab; label: string }[] = [
      { key: "my-clans", label: translateText("clan_modal.my_clans") },
      { key: "browse", label: translateText("clan_modal.browse") },
    ];

    return html`
      <div class="flex border-b border-white/10 px-4 lg:px-6 gap-1">
        ${tabs.map(
          (tab) => html`
            <button
              @click=${() => {
                this.activeTab = tab.key;
                this.view = "list";
                this.selectedClan = null;
                if (tab.key === "browse" && !this.browseData) {
                  this.loadBrowse();
                }
              }}
              class="px-4 py-3 text-sm font-bold uppercase tracking-wider transition-all relative
                ${this.activeTab === tab.key
                ? "text-blue-400"
                : "text-white/40 hover:text-white/70"}"
            >
              ${tab.label}
              ${this.activeTab === tab.key
                ? html`<div
                    class="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-400"
                  ></div>`
                : ""}
            </button>
          `,
        )}
      </div>
    `;
  }

  private renderMyClans() {
    const hasClans = this.myClans.length > 0;
    const hasRequests = this.myPendingRequests.length > 0;

    if (!hasClans && !hasRequests) {
      return html`
        <div class="flex flex-col items-center justify-center p-12 text-center">
          <p class="text-white/40 text-sm mb-4">
            ${translateText("clan_modal.no_clans")}
          </p>
          <button
            @click=${() => {
              this.activeTab = "browse";
              if (!this.browseData) this.loadBrowse();
            }}
            class="px-6 py-2 text-sm font-bold text-white uppercase tracking-wider bg-blue-600/80 hover:bg-blue-600 border border-blue-500/50 rounded-lg transition-all"
          >
            ${translateText("clan_modal.browse")}
          </button>
        </div>
      `;
    }

    return html`
      <div class="p-4 lg:p-6 space-y-3">
        ${hasRequests ? this.renderPendingRequests() : ""}
        ${this.myClans.map((clan) => this.renderClanCard(clan))}
      </div>
    `;
  }

  private renderPendingRequests() {
    return html`
      <div class="space-y-2 mb-2">
        <h3
          class="text-xs font-bold uppercase tracking-wider text-amber-400/80 px-1"
        >
          ${translateText("clan_modal.pending_applications")}
        </h3>
        ${this.myPendingRequests.map(
          (req) => html`
            <div
              class="flex items-center gap-3 bg-amber-500/5 rounded-xl border border-amber-500/15 p-3"
            >
              <div
                class="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20 shrink-0"
              >
                <span class="text-amber-400 font-bold text-xs">${req.tag}</span>
              </div>
              <div class="flex-1 min-w-0">
                <span class="text-white/80 font-medium text-sm truncate block"
                  >${req.name}</span
                >
                <span class="text-white/30 text-xs">
                  ${translateText("clan_modal.applied")}
                  ${new Date(req.createdAt).toLocaleDateString()}
                </span>
              </div>
              <span
                class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400/70 border border-amber-500/20"
              >
                ${translateText("clan_modal.pending")}
              </span>
            </div>
          `,
        )}
      </div>
    `;
  }

  // ── Browse ──────────────────────────────────────────────────────

  private async loadBrowse() {
    this.loading = true;
    this.errorMsg = "";
    const data = await fetchClans(
      this.searchQuery || undefined,
      this.browsePage,
    );
    this.loading = false;
    if (!data) {
      this.errorMsg = "Failed to load clans";
      return;
    }
    this.browseData = data;
  }

  private onSearchInput(e: Event) {
    this.searchQuery = (e.target as HTMLInputElement).value;
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.browsePage = 1;
      this.loadBrowse();
    }, 400);
  }

  private renderBrowse() {
    const totalPages = this.browseData
      ? Math.ceil(this.browseData.total / this.browseData.limit)
      : 0;

    return html`
      <div class="p-4 lg:p-6 space-y-4">
        <div class="relative">
          <input
            type="text"
            .value=${this.searchQuery}
            @input=${(e: Event) => this.onSearchInput(e)}
            class="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all font-medium hover:bg-white/10 text-sm"
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
          ${this.browseData && this.browseData.results.length === 0
            ? html`<p class="text-white/40 text-sm text-center py-8">
                ${translateText("clan_modal.no_results")}
              </p>`
            : ""}
          ${(this.browseData?.results ?? []).map((clan) =>
            this.renderClanCard(clan),
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
                  class="px-2 py-1 text-xs font-bold rounded-lg transition-all
                    ${this.browsePage <= 1
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
                  class="px-2 py-1 text-xs font-bold rounded-lg transition-all
                    ${this.browsePage >= totalPages
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

  private renderClanCard(clan: ClanInfo, role?: string) {
    return html`
      <button
        @click=${() => this.openClanDetail(clan.tag)}
        class="w-full text-left bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 hover:border-white/20 p-4 transition-all cursor-pointer group"
      >
        <div class="flex items-center gap-4">
          <div
            class="w-12 h-12 rounded-xl bg-gradient-to-br ${clan.isOpen
              ? "from-blue-500/20 to-cyan-500/20"
              : "from-amber-500/20 to-orange-500/20"} flex items-center justify-center border border-white/10 shrink-0"
          >
            <span class="text-white font-bold text-sm">${clan.tag}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-white font-bold truncate">${clan.name}</span>
              ${role
                ? html`<span
                    class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full
                      ${role === "leader"
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      : "bg-blue-500/20 text-blue-400 border border-blue-500/30"}"
                  >
                    ${role}
                  </span>`
                : ""}
              ${clan.isOpen
                ? html`<span
                    class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30"
                  >
                    ${translateText("clan_modal.open")}
                  </span>`
                : html`<span
                    class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30"
                  >
                    ${translateText("clan_modal.invite_only")}
                  </span>`}
            </div>
            <div class="flex items-center gap-4 mt-1 text-xs text-white/40">
              <span>${clan.memberCount} members</span>
            </div>
          </div>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="w-5 h-5 text-white/20 group-hover:text-white/50 transition-colors shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </div>
      </button>
    `;
  }

  // ── Detail ──────────────────────────────────────────────────────

  private async openClanDetail(tag: string) {
    this.loading = true;
    this.errorMsg = "";
    this.myRole = null;
    this.pendingRequestCount = 0;
    this.memberSearch = "";

    const [detail, membersRes] = await Promise.all([
      fetchClanDetail(tag),
      fetchClanMembers(tag, 1, this.membersPerPage),
    ]);

    this.loading = false;

    if (!detail) {
      this.errorMsg = "Failed to load clan";
      return;
    }

    this.selectedClan = detail;
    this.view = "detail";
    this.memberPage = 1;

    if (membersRes) {
      // Members endpoint requires clan membership — if it succeeded, we're in.
      this.members = membersRes.results;
      this.membersTotal = membersRes.total;
      this.pendingRequestCount = membersRes.pendingRequests ?? 0;

      // Use the role from @me if available, otherwise infer from member list.
      const knownRole = this.myClanRoles.get(tag);
      if (knownRole) {
        this.myRole = knownRole;
      } else {
        const me = this.myPublicId
          ? membersRes.results.find((m) => m.publicId === this.myPublicId)
          : null;

        if (me) {
          this.myRole = me.role;
        } else if (this.pendingRequestCount > 0) {
          this.myRole = "officer";
        } else {
          this.myRole = "member";
        }
      }
    } else {
      // 403 = not a member
      this.members = [];
      this.membersTotal = 0;
      this.myRole = null;
    }
  }

  private async loadMemberPage(page: number) {
    if (!this.selectedClan) return;
    const res = await fetchClanMembers(
      this.selectedClan.tag,
      page,
      this.membersPerPage,
    );
    if (res) {
      this.members = res.results;
      this.membersTotal = res.total;
      this.memberPage = page;
      this.pendingRequestCount = res.pendingRequests ?? 0;
    }
  }

  private renderClanDetail() {
    const clan = this.selectedClan!;
    const isMember = this.myRole !== null;
    const isLeader = this.myRole === "leader";
    const isOfficer = this.myRole === "officer";
    const canManageRequests = isLeader || isOfficer;

    return html`
      <div class="${this.modalContainerClass}">
        ${modalHeader({
          title: clan.name,
          onBack: () => {
            this.view = "list";
            this.selectedClan = null;
            this.myRole = null;
          },
          ariaLabel: translateText("common.back"),
          rightContent: html`
            <span
              class="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-white/10 text-white/50 border border-white/10"
            >
              [${clan.tag}]
            </span>
          `,
        })}

        <div class="flex-1 overflow-y-auto custom-scrollbar mr-1 p-4 lg:p-6">
          <div class="space-y-6">
            ${this.errorMsg
              ? html`<p class="text-red-400 text-sm">${this.errorMsg}</p>`
              : ""}

            <!-- Description -->
            <div class="bg-white/5 rounded-xl border border-white/10 p-5">
              <p class="text-white/70 text-sm">
                ${clan.description || "No description"}
              </p>
            </div>

            <!-- Stats Row -->
            <div class="grid grid-cols-2 gap-3">
              ${this.renderStat(
                translateText("clan_modal.members"),
                `${clan.memberCount}`,
              )}
              ${this.renderStat(
                translateText("clan_modal.status"),
                clan.isOpen
                  ? translateText("clan_modal.open")
                  : translateText("clan_modal.invite_only"),
              )}
            </div>

            <!-- Join Requests (leader/officer of invite-only clan) -->
            ${canManageRequests && !clan.isOpen && this.pendingRequestCount > 0
              ? html`
                  <button
                    @click=${() => this.openRequests()}
                    class="w-full flex items-center justify-between bg-amber-500/10 hover:bg-amber-500/15 rounded-xl border border-amber-500/20 p-4 transition-all cursor-pointer group"
                  >
                    <div class="flex items-center gap-3">
                      <div
                        class="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="w-5 h-5 text-amber-400"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                          />
                        </svg>
                      </div>
                      <div class="text-left">
                        <span class="text-amber-400 text-sm font-bold">
                          ${translateText("clan_modal.join_requests")}
                        </span>
                        <span class="text-amber-400/60 text-xs block">
                          ${translateText("clan_modal.pending_requests_count", {
                            count: this.pendingRequestCount,
                          })}
                        </span>
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <span
                        class="px-2.5 py-1 text-xs font-bold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      >
                        ${this.pendingRequestCount}
                      </span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="w-5 h-5 text-amber-400/40 group-hover:text-amber-400/70 transition-colors"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </div>
                  </button>
                `
              : ""}

            <!-- Members list (only visible to clan members) -->
            ${isMember
              ? html`
                  <div
                    class="bg-white/5 rounded-xl border border-white/10 p-5 space-y-3"
                  >
                    <h3
                      class="text-sm font-bold text-white/60 uppercase tracking-wider"
                    >
                      ${translateText("clan_modal.members")}
                    </h3>
                    ${this.renderMemberSearch()}
                    ${(() => {
                      const filtered = this.filterMembers(this.members);
                      return html`
                        <div class="space-y-2">
                          ${this.paginateMembers(filtered).map((m) =>
                            this.renderMemberRow(m, canManageRequests),
                          )}
                        </div>
                        ${this.renderMemberPagination(filtered.length)}
                      `;
                    })()}
                  </div>
                `
              : ""}

            <!-- Actions -->
            <div class="flex flex-wrap gap-3">
              ${!isMember && clan.isOpen
                ? html`
                    <button
                      @click=${() => this.handleJoin()}
                      class="flex-1 px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 rounded-xl transition-all shadow-lg hover:shadow-blue-900/40 border border-white/5"
                    >
                      ${translateText("clan_modal.join_clan")}
                    </button>
                  `
                : ""}
              ${!isMember && !clan.isOpen
                ? html`
                    <button
                      @click=${() => this.handleJoin()}
                      class="flex-1 px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 rounded-xl transition-all shadow-lg hover:shadow-amber-900/40 border border-white/5"
                    >
                      ${translateText("clan_modal.request_invite")}
                    </button>
                  `
                : ""}
              ${isMember && !isLeader
                ? html`
                    <button
                      @click=${() => this.handleLeave()}
                      class="flex-1 px-6 py-3 text-sm font-bold text-white/70 uppercase tracking-wider bg-red-600/30 hover:bg-red-600/50 rounded-xl transition-all border border-red-500/30"
                    >
                      ${translateText("clan_modal.leave_clan")}
                    </button>
                  `
                : ""}
              ${isLeader
                ? html`
                    <button
                      @click=${() => {
                        this.manageName = clan.name;
                        this.manageDescription = clan.description;
                        this.manageIsOpen = clan.isOpen;
                        this.view = "manage";
                      }}
                      class="flex-1 px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-white/10 hover:bg-white/15 rounded-xl transition-all border border-white/10"
                    >
                      ${translateText("clan_modal.manage_clan")}
                    </button>
                  `
                : ""}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private async handleJoin() {
    if (!this.selectedClan) return;
    this.errorMsg = "";
    const result = await joinClan(this.selectedClan.tag);
    if ("error" in result) {
      this.errorMsg = result.error;
      return;
    }
    if (result.status === "joined") {
      // Refresh the detail view to show membership
      await this.openClanDetail(this.selectedClan.tag);
    } else {
      this.errorMsg = "Join request sent! Waiting for approval.";
    }
  }

  private async handleLeave() {
    if (!this.selectedClan) return;
    this.errorMsg = "";
    const result = await leaveClan(this.selectedClan.tag);
    if (result !== true) {
      this.errorMsg = result.error;
      return;
    }
    // Go back to browse
    this.selectedClan = null;
    this.myRole = null;
    this.view = "list";
    this.loadBrowse();
  }

  // ── Manage ──────────────────────────────────────────────────────

  private renderManage() {
    const clan = this.selectedClan!;

    return html`
      <div class="${this.modalContainerClass}">
        ${modalHeader({
          title: translateText("clan_modal.manage_clan"),
          onBack: () => {
            this.view = "detail";
            this.errorMsg = "";
          },
          ariaLabel: translateText("common.back"),
          rightContent: html`
            <span
              class="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-white/10 text-white/50 border border-white/10"
            >
              [${clan.tag}]
            </span>
          `,
        })}

        <div class="flex-1 overflow-y-auto custom-scrollbar mr-1 p-4 lg:p-6">
          <div class="space-y-6">
            ${this.errorMsg
              ? html`<p class="text-red-400 text-sm">${this.errorMsg}</p>`
              : ""}

            <!-- Edit Settings -->
            <div
              class="bg-white/5 rounded-2xl border border-white/10 p-6 space-y-5"
            >
              <h3
                class="text-sm font-bold text-white/60 uppercase tracking-wider"
              >
                ${translateText("clan_modal.clan_settings")}
              </h3>

              <div>
                <label
                  class="block text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2"
                  >${translateText("clan_modal.clan_name")}</label
                >
                <input
                  type="text"
                  .value=${this.manageName}
                  @input=${(e: Event) =>
                    (this.manageName = (e.target as HTMLInputElement).value)}
                  maxlength="30"
                  class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all font-medium hover:bg-white/10 text-sm"
                />
              </div>

              <div>
                <label
                  class="block text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2"
                  >${translateText("clan_modal.description")}</label
                >
                <textarea
                  .value=${this.manageDescription}
                  @input=${(e: Event) =>
                    (this.manageDescription = (
                      e.target as HTMLTextAreaElement
                    ).value)}
                  maxlength="200"
                  rows="3"
                  class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all font-medium hover:bg-white/10 text-sm resize-none"
                ></textarea>
              </div>

              <div class="flex items-center justify-between">
                <div>
                  <div class="text-white text-sm font-bold">
                    ${translateText("clan_modal.open_clan")}
                  </div>
                  <div class="text-white/40 text-xs">
                    ${translateText("clan_modal.open_clan_desc")}
                  </div>
                </div>
                <button
                  @click=${() => (this.manageIsOpen = !this.manageIsOpen)}
                  class="relative w-12 h-7 rounded-full transition-all ${this
                    .manageIsOpen
                    ? "bg-blue-500"
                    : "bg-white/20"}"
                >
                  <div
                    class="absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${this
                      .manageIsOpen
                      ? "left-6"
                      : "left-1"}"
                  ></div>
                </button>
              </div>

              <button
                @click=${() => this.handleSaveSettings()}
                ?disabled=${this.saving}
                class="w-full px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 rounded-xl transition-all shadow-lg hover:shadow-blue-900/40 border border-white/5 disabled:opacity-50"
              >
                ${this.saving
                  ? "Saving..."
                  : translateText("clan_modal.save_changes")}
              </button>
            </div>

            <!-- Member Management -->
            <div
              class="bg-white/5 rounded-2xl border border-white/10 p-6 space-y-4"
            >
              <h3
                class="text-sm font-bold text-white/60 uppercase tracking-wider"
              >
                ${translateText("clan_modal.members")} (${clan.memberCount})
              </h3>
              ${this.renderMemberSearch()}
              ${(() => {
                const filtered = this.filterMembers(this.members);
                return html`
                  <div class="space-y-2">
                    ${this.paginateMembers(filtered).map((m) =>
                      this.renderManageMemberRow(m),
                    )}
                  </div>
                  ${this.renderMemberPagination(filtered.length)}
                `;
              })()}
            </div>

            <!-- Danger Zone -->
            <div
              class="bg-red-500/5 rounded-2xl border border-red-500/20 p-6 space-y-4"
            >
              <h3
                class="text-sm font-bold text-red-400/80 uppercase tracking-wider"
              >
                ${translateText("clan_modal.danger_zone")}
              </h3>
              <button
                @click=${() => {
                  this.transferTarget = null;
                  this.view = "transfer";
                  this.errorMsg = "";
                }}
                class="w-full px-6 py-3 text-sm font-bold text-amber-400 uppercase tracking-wider bg-amber-600/20 hover:bg-amber-600/30 rounded-xl transition-all border border-amber-500/30"
              >
                ${translateText("clan_modal.transfer_leadership")}
              </button>
              <button
                @click=${() => this.handleDisband()}
                class="w-full px-6 py-3 text-sm font-bold text-red-400 uppercase tracking-wider bg-red-600/20 hover:bg-red-600/30 rounded-xl transition-all border border-red-500/30"
              >
                ${translateText("clan_modal.disband_clan")}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private async handleSaveSettings() {
    if (!this.selectedClan) return;
    this.saving = true;
    this.errorMsg = "";
    const patch: { name?: string; description?: string; isOpen?: boolean } = {};
    if (this.manageName !== this.selectedClan.name)
      patch.name = this.manageName;
    if (this.manageDescription !== this.selectedClan.description)
      patch.description = this.manageDescription;
    if (this.manageIsOpen !== this.selectedClan.isOpen)
      patch.isOpen = this.manageIsOpen;

    if (Object.keys(patch).length === 0) {
      this.saving = false;
      return;
    }

    const result = await updateClan(this.selectedClan.tag, patch);
    this.saving = false;

    if ("error" in result) {
      this.errorMsg = result.error;
      return;
    }

    // Update local state
    this.selectedClan = {
      ...this.selectedClan,
      name: result.name,
      description: result.description,
      isOpen: result.isOpen,
    };
  }

  private async handleDisband() {
    if (!this.selectedClan) return;
    if (
      !confirm(
        `Are you sure you want to disband [${this.selectedClan.tag}] ${this.selectedClan.name}? This cannot be undone.`,
      )
    )
      return;

    this.errorMsg = "";
    const result = await disbandClan(this.selectedClan.tag);
    if (result !== true) {
      this.errorMsg = result.error;
      return;
    }
    this.selectedClan = null;
    this.myRole = null;
    this.view = "list";
    this.loadBrowse();
  }

  private renderManageMemberRow(member: ClanMember) {
    const isLeader = member.role === "leader";
    const displayId = member.publicId ?? "---";

    return html`
      <div
        class="flex items-center gap-3 py-3 border-b border-white/5 last:border-0"
      >
        <div
          class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/50 text-xs font-bold shrink-0"
        >
          ${(member.publicId ?? "?").charAt(0).toUpperCase()}
        </div>
        <div class="flex-1 min-w-0">
          ${member.publicId
            ? html`<copy-button
                compact
                .copyText=${member.publicId}
                .displayText=${member.publicId}
                .showVisibilityToggle=${false}
                .showCopyIcon=${false}
              ></copy-button>`
            : html`<span class="text-white/40 text-sm">${displayId}</span>`}
        </div>
        <span
          class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0
            ${member.role === "leader"
            ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
            : member.role === "officer"
              ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
              : "bg-white/10 text-white/40 border border-white/10"}"
        >
          ${member.role}
        </span>
        ${!isLeader && member.publicId
          ? html`
              <div class="flex items-center gap-1.5">
                ${member.role === "member"
                  ? html`<button
                      @click=${() => this.handlePromote(member.publicId!)}
                      class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400/70 border border-purple-500/20 hover:bg-purple-500/20 hover:text-purple-400 transition-all"
                    >
                      ${translateText("clan_modal.promote")}
                    </button>`
                  : ""}
                ${member.role === "officer"
                  ? html`<button
                      @click=${() => this.handleDemote(member.publicId!)}
                      class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/5 text-white/40 border border-white/10 hover:bg-white/10 hover:text-white/60 transition-all"
                    >
                      ${translateText("clan_modal.demote")}
                    </button>`
                  : ""}
                <button
                  @click=${() => this.handleKick(member.publicId!)}
                  class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500/10 text-red-400/70 border border-red-500/20 hover:bg-red-500/20 hover:text-red-400 transition-all"
                >
                  ${translateText("clan_modal.kick")}
                </button>
              </div>
            `
          : ""}
      </div>
    `;
  }

  private async handlePromote(publicId: string) {
    if (!this.selectedClan) return;
    this.errorMsg = "";
    const result = await promoteMember(this.selectedClan.tag, publicId);
    if (result !== true) {
      this.errorMsg = result.error;
      return;
    }
    await this.loadMemberPage(this.memberPage);
  }

  private async handleDemote(publicId: string) {
    if (!this.selectedClan) return;
    this.errorMsg = "";
    const result = await demoteMember(this.selectedClan.tag, publicId);
    if (result !== true) {
      this.errorMsg = result.error;
      return;
    }
    await this.loadMemberPage(this.memberPage);
  }

  private async handleKick(publicId: string) {
    if (!this.selectedClan) return;
    this.errorMsg = "";
    const result = await kickMember(this.selectedClan.tag, publicId);
    if (result !== true) {
      this.errorMsg = result.error;
      return;
    }
    await this.loadMemberPage(this.memberPage);
    // Update member count
    if (this.selectedClan) {
      this.selectedClan = {
        ...this.selectedClan,
        memberCount: this.selectedClan.memberCount - 1,
      };
    }
  }

  // ── Transfer ────────────────────────────────────────────────────

  private renderTransfer() {
    const nonLeaders = this.members.filter(
      (m) => m.role !== "leader" && m.publicId,
    );
    const totalMemberPages = Math.ceil(this.membersTotal / this.membersPerPage);

    return html`
      <div class="${this.modalContainerClass}">
        ${modalHeader({
          title: translateText("clan_modal.transfer_leadership"),
          onBack: () => {
            this.view = "manage";
            this.errorMsg = "";
          },
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

            <div class="space-y-2">
              ${nonLeaders.map(
                (m) => html`
                  <div
                    @click=${() => (this.transferTarget = m.publicId)}
                    class="flex items-center gap-3 py-3 border-b border-white/5 last:border-0 cursor-pointer rounded-lg px-2 transition-all
                      ${this.transferTarget === m.publicId
                      ? "bg-amber-500/10"
                      : "hover:bg-white/5"}"
                  >
                    <div
                      class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/50 text-xs font-bold shrink-0"
                    >
                      ${(m.publicId ?? "?").charAt(0).toUpperCase()}
                    </div>
                    <div class="flex-1 min-w-0">
                      ${m.publicId
                        ? html`<copy-button
                            compact
                            .copyText=${m.publicId}
                            .displayText=${m.publicId}
                            .showVisibilityToggle=${false}
                            .showCopyIcon=${false}
                          ></copy-button>`
                        : ""}
                    </div>
                    <span
                      class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0
                        ${m.role === "officer"
                        ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                        : "bg-white/10 text-white/40 border border-white/10"}"
                    >
                      ${m.role}
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
                  </div>
                `,
              )}
            </div>
            ${totalMemberPages > 1
              ? this.renderServerPagination(
                  this.memberPage,
                  totalMemberPages,
                  (p) => this.loadMemberPage(p),
                )
              : ""}

            <button
              @click=${() => this.handleTransfer()}
              class="w-full px-6 py-3 text-sm font-bold text-white uppercase tracking-wider rounded-xl transition-all border
                ${this.transferTarget
                ? "bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 shadow-lg hover:shadow-amber-900/40 border-white/5"
                : "bg-white/5 border-white/10 text-white/30 cursor-not-allowed"}"
              ?disabled=${!this.transferTarget}
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

  private async handleTransfer() {
    if (!this.selectedClan || !this.transferTarget) return;
    this.errorMsg = "";
    const result = await transferLeadership(
      this.selectedClan.tag,
      this.transferTarget,
    );
    if (result !== true) {
      this.errorMsg = result.error;
      return;
    }
    // Refresh - we're no longer leader
    await this.openClanDetail(this.selectedClan.tag);
  }

  // ── Requests ────────────────────────────────────────────────────

  private async openRequests() {
    if (!this.selectedClan) return;
    this.errorMsg = "";
    this.requestsPage = 1;
    const data = await fetchClanRequests(this.selectedClan.tag, 1);
    if (!data) {
      this.errorMsg = "Failed to load requests";
      return;
    }
    this.requests = data.results;
    this.requestsTotal = data.total;
    this.view = "requests";
  }

  private async loadRequestsPage(page: number) {
    if (!this.selectedClan) return;
    const data = await fetchClanRequests(this.selectedClan.tag, page);
    if (data) {
      this.requests = data.results;
      this.requestsTotal = data.total;
      this.requestsPage = page;
    }
  }

  private renderRequests() {
    const totalPages = Math.ceil(this.requestsTotal / 20);

    return html`
      <div class="${this.modalContainerClass}">
        ${modalHeader({
          title: translateText("clan_modal.join_requests"),
          onBack: () => {
            this.view = "detail";
            this.errorMsg = "";
          },
          ariaLabel: translateText("common.back"),
          rightContent: html`
            <span
              class="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-white/10 text-white/50 border border-white/10"
            >
              ${this.requestsTotal}
            </span>
          `,
        })}

        <div class="flex-1 overflow-y-auto custom-scrollbar mr-1 p-4 lg:p-6">
          ${this.errorMsg
            ? html`<p class="text-red-400 text-sm mb-4">${this.errorMsg}</p>`
            : ""}
          ${this.requests.length === 0
            ? html`
                <div
                  class="flex flex-col items-center justify-center p-12 text-center"
                >
                  <p class="text-white/40 text-sm">
                    ${translateText("clan_modal.no_requests")}
                  </p>
                </div>
              `
            : html`
                <div class="space-y-3">
                  ${this.requests.map(
                    (req) => html`
                      <div
                        class="flex items-center gap-3 bg-white/5 rounded-xl border border-white/10 p-4"
                      >
                        <div
                          class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white/50 text-sm font-bold shrink-0"
                        >
                          ${req.publicId.charAt(0).toUpperCase()}
                        </div>
                        <div class="flex-1 min-w-0">
                          <copy-button
                            compact
                            .copyText=${req.publicId}
                            .displayText=${req.publicId}
                            .showVisibilityToggle=${false}
                            .showCopyIcon=${false}
                          ></copy-button>
                          <span class="text-white/30 text-[10px]">
                            ${new Date(req.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div class="flex items-center gap-2 shrink-0">
                          <button
                            @click=${() => this.handleApprove(req.publicId)}
                            class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-all"
                          >
                            ${translateText("clan_modal.approve")}
                          </button>
                          <button
                            @click=${() => this.handleDeny(req.publicId)}
                            class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-all"
                          >
                            ${translateText("clan_modal.deny")}
                          </button>
                        </div>
                      </div>
                    `,
                  )}
                </div>
                ${totalPages > 1
                  ? this.renderServerPagination(
                      this.requestsPage,
                      totalPages,
                      (p) => this.loadRequestsPage(p),
                    )
                  : ""}
              `}
        </div>
      </div>
    `;
  }

  private async handleApprove(publicId: string) {
    if (!this.selectedClan) return;
    this.errorMsg = "";
    const result = await approveClanRequest(this.selectedClan.tag, publicId);
    if (result !== true) {
      this.errorMsg = result.error;
      return;
    }
    // Remove from local list
    this.requests = this.requests.filter((r) => r.publicId !== publicId);
    this.requestsTotal--;
    this.pendingRequestCount = Math.max(0, this.pendingRequestCount - 1);
  }

  private async handleDeny(publicId: string) {
    if (!this.selectedClan) return;
    this.errorMsg = "";
    const result = await denyClanRequest(this.selectedClan.tag, publicId);
    if (result !== true) {
      this.errorMsg = result.error;
      return;
    }
    this.requests = this.requests.filter((r) => r.publicId !== publicId);
    this.requestsTotal--;
    this.pendingRequestCount = Math.max(0, this.pendingRequestCount - 1);
  }

  // ── Shared rendering helpers ────────────────────────────────────

  private filterMembers(members: ClanMember[]): ClanMember[] {
    if (!this.memberSearch) return members;
    const q = this.memberSearch.toLowerCase();
    return members.filter(
      (m) =>
        (m.publicId?.toLowerCase().includes(q) ?? false) || m.role.includes(q),
    );
  }

  private paginateMembers(members: ClanMember[]): ClanMember[] {
    const start = (this.memberPage - 1) * this.membersPerPage;
    return members.slice(start, start + this.membersPerPage);
  }

  private renderMemberSearch() {
    return html`
      <div class="relative">
        <input
          type="text"
          .value=${this.memberSearch}
          @input=${(e: Event) => {
            this.memberSearch = (e.target as HTMLInputElement).value;
            this.memberPage = 1;
          }}
          class="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all font-medium hover:bg-white/10 text-sm"
          placeholder="${translateText(
            "clan_modal.search_members_placeholder",
          )}"
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
    `;
  }

  private renderMemberPagination(totalMembers: number) {
    const totalPages = Math.ceil(totalMembers / this.membersPerPage);
    if (totalMembers <= this.perPageOptions[0]) return html``;

    return html`
      <div
        class="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-white/10"
      >
        <div class="flex items-center gap-2">
          <span
            class="text-[10px] font-bold text-white/40 uppercase tracking-wider"
          >
            ${translateText("clan_modal.per_page")}
          </span>
          ${this.perPageOptions.map(
            (opt) => html`
              <button
                @click=${() => {
                  this.membersPerPage = opt;
                  this.memberPage = 1;
                }}
                class="px-2 py-1 text-xs font-bold rounded-lg transition-all
                  ${this.membersPerPage === opt
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "text-white/40 hover:text-white/70 border border-transparent"}"
              >
                ${opt}
              </button>
            `,
          )}
        </div>
        <div class="flex items-center gap-2">
          <button
            @click=${() => (this.memberPage = Math.max(1, this.memberPage - 1))}
            ?disabled=${this.memberPage <= 1}
            class="px-2 py-1 text-xs font-bold rounded-lg transition-all
              ${this.memberPage <= 1
              ? "text-white/20 cursor-not-allowed"
              : "text-white/60 hover:text-white hover:bg-white/10"}"
          >
            &lt;
          </button>
          <span class="text-xs text-white/50 font-medium">
            ${this.memberPage} / ${totalPages}
          </span>
          <button
            @click=${() =>
              (this.memberPage = Math.min(totalPages, this.memberPage + 1))}
            ?disabled=${this.memberPage >= totalPages}
            class="px-2 py-1 text-xs font-bold rounded-lg transition-all
              ${this.memberPage >= totalPages
              ? "text-white/20 cursor-not-allowed"
              : "text-white/60 hover:text-white hover:bg-white/10"}"
          >
            &gt;
          </button>
        </div>
      </div>
    `;
  }

  private renderMemberRow(member: ClanMember, showId = false) {
    const joinDate = member.joinedAt
      ? new Date(member.joinedAt).toLocaleDateString()
      : "";

    return html`
      <div
        class="flex items-center gap-3 py-2 border-b border-white/5 last:border-0"
      >
        <div
          class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/50 text-xs font-bold shrink-0"
        >
          ${member.role === "leader"
            ? html`<svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-4 h-4 text-amber-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                />
              </svg>`
            : html`<span
                >${(member.publicId ?? member.role)
                  .charAt(0)
                  .toUpperCase()}</span
              >`}
        </div>
        <div class="flex-1 min-w-0">
          ${member.publicId
            ? html`
                <span class="text-white text-sm font-medium truncate block"
                  >${member.publicId}</span
                >
                ${showId
                  ? html`<copy-button
                      compact
                      .copyText=${member.publicId}
                      .displayText=${member.publicId}
                      .showVisibilityToggle=${false}
                      .showCopyIcon=${false}
                    ></copy-button>`
                  : ""}
              `
            : html`
                <span class="text-white/50 text-sm font-medium capitalize"
                  >${member.role}</span
                >
                ${joinDate
                  ? html`<span class="text-white/30 text-[10px] block"
                      >Joined ${joinDate}</span
                    >`
                  : ""}
              `}
        </div>
        <span
          class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0
            ${member.role === "leader"
            ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
            : member.role === "officer"
              ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
              : "bg-white/10 text-white/40 border border-white/10"}"
        >
          ${member.role}
        </span>
      </div>
    `;
  }

  private renderStat(label: string, value: string) {
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-4 text-center">
        <div
          class="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-1"
        >
          ${label}
        </div>
        <div class="text-white font-bold text-sm truncate">${value}</div>
      </div>
    `;
  }

  private renderServerPagination(
    currentPage: number,
    totalPages: number,
    onPageChange: (page: number) => void,
  ) {
    return html`
      <div
        class="flex items-center justify-center gap-2 pt-4 border-t border-white/10"
      >
        <button
          @click=${() => onPageChange(Math.max(1, currentPage - 1))}
          ?disabled=${currentPage <= 1}
          class="px-2 py-1 text-xs font-bold rounded-lg transition-all
            ${currentPage <= 1
            ? "text-white/20 cursor-not-allowed"
            : "text-white/60 hover:text-white hover:bg-white/10"}"
        >
          &lt;
        </button>
        <span class="text-xs text-white/50 font-medium">
          ${currentPage} / ${totalPages}
        </span>
        <button
          @click=${() => onPageChange(Math.min(totalPages, currentPage + 1))}
          ?disabled=${currentPage >= totalPages}
          class="px-2 py-1 text-xs font-bold rounded-lg transition-all
            ${currentPage >= totalPages
            ? "text-white/20 cursor-not-allowed"
            : "text-white/60 hover:text-white hover:bg-white/10"}"
        >
          &gt;
        </button>
      </div>
    `;
  }
}
