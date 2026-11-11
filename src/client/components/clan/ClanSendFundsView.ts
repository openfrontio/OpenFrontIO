import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  type ClanFundRecipient,
  type ClanFundTransferStatus,
  type ClanMember,
  fetchClanFundRecipients,
  fetchClanFundTransfers,
  fetchClanMembers,
  sendClanFunds,
} from "../../ClanApi";
import { translateText } from "../../Utils";
import "../ConfirmDialog";
import "../PlutoniumIcon";
import { playerNameLink } from "../ui/PlayerNameLink";
import {
  clanLeftToday,
  formatPlutonium,
  sendBlockedReason,
} from "./ClanFundShared";
import {
  formatClanDate,
  renderLoadingSpinner,
  renderMemberSearchInput,
  renderRoleIcon,
  renderServerPagination,
  showToast,
  translateClanRole,
} from "./ClanShared";

const QUICK_AMOUNTS = [100n, 500n, 1000n];
const DAY_MS = 24 * 60 * 60 * 1000;

// UUID when available; crypto.randomUUID is undefined outside secure contexts,
// so fall back to random hex of the same shape (8–64 chars, as the API wants).
function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const min = (...xs: bigint[]) => xs.reduce((a, b) => (a < b ? a : b));

/**
 * Full page (Manage → Clan fund → Send Plutonium) where the leader sends
 * Plutonium from the clan fund to a member. Built like the leadership
 * transfer page: a searchable, paged member list, then the action.
 *
 * Members who can't receive right now are dimmed and unselectable with the
 * reason on their row (from GET /fund_transfers/eligibility; if that fails the
 * server's own checks still apply on send). The amount has quick picks and a
 * Max of min(fund, clan's limit left today, the member's limit left today).
 * Sending asks for confirmation first, and Enter never submits. One
 * idempotency key per visit to the page, so a retry can't send twice.
 *
 * Emits `funds-sent` (bubbling) after a successful send.
 */
