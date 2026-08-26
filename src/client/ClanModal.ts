import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getUserMe, invalidateUserMe } from "./Api";
import { type ClanInfo, type ClanMember } from "./ClanApi";
import { BaseModal } from "./components/BaseModal";
import "./components/clan/ClanBansView";
import "./components/clan/ClanBrowseView";
import type { BrowseState } from "./components/clan/ClanBrowseView";
import "./components/clan/ClanCard";
import "./components/clan/ClanDetailView";
import "./components/clan/ClanDonationsView";
import "./components/clan/ClanGameHistoryView";
import type { ClanGameHistoryCache } from "./components/clan/ClanGameHistoryView";
import "./components/clan/ClanManageView";
import "./components/clan/ClanMapView";
import "./components/clan/ClanMyRequestsView";
import "./components/clan/ClanRequestsView";
import type { ClanRole } from "./components/clan/ClanShared";
import "./components/clan/ClanTransferView";
import "./components/ConfirmDialog";
import "./components/CopyButton";
import "./components/CurrencyDisplay";
import { modalHeader } from "./components/ui/ModalHeader";
import { modalRouter } from "./ModalRouter";
import type { ProfileOrigin } from "./PlayerProfileModal";
import { translateText } from "./Utils";

type View =
  | "list"
  | "detail"
  | "manage"
  | "transfer"
  | "requests"
  | "bans"
  | "my-requests";

// List tabs share BaseModal's `activeTab` slot with detail tabs ("overview" /
// "members" / "game-history" / "donations"); which set is live depends on `view`.
// "map" is first in the tab bar but not the landing tab (see the constructor).
const LIST_TABS = ["map", "my-clans", "browse"] as const;
type ListTab = (typeof LIST_TABS)[number];

// Detail tabs a player profile can be opened from and returned to. Overview
// has no member links of its own, so it falls back to Members.
type DetailReturnTab = "members" | "game-history" | "donations";

function isListTab(key: string): key is ListTab {
  return (LIST_TABS as readonly string[]).includes(key);
}

@customElement("clan-modal")
export class ClanModal extends BaseModal {
  protected routerName = "clan";

  constructor() {
    super();
    // BaseModal would otherwise default to the first tab, "map", which would
    // mount the map iframe (and its API polling) before the modal ever opens.
    this.activeTab = "my-clans";
  }

  @state() private view: View = "list";
  @state() private loading = false;

  @state() private myClans: ClanInfo[] = [];
  @state() private myPendingRequests: {
    tag: string;
    name: string;
    createdAt: string;
  }[] = [];

  @state() private selectedClanTag = "";
  @state() private selectedClan: ClanInfo | null = null;
  @state() private myRole: ClanRole | null = null;
  private myPublicId: string | null = null;
  @state() private myClanRoles = new Map<string, ClanRole>();

  // Lifted browse state — survives tab switches
  private browseCache: BrowseState | null = null;

  // Lifted detail cache — survives sub-view navigation
  private detailCache: {
    tag: string;
    members: ClanMember[];
    membersTotal: number;
    pendingRequestCount: number;
  } | null = null;

  // Single-clan cache: switching clans within one modal session drops
  // it (see `openDetail`), so a user who clan-hops loses their filter
  // selection and accumulated scroll on the previous clan. Keyed-by-tag
  // would persist across hops if that becomes desired.
  private gameHistoryCache: ClanGameHistoryCache | null = null;
  private gameHistoryScrollTop = 0;
  // Opening a sibling modal (game stats or a player profile) closes this
  // inline modal. These one-shot flags keep that close/open pair from clearing
  // or reloading the clan detail that the sibling's Back button returns to.
  private preserveStateForModalHandoff = false;
  private returningFromModalHandoff = false;
  // Which detail tab opened the player-profile modal, so its Back button lands
  // on that tab (Members / Game History / Donations) rather than always Members.
  private profileOpenedFromTab: DetailReturnTab = "members";
  // The profile whose Clans tab opened this clan, so Back can return there,
  // plus that profile's own origin — it parks here for the detour because the
  // profile modal is reused by any member profile opened along the way. Only
  // the innermost hop is remembered: a clan reached through a chain of profile
  // detours backs out to the profile that opened it, and the clan under that
  // is not restored (see `returnFromPlayerProfile`).
  private openedFromProfile: string | null = null;
  private openedFromProfileOrigin: ProfileOrigin | null = null;
  private previousListTab: ListTab = "my-clans";

