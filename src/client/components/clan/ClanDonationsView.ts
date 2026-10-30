import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  type ClanCurrencyType,
  type ClanDonation,
  type ClanDonationPeriod,
  type ClanDonor,
  fetchClanDonationLeaderboard,
  fetchClanDonations,
} from "../../ClanApi";
import { translateText } from "../../Utils";
import "../CurrencyDisplay";
import { formatAbsoluteTime } from "../baseComponents/stats/GameHistoryDates";
import { playerNameLink } from "../ui/PlayerNameLink";
import { renderLoadingSpinner, renderMemberPagination } from "./ClanShared";

type CurrencyFilter = ClanCurrencyType | "all";
type DonationsMode = "recent" | "top";

interface Tab<K extends string> {
  key: K;
  labelKey: string;
  icon?: TemplateResult;
}

const MODE_TABS: Tab<DonationsMode>[] = [
  { key: "recent", labelKey: "clan_modal.donations_recent" },
  { key: "top", labelKey: "clan_modal.donations_top" },
];

const FILTER_TABS: Tab<CurrencyFilter>[] = [
  { key: "all", labelKey: "clan_modal.donations_filter_all" },
  {
    key: "soft",
    labelKey: "cosmetics.soft",
    icon: html`<cap-icon .size=${14}></cap-icon>`,
  },
  {
    key: "hard",
    labelKey: "cosmetics.hard",
    icon: html`<plutonium-icon .size=${14}></plutonium-icon>`,
  },
];

const PERIOD_TABS: Tab<ClanDonationPeriod>[] = [
  { key: "all", labelKey: "clan_modal.donations_period_all" },
  { key: "month", labelKey: "clan_modal.donations_period_month" },
  { key: "week", labelKey: "clan_modal.donations_period_week" },
];

// The podium: badge and row tint per rank, matching the global leaderboard.
const PODIUM: Record<number, { icon: string; badge: string; row: string }> = {
  1: {
    icon: "👑",
    badge: "bg-yellow-400/10 ring-1 ring-yellow-400/30",
    row: "bg-yellow-400/[0.06] border-yellow-400/25",
  },
  2: {
    icon: "🥈",
    badge: "bg-slate-400/10 ring-1 ring-slate-400/30",
    row: "bg-slate-300/[0.05] border-slate-300/20",
  },
  3: {
    icon: "🥉",
    badge: "bg-amber-600/10 ring-1 ring-amber-600/30",
    row: "bg-amber-600/[0.06] border-amber-600/25",
  },
};

/**
 * The clan's Donations tab, members only. Recent is a newest-first page of
 * donations made to the clan, filterable by currency; Top donors ranks current
 * members by what they've donated of one currency (caps and plutonium don't
 * sum, so "All" isn't offered there) over all time or the last 30 / 7 days.
 * Refetches on every mount — the tab is unmounted while the player donates
 * from Overview, so re-entering it always shows fresh data. Rows link to the
 * donor's profile via `view-profile` (see PlayerNameLink); a donor whose
 * account was deleted renders as a fixed label instead.
 */
