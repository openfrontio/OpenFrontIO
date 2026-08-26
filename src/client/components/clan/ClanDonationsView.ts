import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  type ClanCurrencyType,
  type ClanDonation,
  fetchClanDonations,
} from "../../ClanApi";
import { translateText } from "../../Utils";
import "../CurrencyDisplay";
import { formatAbsoluteTime } from "../baseComponents/stats/GameHistoryDates";
import { playerNameLink } from "../ui/PlayerNameLink";
import { renderLoadingSpinner, renderMemberPagination } from "./ClanShared";

type CurrencyFilter = ClanCurrencyType | "all";

const FILTER_TABS: { key: CurrencyFilter; labelKey: string }[] = [
  { key: "all", labelKey: "clan_modal.donations_filter_all" },
  { key: "soft", labelKey: "cosmetics.soft" },
  { key: "hard", labelKey: "cosmetics.hard" },
];

/**
 * The clan's Donations tab: a members-only, newest-first page of donations
 * made to the clan, filterable by currency. Refetches on every mount — the
 * tab is unmounted while the player donates from Overview, so re-entering it
 * always shows the fresh list. Rows link to the donor's profile via
 * `view-profile` (see PlayerNameLink); a donor whose account was deleted
 * renders as a fixed label instead.
 */
@customElement("clan-donations-view")
export class ClanDonationsView extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property() clanTag = "";

  @state() private donations: ClanDonation[] = [];
  @state() private total = 0;
  @state() private page = 1;
  @state() private perPage = 10;
  @state() private filter: CurrencyFilter = "all";
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
    const res = await fetchClanDonations(this.clanTag, {
      page: this.page,
      limit: this.perPage,
      currencyType: this.filter === "all" ? undefined : this.filter,
    });
    if (gen !== this.asyncGeneration) return;
    this.loading = false;
    if ("error" in res) {
      this.loadState = res.error;
      this.donations = [];
      this.total = 0;
      return;
    }
    this.donations = res.results;
    this.total = res.total;
  }

  private setFilter(filter: CurrencyFilter) {
    if (filter === this.filter) return;
    this.filter = filter;
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
    return html`<div class="space-y-3">
      ${this.renderFilters()}${this.renderBody()}
    </div>`;
  }

  private renderFilters(): TemplateResult {
    return html`
      <div
        role="tablist"
        class="flex gap-1 p-1 bg-white/5 border border-white/10 rounded-xl"
      >
        ${FILTER_TABS.map((tab) => {
          const active = this.filter === tab.key;
          return html`
            <button
              type="button"
              role="tab"
              aria-selected=${active}
              data-currency-filter=${tab.key}
              @click=${() => this.setFilter(tab.key)}
              class="flex-1 px-3 py-1.5 text-xs font-bold uppercase tracking-wider whitespace-nowrap rounded-lg transition-colors ${active
                ? "bg-malibu-blue/20 text-aquarius border border-malibu-blue/30"
                : "text-white/50 hover:text-white hover:bg-white/5 border border-transparent"}"
            >
              ${translateText(tab.labelKey)}
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
    if (this.donations.length === 0) {
      return html`
        <div
          class="bg-white/5 rounded-xl border border-white/10 p-8 text-center"
        >
          <p class="text-white/40 text-sm">
            ${translateText("clan_modal.donations_empty")}
          </p>
        </div>
      `;
    }
    return html`
      <div class="space-y-2">
        ${this.donations.map((d) => this.renderRow(d))}
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
}
