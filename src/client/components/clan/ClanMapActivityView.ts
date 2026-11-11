import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  fetchClanMapActivity,
  fetchClanMapActivityMembers,
  type MapActivityClan,
  type MapActivityEvent,
  type MapActivityFilter,
  type MapActivityMember,
  type MapActivityPage,
  type MapActivityPeriod,
  type MapActivityPlayer,
} from "../../ClanApi";
import { getCurrentLanguage, translateText } from "../../Utils";
import "../CurrencyDisplay";
import {
  formatDayHeader,
  groupByDay,
} from "../baseComponents/stats/GameHistoryDates";
import { playerNameLink } from "../ui/PlayerNameLink";
import { renderLoadingSpinner, renderRoleIcon } from "./ClanShared";

type Mode = "recent" | "members";
type MemberSort = "active" | "claimed" | "caps" | "ships";
type LoadState = "ok" | "failed" | "forbidden" | "signed_out";

// One Recent filter's loaded pages, kept while the tab is open so switching
// filters or modes doesn't refetch or drop what Load more added.
interface RecentEntry {
  page: MapActivityPage;
  events: MapActivityEvent[];
  nextBefore: string | null;
}

// Marks where an element goes in a translated string (see `withSlots`).
// Private-use characters, so no translation contains them.
const SLOT_OPEN = "";
const SLOT_CLOSE = "";
const SLOT_RE = /(\w+)/;

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Times and dates in the game's language, not the browser's.
function formatTime(d: Date): string {
  return d.toLocaleTimeString(getCurrentLanguage(), {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function formatDate(d: Date): string {
  return d.toLocaleDateString(getCurrentLanguage());
}
function formatCount(n: number): string {
  return new Intl.NumberFormat(getCurrentLanguage()).format(n);
}

interface Tab<K extends string> {
  key: K;
  labelKey: string;
}

const MODE_TABS: Tab<Mode>[] = [
  { key: "recent", labelKey: "clan_modal.map_activity_recent" },
  { key: "members", labelKey: "clan_modal.map_activity_by_member" },
];

const FILTER_TABS: Tab<MapActivityFilter>[] = [
  { key: "all", labelKey: "clan_modal.map_activity_filter_all" },
  { key: "ours", labelKey: "clan_modal.map_activity_filter_ours" },
  { key: "lost", labelKey: "clan_modal.map_activity_filter_lost" },
];

const PERIODS: MapActivityPeriod[] = ["24h", "7d", "30d"];
const SORTS: MemberSort[] = ["active", "claimed", "caps", "ships"];

// Where "View on map" points: the map opens framed on this pixel.
export interface MapActivityAt {
  x: number;
  y: number;
}

type Row = MapActivityEvent & { start: string };

/**
 * The clan's Map activity tab, members only: what members did on the clan
 * territory map and what the clan lost there. Recent is a newest-first log
 * (claims, unclaims, troop purchases, ships, land taken and sieges) with a
 * 24-hour summary and the ships at sea, paged with Load more; By member sums
 * each member's claims, caps spent on troops and ships over a period. Rows
 * with a place on the map dispatch `view-on-map` ({x, y}); the empty state's
 * Open map dispatches it without a place. Player names dispatch
 * `view-profile` (see PlayerNameLink).
 */
@customElement("clan-map-activity-view")
export class ClanMapActivityView extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property() clanTag = "";

  @state() private mode: Mode = "recent";
  @state() private filter: MapActivityFilter = "all";
  @state() private page: MapActivityPage | null = null;
  @state() private events: MapActivityEvent[] = [];
  @state() private nextBefore: string | null = null;
  @state() private loadingMore = false;
  @state() private loadMoreFailed = false;
  @state() private period: MapActivityPeriod = "7d";
  @state() private sort: MemberSort = "active";
  @state() private members: MapActivityMember[] = [];
  @state() private loading = false;
  @state() private loadState: LoadState = "ok";
  // Bumped whenever what's shown changes, so a response for something no
  // longer shown is dropped.
  private asyncGeneration = 0;
  private recentCache = new Map<MapActivityFilter, RecentEntry>();
  private membersCache = new Map<MapActivityPeriod, MapActivityMember[]>();

  connectedCallback() {
    super.connectedCallback();
    if (this.clanTag) this.show();
  }

  protected willUpdate(changed: Map<PropertyKey, unknown>) {
    // Reused for another clan: nothing cached belongs to it.
    if (changed.has("clanTag") && changed.get("clanTag") && this.clanTag) {
      this.recentCache.clear();
      this.membersCache.clear();
      this.show();
    }
  }

  // Shows the current mode / filter / period: from the cache when it was
  // loaded before (unless `refetch`), otherwise fetched. Anything in flight
  // for what was shown before, a Load more included, is abandoned.
  private show(refetch = false) {
    this.asyncGeneration++;
    this.loadingMore = false;
    this.loadMoreFailed = false;
    this.loadState = "ok";
    if (this.mode === "members") {
      const cached = refetch ? undefined : this.membersCache.get(this.period);
      if (cached) {
        this.loading = false;
        this.members = cached;
        return;
      }
    } else {
      const cached = refetch ? undefined : this.recentCache.get(this.filter);
      if (cached) {
        this.loading = false;
        this.page = cached.page;
        this.events = cached.events;
        this.nextBefore = cached.nextBefore;
        return;
      }
    }
    void this.load();
  }

  private async load() {
    if (!this.clanTag) return;
    const gen = this.asyncGeneration;
    this.loading = true;
    if (this.mode === "members") {
      const period = this.period;
      const res = await fetchClanMapActivityMembers(this.clanTag, period);
      if (gen !== this.asyncGeneration) return;
      this.loading = false;
      if ("error" in res) {
        this.loadState = res.error;
        this.members = [];
        return;
      }
      this.membersCache.set(period, res.members);
      this.members = res.members;
      return;
    }
    const filter = this.filter;
    const res = await fetchClanMapActivity(this.clanTag, { filter });
    if (gen !== this.asyncGeneration) return;
    this.loading = false;
    if ("error" in res) {
      this.loadState = res.error;
      this.page = null;
      this.events = [];
      this.nextBefore = null;
      return;
    }
    this.recentCache.set(filter, {
      page: res,
      events: res.events,
      nextBefore: res.nextBefore,
    });
    this.page = res;
    this.events = res.events;
    this.nextBefore = res.nextBefore;
  }

  private async loadMore() {
    if (!this.nextBefore || this.loadingMore || !this.page) return;
    const gen = this.asyncGeneration;
    const filter = this.filter;
    const page = this.page;
    this.loadingMore = true;
    this.loadMoreFailed = false;
    const res = await fetchClanMapActivity(this.clanTag, {
      filter,
      before: this.nextBefore,
    });
    // A switch since then has already cleared loadingMore.
    if (gen !== this.asyncGeneration) return;
    this.loadingMore = false;
    if ("error" in res) {
      this.loadMoreFailed = true;
      return;
    }
    this.events = [...this.events, ...res.events];
    this.nextBefore = res.nextBefore;
    this.recentCache.set(filter, {
      page,
      events: this.events,
      nextBefore: this.nextBefore,
    });
  }

  private setMode(mode: Mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.show();
  }

  private setFilter(filter: MapActivityFilter) {
    if (filter === this.filter) return;
    this.filter = filter;
    this.show();
  }

  private setPeriod(period: MapActivityPeriod) {
    if (period === this.period) return;
    this.period = period;
    this.show();
  }

  // A translated string with elements in it: each `slots` entry fills the
  // `{name}` placeholder of the same name, so translators can put the
  // player's or clan's name anywhere in the sentence.
  private withSlots(
    key: string,
    params: Record<string, string | number>,
    slots: Record<string, TemplateResult>,
  ): TemplateResult {
    const marked: Record<string, string | number> = { ...params };
    for (const name of Object.keys(slots)) {
      marked[name] = `${SLOT_OPEN}${name}${SLOT_CLOSE}`;
    }
    const parts = translateText(key, marked).split(SLOT_RE);
    // split() with a capture group alternates text and slot names. A
    // translation that left a slot out still shows it, first, rather than
    // losing who did it.
    const used = new Set(parts.filter((_, i) => i % 2));
    const missing = Object.keys(slots).filter((name) => !used.has(name));
    return html`${missing.map((name) => slots[name])}${parts.map((part, i) => {
      if (i % 2) return slots[part] ?? nothing;
      const text = part.trim();
      return text ? html`<span class="text-white/70">${text}</span>` : nothing;
    })}`;
  }

  private viewOnMap(at: MapActivityAt | null) {
    this.dispatchEvent(
      new CustomEvent<MapActivityAt | null>("view-on-map", {
        detail: at,
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    return html`<div class="space-y-3">
      ${this.renderTabs(
        MODE_TABS,
        this.mode,
        (mode) => this.setMode(mode),
        "mode",
      )}
      ${this.mode === "recent" ? this.renderRecent() : this.renderMembers()}
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
        class="${
          compact ? "inline-flex" : "flex"
        } gap-1 p-1 bg-white/5 border border-white/10 rounded-xl"
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
              class="${
                compact ? "" : "flex-1"
              } inline-flex items-center justify-center px-3 py-1.5 text-xs font-bold uppercase tracking-wider whitespace-nowrap rounded-lg transition-colors ${
                selected
                  ? "bg-malibu-blue/20 text-aquarius border border-malibu-blue/30"
                  : "text-white/50 hover:text-white hover:bg-white/5 border border-transparent"
              }"
            >
              ${translateText(tab.labelKey)}
            </button>
          `;
        })}
      </div>
    `;
  }

  private renderMessage(
    key: string,
    action?: { labelKey: string; onClick: () => void; primary?: boolean },
  ): TemplateResult {
    return html`<div
      data-state=${key}
      class="bg-white/5 rounded-xl border border-white/10 p-8 text-center"
    >
      <p class="text-white/40 text-sm ${action ? "mb-3" : ""}">
        ${translateText(key)}
      </p>
      ${
        action
          ? html`<button
              type="button"
              @click=${action.onClick}
              class="text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-colors ${
                action.primary
                  ? "bg-malibu-blue/20 text-aquarius border border-malibu-blue/30 hover:bg-malibu-blue/30"
                  : "text-white/60 hover:text-white border border-white/10 hover:border-white/20 hover:bg-white/5"
              }"
            >
              ${translateText(action.labelKey)}
            </button>`
          : nothing
      }
    </div>`;
  }

  // Loading, members-only and failed: the same for both modes.
  private renderBlocking(): TemplateResult | null {
    if (this.loading) return renderLoadingSpinner();
    if (this.loadState === "forbidden") {
      return this.renderMessage("clan_modal.map_activity_members_only");
    }
    if (this.loadState === "signed_out") {
      return this.renderMessage("clan_modal.map_activity_signed_out");
    }
    if (this.loadState === "failed") {
      return this.renderMessage("clan_modal.map_activity_unavailable", {
        labelKey: "leaderboard_modal.try_again",
        onClick: () => this.show(true),
      });
    }
    return null;
  }

  // ---- Recent

  private renderRecent(): TemplateResult {
    const blocking = this.renderBlocking();
    if (blocking) return blocking;
    const page = this.page;
    if (!page) return html``;
    const nothingAtAll =
      this.filter === "all" && !this.events.length && !page.atSea.length;
    if (nothingAtAll) {
      return this.renderMessage("clan_modal.map_activity_empty", {
        labelKey: "clan_modal.map_activity_open_map",
        onClick: () => this.viewOnMap(null),
        primary: true,
      });
    }
    const atSea = this.filter === "lost" ? [] : page.atSea;
    const rows: Row[] = this.events.map((e) => ({ ...e, start: e.at }));
    return html`
      ${this.renderSummary(page)}
      ${this.renderTabs(
        FILTER_TABS,
        this.filter,
        (f) => this.setFilter(f),
        "filter",
        true,
      )}
      ${
        atSea.length
          ? html`<div data-group="at-sea" class="space-y-2">
              ${this.renderDivider(
                translateText("clan_modal.map_activity_at_sea"),
              )}
              ${atSea.map((e) => this.renderEvent(e))}
            </div>`
          : nothing
      }
      ${
        rows.length
          ? groupByDay(rows).map(
              (group) =>
                html`<div class="space-y-2" data-day=${group.day}>
                  ${this.renderDivider(formatDayHeader(group.day))}
                  ${group.items.map((e) => this.renderEvent(e))}
                </div>`,
            )
          : atSea.length
            ? nothing
            : this.renderMessage(
                this.filter === "lost"
                  ? "clan_modal.map_activity_empty_lost"
                  : "clan_modal.map_activity_empty_ours",
              )
      }
      ${this.renderLoadMore()}
    `;
  }

  private renderSummary(page: MapActivityPage): TemplateResult {
    const box = (labelKey: string, value: string, name: string) =>
      html`<div
        data-stat=${name}
        class="rounded-xl border border-white/10 bg-white/5 py-2.5 text-center"
      >
        <div
          class="text-[10px] font-bold uppercase tracking-wider text-white/40"
        >
          ${translateText(labelKey)}
        </div>
        <div class="text-sm font-bold tabular-nums">${value}</div>
      </div>`;
    const s = page.summary;
    return html`<div class="grid grid-cols-3 gap-2">
      ${box(
        "clan_modal.map_activity_gained_24h",
        translateText("clan_modal.map_activity_px_gain", { count: s.gained }),
        "gained",
      )}
      ${box(
        "clan_modal.map_activity_lost_24h",
        translateText("clan_modal.map_activity_px", { count: s.lost }),
        "lost",
      )}
      ${box(
        "clan_modal.map_activity_ships_at_sea",
        formatCount(s.shipsAtSea),
        "ships",
      )}
    </div>`;
  }

  private renderDivider(label: string): TemplateResult {
    return html`<div class="flex items-center gap-3 px-1 pt-1">
      <span class="h-px flex-1 bg-white/10"></span>
      <h3
        class="text-xs font-bold uppercase tracking-widest text-white/70 whitespace-nowrap"
      >
        ${label}
      </h3>
      <span class="h-px flex-1 bg-white/10"></span>
    </div>`;
  }

  private renderLoadMore(): TemplateResult | typeof nothing {
    if (!this.nextBefore) return nothing;
    return html`<div class="text-center space-y-2">
      ${
        this.loadMoreFailed
          ? html`<p class="text-xs text-red-400">
              ${translateText("clan_modal.map_activity_load_more_failed")}
            </p>`
          : nothing
      }
      <button
        type="button"
        data-load-more
        ?disabled=${this.loadingMore}
        @click=${() => void this.loadMore()}
        class="w-full py-2 text-xs font-bold uppercase tracking-wider text-white/60 border border-white/10 rounded-lg hover:bg-white/5 hover:text-white transition-colors disabled:opacity-50"
      >
        ${translateText("clan_modal.map_activity_load_more")}
      </button>
    </div>`;
  }

  private name(player: MapActivityPlayer): TemplateResult {
    if (!player.id) {
      return html`<span class="text-sm text-white/40 italic"
        >${translateText("clan_modal.map_activity_deleted_player")}</span
      >`;
    }
    // Above a row's stretched "view on map" button (see renderEvent), which
    // the rest of the row lets clicks through to.
    return playerNameLink(
      this,
      player.username,
      player.id,
      "relative pointer-events-auto",
    );
  }

  private clan(clan: MapActivityClan): TemplateResult {
    const color =
      clan.color === null
        ? "rgba(255,255,255,0.3)"
        : `#${clan.color.toString(16).padStart(6, "0")}`;
    return html`<span class="inline-flex items-center gap-1 font-bold"
      ><span
        aria-hidden="true"
        class="inline-block w-2.5 h-2.5 rounded-sm"
        style="background:${color}"
      ></span
      >${clan.tag ?? translateText("clan_modal.map_activity_deleted_clan")}</span
    >`;
  }

  private value(text: string, tone: "gain" | "loss" | "muted"): TemplateResult {
    const color =
      tone === "gain"
        ? "text-green-400"
        : tone === "loss"
          ? "text-red-400"
          : "text-white/60";
    return html`<span class="shrink-0 text-sm font-bold tabular-nums ${color}"
      >${text}</span
    >`;
  }

  private renderEvent(e: MapActivityEvent): TemplateResult {
    const t = translateText;
    let headline: TemplateResult;
    let details: string[] = [];
    let right: TemplateResult | typeof nothing = nothing;
    let at: MapActivityAt | null = null;
    switch (e.kind) {
      case "claimed": {
        headline = this.withSlots(
          "clan_modal.map_activity_claimed",
          { count: e.pixels },
          { name: this.name(e.player) },
        );
        if (e.neutral) {
          details.push(
            t("clan_modal.map_activity_neutral", { count: e.neutral }),
          );
        }
        for (const from of e.takenFrom) {
          details.push(
            t("clan_modal.map_activity_taken_from", {
              count: from.pixels,
              tag: from.clan.tag ?? t("clan_modal.map_activity_deleted_clan"),
            }),
          );
        }
        right = this.value(
          t("clan_modal.map_activity_px_gain", { count: e.pixels }),
          "gain",
        );
        at = { x: e.x, y: e.y };
        break;
      }
      case "unclaimed":
        headline = this.withSlots(
          "clan_modal.map_activity_unclaimed",
          { count: e.pixels },
          { name: this.name(e.player) },
        );
        details.push(
          t("clan_modal.map_activity_refunded", { troops: e.refundTroops }),
        );
        right = this.value(
          t("clan_modal.map_activity_px_loss", { count: e.pixels }),
          "muted",
        );
        at = { x: e.x, y: e.y };
        break;
      case "bought_troops":
        headline = this.withSlots(
          "clan_modal.map_activity_bought",
          { troops: e.troops },
          { name: this.name(e.player) },
        );
        right = html`<currency-display
          class="shrink-0"
          .soft=${e.caps}
        ></currency-display>`;
        break;
      case "ship_sailing": {
        headline = this.withSlots(
          "clan_modal.map_activity_ship_sent",
          { x: e.toX, y: e.toY },
          { name: this.name(e.player) },
        );
        const lands = new Date(e.arrivesAt);
        details = [
          sameDay(lands, new Date())
            ? t("clan_modal.map_activity_ship_lands", {
                time: formatTime(lands),
              })
            : t("clan_modal.map_activity_ship_lands_date", {
                date: formatDate(lands),
                time: formatTime(lands),
              }),
          t("clan_modal.map_activity_troops_aboard", { troops: e.troops }),
        ];
        right = html`<span class="shrink-0 text-xs font-bold text-white/60"
          >${t("clan_modal.map_activity_view")}</span
        >`;
        at = { x: e.toX, y: e.toY };
        break;
      }
      case "ship_landed":
        headline = this.withSlots(
          "clan_modal.map_activity_ship_landed",
          { x: e.toX, y: e.toY },
          { name: this.name(e.player) },
        );
        details = [
          t(`clan_modal.map_activity_outcome_${e.outcome}`),
          t("clan_modal.map_activity_troops_aboard", { troops: e.troops }),
        ];
        right =
          e.outcome === "captured"
            ? this.value(
                t("clan_modal.map_activity_px_gain", { count: 1 }),
                "gain",
              )
            : nothing;
        at = { x: e.toX, y: e.toY };
        break;
      case "lost":
        headline = this.withSlots(
          "clan_modal.map_activity_lost",
          { count: e.pixels },
          { clan: this.clan(e.clan) },
        );
        if (e.player.id) {
          details.push(
            t("clan_modal.map_activity_by", {
              name: e.player.username ?? "",
            }),
          );
        }
        right = this.value(
          t("clan_modal.map_activity_px_loss", { count: e.pixels }),
          "loss",
        );
        at = { x: e.x, y: e.y };
        break;
      case "siege":
        headline = this.withSlots(
          "clan_modal.map_activity_siege",
          { count: e.pixels },
          { clan: this.clan(e.clan) },
        );
        right = this.value(
          t("clan_modal.map_activity_px_loss", { count: e.pixels }),
          "loss",
        );
        at = { x: e.x, y: e.y };
        break;
    }
    // The day divider above already says which day: just the time.
    const time = e.kind === "ship_sailing" ? null : formatTime(new Date(e.at));
    const sub = [time, ...details].filter(Boolean).join(" · ");
    const rowClass =
      "relative w-full flex items-center gap-3 py-2.5 px-3 rounded-xl border bg-white/5 border-white/10 text-left";
    const body = (interactive: boolean) =>
      html`<div
          class="flex-1 min-w-0 flex flex-col ${
            interactive ? "pointer-events-none" : ""
          }"
        >
          <div class="text-sm min-w-0 flex flex-wrap items-baseline gap-x-1">
            ${headline}
          </div>
          <span class="text-white/30 text-[10px]">${sub}</span>
        </div>
        <span class="contents ${interactive ? "pointer-events-none" : ""}"
          >${right}</span
        >`;
    if (!at) {
      return html`<div data-kind=${e.kind} class=${rowClass}>
        ${body(false)}
      </div>`;
    }
    const target = at;
    // The whole row opens the map: a real button stretched under the row's
    // content (which lets clicks through), so the player's name stays a
    // button of its own rather than one nested inside another.
    return html`<div
      data-kind=${e.kind}
      class="${rowClass} hover:bg-white/[0.08] transition-colors"
    >
      <button
        type="button"
        data-view-on-map
        aria-label=${t("clan_modal.map_activity_view_at", {
          x: target.x,
          y: target.y,
        })}
        @click=${() => this.viewOnMap(target)}
        class="absolute inset-0 rounded-xl cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-malibu-blue"
      ></button>
      ${body(true)}
    </div>`;
  }

  // ---- By member

  private sorted(): MapActivityMember[] {
    const key = (m: MapActivityMember): number => {
      switch (this.sort) {
        case "active":
          return m.lastActiveAt ? Date.parse(m.lastActiveAt) : -Infinity;
        case "claimed":
          return m.claimed;
        case "caps":
          return Number(m.caps);
        case "ships":
          return m.shipsSent;
      }
    };
    return [...this.members].sort((a, b) => key(b) - key(a));
  }

  private renderMembers(): TemplateResult {
    const blocking = this.renderBlocking();
    if (blocking) return blocking;
    const select = <K extends string>(
      name: string,
      value: K,
      options: K[],
      labelKey: (k: K) => string,
      onChange: (k: K) => void,
    ) =>
      html`<select
        data-select=${name}
        aria-label=${translateText(`clan_modal.map_activity_${name}_label`)}
        .value=${value}
        @change=${(ev: Event) =>
          onChange((ev.target as HTMLSelectElement).value as K)}
        class="text-xs px-2 py-1 rounded-md border border-white/10 bg-black/30 text-white"
      >
        ${options.map(
          (o) =>
            html`<option value=${o} ?selected=${o === value}>
              ${translateText(labelKey(o))}
            </option>`,
        )}
      </select>`;
    const rows = this.sorted();
    return html`<div
      class="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-sm font-bold text-white/60 uppercase tracking-wider">
          ${translateText(`clan_modal.map_activity_period_${this.period}`)}
        </h3>
        <div class="flex items-center gap-2">
          <span
            class="text-[10px] font-bold uppercase tracking-wider text-white/40"
            >${translateText("clan_modal.map_activity_sort_by")}</span
          >
          ${select(
            "sort",
            this.sort,
            SORTS,
            (k) => `clan_modal.map_activity_sort_${k}`,
            (k) => (this.sort = k),
          )}
          ${select(
            "period",
            this.period,
            PERIODS,
            (k) => `clan_modal.map_activity_period_${k}`,
            (k) => this.setPeriod(k),
          )}
        </div>
      </div>
      ${
        rows.length
          ? rows.map((m) => this.renderMember(m))
          : html`<p
              data-state="members-empty"
              class="text-white/40 text-sm text-center py-6"
            >
              ${translateText("clan_modal.map_activity_members_empty")}
            </p>`
      }
    </div>`;
  }

  // "Active today at 14:30", or just the date for an earlier day.
  private activeAt(d: Date): string {
    return sameDay(d, new Date())
      ? translateText("clan_modal.map_activity_active_today", {
          time: formatTime(d),
        })
      : translateText("clan_modal.map_activity_active_date", {
          date: formatDate(d),
        });
  }

  private renderMember(m: MapActivityMember): TemplateResult {
    const t = translateText;
    const caps = BigInt(m.caps);
    const parts: TemplateResult[] = [];
    if (m.claimed) {
      parts.push(
        html`<span
          >${t("clan_modal.map_activity_stat_claimed", {
            count: m.claimed,
          })}</span
        >`,
      );
    }
    if (caps > 0n) {
      parts.push(
        html`<span class="text-orange-400"
          >${t("clan_modal.map_activity_stat_caps", {
            caps: Number(caps),
          })}</span
        >`,
      );
    }
    if (m.shipsSent) {
      parts.push(
        html`<span
          >${t("clan_modal.map_activity_stat_ships", {
            landed: m.shipsLanded,
            sent: m.shipsSent,
          })}</span
        >`,
      );
    }
    const left = m.role === null;
    return html`<div
      data-member=${m.player.id ?? ""}
      class="py-2 px-3 rounded-xl border bg-white/5 border-white/10 ${
        left ? "opacity-60" : ""
      }"
    >
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 min-w-0">
          ${m.role ? renderRoleIcon(m.role) : nothing} ${this.name(m.player)}
          ${
            left
              ? html`<span
                  data-left
                  class="text-[10px] font-bold uppercase tracking-wider text-white/40"
                  >${t("clan_modal.map_activity_left")}</span
                >`
              : nothing
          }
        </div>
        <span class="shrink-0 text-[10px] text-white/30"
          >${m.lastActiveAt ? this.activeAt(new Date(m.lastActiveAt)) : "—"}</span
        >
      </div>
      <div class="text-xs text-white/60 mt-1 flex flex-wrap gap-x-1">
        ${
          parts.length
            ? parts.flatMap((p, i) => (i ? [html`<span>·</span>`, p] : [p]))
            : html`<span class="text-white/40"
                >${t(`clan_modal.map_activity_none_${this.period}`)}</span
              >`
        }
      </div>
    </div>`;
  }
}