@customElement("clan-send-funds-view")
export class ClanSendFundsView extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property() clanTag = "";
  @property() myPublicId: string | null = null;

  @state() private status: ClanFundTransferStatus | null = null;
  // The status request failed: nothing can be sent until a retry loads it.
  @state() private statusFailed = false;
  @state() private members: ClanMember[] = [];
  @state() private eligibility = new Map<string, ClanFundRecipient>();
  @state() private membersTotal = 0;
  // The member list failed to load: show an error with Retry, not "no
  // members" or a stale page.
  // The member request that failed (its page and search), so Retry repeats
  // exactly that one rather than the last page that loaded.
  @state() private membersFailed: { page: number; search: string } | null =
    null;
  @state() private memberPage = 1;
  @state() private memberSearch = "";
  @state() private loading = true;
  @state() private recipient: ClanMember | null = null;
  @state() private amountInput = "";
  @state() private confirming = false;
  @state() private submitting = false;
  @state() private serverError: string | null = null;

  private readonly membersPerPage = 10;
  private idempotencyKey = newIdempotencyKey();
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;
  private loadSeq = 0;

  connectedCallback() {
    super.connectedCallback();
    void this.loadStatus();
    void this.loadMembers(1);
  }

  disconnectedCallback() {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.loadSeq++;
    super.disconnectedCallback();
  }

  private async loadStatus() {
    this.statusFailed = false;
    const res = await fetchClanFundTransfers(this.clanTag, { limit: 1 });
    if (!this.isConnected) return;
    if ("error" in res) {
      this.statusFailed = true;
      return;
    }
    this.status = res.status;
  }

  private async loadMembers(page: number, search = this.memberSearch) {
    const seq = ++this.loadSeq;
    const res = await fetchClanMembers(
      this.clanTag,
      page,
      this.membersPerPage,
      "default",
      undefined,
      search || undefined,
    );
    if (seq !== this.loadSeq) return;
    if (!res) {
      this.membersFailed = { page, search };
      this.members = [];
      this.loading = false;
      return;
    }
    const members = res.results.filter((m) => m.publicId !== this.myPublicId);
    const eligibility = await fetchClanFundRecipients(
      this.clanTag,
      members.map((m) => m.publicId),
    );
    if (seq !== this.loadSeq) return;
    this.membersFailed = null;
    this.members = members;
    this.membersTotal = res.total;
    this.memberPage = res.page;
    const next = new Map((eligibility || []).map((e) => [e.publicId, e]));
    // Keep the picked member's eligibility when they're off this page or
    // search, so Max still respects their own limit left today.
    const picked = this.recipient
      ? this.eligibility.get(this.recipient.publicId)
      : undefined;
    if (picked && !next.has(picked.publicId)) next.set(picked.publicId, picked);
    this.eligibility = next;
    this.loading = false;
  }

  private onSearchInput(e: Event) {
    const search = (e.target as HTMLInputElement).value.trim();
    if (search === this.memberSearch) return;
    this.memberSearch = search;
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.searchDebounce = null;
      void this.loadMembers(1, search);
    }, 200);
  }

  private memberName(m: ClanMember): string {
    return m.username ?? m.publicId;
  }

  // Null when unknown (eligibility didn't load): the server decides.
  private eligibilityOf(m: ClanMember): ClanFundRecipient | null {
    return this.eligibility.get(m.publicId) ?? null;
  }

  private selectable(m: ClanMember): boolean {
    return this.eligibilityOf(m)?.eligible ?? true;
  }

  // The most the leader can send to the picked member right now.
  private maxAmount(): bigint | null {
    if (!this.status) return null;
    const limits = [
      BigInt(this.status.hardBalance),
      clanLeftToday(this.status),
    ];
    const e = this.recipient ? this.eligibilityOf(this.recipient) : null;
    limits.push(
      e ? BigInt(e.leftToday) : BigInt(this.status.recipientDailyCap),
    );
    const m = min(...limits);
    return m > 0n ? m : 0n;
  }

  private parsedAmount(): bigint | null {
    const raw = this.amountInput.trim();
    if (!/^\d+$/.test(raw)) return null;
    const amount = BigInt(raw);
    return amount > 0n ? amount : null;
  }

  private amountError(): string | null {
    if (this.amountInput.trim() === "") return null;
    const amount = this.parsedAmount();
    if (amount === null)
      return translateText("clan_modal.donate_invalid_amount");
    const max = this.maxAmount();
    if (max !== null && amount > max) {
      return translateText("clan_modal.send_funds_over_max", {
        amount: formatPlutonium(max),
      });
    }
    return null;
  }

  private canSend(): boolean {
    return (
      !this.submitting &&
      this.recipient !== null &&
      this.parsedAmount() !== null &&
      this.amountError() === null &&
      // Only once the API has said this leader can send right now.
      this.status !== null &&
      this.status.enabled &&
      this.status.canSend &&
      sendBlockedReason(this.status) === null
    );
  }

  private pick(m: ClanMember) {
    if (this.submitting || !this.selectable(m)) return;
    this.recipient = m;
    this.serverError = null;
  }

  private async send() {
    const amount = this.parsedAmount();
    const recipient = this.recipient;
    if (!this.canSend() || amount === null || recipient === null) return;
    this.submitting = true;
    this.serverError = null;
    try {
      const result = await sendClanFunds(
        this.clanTag,
        recipient.publicId,
        amount.toString(),
        this.idempotencyKey,
      );
      if (result !== true) {
        this.serverError = translateText(result.error);
        return;
      }
      showToast(
        translateText("clan_modal.send_funds_success", {
          amount: formatPlutonium(amount),
          name: this.memberName(recipient),
        }),
        "green",
      );
      this.dispatchEvent(
        new CustomEvent("funds-sent", { bubbles: true, composed: true }),
      );
    } finally {
      this.submitting = false;
    }
  }

  render() {
    if (this.loading) return renderLoadingSpinner();
    const status = this.status;
    const blocked = status ? sendBlockedReason(status) : null;
    const totalPages = Math.ceil(this.membersTotal / this.membersPerPage);
    return html`
      <div class="space-y-6">
        ${status ? this.renderSummary(status) : ""}
        ${
          this.statusFailed
            ? this.renderLoadError(
                "status",
                "clan_modal.clan_fund_load_failed",
                () => void this.loadStatus(),
              )
            : ""
        }
        ${
          blocked
            ? html`<div
                role="status"
                class="bg-amber-500/10 rounded-xl border border-amber-500/20 p-3 text-amber-300 text-sm"
              >
                ${blocked}
              </div>`
            : ""
        }

        <div class="space-y-3">
          <h3 class="text-sm font-bold text-white/60 uppercase tracking-wider">
            ${translateText("clan_modal.send_funds_step_member")}
          </h3>
          ${renderMemberSearchInput(
            (e) => this.onSearchInput(e),
            this.memberSearch,
          )}
          <div role="radiogroup" class="space-y-2">
            ${
              this.membersFailed
                ? this.renderLoadError(
                    "members",
                    "clan_modal.send_funds_members_failed",
                    () => {
                      const failed = this.membersFailed;
                      if (failed)
                        void this.loadMembers(failed.page, failed.search);
                    },
                  )
                : this.members.length === 0
                  ? html`<p class="text-white/40 text-sm text-center py-4">
                      ${translateText("clan_modal.send_funds_no_members")}
                    </p>`
                  : this.members.map((m) => this.renderMember(m))
            }
          </div>
          ${
            totalPages > 1
              ? renderServerPagination(this.memberPage, totalPages, (p) =>
                  this.loadMembers(p),
                )
              : ""
          }
        </div>

        ${this.renderAmount()}

        <div
          class="bg-red-500/10 rounded-xl border border-red-500/30 p-4 text-red-300 text-sm"
        >
          ${translateText("clan_modal.send_funds_warning", {
            tag: this.clanTag,
          })}
        </div>

        ${
          this.serverError
            ? html`<p class="text-red-400 text-sm" role="alert">
                ${this.serverError}
              </p>`
            : ""
        }

        <button
          type="button"
          data-action="send"
          ?disabled=${!this.canSend()}
          @click=${() => (this.confirming = true)}
          class="w-full px-6 py-3 text-sm font-bold text-white uppercase tracking-wider rounded-xl transition-all border bg-red-600 hover:bg-red-700 border-white/5 disabled:bg-white/5 disabled:border-white/10 disabled:text-white/30 disabled:pointer-events-none"
        >
          ${this.sendLabel()}
        </button>
      </div>
      ${this.renderConfirm()}
    `;
  }

  // A red "couldn't load" box with Retry. `which` names it for tests.
  private renderLoadError(
    which: "status" | "members",
    messageKey: string,
    retry: () => void,
  ): TemplateResult {
    return html`<div
      data-load-error=${which}
      role="alert"
      class="flex items-center justify-between gap-3 bg-red-500/10 rounded-xl border border-red-500/30 p-3 text-red-300 text-sm"
    >
      <span>${translateText(messageKey)}</span>
      <button
        type="button"
        data-action="retry"
        @click=${retry}
        class="shrink-0 px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg bg-white/10 hover:bg-white/15 text-white border border-white/10"
      >
        ${translateText("clan_modal.retry")}
      </button>
    </div>`;
  }

  private sendLabel(): string {
    if (this.submitting)
      return translateText("clan_modal.send_funds_submitting");
    const amount = this.parsedAmount();
    if (!this.recipient)
      return translateText("clan_modal.send_funds_pick_member");
    if (amount === null)
      return translateText("clan_modal.send_funds_enter_amount");
    return translateText("clan_modal.send_funds_send_to", {
      amount: formatPlutonium(amount),
      name: this.memberName(this.recipient),
    });
  }

  private renderSummary(status: ClanFundTransferStatus): TemplateResult {
    const stat = (label: string, value: string, attr: string) => html`
      <div
        class="flex-1 min-w-[120px] bg-white/5 rounded-xl border border-white/10 p-3"
      >
        <div
          class="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-1"
        >
          ${label}
        </div>
        <div
          data-summary=${attr}
          class="flex items-center gap-1.5 text-white font-bold tabular-nums"
        >
          <plutonium-icon .size=${14}></plutonium-icon>${value}
        </div>
      </div>
    `;
    return html`<div class="flex flex-wrap gap-2">
      ${stat(
        translateText("clan_modal.send_funds_stat_fund"),
        formatPlutonium(status.hardBalance),
        "fund",
      )}
      ${stat(
        translateText("clan_modal.send_funds_stat_clan_left"),
        formatPlutonium(clanLeftToday(status)),
        "clan-left",
      )}
      ${stat(
        translateText("clan_modal.send_funds_stat_member_max"),
        formatPlutonium(status.recipientDailyCap),
        "member-max",
      )}
    </div>`;
  }

  private reasonText(e: ClanFundRecipient): string | null {
    switch (e.reason) {
      case "too_recent": {
        const ms = e.eligibleAt
          ? new Date(e.eligibleAt).getTime() - Date.now()
          : 0;
        return translateText("clan_modal.send_funds_reason_too_recent", {
          days: Math.max(1, Math.ceil(ms / DAY_MS)),
        });
      }
      case "recipient_cap":
        return translateText("clan_modal.send_funds_reason_cap");
      case "not_eligible":
      case "self":
      case "not_member":
        return translateText("clan_modal.send_funds_reason_not_eligible");
      default:
        return null;
    }
  }

  private renderMember(m: ClanMember): TemplateResult {
    const e = this.eligibilityOf(m);
    const selectable = this.selectable(m);
    const selected = this.recipient?.publicId === m.publicId;
    const reason = e ? this.reasonText(e) : null;
    return html`
      <div
        data-member=${m.publicId}
        ?data-ineligible=${!selectable}
        class="relative w-full flex items-center gap-3 py-2.5 px-3 rounded-xl border transition-all text-left ${
          selected
            ? "bg-white/10 border-white/30"
            : selectable
              ? "bg-white/5 border-white/10 hover:bg-white/10"
              : "bg-white/[0.02] border-white/5 opacity-50"
        }"
      >
        <button
          type="button"
          role="radio"
          aria-checked=${selected}
          aria-disabled=${!selectable}
          aria-labelledby=${`send-target-${m.publicId}`}
          ?disabled=${!selectable || this.submitting}
          @click=${() => this.pick(m)}
          class="absolute inset-0 w-full h-full rounded-xl focus:outline-none focus:ring-2 focus:ring-white/30 ${
            selectable ? "cursor-pointer" : "cursor-not-allowed"
          }"
        ></button>
        <div
          class="relative pointer-events-none w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/50 text-xs font-bold shrink-0"
        >
          ${renderRoleIcon(m.role)}
        </div>
        <div
          id=${`send-target-${m.publicId}`}
          class="relative pointer-events-none flex-1 min-w-0 flex flex-col"
        >
          <span class="pointer-events-auto inline-flex max-w-full min-w-0">
            ${playerNameLink(this, m.username, m.publicId)}
          </span>
          <span
            class="text-[10px] ${reason ? "text-amber-300/80" : "text-white/30"}"
            >${
              reason ??
              translateText("clan_modal.joined_date", {
                date: formatClanDate(m.joinedAt),
              })
            }</span
          >
        </div>
        <span
          class="relative pointer-events-none text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${
            m.role === "officer"
              ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
              : "bg-white/10 text-white/40 border border-white/10"
          }"
          >${translateClanRole(m.role)}</span
        >
        ${
          selected
            ? html`<svg
                xmlns="http://www.w3.org/2000/svg"
                class="relative pointer-events-none w-5 h-5 text-white shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>`
            : ""
        }
      </div>
    `;
  }

  private renderAmount(): TemplateResult {
    const max = this.maxAmount();
    const error = this.amountError();
    const quick = (amount: bigint, label: string, attr: string) =>
      html`<button
        type="button"
        data-quick=${attr}
        ?disabled=${this.submitting || max === null || amount <= 0n || amount > max}
        @click=${() => {
          this.amountInput = amount.toString();
          this.serverError = null;
        }}
        class="px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-30 disabled:pointer-events-none"
      >
        ${label}
      </button>`;
    return html`
      <div class="space-y-3">
        <h3 class="text-sm font-bold text-white/60 uppercase tracking-wider">
          <label for="clan-send-funds-amount"
            >${translateText("clan_modal.send_funds_step_amount")}</label
          >
        </h3>
        <div class="relative">
          <plutonium-icon
            class="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
            .size=${18}
          ></plutonium-icon>
          <input
            id="clan-send-funds-amount"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            placeholder="0"
            .value=${this.amountInput}
            ?disabled=${this.submitting}
            @input=${(e: Event) => {
              this.amountInput = (e.target as HTMLInputElement).value;
              this.serverError = null;
            }}
            class="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-lg font-bold tabular-nums placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 disabled:opacity-50"
          />
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap gap-1.5">
            ${QUICK_AMOUNTS.map((a) => quick(a, formatPlutonium(a), a.toString()))}
            ${quick(max ?? 0n, translateText("clan_modal.send_funds_max"), "max")}
          </div>
          ${
            this.recipient && max !== null
              ? html`<span data-amount-hint class="text-xs text-white/40"
                  >${translateText("clan_modal.send_funds_amount_hint", {
                    amount: formatPlutonium(max),
                    name: this.memberName(this.recipient),
                  })}</span
                >`
              : ""
          }
        </div>
        ${error ? html`<p class="text-red-400 text-xs" role="alert">${error}</p>` : ""}
      </div>
    `;
  }

  private renderConfirm() {
    const amount = this.parsedAmount();
    if (!this.confirming || !this.recipient || amount === null) return "";
    return html`<confirm-dialog
      .message=${translateText("clan_modal.send_funds_confirm_message", {
        amount: formatPlutonium(amount),
        name: this.memberName(this.recipient),
        tag: this.clanTag,
      })}
      variant="warning"
      .confirmText=${translateText("clan_modal.send_funds_confirm")}
      ?disabled=${this.submitting}
      @confirm=${() => {
        this.confirming = false;
        void this.send();
      }}
      @cancel=${() => (this.confirming = false)}
    ></confirm-dialog>`;
  }
}