  private get onListView(): boolean {
    return this.view === "list" && !this.selectedClanTag;
  }

  private get onDetailView(): boolean {
    return this.view === "detail" && !!this.selectedClanTag;
  }

  protected modalConfig() {
    return {
      tabs: this.onListView
        ? [
            { key: "map", label: translateText("clan_modal.tab_map") },
            { key: "my-clans", label: translateText("clan_modal.my_clans") },
            { key: "browse", label: translateText("clan_modal.browse") },
          ]
        : this.onDetailView
          ? [
              {
                key: "overview",
                label: translateText("clan_modal.tab_overview"),
              },
              {
                key: "members",
                label: translateText("clan_modal.members"),
              },
              {
                key: "game-history",
                label: translateText("clan_modal.tab_game_history"),
              },
              {
                key: "donations",
                label: translateText("clan_modal.tab_donations"),
              },
            ]
          : [],
    };
  }

  protected renderHeaderSlot() {
    return this.onListView
      ? modalHeader({
          title: translateText("clan_modal.title"),
          onBack: () => this.close(),
          ariaLabel: translateText("common.back"),
        })
      : this.renderSubViewHeader();
  }

  protected renderBody() {
    // The map fills the content box edge to edge; everything else is padded.
    const onMap = this.onListView && this.activeTab === "map";
    return html`<div class=${onMap ? "" : "p-4 lg:p-[1.4rem]"}>
      ${this.renderInner()}
    </div>`;
  }

  protected onTabEnter(tab: string): void {
    if (isListTab(tab)) {
      this.view = "list";
      this.selectedClan = null;
      this.selectedClanTag = "";
      this.detailCache = null;
      this.gameHistoryCache = null;
      if (tab === "my-clans") {
        this.loadMyClans();
      }
      return;
    }
    // Detail tabs: BaseModal already updated activeTab; renderInner reads it.
    // No additional side effects required here.
  }

  private tagPill(tag: string) {
    return html`<span
      class="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-white/10 text-white/50 border border-white/10"
      >[${tag}]</span
    >`;
  }

  // The clan treasury, sitting in the header the way the store shows the
  // player's own wallet. These are the clan's balances, not the viewer's, and
  // they are public — every viewer sees them, member or not. Renders nothing
  // when the API reported neither balance.
  private clanBalances(clan: ClanInfo) {
    return html`<div class="flex items-center gap-3">
      <currency-display
        .hard=${clan.hardBalance ?? null}
        .soft=${clan.softBalance ?? null}
      ></currency-display>
      ${this.tagPill(clan.tag)}
    </div>`;
  }

  // Every exit from the clan detail calls this first: when a profile opened the
  // clan, Back belongs to that profile, not this modal's list. False = no
  // profile origin, so the caller does its normal list navigation.
  private backToProfile(): boolean {
    const publicId = this.openedFromProfile;
    if (publicId === null) return false;
    const origin = this.openedFromProfileOrigin;
    this.openedFromProfile = null;
    this.openedFromProfileOrigin = null;
    this.close();
    document
      .querySelector<
        HTMLElement & {
          returnFromClan(publicId: string, origin: ProfileOrigin | null): void;
        }
      >("player-profile-modal")
      ?.returnFromClan(publicId, origin);
    return true;
  }

