import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { invalidateUserMe } from "../../Api";
import {
  type ClanInfo,
  type ClanMember,
  type ClanMemberOrder,
  type ClanMemberSort,
  fetchClanDetail,
  fetchClanMembers,
  joinClan,
  leaveClan,
} from "../../ClanApi";
import { translateText } from "../../Utils";
import "../ConfirmDialog";
import "../CopyButton";
import {
  type ClanRole,
  defaultOrderForSort,
  filterMembersBySearch,
  renderLoadingSpinner,
  renderMemberPagination,
  renderMemberRow,
  renderMemberSearchInput,
  renderMemberSortControl,
  renderStat,
  showToast,
} from "./ClanShared";
import { ClanStatsBreakdown } from "./ClanStatsBreakdown";

@customElement("clan-detail-view")
export class ClanDetailView extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property() clanTag = "";
  @property() myPublicId: string | null = null;
  @property({ type: Object }) myClanRoles: Map<string, ClanRole> = new Map();
  @property({ type: Array }) myPendingRequests: {
    tag: string;
    name: string;
    createdAt: string;
  }[] = [];
  @property({ type: Object }) cachedDetail: {
    tag: string;
    members: ClanMember[];
    membersTotal: number;
    pendingRequestCount: number;
  } | null = null;
  @property() detailTab: "overview" | "members" = "overview";

  @property({ type: Object }) cachedClan: ClanInfo | null = null;
  @state() private selectedClan: ClanInfo | null = null;
  @state() private myRole: ClanRole | null = null;
  @state() private members: ClanMember[] = [];
  @state() private membersTotal = 0;
  @state() private memberPage = 1;
  @state() private membersPerPage = 10;
  @state() private memberSort: ClanMemberSort = "default";
  @state() private memberOrder: ClanMemberOrder = "asc";
  @state() private pendingRequestCount = 0;
  @state() private loading = false;
  @state() private actionPending = false;
  @state() private allStatsExpanded = false;
  @state() private membersLoadInFlight = false;
  private memberSearch = "";
  private memberSearchDebounce: ReturnType<typeof setTimeout> | null = null;
  private asyncGeneration = 0;

  connectedCallback() {
    super.connectedCallback();
    if (this.cachedDetail && this.cachedDetail.tag === this.clanTag) {
      this.restoreFromCache(this.cachedDetail);
    } else if (this.clanTag) {
      this.loadDetail();
    }
  }

  private restoreFromCache(cache: NonNullable<typeof this.cachedDetail>) {
    this.selectedClan = this.cachedClan;
    this.members = cache.members;
    this.membersTotal = cache.membersTotal;
    this.pendingRequestCount = cache.pendingRequestCount;
    this.memberPage = 1;
    const knownRole = this.myClanRoles.get(this.clanTag);
    this.myRole = knownRole ?? null;
  }

  disconnectedCallback() {
    if (this.memberSearchDebounce) clearTimeout(this.memberSearchDebounce);
    super.disconnectedCallback();
  }

  protected updated() {
    if (this.allStatsExpanded) {
      this.querySelectorAll<ClanStatsBreakdown>("clan-stats-breakdown").forEach(
        (el) => el.setAllExpanded(true),
      );
    }
  }

  private async loadDetail() {
    const gen = ++this.asyncGeneration;
    this.loading = true;
    this.myRole = null;
    this.pendingRequestCount = 0;
    this.memberSearch = "";

    // When the user lands directly on the Members tab (deep link / cached
    // activeTab), fire both fetches in parallel — otherwise sequencing
    // adds a full members RTT to the visible loading time. The Overview
    // tab waits for detail only; willUpdate kicks off members on tab
    // switch later.
    const goingToMembers =
      this.detailTab === "members" && this.myClanRoles.has(this.clanTag);
    const detailPromise = fetchClanDetail(this.clanTag);
    if (goingToMembers) {
      // Floating; loadInitialMembers's own asyncGeneration + tag guards
      // cancel cleanly if the user navigates away mid-flight.
      void this.loadInitialMembers();
    }
    const detail = await detailPromise;

    if (gen !== this.asyncGeneration) return;
    this.loading = false;

    if (!detail) {
      showToast(translateText("clan_modal.failed_to_load_clan"), "red");
      this.dispatchEvent(
        new CustomEvent("navigate-back", { bubbles: true, composed: true }),
      );
      return;
    }

    this.selectedClan = detail;
    this.memberPage = 1;
    if (!goingToMembers) {
      // Members tab will populate these via loadInitialMembers; the
      // Overview tab doesn't need them.
      this.members = [];
      this.membersTotal = 0;
    }
    this.myRole = this.myClanRoles.get(this.clanTag) ?? null;

    this.dispatchEvent(
      new CustomEvent("detail-loaded", {
        detail: {
          clan: detail,
          myRole: this.myRole,
          members: this.members,
          membersTotal: this.membersTotal,
          pendingRequestCount: this.pendingRequestCount,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async loadInitialMembers() {
    if (this.membersLoadInFlight) return;
    if (!this.clanTag) return;
    if (!this.myClanRoles.has(this.clanTag)) return;
    if (this.members.length > 0) return;
    // Don't share `asyncGeneration` with loadDetail — these two run
    // concurrently when the user lands on the Members tab directly, and
    // bumping the shared counter would cancel the parent. The
    // `membersLoadInFlight` flag dedupes concurrent invocations and the
    // `requestedTag` check handles tag navigation.
    const requestedTag = this.clanTag;
    this.membersLoadInFlight = true;
    try {
      const res = await fetchClanMembers(
        requestedTag,
        1,
        this.membersPerPage,
        this.memberSort,
        this.memberOrder,
      );
      if (requestedTag !== this.clanTag) return;
      if (!res) return;
      this.members = res.results;
      this.membersTotal = res.total;
      this.pendingRequestCount = res.pendingRequests ?? 0;
      this.memberPage = 1;

      this.dispatchEvent(
        new CustomEvent("members-loaded", {
          detail: {
            members: this.members,
            membersTotal: this.membersTotal,
            pendingRequestCount: this.pendingRequestCount,
          },
          bubbles: true,
          composed: true,
        }),
      );
    } finally {
      this.membersLoadInFlight = false;
    }
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (
      (changed.has("detailTab") || changed.has("selectedClan")) &&
      this.detailTab === "members" &&
      this.selectedClan &&
      this.members.length === 0 &&
      this.myClanRoles.has(this.clanTag)
    ) {
      this.loadInitialMembers();
    }
  }

  private async loadMemberPage(page: number) {
    if (!this.selectedClan) return;
    const res = await fetchClanMembers(
      this.selectedClan.tag,
      page,
      this.membersPerPage,
      this.memberSort,
      this.memberOrder,
    );
    if (!res) return;
    if (res.results.length === 0 && page > 1) {
      await this.loadMemberPage(1);
      return;
    }
    this.members = res.results;
    this.membersTotal = res.total;
    this.memberPage = page;
    this.pendingRequestCount = res.pendingRequests ?? 0;
    if (this.selectedClan.memberCount !== res.total) {
      this.selectedClan = { ...this.selectedClan, memberCount: res.total };
    }
  }

  private onSortChange(sort: ClanMemberSort) {
    if (sort === this.memberSort) return;
    this.memberSort = sort;
    this.memberOrder = defaultOrderForSort(sort);
    this.loadMemberPage(1);
  }

  private onOrderToggle() {
    this.memberOrder = this.memberOrder === "asc" ? "desc" : "asc";
    this.loadMemberPage(1);
  }

  private async handleJoin() {
    if (!this.selectedClan || this.actionPending) return;
    this.actionPending = true;
    try {
      const result = await joinClan(this.selectedClan.tag);
      if ("error" in result) {
        if (result.error === "clan_modal.sign_in_for_clans") {
          window.showPage?.("page-account");
        }
        showToast(
          result.reason
            ? translateText(result.error, { reason: result.reason })
            : translateText(result.error),
          "red",
        );
        return;
      }
      invalidateUserMe();
      if (result.status === "joined") {
        // Joining an open clan should immediately switch this detail page into
        // member mode and refresh member-only data without requiring remount.
        this.myRole = "member";
        await this.loadMemberPage(1);
        this.dispatchEvent(
          new CustomEvent("clan-joined", {
            detail: { tag: this.selectedClan.tag },
            bubbles: true,
            composed: true,
          }),
        );
      } else {
        this.dispatchEvent(
          new CustomEvent("request-sent", {
            detail: {
              tag: this.selectedClan.tag,
              name: this.selectedClan.name,
            },
            bubbles: true,
            composed: true,
          }),
        );
        showToast(translateText("clan_modal.join_request_sent"), "green");
      }
    } finally {
      this.actionPending = false;
    }
  }

  private async handleLeave() {
    if (!this.selectedClan || this.actionPending) return;
    this.actionPending = true;
    try {
      const result = await leaveClan(this.selectedClan.tag);
      if (result !== true) {
        showToast(translateText(result.error), "red");
        return;
      }
      invalidateUserMe();
      this.dispatchEvent(
        new CustomEvent("clan-left", {
          detail: { tag: this.selectedClan.tag },
          bubbles: true,
          composed: true,
        }),
      );
      showToast(translateText("clan_modal.left_clan"), "green");
    } finally {
      this.actionPending = false;
    }
  }

  private onSearchInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    if (this.memberSearchDebounce) clearTimeout(this.memberSearchDebounce);
    this.memberSearchDebounce = setTimeout(() => {
      this.memberSearch = val;
      this.requestUpdate();
    }, 200);
  }

  render() {
    if (this.loading) {
      return renderLoadingSpinner();
    }

    const clan = this.selectedClan;
    if (!clan) return "";

    const isMember = this.myRole !== null;
    const isLeader = this.myRole === "leader";
    const isOfficer = this.myRole === "officer";
    const canManageRequests = isLeader || isOfficer;
    const hasPendingRequest = this.myPendingRequests.some(
      (r) => r.tag === clan.tag,
    );

    if (this.detailTab === "members") {
      if (!isMember) {
        return html`
          <div
            class="bg-white/5 rounded-xl border border-white/10 p-8 text-center"
          >
            <p class="text-white/40 text-sm">
              ${translateText("clan_modal.members_visible_to_members")}
            </p>
          </div>
        `;
      }
      // Initial lazy-load: show a spinner instead of an empty members
      // list + pagination so there's no flash of "no members".
      if (this.membersLoadInFlight && this.members.length === 0) {
        return renderLoadingSpinner();
      }
      return html`
        <div class="space-y-6">
          ${canManageRequests && this.pendingRequestCount > 0
            ? this.renderRequestsButton()
            : ""}
          ${this.renderMembersList()}
        </div>
      `;
    }

    return html`
      <div class="space-y-6">
        <div class="bg-white/5 rounded-xl border border-white/10 p-5">
          <p class="text-white/70 text-sm">
            ${clan.description || translateText("clan_modal.no_description")}
          </p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          ${renderStat(
            translateText("clan_modal.members"),
            `${clan.memberCount ?? 0}`,
          )}
          ${renderStat(
            translateText("clan_modal.status"),
            clan.isOpen
              ? translateText("clan_modal.open")
              : translateText("clan_modal.invite_only"),
          )}
        </div>

        <div class="flex flex-wrap gap-3">
          ${this.renderActionButtons(
            isMember,
            isLeader,
            isOfficer,
            hasPendingRequest,
            clan,
          )}
        </div>
      </div>
    `;
  }

  private renderRequestsButton() {
    return html`
      <button
        @click=${() =>
          this.dispatchEvent(
            new CustomEvent("navigate-requests", {
              bubbles: true,
              composed: true,
            }),
          )}
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
    `;
  }

  private toggleAllStats() {
    this.allStatsExpanded = !this.allStatsExpanded;
    const target = this.allStatsExpanded;
    this.querySelectorAll<ClanStatsBreakdown>("clan-stats-breakdown").forEach(
      (el) => el.setAllExpanded(target),
    );
  }

  private renderMembersList() {
    const filtered = filterMembersBySearch(this.members, this.memberSearch);
    const toggleLabel = translateText(
      this.allStatsExpanded
        ? "clan_modal.stats_collapse_all"
        : "clan_modal.stats_expand_all",
    );
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-5 space-y-3">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-bold text-white/60 uppercase tracking-wider">
            ${translateText("clan_modal.members")}
          </h3>
          <button
            type="button"
            @click=${() => this.toggleAllStats()}
            class="text-[10px] font-bold text-white/50 hover:text-white uppercase tracking-wider px-2 py-1 rounded-md border border-white/10 hover:border-white/20 hover:bg-white/5 transition-colors"
            title=${toggleLabel}
            aria-pressed=${this.allStatsExpanded}
          >
            ${toggleLabel}
          </button>
        </div>
        ${renderMemberSearchInput(
          (e: Event) => this.onSearchInput(e),
          undefined,
          renderMemberSortControl(
            this.memberSort,
            this.memberOrder,
            (s) => this.onSortChange(s),
            () => this.onOrderToggle(),
          ),
        )}
        <div class="space-y-2">
          ${filtered.map((m) => renderMemberRow(m, this.myPublicId))}
        </div>
        ${renderMemberPagination(
          this.memberPage,
          this.membersTotal,
          this.membersPerPage,
          (p) => this.loadMemberPage(p),
          (pp) => {
            this.membersPerPage = pp;
            this.loadMemberPage(1);
          },
        )}
      </div>
    `;
  }

  private renderActionButtons(
    isMember: boolean,
    isLeader: boolean,
    isOfficer: boolean,
    hasPendingRequest: boolean,
    clan: ClanInfo,
  ) {
    const buttons: ReturnType<typeof html>[] = [];
    if (!isMember && hasPendingRequest) {
      buttons.push(html`
        <button
          disabled
          class="flex-1 px-6 py-3 text-sm font-bold text-white/40 uppercase tracking-wider bg-white/5 rounded-xl border border-white/10 cursor-not-allowed"
        >
          ${translateText("clan_modal.request_pending")}
        </button>
      `);
    } else if (!isMember && clan.isOpen) {
      buttons.push(html`
        <button
          @click=${() => this.handleJoin()}
          ?disabled=${this.actionPending}
          class="flex-1 px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 rounded-xl transition-all disabled:opacity-50 disabled:pointer-events-none"
        >
          ${translateText("clan_modal.join_clan")}
        </button>
      `);
    } else if (!isMember && !clan.isOpen) {
      buttons.push(html`
        <button
          @click=${() => this.handleJoin()}
          ?disabled=${this.actionPending}
          class="flex-1 px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 rounded-xl transition-all shadow-lg hover:shadow-amber-900/40 border border-white/5 disabled:opacity-50 disabled:pointer-events-none"
        >
          ${translateText("clan_modal.request_invite")}
        </button>
      `);
    }
    if (isMember && !isLeader) {
      buttons.push(html`
        <button
          @click=${() => this.handleLeave()}
          ?disabled=${this.actionPending}
          class="flex-1 px-6 py-3 text-sm font-bold text-white/70 uppercase tracking-wider bg-red-600/30 hover:bg-red-600/50 rounded-xl transition-all border border-red-500/30 disabled:opacity-50 disabled:pointer-events-none"
        >
          ${translateText("clan_modal.leave_clan")}
        </button>
      `);
    }
    if (isLeader || isOfficer) {
      buttons.push(html`
        <button
          @click=${() =>
            this.dispatchEvent(
              new CustomEvent("navigate-manage", {
                bubbles: true,
                composed: true,
              }),
            )}
          class="flex-1 px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-white/10 hover:bg-white/15 rounded-xl transition-all border border-white/10"
        >
          ${translateText("clan_modal.manage_clan")}
        </button>
      `);
    }
    return buttons;
  }
}
