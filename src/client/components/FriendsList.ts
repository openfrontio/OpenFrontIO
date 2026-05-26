import { html, LitElement, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { FriendEntry } from "../../core/ApiSchemas";
import {
  acceptFriendRequest,
  deleteFriendRequest,
  fetchFriendRequests,
  fetchFriends,
  removeFriend,
  sendFriendRequest,
} from "../FriendsApi";
import { showToast, translateText } from "../Utils";
import "./CopyButton";

const PAGE_LIMIT = 20;

@customElement("friends-list")
export class FriendsList extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ type: String }) myPublicId = "";

  @state() private loading = true;
  @state() private actionPending = false;
  @state() private friends: FriendEntry[] = [];
  @state() private friendsTotal = 0;
  @state() private friendsPage = 0;
  @state() private incoming: FriendEntry[] = [];
  @state() private outgoing: FriendEntry[] = [];
  @state() private addInput = "";

  connectedCallback(): void {
    super.connectedCallback();
    void this.loadAll();
  }

  private async loadAll(): Promise<void> {
    this.loading = true;
    try {
      const [requests, firstPage] = await Promise.all([
        fetchFriendRequests(),
        fetchFriends(1, PAGE_LIMIT),
      ]);
      if (requests) {
        this.incoming = requests.incoming;
        this.outgoing = requests.outgoing;
      }
      if (firstPage) {
        this.friends = firstPage.results;
        this.friendsTotal = firstPage.total;
        this.friendsPage = firstPage.page;
      }
    } finally {
      this.loading = false;
    }
  }

  private async loadMore(): Promise<void> {
    if (this.actionPending) return;
    this.actionPending = true;
    try {
      const next = await fetchFriends(this.friendsPage + 1, PAGE_LIMIT);
      if (!next) {
        showToast(translateText("friends.load_failed"), "red");
        return;
      }
      this.friends = [...this.friends, ...next.results];
      this.friendsPage = next.page;
      this.friendsTotal = next.total;
    } finally {
      this.actionPending = false;
    }
  }

  // Re-fetch every currently-loaded page from page 1. Server pagination is
  // offset-based, so any insert/delete shifts later pages — leaving the local
  // cache divergent from the server. Call this after add/remove to resync.
  private async refreshFriends(): Promise<void> {
    const targetPages = Math.max(1, this.friendsPage);
    const accumulated: FriendEntry[] = [];
    let total = this.friendsTotal;
    let lastPage = 0;
    for (let p = 1; p <= targetPages; p++) {
      const data = await fetchFriends(p, PAGE_LIMIT);
      if (!data) return;
      accumulated.push(...data.results);
      total = data.total;
      lastPage = data.page;
      if (data.results.length < PAGE_LIMIT) break;
    }
    this.friends = accumulated;
    this.friendsTotal = total;
    this.friendsPage = lastPage;
  }

  private async handleSend(): Promise<void> {
    const target = this.addInput.trim();
    if (!target) return;
    if (target === this.myPublicId) {
      showToast(translateText("friends.cannot_friend_self"), "red");
      return;
    }
    if (this.actionPending) return;
    this.actionPending = true;
    try {
      const result = await sendFriendRequest(target);
      if (typeof result === "string") {
        showToast(translateText(this.errorKey(result)), "red");
        return;
      }
      this.addInput = "";
      if (result.status === "accepted") {
        showToast(translateText("friends.request_auto_accepted"), "green");
        await this.loadAll();
      } else {
        showToast(translateText("friends.request_sent"), "green");
        this.outgoing = [
          ...this.outgoing,
          { publicId: target, createdAt: new Date().toISOString() },
        ];
      }
    } finally {
      this.actionPending = false;
    }
  }

  private async handleAccept(publicId: string): Promise<void> {
    if (this.actionPending) return;
    this.actionPending = true;
    try {
      const result = await acceptFriendRequest(publicId);
      if (result !== true) {
        showToast(translateText(this.errorKey(result)), "red");
        return;
      }
      this.incoming = this.incoming.filter((r) => r.publicId !== publicId);
      this.friends = [
        { publicId, createdAt: new Date().toISOString() },
        ...this.friends,
      ];
      this.friendsTotal++;
      showToast(translateText("friends.request_accepted"), "green");
      await this.refreshFriends();
    } finally {
      this.actionPending = false;
    }
  }

  private async handleDenyOrWithdraw(
    publicId: string,
    direction: "incoming" | "outgoing",
  ): Promise<void> {
    if (this.actionPending) return;
    this.actionPending = true;
    try {
      const result = await deleteFriendRequest(publicId);
      if (result !== true) {
        showToast(translateText(this.errorKey(result)), "red");
        return;
      }
      if (direction === "incoming") {
        this.incoming = this.incoming.filter((r) => r.publicId !== publicId);
        showToast(translateText("friends.request_denied"), "green");
      } else {
        this.outgoing = this.outgoing.filter((r) => r.publicId !== publicId);
        showToast(translateText("friends.request_withdrawn"), "green");
      }
    } finally {
      this.actionPending = false;
    }
  }

  private async handleRemove(publicId: string): Promise<void> {
    if (this.actionPending) return;
    const confirmed = window.confirm(
      translateText("friends.confirm_remove", { publicId }),
    );
    if (!confirmed) return;
    this.actionPending = true;
    try {
      const result = await removeFriend(publicId);
      if (result !== true) {
        showToast(translateText(this.errorKey(result)), "red");
        return;
      }
      this.friends = this.friends.filter((f) => f.publicId !== publicId);
      this.friendsTotal = Math.max(0, this.friendsTotal - 1);
      showToast(translateText("friends.friend_removed"), "green");
      await this.refreshFriends();
    } finally {
      this.actionPending = false;
    }
  }

  private errorKey(err: string): string {
    switch (err) {
      case "not_found":
        return "friends.error_not_found";
      case "conflict":
        return "friends.error_conflict";
      case "bad_request":
        return "friends.error_bad_request";
      default:
        return "friends.error_generic";
    }
  }

  private formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString();
  }

  render(): TemplateResult {
    if (this.loading) {
      return html`
        <div class="flex items-center justify-center p-12">
          <div
            class="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"
          ></div>
        </div>
      `;
    }

    return html`
      <div class="flex flex-col gap-6">
        ${this.renderTeamInfo()} ${this.renderAddSection()}
        ${this.renderRequestsSection()} ${this.renderFriendsSection()}
      </div>
    `;
  }

  private renderTeamInfo(): TemplateResult {
    return html`
      <div
        class="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3 flex items-center gap-3"
      >
        <span class="text-blue-400 text-lg shrink-0">🛡️</span>
        <p class="text-sm text-white/80">
          ${translateText("friends.team_info")}
        </p>
      </div>
    `;
  }

  private renderAddSection(): TemplateResult {
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-6">
        <h3 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <span class="text-blue-400">➕</span>
          ${translateText("friends.add_friend")}
        </h3>
        <div class="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            .value=${this.addInput}
            @input=${(e: Event) =>
              (this.addInput = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") void this.handleSend();
            }}
            class="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-mono text-sm"
            placeholder=${translateText("friends.public_id_placeholder")}
            maxlength="22"
            ?disabled=${this.actionPending}
          />
          <button
            @click=${() => void this.handleSend()}
            ?disabled=${this.actionPending || this.addInput.trim().length === 0}
            class="px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            ${translateText("friends.send_request")}
          </button>
        </div>
      </div>
    `;
  }

  private renderRequestsSection(): TemplateResult | "" {
    if (this.incoming.length === 0 && this.outgoing.length === 0) return "";
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-6">
        <h3 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <span class="text-blue-400">✉️</span>
          ${translateText("friends.pending_requests")}
        </h3>
        ${this.incoming.length > 0
          ? html`
              <div
                class="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-2"
              >
                ${translateText("friends.incoming")}
              </div>
              <div class="space-y-2 mb-4">
                ${this.incoming.map((r) =>
                  this.renderRequestRow(r, "incoming"),
                )}
              </div>
            `
          : ""}
        ${this.outgoing.length > 0
          ? html`
              <div
                class="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-2"
              >
                ${translateText("friends.outgoing")}
              </div>
              <div class="space-y-2">
                ${this.outgoing.map((r) =>
                  this.renderRequestRow(r, "outgoing"),
                )}
              </div>
            `
          : ""}
      </div>
    `;
  }

  private renderRequestRow(
    entry: FriendEntry,
    direction: "incoming" | "outgoing",
  ): TemplateResult {
    return html`
      <div
        class="flex items-center gap-3 bg-white/5 rounded-lg border border-white/10 p-3"
      >
        <div class="flex-1 min-w-0">
          <copy-button
            compact
            .copyText=${entry.publicId}
            .displayText=${entry.publicId}
            .showVisibilityToggle=${false}
            .showCopyIcon=${false}
          ></copy-button>
          <div class="text-white/30 text-[10px] mt-0.5">
            ${this.formatDate(entry.createdAt)}
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          ${direction === "incoming"
            ? html`
                <button
                  @click=${() => void this.handleAccept(entry.publicId)}
                  ?disabled=${this.actionPending}
                  class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-all disabled:opacity-50 disabled:pointer-events-none"
                >
                  ${translateText("friends.accept")}
                </button>
                <button
                  @click=${() =>
                    void this.handleDenyOrWithdraw(entry.publicId, "incoming")}
                  ?disabled=${this.actionPending}
                  class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-all disabled:opacity-50 disabled:pointer-events-none"
                >
                  ${translateText("friends.deny")}
                </button>
              `
            : html`
                <button
                  @click=${() =>
                    void this.handleDenyOrWithdraw(entry.publicId, "outgoing")}
                  ?disabled=${this.actionPending}
                  class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg bg-white/10 text-white/70 border border-white/10 hover:bg-white/20 transition-all disabled:opacity-50 disabled:pointer-events-none"
                >
                  ${translateText("friends.withdraw")}
                </button>
              `}
        </div>
      </div>
    `;
  }

  private renderFriendsSection(): TemplateResult {
    if (this.friendsTotal === 0) {
      return html`
        <div
          class="bg-white/5 rounded-xl border border-white/10 p-12 flex flex-col items-center justify-center text-center"
        >
          <div class="text-4xl mb-3">👥</div>
          <p class="text-white/60 text-sm">
            ${translateText("friends.no_friends")}
          </p>
        </div>
      `;
    }
    const hasMore = this.friends.length < this.friendsTotal;
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-6">
        <h3 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <span class="text-blue-400">👥</span>
          ${translateText("friends.your_friends")}
          <span class="text-xs text-white/40 font-medium">
            (${this.friendsTotal})
          </span>
        </h3>
        <div class="space-y-2">
          ${this.friends.map(
            (f) => html`
              <div
                class="flex items-center gap-3 bg-white/5 rounded-lg border border-white/10 p-3"
              >
                <div class="flex-1 min-w-0">
                  <copy-button
                    compact
                    .copyText=${f.publicId}
                    .displayText=${f.publicId}
                    .showVisibilityToggle=${false}
                    .showCopyIcon=${false}
                  ></copy-button>
                  <div class="text-white/30 text-[10px] mt-0.5">
                    ${translateText("friends.friends_since", {
                      date: this.formatDate(f.createdAt),
                    })}
                  </div>
                </div>
                <button
                  @click=${() => void this.handleRemove(f.publicId)}
                  ?disabled=${this.actionPending}
                  class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-all disabled:opacity-50 disabled:pointer-events-none shrink-0"
                >
                  ${translateText("friends.remove")}
                </button>
              </div>
            `,
          )}
        </div>
        ${hasMore
          ? html`
              <div class="flex justify-center mt-4">
                <button
                  @click=${() => void this.loadMore()}
                  ?disabled=${this.actionPending}
                  class="px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg bg-white/10 text-white/80 border border-white/10 hover:bg-white/20 transition-all disabled:opacity-50 disabled:pointer-events-none"
                >
                  ${translateText("friends.load_more")}
                </button>
              </div>
            `
          : ""}
      </div>
    `;
  }
}