  private renderSubViewHeader() {
    const clan = this.selectedClan;
    const ariaLabel = translateText("common.back");
    if (this.view === "my-requests") {
      return modalHeader({
        title: translateText("clan_modal.pending_applications"),
        onBack: () => (this.view = "list"),
        ariaLabel,
      });
    }
    if (this.view === "manage") {
      return modalHeader({
        title: translateText("clan_modal.manage_clan"),
        onBack: () => (this.view = "detail"),
        ariaLabel,
        rightContent: clan ? this.tagPill(clan.tag) : undefined,
      });
    }
    if (this.view === "transfer") {
      return modalHeader({
        title: translateText("clan_modal.transfer_leadership"),
        onBack: () => (this.view = "manage"),
        ariaLabel,
      });
    }
    if (this.view === "requests") {
      return modalHeader({
        title: translateText("clan_modal.join_requests"),
        onBack: () => (this.view = "detail"),
        ariaLabel,
      });
    }
    if (this.view === "bans") {
      return modalHeader({
        title: translateText("clan_modal.banned_players"),
        onBack: () => (this.view = "manage"),
        ariaLabel,
      });
    }
    // Default: detail
    return modalHeader({
      title: clan?.name ?? translateText("clan_modal.title"),
      onBack: () => {
        if (this.backToProfile()) return;
        this.view = "list";
        this.selectedClan = null;
        this.selectedClanTag = "";
        this.myRole = null;
        this.detailCache = null;
        modalRouter.syncArgs("clan", { clan: null, tag: null });
        this.gameHistoryCache = null;
        this.setActiveTab(this.previousListTab);
      },
      ariaLabel,
      rightContent: clan ? this.clanBalances(clan) : undefined,
    });
  }

  protected onOpen(args?: Record<string, unknown>): void {
    if (this.returningFromModalHandoff) {
      this.returningFromModalHandoff = false;
      return;
    }
    // openFromProfile() re-sets these right after open().
    this.openedFromProfile = null;
    this.openedFromProfileOrigin = null;
    const targetTag =
      typeof args?.clan === "string"
        ? args.clan.trim()
        : typeof args?.tag === "string"
          ? args.tag.trim()
          : "";
    if (targetTag) {
      this.openDetail(targetTag.toUpperCase());
    }
    this.loadMyClans({ allowGuest: Boolean(targetTag) });
  }

  protected onClose(): void {
    if (this.preserveStateForModalHandoff) return;
    this.openedFromProfile = null;
    this.openedFromProfileOrigin = null;
    this.activeTab = "my-clans";
    this.previousListTab = "my-clans";
    this.view = "list";
    this.selectedClan = null;
    this.selectedClanTag = "";
    this.myRole = null;
    this.browseCache = null;
    this.detailCache = null;
    this.gameHistoryCache = null;
    this.gameHistoryScrollTop = 0;
    this.returningFromModalHandoff = false;
  }

  private async loadMyClans(opts: { allowGuest?: boolean } = {}) {
    this.loading = true;
    try {
      const me = await getUserMe();
      if (!this.isModalOpen) return;
      if (!me || Object.keys(me.user).length === 0) {
        // The map is public (read-only without a token). Checked once the
        // response is in, not when it was requested: the router opens inline
        // modals arg-less first and only then with the URL's tab, so a guest
        // deep-linked to `#modal=clan&tab=map` has reached the map by now.
        if (opts.allowGuest || this.activeTab === "map") {
          this.myPublicId = null;
          this.myPendingRequests = [];
          this.myClanRoles = new Map();
          this.myClans = [];
          return;
        }
        window.dispatchEvent(
          new CustomEvent("show-message", {
            detail: {
              message: translateText("clan_modal.sign_in_for_clans"),
              color: "red",
              duration: 3000,
            },
          }),
        );
        this.close();
        window.showPage?.("page-account");
        return;
      }
      this.myPublicId = me.player.publicId;
      this.myPendingRequests = me.player.clanRequests ?? [];
      const roles = new Map<string, ClanRole>();
      const clans: ClanInfo[] = [];
      for (const c of me.player.clans ?? []) {
        roles.set(c.tag, c.role);
        clans.push({
          tag: c.tag,
          name: c.name,
          description: "",
          isOpen: false,
          memberCount: c.memberCount,
          softBalance: c.softBalance,
          hardBalance: c.hardBalance,
        });
      }
      this.myClanRoles = roles;
      this.myClans = clans;
    } finally {
      this.loading = false;
    }
  }