@customElement("clan-donations-view")
export class ClanDonationsView extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property() clanTag = "";

  @state() private mode: DonationsMode = "recent";
  @state() private donations: ClanDonation[] = [];
  @state() private donors: ClanDonor[] = [];
  @state() private total = 0;
  @state() private page = 1;
  @state() private perPage = 10;
  @state() private filter: CurrencyFilter = "all";
  @state() private period: ClanDonationPeriod = "all";
  // #1's total, kept from page 1 (every filter change resets to it) so each
  // row's bar can show the donor's total against the leader's on any page.
  private leaderTotal = 0n;
  @state() private loading = false;
  @state() private loadState: "ok" | "failed" | "forbidden" = "ok";
  private asyncGeneration = 0;

  connectedCallback() {
    super.connectedCallback();
    if (this.clanTag) void this.load();
  }

  private async load() {
    if (!this.clanTag) return;
    const gen = ++this.asyncGeneration;
    this.loading = true;
    this.loadState = "ok";
    if (this.mode === "top") {
      const res = await fetchClanDonationLeaderboard(this.clanTag, {
        // setMode moves the filter off "all" before a Top donors load.
        currencyType: this.filter === "hard" ? "hard" : "soft",
        period: this.period,
        page: this.page,
        limit: this.perPage,
      });
      if (gen !== this.asyncGeneration) return;
      this.applyResult(res, (rows) => {
        this.donors = rows;
        if (this.page === 1) this.leaderTotal = BigInt(rows[0]?.total ?? 0);
      });
    } else {
      const res = await fetchClanDonations(this.clanTag, {
        page: this.page,
        limit: this.perPage,
        currencyType: this.filter === "all" ? undefined : this.filter,
      });
      if (gen !== this.asyncGeneration) return;
      this.applyResult(res, (rows) => (this.donations = rows));
    }
  }

  private applyResult<T>(
    res: { results: T[]; total: number } | { error: "failed" | "forbidden" },
    setRows: (rows: T[]) => void,
  ) {
    this.loading = false;
    this.donations = [];
    this.donors = [];
    if ("error" in res) {
      this.loadState = res.error;
      this.total = 0;
      return;
    }
    setRows(res.results);
    this.total = res.total;
  }

  private setMode(mode: DonationsMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === "top" && this.filter === "all") this.filter = "soft";
    this.page = 1;
    void this.load();
  }

  private setFilter(filter: CurrencyFilter) {
    if (filter === this.filter) return;
    this.filter = filter;
    this.page = 1;
    void this.load();
  }

  private setPeriod(period: ClanDonationPeriod) {
    if (period === this.period) return;
    this.period = period;
    this.page = 1;
    void this.load();
  }

  private setPage(page: number) {
    if (page === this.page) return;
    this.page = page;
    void this.load();
  }

  private setPerPage(perPage: number) {
    if (perPage === this.perPage) return;
    this.perPage = perPage;
    this.page = 1;
    void this.load();
  }

  render() {
    if (this.loadState === "forbidden") {
      return html`
        <div
          class="bg-white/5 rounded-xl border border-white/10 p-8 text-center"
        >
          <p class="text-white/40 text-sm">
            ${translateText("clan_modal.donations_members_only")}
          </p>
        </div>
      `;
    }
    const top = this.mode === "top";
    return html`<div class="space-y-3">
      ${this.renderTabs(
        MODE_TABS,
        this.mode,
        (mode) => this.setMode(mode),
        "mode",
      )}
      <div class="flex flex-wrap items-center justify-between gap-2">
        ${this.renderTabs(
          top ? FILTER_TABS.filter((t) => t.key !== "all") : FILTER_TABS,
          this.filter,
          (filter) => this.setFilter(filter),
          "currency",
          true,
        )}
        ${top
          ? this.renderTabs(
              PERIOD_TABS,
              this.period,
              (period) => this.setPeriod(period),
              "period",
              true,
            )
          : null}
      </div>
      ${this.renderBody()}
    </div>`;
  }

  private renderTabs<K extends string>(
    tabs: Tab<K>[],
    active: K,
    onSelect: (key: K) => void,
    name: string,
    compact = false,
  ): TemplateResult {
    return html`
      <div
        role="tablist"
        data-tabs=${name}
        class="${compact
          ? "inline-flex"
          : "flex"} gap-1 p-1 bg-white/5 border border-white/10 rounded-xl"
      >
        ${tabs.map((tab) => {
          const selected = active === tab.key;
          return html`
            <button
              type="button"
              role="tab"
              aria-selected=${selected}
              data-tab=${tab.key}
              @click=${() => onSelect(tab.key)}
              class="${compact
                ? ""
                : "flex-1"} inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider whitespace-nowrap rounded-lg transition-colors ${selected
                ? "bg-malibu-blue/20 text-aquarius border border-malibu-blue/30"
                : "text-white/50 hover:text-white hover:bg-white/5 border border-transparent"}"
            >
              ${tab.icon ?? null}${translateText(tab.labelKey)}
            </button>
          `;
        })}
      </div>
    `;
  }

  private renderBody(): TemplateResult {
    if (this.loading) {
      return renderLoadingSpinner();
    }
    if (this.loadState === "failed") {
      return html`
        <div
          class="bg-white/5 rounded-xl border border-white/10 p-8 text-center"
        >
          <p class="text-white/40 text-sm mb-3">
            ${translateText("clan_modal.donations_unavailable")}
          </p>
          <button
            type="button"
            @click=${() => this.load()}
            class="text-xs font-bold text-white/60 hover:text-white uppercase tracking-wider px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 hover:bg-white/5 transition-colors"
          >
            ${translateText("leaderboard_modal.try_again")}
          </button>
        </div>
      `;
    }
    const top = this.mode === "top";
    if ((top ? this.donors : this.donations).length === 0) {
      return html`
        <div
          class="bg-white/5 rounded-xl border border-white/10 p-8 text-center"
        >
          <p class="text-white/40 text-sm">
            ${translateText(
              top
                ? "clan_modal.donations_top_empty"
                : "clan_modal.donations_empty",
            )}
          </p>
        </div>
      `;
    }
    return html`
      <div class="space-y-2">
        ${top
          ? this.donors.map((d) => this.renderDonorRow(d))
          : this.donations.map((d) => this.renderRow(d))}
      </div>
      ${renderMemberPagination(
        this.page,
        this.total,
        this.perPage,
        (page) => this.setPage(page),
        (perPage) => this.setPerPage(perPage),
      )}
    `;
  }

  private renderRow(d: ClanDonation): TemplateResult {
    const isHard = d.currencyType === "hard";
    return html`
      <div
        data-donation-id=${d.id}
        class="flex items-center gap-3 py-2.5 px-3 rounded-xl border bg-white/5 border-white/10"
      >
        <div class="flex-1 min-w-0 flex flex-col">
          ${d.createdBy === null
            ? html`<span class="text-sm text-white/40 italic"
                >${translateText("clan_modal.donations_deleted_player")}</span
              >`
            : html`<div class="min-w-0">
                ${playerNameLink(this, d.createdByUsername, d.createdBy)}
              </div>`}
          <span class="text-white/30 text-[10px] whitespace-nowrap"
            >${formatAbsoluteTime(d.createdAt)}</span
          >
        </div>
        <currency-display
          class="shrink-0"
          .hard=${isHard ? d.amount : null}
          .soft=${isHard ? null : d.amount}
        ></currency-display>
      </div>
    `;
  }

  private renderDonorRow(d: ClanDonor): TemplateResult {
    const isHard = this.filter === "hard";
    const podium = PODIUM[d.rank];
    const total = BigInt(d.total);
    const share =
      this.leaderTotal > 0n
        ? Math.min(100, Number((total * 1000n) / this.leaderTotal) / 10)
        : 0;
    return html`
      <div
        data-donor-id=${d.playerId}
        data-rank=${d.rank}
        class="flex items-center gap-3 py-2.5 px-3 rounded-xl border ${podium?.row ??
        "bg-white/5 border-white/10"}"
      >
        <span
          class="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg font-bold tabular-nums ${podium
            ? `text-lg ${podium.badge}`
            : "text-sm text-white/40 bg-white/5"}"
          >${podium?.icon ?? d.rank}</span
        >
        <div class="flex-1 min-w-0 flex flex-col gap-1">
          <div class="flex items-baseline justify-between gap-3 min-w-0">
            <div class="min-w-0">
              ${playerNameLink(this, d.username, d.playerId)}
            </div>
            <currency-display
              class="shrink-0"
              .hard=${isHard ? d.total : null}
              .soft=${isHard ? null : d.total}
            ></currency-display>
          </div>
          <div class="flex items-center gap-3">
            <div class="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
              <div
                data-share
                class="h-full rounded-full ${isHard
                  ? "bg-green-400/60"
                  : "bg-amber-600/70"}"
                style="width: ${share}%"
              ></div>
            </div>
            <span class="shrink-0 text-white/30 text-[10px] whitespace-nowrap"
              >${translateText("clan_modal.donations_count", {
                count: d.donations,
              })}</span
            >
          </div>
        </div>
      </div>
    `;
  }
}
