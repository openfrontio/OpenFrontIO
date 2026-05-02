import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { invalidateUserMe } from "../../Api";
import {
  banClanMember,
  type ClanInfo,
  type ClanMember,
  type ClanMemberOrder,
  type ClanMemberSort,
  demoteMember,
  disbandClan,
  fetchClanMembers,
  kickMember,
  promoteMember,
  updateClan,
} from "../../ClanApi";
import { translateText } from "../../Utils";
import "../ConfirmDialog";
import "../CopyButton";
import { modalHeader } from "../ui/ModalHeader";
import {
  type ClanRole,
  defaultOrderForSort,
  filterMembersBySearch,
  formatClanDate,
  modalContainerClass,
  renderLoadingSpinner,
  renderMemberPagination,
  renderMemberSearchInput,
  renderMemberSortControl,
  renderRoleIcon,
  showToast,
} from "./ClanShared";

@customElement("clan-manage-view")
export class ClanManageView extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property() clanTag = "";
  @property({ type: Object }) selectedClan: ClanInfo | null = null;
  @property() myPublicId: string | null = null;
  @property() myRole: ClanRole | null = null;

  @state() private manageName = "";
  @state() private manageDescription = "";
  @state() private manageIsOpen = true;
  @state() private saving = false;
  @state() private members: ClanMember[] = [];
  @state() private membersTotal = 0;
  @state() private memberPage = 1;
  @state() private membersPerPage = 10;
  @state() private memberSort: ClanMemberSort = "default";
  @state() private memberOrder: ClanMemberOrder = "asc";
  @state() private memberActionPending = false;
  @state() private loading = false;
  @state() private confirmAction: "disband" | "kick" | "ban" | null = null;
  @state() private confirmTargetId: string | null = null;
  @state() private pendingRequestCount = 0;
  @state() private actionPending = false;
  private memberSearch = "";
  private memberSearchDebounce: ReturnType<typeof setTimeout> | null = null;

  connectedCallback() {
    super.connectedCallback();
    if (this.selectedClan) {
      this.manageName = this.selectedClan.name;
      this.manageDescription = this.selectedClan.description ?? "";
      this.manageIsOpen = this.selectedClan.isOpen ?? true;
    }
    this.loadMembers(1);
  }

  disconnectedCallback() {
    if (this.memberSearchDebounce) clearTimeout(this.memberSearchDebounce);
    super.disconnectedCallback();
  }

  private async loadMembers(page: number) {
    if (this.members.length === 0) this.loading = true;
    const res = await fetchClanMembers(
      this.clanTag,
      page,
      this.membersPerPage,
      this.memberSort,
      this.memberOrder,
    );
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
    this.memberPage = page;
    this.pendingRequestCount = res.pendingRequests ?? 0;
    if (this.selectedClan && this.selectedClan.memberCount !== res.total) {
      this.dispatchEvent(
        new CustomEvent("clan-updated", {
          detail: { memberCount: res.total },
          bubbles: true,
          composed: true,
        }),
      );
    }
    this.loading = false;
  }

  private async handleSaveSettings() {
    const clan = this.selectedClan;
    if (!clan) return;
    const patch: { name?: string; description?: string; isOpen?: boolean } = {};
    if (this.manageName !== clan.name) patch.name = this.manageName;
    if ((this.manageDescription ?? "") !== (clan.description ?? ""))
      patch.description = this.manageDescription;
    if (this.manageIsOpen !== (clan.isOpen ?? true))
      patch.isOpen = this.manageIsOpen;
    if (Object.keys(patch).length === 0) return;

    this.saving = true;
    const result = await updateClan(this.clanTag, patch);
    if ("error" in result) {
      showToast(translateText(result.error), "red");
      this.saving = false;
      return;
    }
    this.dispatchEvent(
      new CustomEvent("clan-updated", {
        detail: {
          name: result.name,
          description: result.description,
          isOpen: result.isOpen,
        },
        bubbles: true,
        composed: true,
      }),
    );
    this.saving = false;
    showToast(translateText("clan_modal.settings_saved"), "green");
    this.dispatchEvent(
      new CustomEvent("navigate-detail", { bubbles: true, composed: true }),
    );
  }

  private async handlePromote(publicId: string) {
    if (this.memberActionPending) return;
    this.memberActionPending = true;
    try {
      const result = await promoteMember(this.clanTag, publicId);
      if (result !== true) {
        showToast(translateText(result.error), "red");
        return;
      }
      await this.loadMembers(this.memberPage);
      showToast(translateText("clan_modal.member_promoted"), "green");
    } finally {
      this.memberActionPending = false;
    }
  }

  private async handleDemote(publicId: string) {
    if (this.memberActionPending) return;
    this.memberActionPending = true;
    try {
      const result = await demoteMember(this.clanTag, publicId);
      if (result !== true) {
        showToast(translateText(result.error), "red");
        return;
      }
      await this.loadMembers(this.memberPage);
      showToast(translateText("clan_modal.member_demoted"), "green");
    } finally {
      this.memberActionPending = false;
    }
  }

  private async handleKick(publicId: string) {
    if (this.memberActionPending) return;
    this.memberActionPending = true;
    try {
      const result = await kickMember(this.clanTag, publicId);
      if (result !== true) {
        showToast(translateText(result.error), "red");
        return;
      }
      await this.loadMembers(this.memberPage);
      showToast(translateText("clan_modal.member_kicked"), "green");
    } finally {
      this.memberActionPending = false;
    }
  }

  private async handleBan(publicId: string, reason: string) {
    if (this.memberActionPending) return;
    this.memberActionPending = true;
    try {
      const result = await banClanMember(
        this.clanTag,
        publicId,
        reason.trim().slice(0, 200) || undefined,
      );
      if (result !== true) {
        showToast(translateText(result.error), "red");
        return;
      }
      await this.loadMembers(this.memberPage);
      showToast(translateText("clan_modal.member_banned"), "green");
    } finally {
      this.memberActionPending = false;
    }
  }

  private async handleDisband() {
    if (this.actionPending) return;
    this.actionPending = true;
    try {
      const result = await disbandClan(this.clanTag);
      if (result !== true) {
        showToast(translateText(result.error), "red");
        return;
      }
      invalidateUserMe();
      this.dispatchEvent(
        new CustomEvent("clan-disbanded", {
          detail: { tag: this.clanTag },
          bubbles: true,
          composed: true,
        }),
      );
      showToast(translateText("clan_modal.clan_disbanded"), "green");
    } finally {
      this.actionPending = false;
    }
  }

  private clearConfirm() {
    this.confirmAction = null;
    this.confirmTargetId = null;
  }

  private onSearchInput(e: Event) {
    if (this.memberSearchDebounce) clearTimeout(this.memberSearchDebounce);
    this.memberSearchDebounce = setTimeout(() => {
      this.memberSearch = (e.target as HTMLInputElement).value;
      this.requestUpdate();
    }, 200);
  }

  private onSortChange(sort: ClanMemberSort) {
    if (sort === this.memberSort) return;
    this.memberSort = sort;
    this.memberOrder = defaultOrderForSort(sort);
    this.loadMembers(1);
  }

  private onOrderToggle() {
    this.memberOrder = this.memberOrder === "asc" ? "desc" : "asc";
    this.loadMembers(1);
  }

  private navigateDetail = () =>
    this.dispatchEvent(
      new CustomEvent("navigate-detail", { bubbles: true, composed: true }),
    );

  render() {
    if (this.loading)
      return html`<div class="${modalContainerClass}">
        ${modalHeader({
          title: translateText("clan_modal.manage_clan"),
          onBack: this.navigateDetail,
          ariaLabel: translateText("common.back"),
        })}
        ${renderLoadingSpinner()}
      </div>`;

    const clan = this.selectedClan;
    if (!clan) return "";

    return html`${this.renderManageContent(clan)}${this.renderConfirmOverlay()}`;
  }

  private renderConfirmOverlay() {
    if (!this.confirmAction) return "";

    if (this.confirmAction === "disband") {
      return html`<confirm-dialog
        .message=${translateText("clan_modal.confirm_disband", {
          tag: this.selectedClan?.tag ?? "",
          name: this.selectedClan?.name ?? "",
        })}
        variant="danger"
        ?disabled=${this.actionPending}
        @confirm=${() => {
          this.clearConfirm();
          this.handleDisband();
        }}
        @cancel=${() => this.clearConfirm()}
      ></confirm-dialog>`;
    }
    if (this.confirmAction === "kick" && this.confirmTargetId) {
      return html`<confirm-dialog
        .message=${translateText("clan_modal.confirm_kick")}
        variant="warning"
        ?disabled=${this.memberActionPending}
        @confirm=${() => {
          const id = this.confirmTargetId!;
          this.clearConfirm();
          this.handleKick(id);
        }}
        @cancel=${() => this.clearConfirm()}
      ></confirm-dialog>`;
    }
    if (this.confirmAction === "ban" && this.confirmTargetId) {
      return html`<confirm-dialog
        .message=${translateText("clan_modal.confirm_ban")}
        variant="warning"
        textareaPlaceholder=${translateText("clan_modal.ban_reason_prompt")}
        ?disabled=${this.memberActionPending}
        @confirm=${(e: CustomEvent<{ text: string }>) => {
          const id = this.confirmTargetId!;
          const reason = e.detail.text;
          this.clearConfirm();
          this.handleBan(id, reason);
        }}
        @cancel=${() => this.clearConfirm()}
      ></confirm-dialog>`;
    }
    return "";
  }

  private renderManageContent(clan: ClanInfo) {
    return html`
      <div class="${modalContainerClass}">
        ${modalHeader({
          title: translateText("clan_modal.manage_clan"),
          onBack: this.navigateDetail,
          ariaLabel: translateText("common.back"),
          rightContent: html`<span
            class="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-white/10 text-white/50 border border-white/10"
            >[${clan.tag}]</span
          >`,
        })}
        <div class="flex-1 overflow-y-auto custom-scrollbar mr-1 p-4 lg:p-6">
          <div class="space-y-6">
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
                  maxlength="35"
                  class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium hover:bg-white/10 text-sm"
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
                  class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium hover:bg-white/10 text-sm resize-none"
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
                  role="switch"
                  aria-checked="${this.manageIsOpen}"
                  aria-label="${translateText("clan_modal.open_clan")}"
                  @click=${() => (this.manageIsOpen = !this.manageIsOpen)}
                  class="relative w-12 h-7 rounded-full transition-all ${this
                    .manageIsOpen
                    ? "bg-malibu-blue"
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
                class="w-full px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 rounded-xl transition-all disabled:opacity-50"
              >
                ${this.saving
                  ? translateText("clan_modal.saving")
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
                ${translateText("clan_modal.members")}
                (${clan.memberCount ?? 0})
              </h3>
              ${renderMemberSearchInput(
                (e) => this.onSearchInput(e),
                undefined,
                renderMemberSortControl(
                  this.memberSort,
                  this.memberOrder,
                  (s) => this.onSortChange(s),
                  () => this.onOrderToggle(),
                ),
              )}
              ${(() => {
                const filtered = filterMembersBySearch(
                  this.members,
                  this.memberSearch,
                );
                return html`
                  <div class="space-y-2">
                    ${filtered.map((m) => this.renderManageMemberRow(m))}
                  </div>
                  ${renderMemberPagination(
                    this.memberPage,
                    this.membersTotal,
                    this.membersPerPage,
                    (p) => this.loadMembers(p),
                    (pp) => {
                      this.membersPerPage = pp;
                      this.loadMembers(1);
                    },
                  )}
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
                @click=${() =>
                  this.dispatchEvent(
                    new CustomEvent("navigate-bans", {
                      bubbles: true,
                      composed: true,
                    }),
                  )}
                class="w-full px-6 py-3 text-sm font-bold text-red-400 uppercase tracking-wider bg-red-600/20 hover:bg-red-600/30 rounded-xl transition-all border border-red-500/30"
              >
                ${translateText("clan_modal.banned_players")}
              </button>
              ${this.myRole === "leader"
                ? html`
                    <button
                      @click=${() =>
                        this.dispatchEvent(
                          new CustomEvent("navigate-transfer", {
                            bubbles: true,
                            composed: true,
                          }),
                        )}
                      class="w-full px-6 py-3 text-sm font-bold text-amber-400 uppercase tracking-wider bg-amber-600/20 hover:bg-amber-600/30 rounded-xl transition-all border border-amber-500/30"
                    >
                      ${translateText("clan_modal.transfer_leadership")}
                    </button>
                    <button
                      @click=${() => {
                        this.confirmAction = "disband";
                        this.confirmTargetId = null;
                      }}
                      ?disabled=${this.confirmAction === "disband"}
                      class="w-full px-6 py-3 text-sm font-bold text-red-400 uppercase tracking-wider bg-red-600/20 hover:bg-red-600/30 rounded-xl transition-all border border-red-500/30 disabled:opacity-50 disabled:pointer-events-none"
                    >
                      ${translateText("clan_modal.disband_clan")}
                    </button>
                  `
                : ""}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderManageMemberRow(member: ClanMember) {
    const isLeader = member.role === "leader";
    const isMe = member.publicId === this.myPublicId;
    const canModerate =
      !isMe &&
      !isLeader &&
      (this.myRole === "leader" ||
        (this.myRole === "officer" && member.role === "member"));
    const canPromote =
      !isMe && this.myRole === "leader" && member.role === "member";
    const canDemote =
      !isMe && this.myRole === "leader" && member.role === "officer";

    return html`
      <div
        class="flex flex-col py-2.5 px-3 rounded-xl border
        ${isMe
          ? "bg-malibu-blue/10 border-malibu-blue/20"
          : "bg-white/5 border-white/10"}"
      >
        <div class="flex items-center flex-wrap gap-1.5">
          <div
            class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0
          ${isMe
              ? "bg-malibu-blue/20 text-aquarius"
              : "bg-white/10 text-white/50"}"
          >
            ${renderRoleIcon(member.role)}
          </div>
          <copy-button
            compact
            .copyText=${member.publicId}
            .displayText=${member.publicId}
            .showVisibilityToggle=${false}
            .showCopyIcon=${false}
          ></copy-button>
          <span class="text-white/30 text-[10px] whitespace-nowrap">
            ${translateText("clan_modal.joined_date", {
              date: formatClanDate(member.joinedAt),
            })}
          </span>
          <div class="flex items-center gap-1.5 ml-auto flex-wrap justify-end">
            ${canPromote
              ? html`<button
                  @click=${() => this.handlePromote(member.publicId)}
                  ?disabled=${this.memberActionPending}
                  class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400/70 border border-purple-500/20 hover:bg-purple-500/20 hover:text-purple-400 transition-all disabled:opacity-50 disabled:pointer-events-none"
                >
                  ${translateText("clan_modal.promote")}
                </button>`
              : ""}
            ${canDemote
              ? html`<button
                  @click=${() => this.handleDemote(member.publicId)}
                  ?disabled=${this.memberActionPending}
                  class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/5 text-white/40 border border-white/10 hover:bg-white/10 hover:text-white/60 transition-all disabled:opacity-50 disabled:pointer-events-none"
                >
                  ${translateText("clan_modal.demote")}
                </button>`
              : ""}
            ${canModerate
              ? html`
                  <button
                    @click=${() => {
                      this.confirmAction = "kick";
                      this.confirmTargetId = member.publicId;
                    }}
                    ?disabled=${this.memberActionPending ||
                    this.confirmAction !== null}
                    class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500/10 text-red-400/70 border border-red-500/20 hover:bg-red-500/20 hover:text-red-400 transition-all disabled:opacity-50 disabled:pointer-events-none"
                  >
                    ${translateText("clan_modal.kick")}
                  </button>
                  <button
                    @click=${() => {
                      this.confirmAction = "ban";
                      this.confirmTargetId = member.publicId;
                    }}
                    ?disabled=${this.memberActionPending ||
                    this.confirmAction !== null}
                    class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500/10 text-red-400/70 border border-red-500/20 hover:bg-red-500/20 hover:text-red-400 transition-all disabled:opacity-50 disabled:pointer-events-none"
                  >
                    ${translateText("clan_modal.ban")}
                  </button>
                `
              : ""}
          </div>
        </div>
      </div>
    `;
  }
}