  private renderInner() {
    if (this.loading) {
      return this.renderLoadingSpinner();
    }

    if (this.view === "my-requests") {
      return html`<clan-my-requests-view
        .myPendingRequests=${this.myPendingRequests}
        @navigate-back=${() => (this.view = "list")}
        @request-withdrawn=${(e: CustomEvent<{ tag: string }>) => {
          this.myPendingRequests = this.myPendingRequests.filter(
            (r) => r.tag !== e.detail.tag,
          );
          if (this.myPendingRequests.length === 0) this.view = "list";
        }}
      ></clan-my-requests-view>`;
    }

    if (this.selectedClanTag) {
      if (this.view === "manage") {
        return html`<clan-manage-view
          .clanTag=${this.selectedClanTag}
          .selectedClan=${this.selectedClan}
          .myPublicId=${this.myPublicId}
          .myRole=${this.myRole}
          @navigate-detail=${() => (this.view = "detail")}
          @navigate-bans=${() => (this.view = "bans")}
          @navigate-transfer=${() => (this.view = "transfer")}
          @view-profile=${(e: CustomEvent<{ publicId: string }>) =>
            this.openPlayerProfile(e.detail.publicId)}
          @clan-updated=${(e: CustomEvent<Partial<ClanInfo>>) => {
            if (this.selectedClan) {
              this.selectedClan = { ...this.selectedClan, ...e.detail };
            }
            this.detailCache = null;
            invalidateUserMe();
          }}
          @clan-disbanded=${(e: CustomEvent<{ tag: string }>) => {
            const roles = new Map(this.myClanRoles);
            roles.delete(e.detail.tag);
            this.myClanRoles = roles;
            this.myClans = this.myClans.filter((c) => c.tag !== e.detail.tag);
            this.selectedClan = null;
            this.selectedClanTag = "";
            this.myRole = null;
            this.detailCache = null;
            if (this.backToProfile()) return;
            this.view = "list";
            this.setActiveTab(this.previousListTab);
          }}
        ></clan-manage-view>`;
      }
      if (this.view === "transfer") {
        return html`<clan-transfer-view
          .clanTag=${this.selectedClanTag}
          .selectedClan=${this.selectedClan}
          @navigate-back=${() => (this.view = "manage")}
          @view-profile=${(e: CustomEvent<{ publicId: string }>) =>
            this.openPlayerProfile(e.detail.publicId)}
          @leadership-transferred=${() => {
            this.loadMyClans().then(() =>
              this.openDetail(this.selectedClanTag),
            );
          }}
        ></clan-transfer-view>`;
      }
      if (this.view === "requests") {
        return html`<clan-requests-view
          .clanTag=${this.selectedClanTag}
          .selectedClan=${this.selectedClan}
          @navigate-back=${() => (this.view = "detail")}
          @view-profile=${(e: CustomEvent<{ publicId: string }>) =>
            this.openPlayerProfile(e.detail.publicId)}
          @request-approved=${() => {
            if (this.selectedClan) {
              this.selectedClan = {
                ...this.selectedClan,
                memberCount: (this.selectedClan.memberCount ?? 0) + 1,
              };
            }
            this.detailCache = null;
          }}
        ></clan-requests-view>`;
      }
      if (this.view === "bans") {
        return html`<clan-bans-view
          .clanTag=${this.selectedClanTag}
          @navigate-back=${() => (this.view = "manage")}
          @view-profile=${(e: CustomEvent<{ publicId: string }>) =>
            this.openPlayerProfile(e.detail.publicId)}
        ></clan-bans-view>`;
      }
      // Default: detail view — dispatched by the active detail tab
      if (this.activeTab === "donations") {
        return html`<clan-donations-view
          .clanTag=${this.selectedClanTag}
          @view-profile=${(e: CustomEvent<{ publicId: string }>) =>
            this.openPlayerProfile(e.detail.publicId)}
        ></clan-donations-view>`;
      }
      if (this.activeTab === "game-history") {
        return html`<clan-game-history-view
          .clanTag=${this.selectedClanTag}
          .cachedState=${this.gameHistoryCache?.tag === this.selectedClanTag
            ? this.gameHistoryCache
            : null}
          @history-updated=${(e: CustomEvent<ClanGameHistoryCache>) => {
            this.gameHistoryCache = e.detail;
          }}
          @view-stats=${(e: CustomEvent<{ gameId: string }>) =>
            this.openGameStats(e.detail.gameId)}
          @view-profile=${(e: CustomEvent<{ publicId: string }>) =>
            this.openPlayerProfile(e.detail.publicId)}
          @close-clan-modal=${() => this.close()}
        ></clan-game-history-view>`;
      }
      return html`<clan-detail-view
        .clanTag=${this.selectedClanTag}
        .cachedClan=${this.selectedClan}
        .myPublicId=${this.myPublicId}
        .myClanRoles=${this.myClanRoles}
        .myPendingRequests=${this.myPendingRequests}
        .detailTab=${this.activeTab === "members" ? "members" : "overview"}
        .cachedDetail=${this.detailCache?.tag === this.selectedClanTag
          ? this.detailCache
          : null}
        @navigate-back=${() => {
          // Raised when the clan fails to load.
          if (this.backToProfile()) return;
          this.view = "list";
          this.selectedClan = null;
          this.selectedClanTag = "";
          this.myRole = null;
          this.detailCache = null;
          this.gameHistoryCache = null;
          this.setActiveTab(this.previousListTab);
        }}
        @detail-loaded=${(
          e: CustomEvent<{
            clan: ClanInfo;
            myRole: ClanRole | null;
            members: ClanMember[];
            membersTotal: number;
            pendingRequestCount: number;
          }>,
        ) => {
          this.selectedClan = e.detail.clan;
          this.myRole = e.detail.myRole;
          this.detailCache = {
            tag: e.detail.clan.tag,
            members: e.detail.members,
            membersTotal: e.detail.membersTotal,
            pendingRequestCount: e.detail.pendingRequestCount,
          };
        }}
        @members-loaded=${(
          e: CustomEvent<{
            members: ClanMember[];
            membersTotal: number;
            pendingRequestCount: number;
          }>,
        ) => {
          if (
            !this.detailCache ||
            this.detailCache.tag !== this.selectedClanTag
          )
            return;
          this.detailCache = {
            ...this.detailCache,
            members: e.detail.members,
            membersTotal: e.detail.membersTotal,
            pendingRequestCount: e.detail.pendingRequestCount,
          };
        }}
        @view-profile=${(e: CustomEvent<{ publicId: string }>) =>
          this.openPlayerProfile(e.detail.publicId)}
        @navigate-manage=${() => (this.view = "manage")}
        @navigate-requests=${() => (this.view = "requests")}
        @clan-donated=${(e: CustomEvent<{ clan: ClanInfo }>) => {
          // Fresh detail after a donation: the header treasury and the My
          // Clans card both show balances, so both pick up the new figures.
          this.selectedClan = e.detail.clan;
          this.myClans = this.myClans.map((c) =>
            c.tag === e.detail.clan.tag
              ? {
                  ...c,
                  softBalance: e.detail.clan.softBalance,
                  hardBalance: e.detail.clan.hardBalance,
                }
              : c,
          );
        }}
        @clan-joined=${(e: CustomEvent<{ tag: string }>) => {
          this.myClanRoles = new Map([
            ...this.myClanRoles,
            [e.detail.tag, "member" as ClanRole],
          ]);
          this.detailCache = null;
          this.openDetail(e.detail.tag);
        }}
        @clan-left=${(e: CustomEvent<{ tag: string }>) => {
          const roles = new Map(this.myClanRoles);
          roles.delete(e.detail.tag);
          this.myClanRoles = roles;
          this.selectedClan = null;
          this.selectedClanTag = "";
          this.myRole = null;
          this.detailCache = null;
          if (this.backToProfile()) return;
          this.view = "list";
          this.setActiveTab(this.previousListTab);
        }}
        @request-sent=${(e: CustomEvent<{ tag: string; name: string }>) => {
          this.myPendingRequests = [
            ...this.myPendingRequests,
            {
              tag: e.detail.tag,
              name: e.detail.name,
              createdAt: new Date().toISOString(),
            },
          ];
        }}
      ></clan-detail-view>`;
    }

    // List view (map / my clans / browse) — header + tabs are rendered by o-modal
    if (this.activeTab === "map") {
      // Mounted only while open: the page polls its API while framed.
      return this.isModalOpen ? html`<clan-map-view></clan-map-view>` : html``;
    }
    return html`
      ${this.activeTab === "my-clans"
        ? this.renderMyClans()
        : html`<clan-browse-view
            .myClanRoles=${this.myClanRoles}
            .myPendingRequests=${this.myPendingRequests}
            .cachedState=${this.browseCache}
            @browse-updated=${(e: CustomEvent<BrowseState>) => {
              this.browseCache = e.detail;
            }}
            @clan-select=${(e: CustomEvent<{ tag: string }>) =>
              this.openDetail(e.detail.tag)}
          ></clan-browse-view>`}
    `;
  }

