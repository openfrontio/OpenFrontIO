import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getUserMe, invalidateUserMe } from "./Api";
import { type ClanInfo, type ClanMember, type ClanStats } from "./ClanApi";
import { BaseModal } from "./components/BaseModal";
import "./components/clan/ClanBansView";
import "./components/clan/ClanBrowseView";
import type { BrowseState } from "./components/clan/ClanBrowseView";
import "./components/clan/ClanCard";
import "./components/clan/ClanDetailView";
import "./components/clan/ClanManageView";
import "./components/clan/ClanMyRequestsView";
import "./components/clan/ClanRequestsView";
import type { ClanRole } from "./components/clan/ClanShared";
import "./components/clan/ClanTransferView";
import "./components/ConfirmDialog";
import "./components/CopyButton";
import { modalHeader } from "./components/ui/ModalHeader";
import { translateText } from "./Utils";

type Tab = "my-clans" | "browse";
type View =
  | "list"
  | "detail"
  | "manage"
  | "transfer"
  | "requests"
  | "bans"
  | "my-requests";

@customElement("clan-modal")
export class ClanModal extends BaseModal {
  @state() private activeTab: Tab = "my-clans";
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
    stats: ClanStats | null;
  } | null = null;

  render() {
    const onListView = this.view === "list" && !this.selectedClanTag;
    const tabs = onListView
      ? [
          { key: "my-clans", label: translateText("clan_modal.my_clans") },
          { key: "browse", label: translateText("clan_modal.browse") },
        ]
      : [];
    const header = onListView
      ? modalHeader({
          title: translateText("clan_modal.title"),
          onBack: () => this.close(),
          ariaLabel: translateText("common.back"),
        })
      : null;
    return html`
      <o-modal
        id="clan-modal"
        title=""
        ?hideCloseButton=${true}
        ?inline=${this.inline}
        hideHeader
        .tabs=${tabs}
        .activeTab=${this.activeTab}
        .onTabChange=${(key: string) => this.handleTabChange(key as Tab)}
      >
        ${header ? html`<div slot="header">${header}</div>` : ""}
        ${this.renderInner()}
      </o-modal>
    `;
  }

  private handleTabChange(tab: Tab) {
    this.activeTab = tab;
    this.view = "list";
    this.selectedClan = null;
    this.selectedClanTag = "";
    if (tab === "my-clans") {
      this.loadMyClans();
    }
  }

  protected onOpen(): void {
    this.loadMyClans();
  }

  protected onClose(): void {
    this.activeTab = "my-clans";
    this.view = "list";
    this.selectedClan = null;
    this.selectedClanTag = "";
    this.myRole = null;
    this.browseCache = null;
    this.detailCache = null;
  }

  private async loadMyClans() {
    this.loading = true;
    try {
      const me = await getUserMe();
      if (!this.isModalOpen) return;
      if (!me || Object.keys(me.user).length === 0) {
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
            this.view = "list";
            this.loadMyClans();
          }}
        ></clan-manage-view>`;
      }
      if (this.view === "transfer") {
        return html`<clan-transfer-view
          .clanTag=${this.selectedClanTag}
          .selectedClan=${this.selectedClan}
          @navigate-back=${() => (this.view = "manage")}
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
        ></clan-bans-view>`;
      }
      // Default: detail view
      return html`<clan-detail-view
        .clanTag=${this.selectedClanTag}
        .cachedClan=${this.selectedClan}
        .myPublicId=${this.myPublicId}
        .myClanRoles=${this.myClanRoles}
        .myPendingRequests=${this.myPendingRequests}
        .cachedDetail=${this.detailCache?.tag === this.selectedClanTag
          ? this.detailCache
          : null}
        @navigate-back=${() => {
          this.view = "list";
          this.selectedClan = null;
          this.selectedClanTag = "";
          this.myRole = null;
          this.detailCache = null;
        }}
        @detail-loaded=${(
          e: CustomEvent<{
            clan: ClanInfo;
            myRole: ClanRole | null;
            members: ClanMember[];
            membersTotal: number;
            pendingRequestCount: number;
            stats: ClanStats | null;
          }>,
        ) => {
          this.selectedClan = e.detail.clan;
          this.myRole = e.detail.myRole;
          this.detailCache = {
            tag: e.detail.clan.tag,
            members: e.detail.members,
            membersTotal: e.detail.membersTotal,
            pendingRequestCount: e.detail.pendingRequestCount,
            stats: e.detail.stats,
          };
        }}
        @navigate-manage=${() => (this.view = "manage")}
        @navigate-requests=${() => (this.view = "requests")}
        @clan-joined=${(e: CustomEvent<{ tag: string }>) => {
          this.myClanRoles = new Map([
            ...this.myClanRoles,
            [e.detail.tag, "member" as ClanRole],
          ]);
          this.openDetail(e.detail.tag);
        }}
        @clan-left=${(e: CustomEvent<{ tag: string }>) => {
          const roles = new Map(this.myClanRoles);
          roles.delete(e.detail.tag);
          this.myClanRoles = roles;
          this.selectedClan = null;
          this.selectedClanTag = "";
          this.myRole = null;
          this.view = "list";
          this.loadMyClans();
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

    // List view (my clans / browse) — header + tabs are rendered by o-modal
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
    this.selectedClanTag = tag;
    this.view = "detail";
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
            @click=${() => (this.activeTab = "browse")}
            class="px-6 py-2 text-sm font-bold text-white uppercase tracking-wider bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 rounded-lg transition-all"
          >
            ${translateText("clan_modal.browse")}
          </button>
        </div>
      `;
    }

    return html`
      <div class="p-4 lg:p-6 space-y-3">
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
