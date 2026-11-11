import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  type ClanFundTransfer,
  type ClanFundTransferStatus,
  fetchClanFundTransfers,
} from "../../ClanApi";
import { translateText } from "../../Utils";
import "../PlutoniumIcon";
import {
  clanLeftToday,
  formatPlutonium,
  renderPayoutRow,
  sendBlockedReason,
} from "./ClanFundShared";
import type { ClanRole } from "./ClanShared";

const RECENT_PAYOUTS = 3;
const CAP_RELOAD_MAX_BACKOFF_MS = 5 * 60_000;

/**
 * The "Clan fund" card on the Manage page (leader and officers): the fund's
 * Plutonium balance, how much of today's sending limit is used, the last few
 * payouts and a link to the full log every member can see. The leader gets the
 * Send button; officers see the card read-only. A notice explains when sending
 * is blocked (paused by staff, daily limit reached, empty fund).
 *
 * Renders nothing until the API reports the feature on (or the clan already
 * has payouts), so it stays out of the way against an older API.
 *
 * Emits `navigate-send-funds` and `navigate-payouts` (bubbling).
 */
@customElement("clan-fund-card")
export class ClanFundCard extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property() clanTag = "";
  @property() myRole: ClanRole | null = null;

  @state() private status: ClanFundTransferStatus | null = null;
  @state() private recent: ClanFundTransfer[] = [];
  @state() private visible = false;

  // Reloads the card when the rolling 24h limit frees up, so a leader who
  // stays on Manage isn't left with a disabled Send button.
  private capTimer: ReturnType<typeof setTimeout> | null = null;
  // Back-to-back reloads that found the limit still used with its reset time
  // already past (browser clock ahead of the API's), or that failed. Each one
  // doubles the wait, so a skewed clock or a down API can't cause a request
  // every second.
  private capRetries = 0;

  connectedCallback() {
    super.connectedCallback();
    void this.load();
  }

  disconnectedCallback() {
    this.clearCapTimer();
    super.disconnectedCallback();
  }

  private clearCapTimer() {
    if (this.capTimer) clearTimeout(this.capTimer);
    this.capTimer = null;
  }

  // 1s, 2s, 4s… up to 5 minutes.
  private nextBackoff(): number {
    const ms = 1_000 * (1 << Math.min(this.capRetries, 9));
    this.capRetries++;
    return Math.min(ms, CAP_RELOAD_MAX_BACKOFF_MS);
  }

  // `waitingForReset`: this load was the timer's, so a failure retries
  // instead of leaving Send disabled.
  private async load(waitingForReset = false) {
    if (!this.clanTag) return;
    const res = await fetchClanFundTransfers(this.clanTag, {
      limit: RECENT_PAYOUTS,
    });
    if (!this.isConnected) return;
    if ("error" in res) {
      if (waitingForReset) this.setCapTimer(this.nextBackoff());
      return;
    }
    this.status = res.status;
    this.recent = res.results;
    this.visible = res.status.enabled || res.total > 0;
    this.scheduleCapReload(res.status);
  }

  private scheduleCapReload(status: ClanFundTransferStatus) {
    this.clearCapTimer();
    if (!status.enabled || !status.capResetsAt || clanLeftToday(status) > 0n) {
      this.capRetries = 0;
      return;
    }
    const wait = new Date(status.capResetsAt).getTime() - Date.now();
    if (wait <= 0) {
      // Already past by our clock but the API still counts it: back off.
      this.setCapTimer(this.nextBackoff());
      return;
    }
    this.capRetries = 0;
    // A second's grace so the API's window has moved on too; never more than
    // a day, so a bad timestamp can't overflow setTimeout.
    this.setCapTimer(Math.min(wait + 1_000, 24 * 3_600_000));
  }

  private setCapTimer(delay: number) {
    this.clearCapTimer();
    this.capTimer = setTimeout(() => {
      this.capTimer = null;
      void this.load(true);
    }, delay);
  }

  private emit(name: string) {
    this.dispatchEvent(
      new CustomEvent(name, { bubbles: true, composed: true }),
    );
  }

  render() {
    const status = this.status;
    if (!this.visible || !status) return html``;
    const cap = BigInt(status.clanDailyCap);
    const sent = BigInt(status.clanSentToday);
    const usedPct =
      cap > 0n ? Math.min(100, Number((sent * 1000n) / cap) / 10) : 0;
    const blocked = status.enabled ? sendBlockedReason(status) : null;
    const isLeader = this.myRole === "leader";

    return html`
      <div
        data-clan-fund-card
        class="bg-white/5 rounded-2xl border border-white/10 p-6 space-y-4"
      >
        <h3 class="text-sm font-bold text-white/60 uppercase tracking-wider">
          ${translateText("clan_modal.clan_fund")}
        </h3>

        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <plutonium-icon .size=${24}></plutonium-icon>
              <span
                data-fund-balance
                class="text-3xl font-bold text-white tabular-nums"
                >${formatPlutonium(status.hardBalance)}</span
              >
            </div>
            <p class="text-white/40 text-xs mt-1">
              ${translateText("clan_modal.clan_fund_balance_label")}
            </p>
          </div>
          <div class="flex-1 min-w-[180px] max-w-xs">
            <div class="flex justify-between text-xs text-white/50 mb-1.5">
              <span>${translateText("clan_modal.clan_fund_sent_today")}</span>
              <span data-sent-today class="tabular-nums"
                >${formatPlutonium(sent)} / ${formatPlutonium(cap)}</span
              >
            </div>
            <div class="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                class="h-full rounded-full ${
                  usedPct >= 100 ? "bg-amber-400/70" : "bg-white/40"
                }"
                style="width: ${usedPct}%"
              ></div>
            </div>
          </div>
        </div>

        ${
          blocked
            ? html`<div
                data-fund-notice
                role="status"
                class="bg-amber-500/10 rounded-xl border border-amber-500/20 p-3 text-amber-300 text-sm"
              >
                ${blocked}
              </div>`
            : ""
        }
        ${
          isLeader
            ? html`<button
                type="button"
                data-action="open-send-funds"
                ?disabled=${!status.canSend || blocked !== null}
                @click=${() => this.emit("navigate-send-funds")}
                class="w-full flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-white/10 hover:bg-white/15 rounded-xl transition-all border border-white/10 disabled:opacity-40 disabled:pointer-events-none"
              >
                <plutonium-icon .size=${16}></plutonium-icon>
                ${translateText("clan_modal.send_funds")}
              </button>`
            : html`<p class="text-white/40 text-xs">
                ${translateText("clan_modal.clan_fund_officer_note")}
              </p>`
        }

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span
              class="text-[10px] font-bold text-white/40 uppercase tracking-wider"
              >${translateText("clan_modal.clan_fund_recent")}</span
            >
            <button
              type="button"
              data-action="view-payouts"
              @click=${() => this.emit("navigate-payouts")}
              class="text-xs text-aquarius hover:underline"
            >
              ${translateText("clan_modal.clan_fund_view_log")}
            </button>
          </div>
          ${
            this.recent.length === 0
              ? html`<p class="text-white/30 text-xs">
                  ${translateText("clan_modal.clan_fund_no_payouts")}
                </p>`
              : this.recent.map((t) => renderPayoutRow(this, t))
          }
        </div>
      </div>
    `;
  }
}