  private openDetail(tag: string) {
    if (this.selectedClanTag !== tag) {
      // History cache is per-clan (see `gameHistoryCache` declaration),
      // so it must be cleared on tag change. `detailCache` is left
      // alone — its `tag` field is checked at render time and the
      // detail view falls back to a fresh fetch when it doesn't match,
      // so an explicit null here would be redundant.
      this.gameHistoryCache = null;
    }
    // Remember which list tab the user was on so the back button can
    // return them to it (browse vs my-clans).
    if (isListTab(this.activeTab)) {
      this.previousListTab = this.activeTab;
    }
    this.selectedClanTag = tag;
    this.view = "detail";
    modalRouter.syncArgs("clan", { clan: tag, tag: null });
    // modalConfig() returns detail tabs; setActiveTab anchors activeTab to
    // "overview" and syncs the URL router (routerName = "clan").
    this.setActiveTab("overview");
  }

  private openGameStats(gameId: string): void {
    const statsModal = document.querySelector<
      HTMLElement & { openFromClan(gameId: string): void }
    >("game-stats-modal");
    if (!statsModal) return;

    this.gameHistoryScrollTop = this.modalEl?.getScrollTop() ?? 0;
    this.preserveStateForModalHandoff = true;
    try {
      statsModal.openFromClan(gameId);
    } finally {
      this.preserveStateForModalHandoff = false;
    }
  }

