import { html, type TemplateResult } from "lit";
import type { ClanFundTransfer, ClanFundTransferStatus } from "../../ClanApi";
import { translateText } from "../../Utils";
import { formatAbsoluteTime } from "../baseComponents/stats/GameHistoryDates";
import { formatCurrencyAmount } from "../CurrencyDisplay";
import "../PlutoniumIcon";
import { playerNameLink } from "../ui/PlayerNameLink";

// Pieces shared by the Clan fund card (Manage), the send page and the
// members' Payouts log (Donations).

export function formatPlutonium(amount: string | bigint): string {
  return formatCurrencyAmount(amount.toString()) ?? "0";
}

// Plutonium the clan can still send in the rolling 24h.
export function clanLeftToday(status: ClanFundTransferStatus): bigint {
  const left = BigInt(status.clanDailyCap) - BigInt(status.clanSentToday);
  return left > 0n ? left : 0n;
}

// Why the leader can't send right now, as a translated sentence, or null.
// Order matters: a frozen fund says so even when it is also empty.
export function sendBlockedReason(
  status: ClanFundTransferStatus,
  now: number = Date.now(),
): string | null {
  if (status.frozen) return translateText("clan_modal.clan_fund_frozen");
  if (BigInt(status.hardBalance) <= 0n) {
    return translateText("clan_modal.clan_fund_empty");
  }
  if (clanLeftToday(status) <= 0n) {
    const ms = status.capResetsAt
      ? new Date(status.capResetsAt).getTime() - now
      : 0;
    return translateText("clan_modal.clan_fund_cap_reached", {
      hours: Math.max(1, Math.ceil(ms / 3_600_000)),
    });
  }
  return null;
}

// Plutonium amount with the icon, in neutral text: payouts are money leaving
// the fund, so they must not read like the green donations coming in.
export function renderPlutoniumAmount(
  amount: string,
  sign: "+" | "−",
  opts: { struck?: boolean } = {},
): TemplateResult {
  return html`<span
    class="inline-flex items-center gap-1 text-sm font-bold tabular-nums text-white/70 ${
      opts.struck ? "line-through text-white/30" : ""
    }"
    ><plutonium-icon .size=${14}></plutonium-icon>${sign}${formatPlutonium(
      amount,
    )}</span
  >`;
}

function renderPlayer(
  host: HTMLElement,
  publicId: string | null,
  username: string | null,
): TemplateResult {
  return publicId === null
    ? html`<span class="text-white/40 italic"
        >${translateText("clan_modal.donations_deleted_player")}</span
      >`
    : html`<span class="min-w-0 inline-flex"
        >${playerNameLink(host, username, publicId)}</span
      >`;
}

/**
 * One payout log row. A send reads "Sender → Recipient" with the amount going
 * out of the fund; a reversed send keeps its row, struck through with a
 * Reversed pill. A staff reversal is its own row: who it was taken back from,
 * the amount returned to the fund, and when the original send was made.
 */
export function renderPayoutRow(
  host: HTMLElement,
  t: ClanFundTransfer,
): TemplateResult {
  if (t.kind === "reversal") {
    return html`
      <div
        data-transfer-id=${t.id}
        data-kind="reversal"
        class="flex items-center gap-3 py-2.5 px-3 rounded-xl border bg-red-500/5 border-red-500/20"
      >
        <div class="flex-1 min-w-0 flex flex-col gap-0.5">
          <div
            class="flex flex-wrap items-center gap-1.5 text-sm text-white/70"
          >
            <span>${translateText("clan_modal.payout_reversal")}</span>
            ${renderPlayer(host, t.recipient, t.recipientUsername)}
          </div>
          <span class="text-white/30 text-[10px] whitespace-nowrap">
            ${formatAbsoluteTime(t.createdAt)}${
              t.reversesCreatedAt
                ? html` ·
                  ${translateText("clan_modal.payout_original", {
                    date: formatAbsoluteTime(t.reversesCreatedAt),
                  })}`
                : ""
            }
          </span>
        </div>
        <div class="shrink-0 flex flex-col items-end">
          ${renderPlutoniumAmount(t.amount, "+")}
          <span class="text-[10px] text-white/30"
            >${translateText("clan_modal.payout_returned")}</span
          >
        </div>
      </div>
    `;
  }
  const reversed = t.reversedAt !== null;
  return html`
    <div
      data-transfer-id=${t.id}
      data-kind="transfer"
      ?data-reversed=${reversed}
      class="flex items-center gap-3 py-2.5 px-3 rounded-xl border bg-white/5 border-white/10"
    >
      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        <div class="flex flex-wrap items-center gap-1.5 text-sm text-white/70">
          ${renderPlayer(host, t.sender, t.senderUsername)}
          <span class="text-white/30" aria-hidden="true">→</span>
          ${renderPlayer(host, t.recipient, t.recipientUsername)}
          ${
            reversed
              ? html`<span
                  class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20"
                  >${translateText("clan_modal.payout_reversed")}</span
                >`
              : ""
          }
        </div>
        <span class="text-white/30 text-[10px] whitespace-nowrap"
          >${formatAbsoluteTime(t.createdAt)}</span
        >
      </div>
      <div class="shrink-0">
        ${renderPlutoniumAmount(t.amount, "−", { struck: reversed })}
      </div>
    </div>
  `;
}
