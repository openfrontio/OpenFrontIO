import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { type ClanBan, fetchClanBans, unbanClanMember } from "../../ClanApi";
import { translateText } from "../../Utils";
import "../CopyButton";
import {
  formatClanDate,
  renderLoadingSpinner,
  renderMemberSearchInput,
  renderServerPagination,
  showToast,
} from "./ClanShared";

@customElement("clan-bans-view")
export class ClanBansView extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property() clanTag = "";

  @state() private bans: ClanBan[] = [];
  @state() private bansTotal = 0;
  @state() private bansPage = 1;
  @state() private bansLimit = 20;
  @state() private memberActionPending = false;
  @state() private loading = false;
  private memberSearch = "";
  private memberSearchDebounce: ReturnType<typeof setTimeout> | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.loadBans(1);
  }

  disconnectedCallback() {
    if (this.memberSearchDebounce) clearTimeout(this.memberSearchDebounce);
    super.disconnectedCallback();
  }

  private async loadBans(page: number, showLoading = true) {
    if (showLoading) this.loading = true;
    else this.memberActionPending = true;
    try {
      const data = await fetchClanBans(this.clanTag, page);
      if (!data) {
        showToast(translateText("clan_modal.error_failed"), "red");
        return;
      }
      if (data.results.length === 0 && page > 1) {
        await this.loadBans(1, false);
        return;
      }
      this.bans = data.results;
      this.bansTotal = data.total;
      this.bansLimit = data.limit;
      this.bansPage = data.page;
    } finally {
      if (showLoading) this.loading = false;
      else this.memberActionPending = false;
    }
  }

  private async handleUnban(publicId: string) {
    if (this.memberActionPending) return;
    this.memberActionPending = true;
    try {
      const result = await unbanClanMember(this.clanTag, publicId);
      if (result !== true) {
        showToast(translateText(result.error), "red");
        return;
      }
      this.bans = this.bans.filter((b) => b.publicId !== publicId);
      this.bansTotal--;
      showToast(translateText("clan_modal.member_unbanned"), "green");
      if (this.bans.length === 0 && this.bansPage > 1) {
        await this.loadBans(this.bansPage - 1, false);
      }
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
    if (this.loading) return renderLoadingSpinner();

    const totalPages = Math.ceil(this.bansTotal / this.bansLimit);
    const filtered = this.memberSearch
      ? this.bans.filter((b) =>
          b.publicId.toLowerCase().includes(this.memberSearch.toLowerCase()),
        )
      : this.bans;

    return html`
      <div>
        <div
          class="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-2"
        >
          ${translateText("clan_modal.banned_players_count", {
            count: this.bansTotal,
          })}
        </div>
        ${renderMemberSearchInput(
          (e) => this.onSearchInput(e),
          "clan_modal.search_members_placeholder",
        )}
        ${filtered.length === 0
          ? html`<div
              class="flex flex-col items-center justify-center p-12 text-center"
            >
              <p class="text-white/40 text-sm">
                ${translateText("clan_modal.no_bans")}
              </p>
            </div>`
          : html`
              <div class="space-y-3">
                ${filtered.map(
                  (ban) => html`
                    <div
                      class="bg-white/5 rounded-xl border border-white/10 p-4 space-y-2"
                    >
                      <div class="flex items-center gap-2">
                        <div
                          class="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center shrink-0"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="w-4 h-4 text-red-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            stroke-width="2"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                            />
                          </svg>
                        </div>
                        <copy-button
                          compact
                          .copyText=${ban.publicId}
                          .displayText=${ban.publicId}
                          .showVisibilityToggle=${false}
                          .showCopyIcon=${false}
                        ></copy-button>
                        <span class="text-white/30 text-xs shrink-0"
                          >${translateText("clan_modal.banned_by_label")}</span
                        >
                        <copy-button
                          compact
                          .copyText=${ban.bannedBy}
                          .displayText=${ban.bannedBy}
                          .showVisibilityToggle=${false}
                          .showCopyIcon=${false}
                        ></copy-button>
                        <span class="text-white/30 text-xs shrink-0"
                          >${formatClanDate(ban.createdAt)}</span
                        >
                        <div class="flex-1"></div>
                        <button
                          @click=${() => this.handleUnban(ban.publicId)}
                          ?disabled=${this.memberActionPending}
                          class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-all disabled:opacity-50 disabled:pointer-events-none shrink-0"
                        >
                          ${translateText("clan_modal.unban")}
                        </button>
                      </div>
                      ${ban.reason
                        ? html`<div class="text-white/50 text-xs pl-10">
                            ${translateText("clan_modal.ban_reason", {
                              reason: ban.reason,
                            })}
                          </div>`
                        : ""}
                    </div>
                  `,
                )}
              </div>
              ${totalPages > 1
                ? renderServerPagination(this.bansPage, totalPages, (p) =>
                    this.loadBans(p, false),
                  )
                : ""}
            `}
      </div>
    `;
  }
}