  private openPlayerProfile(publicId: string): void {
    const profileModal = document.querySelector<
      HTMLElement & { openFromClan(publicId: string): void }
    >("player-profile-modal");
    if (!profileModal) return;

    // Route the profile modal's Back button to whichever tab opened it. Only
    // the game-history tab needs its scroll position preserved on return.
    this.profileOpenedFromTab =
      this.activeTab === "game-history" || this.activeTab === "donations"
        ? this.activeTab
        : "members";
    if (this.profileOpenedFromTab === "game-history") {
      this.gameHistoryScrollTop = this.modalEl?.getScrollTop() ?? 0;
    }

    // Same handoff as openGameStats: keep clan state so the profile modal's
    // back button can land on the originating tab without a refetch.
    this.preserveStateForModalHandoff = true;
    try {
      profileModal.openFromClan(publicId);
    } finally {
      this.preserveStateForModalHandoff = false;
    }
  }

  // Entry point for the profile modal's Back button (opened via openFromClan
  // from the Members, Game History or Donations tab).
  public returnFromPlayerProfile(): void {
    // Nothing showing means the profile detoured through one of its own clans,
    // which reset this modal. Nothing is restored — land on the clan list
    // rather than leave the user on an empty page.
    if (!this.selectedClanTag) {
      this.open({});
      return;
    }
    // A sub-view (manage / transfer / requests / bans) survived the handoff in
    // `view`, so reopening without a tab lands the user back on it.
    if (this.view !== "detail") {
      this.returningFromModalHandoff = true;
      this.open({ clan: this.selectedClanTag });
      return;
    }
    if (this.profileOpenedFromTab === "game-history") {
      this.returnToGameHistory();
    } else {
      this.returnToDetailTab(this.profileOpenedFromTab);
    }
  }

  // Entry point from a player profile's Clans tab. Origin is set after open()
  // because onOpen clears it (same as the profile modal's openFrom* helpers).
  public openFromProfile(
    tag: string,
    publicId: string,
    origin: ProfileOrigin | null,
  ): void {
    this.open({ clan: tag });
    this.openedFromProfile = publicId;
    this.openedFromProfileOrigin = origin;
  }

  public returnToDetailTab(tab: DetailReturnTab): void {
    const tag = this.selectedClanTag;
    if (!tag) return;

    this.returningFromModalHandoff = true;
    this.open({ clan: tag, tab });
  }

  public returnToGameHistory(): void {
    const tag = this.selectedClanTag;
    if (!tag) return;

    this.returningFromModalHandoff = true;
    this.open({ clan: tag, tab: "game-history" });
    void this.restoreGameHistoryScroll();
  }

  private async restoreGameHistoryScroll(): Promise<void> {
    await this.updateComplete;
    await this.modalEl?.updateComplete;
    const historyView = this.querySelector<
      HTMLElement & { updateComplete?: Promise<boolean> }
    >("clan-game-history-view");
    await historyView?.updateComplete;
    this.modalEl?.setScrollTop(this.gameHistoryScrollTop);
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
            @click=${() => this.setActiveTab("browse")}
            class="px-6 py-2 text-sm font-bold text-white uppercase tracking-wider bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 rounded-lg transition-all"
          >
            ${translateText("clan_modal.browse")}
          </button>
        </div>
      `;
    }

    return html`
      <div class="space-y-3">
        ${hasRequests ? this.renderPendingRequestsButton() : ""}
        ${this.myClans.map(
          (clan) => html`
            <clan-card
              .clan=${clan}
              .clanRole=${this.myClanRoles.get(clan.tag)}
              @clan-select=${(e: CustomEvent<{ tag: string }>) =>
                this.openDetail(e.detail.tag)}
            ></clan-card>
          `,
        )}
      </div>
    `;
  }

  private renderPendingRequestsButton() {
    const count = this.myPendingRequests.length;
    return html`
      <button
        @click=${() => (this.view = "my-requests")}
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
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div class="text-left">
            <span class="text-amber-400 text-sm font-bold">
              ${translateText("clan_modal.pending_applications")}
            </span>
            <span class="text-amber-400/60 text-xs block">
              ${translateText("clan_modal.pending_requests_count", {
                count,
              })}
            </span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span
            class="px-2.5 py-1 text-xs font-bold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30"
          >
            ${count}
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
}
