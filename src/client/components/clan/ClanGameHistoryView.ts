import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { GameMapType } from "../../../core/game/Game";
import {
  type ClanGame,
  type ClanGameFilter,
  fetchClanGames,
} from "../../ClanApi";
import { ClientEnv } from "../../ClientEnv";
import { terrainMapFileLoader } from "../../TerrainMapFileLoader";
import { getMapName, renderDuration, translateText } from "../../Utils";
import "../CopyButton";
import {
  formatAbsoluteTime,
  formatDayHeader,
  groupByDay,
} from "../baseComponents/stats/GameHistoryDates";
import { formatGameType, isFfa } from "../baseComponents/stats/GameTypeLabels";
import { renderLoadingSpinner, showToast } from "./ClanShared";

type FilterKey = ClanGameFilter | "all";

// "All" is filter-only; FFA and Team reuse the type-label keys (same
// English strings); HvN and Ranked have shorter filter labels than their
// type labels ("Humans vs Nations" / "Ranked 1v1") so keep those split.
const FILTER_TABS: { key: FilterKey; labelKey: string }[] = [
  { key: "all", labelKey: "clan_modal.history_filter_all" },
  { key: "ffa", labelKey: "clan_modal.history_type_ffa" },
  { key: "team", labelKey: "clan_modal.history_type_team" },
  { key: "hvn", labelKey: "clan_modal.history_filter_hvn" },
  { key: "ranked", labelKey: "clan_modal.history_filter_ranked" },
];

// Cache survives a tab switch within the modal: keep the full
// accumulated list plus the cursor state so re-entering the tab restores
// the scroll position the user had built up.
export type ClanGameHistoryCache = {
  tag: string;
  filter: FilterKey;
  games: ClanGame[];
  nextCursor: string | null;
};

@customElement("clan-game-history-view")
export class ClanGameHistoryView extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property() clanTag = "";
  @property({ type: Object }) cachedState: ClanGameHistoryCache | null = null;

  @state() private games: ClanGame[] = [];
  @state() private nextCursor: string | null = null;
  @state() private loading = false;
  // Distinct from `loading` because it controls the inline footer spinner
  // rather than replacing the whole list with a centred spinner.
  @state() private loadingMore = false;
  @state() private loadState: "ok" | "failed" | "forbidden" = "ok";
  @state() private appendFailed = false;
  @state() private filter: FilterKey = "all";
  private asyncGeneration = 0;
  private sentinel: HTMLElement | null = null;
  private observer: IntersectionObserver | null = null;
  // Memoise grouping against the current `games` reference so re-renders
  // triggered by unrelated state (e.g. `loadingMore` flipping) don't
  // re-walk the accumulated list each time.
  private groupedFor: ClanGame[] | null = null;
  private grouped: ReturnType<typeof groupByDay<ClanGame>> = [];

  connectedCallback() {
    super.connectedCallback();
    if (this.cachedState && this.cachedState.tag === this.clanTag) {
      this.games = this.cachedState.games;
      this.nextCursor = this.cachedState.nextCursor;
      this.filter = this.cachedState.filter;
    } else if (this.clanTag) {
      this.reload();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.teardownObserver();
  }

  updated() {
    // The IntersectionObserver target only exists when there's more to
    // load AND we're not in the middle of a request — wire it up after
    // each render so it tracks the current sentinel node.
    this.ensureObserver();
  }

  // Hard reset on filter change — drop cached games and start fresh from
  // the newest game.
  private async reload() {
    this.games = [];
    this.nextCursor = null;
    this.appendFailed = false;
    await this.load({ append: false });
  }

  private setFilter(filter: FilterKey) {
    if (filter === this.filter) return;
    this.filter = filter;
    this.reload();
  }

  private async load({ append }: { append: boolean }) {
    if (!this.clanTag) return;
    const gen = ++this.asyncGeneration;
    if (append) {
      this.loadingMore = true;
      this.appendFailed = false;
    } else {
      this.loading = true;
      this.loadState = "ok";
      this.loadingMore = false;
    }
    const filterParam = this.filter === "all" ? undefined : this.filter;
    // Append uses the saved cursor; a fresh load starts from the newest
    // game (no cursor).
    const cursor = append ? (this.nextCursor ?? undefined) : undefined;
    const res = await fetchClanGames(this.clanTag, {
      filter: filterParam,
      cursor,
    });
    if (gen !== this.asyncGeneration) return;
    if (append) this.loadingMore = false;
    else this.loading = false;
    if ("error" in res) {
      if (append) {
        // Keep the games we already have; just surface a retry footer.
        this.appendFailed = true;
      } else {
        this.loadState = res.error;
        this.games = [];
        this.nextCursor = null;
      }
      return;
    }
    this.games = append ? [...this.games, ...res.results] : res.results;
    this.nextCursor = res.nextCursor;
    this.dispatchEvent(
      new CustomEvent<ClanGameHistoryCache>("history-updated", {
        detail: {
          tag: this.clanTag,
          filter: this.filter,
          games: this.games,
          nextCursor: this.nextCursor,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private ensureObserver() {
    const sentinel = this.querySelector<HTMLElement>("[data-scroll-sentinel]");
    if (sentinel === this.sentinel) return;
    this.teardownObserver();
    this.sentinel = sentinel;
    if (!sentinel) return;
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (this.loading || this.loadingMore) continue;
        if (this.nextCursor === null) continue;
        if (this.appendFailed) continue;
        void this.load({ append: true });
      }
    });
    this.observer.observe(sentinel);
  }

  private teardownObserver() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.sentinel = null;
  }

  private async watchReplay(gameId: string) {
    try {
      const encoded = encodeURIComponent(gameId);
      const url = `/${ClientEnv.workerPath(gameId)}/game/${encoded}`;
      history.pushState({ join: gameId }, "", url);
      window.dispatchEvent(
        new CustomEvent("join-changed", { detail: { gameId: encoded } }),
      );
      this.dispatchEvent(
        new CustomEvent("close-clan-modal", { bubbles: true, composed: true }),
      );
    } catch {
      showToast(translateText("clan_modal.error_failed"), "red");
    }
  }

  render() {
    if (this.loadState === "forbidden") {
      return html`
        <div
          class="bg-white/5 rounded-xl border border-white/10 p-8 text-center"
        >
          <p class="text-white/40 text-sm">
            ${translateText("clan_modal.history_members_only")}
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
        class="flex flex-wrap gap-1 p-1 bg-white/5 border border-white/10 rounded-xl"
      >
        ${FILTER_TABS.map((tab) => {
          const active = this.filter === tab.key;
          // "All" gets a full row on mobile (basis-full) and normal sizing
          // on sm+. The others use basis-20 so "Ranked" stays comfortable
          // and flex-wrap drops them to a second row when needed.
          const basis =
            tab.key === "all" ? "basis-full sm:basis-20" : "basis-20";
          return html`
            <button
              type="button"
              role="tab"
              aria-selected=${active}
              @click=${() => this.setFilter(tab.key)}
              class="grow ${basis} px-3 py-1.5 text-xs font-bold uppercase tracking-wider whitespace-nowrap rounded-lg transition-colors ${active
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
    if (this.loading && this.games.length === 0) {
      return renderLoadingSpinner();
    }
    if (this.loadState === "failed") {
      return html`
        <div
          class="bg-white/5 rounded-xl border border-white/10 p-8 text-center"
        >
          <p class="text-white/40 text-sm mb-3">
            ${translateText("clan_modal.history_unavailable")}
          </p>
          <button
            type="button"
            @click=${() => this.reload()}
            class="text-xs font-bold text-white/60 hover:text-white uppercase tracking-wider px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 hover:bg-white/5 transition-colors"
          >
            ${translateText("leaderboard_modal.try_again")}
          </button>
        </div>
      `;
    }
    if (this.games.length === 0) {
      return html`
        <div
          class="bg-white/5 rounded-xl border border-white/10 p-8 text-center"
        >
          <p class="text-white/40 text-sm">
            ${translateText("clan_modal.history_empty")}
          </p>
        </div>
      `;
    }

    // Group consecutive games by their start day so the user gets a sense
    // of when each batch was played without us having to render N
    // standalone date pills. Cached against the `games` reference; `load()`
    // always assigns a fresh array, so identity comparison is safe.
    if (this.groupedFor !== this.games) {
      this.grouped = groupByDay(this.games);
      this.groupedFor = this.games;
    }
    const groups = this.grouped;
    return html`
      <div class="space-y-5">
        ${groups.map(
          (group) => html`
            <div class="space-y-3">
              <div
                class="sticky top-0 z-10 flex items-center gap-3 px-1 py-1.5"
              >
                <span class="h-px flex-1 bg-white/10"></span>
                <h3
                  class="text-xs font-bold uppercase tracking-widest text-white/70 whitespace-nowrap"
                >
                  ${formatDayHeader(group.day)}
                </h3>
                <span class="h-px flex-1 bg-white/10"></span>
              </div>
              <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
                ${group.items.map((game) => this.renderGameRow(game))}
              </div>
            </div>
          `,
        )}
        ${this.renderScrollFooter()}
      </div>
    `;
  }

  private renderScrollFooter(): TemplateResult {
    if (this.nextCursor === null) {
      return html`
        <div class="text-center text-[11px] text-white/30 py-3 select-none">
          ${translateText("clan_modal.history_end_of_history")}
        </div>
      `;
    }
    if (this.appendFailed) {
      return html`
        <div class="text-center py-3">
          <p class="text-white/40 text-xs mb-2">
            ${translateText("clan_modal.history_load_more_failed")}
          </p>
          <button
            type="button"
            @click=${() => this.load({ append: true })}
            class="text-xs font-bold text-white/60 hover:text-white uppercase tracking-wider px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 hover:bg-white/5 transition-colors"
          >
            ${translateText("leaderboard_modal.try_again")}
          </button>
        </div>
      `;
    }
    // Sentinel drives auto-load; the spinner is shown adjacent to it (not
    // *as* it) so the sentinel node identity stays stable across pages —
    // otherwise every fetch tears down and recreates the IntersectionObserver
    // (the spinner replacing the sentinel changed the queried node).
    return html`
      <div class="py-3">
        <div data-scroll-sentinel aria-hidden="true" class="h-px"></div>
        ${this.loadingMore ? renderLoadingSpinner() : ""}
      </div>
    `;
  }

  private renderGameRow(game: ClanGame): TemplateResult {
    // getMapData() throws for unknown map values — guard so an unmapped
    // server response doesn't tank the whole history view.
    let mapWebpPath: string | null = null;
    if (game.map) {
      try {
        mapWebpPath = terrainMapFileLoader.getMapData(
          game.map as GameMapType,
        ).webpPath;
      } catch {
        mapWebpPath = null;
      }
    }
    const mapDisplayName = game.map ? (getMapName(game.map) ?? game.map) : null;
    // Partition once per row so renderResultBadge + renderPlayerLists
    // don't each re-walk clanPlayers (matters in 50v50 lobbies).
    const winners: ClanGame["clanPlayers"] = [];
    const losers: ClanGame["clanPlayers"] = [];
    for (const p of game.clanPlayers) {
      (p.won ? winners : losers).push(p);
    }

    return html`
      <div class="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        ${mapWebpPath
          ? html`<div
              class="relative w-full aspect-[3/1] overflow-hidden bg-surface"
            >
              <img
                src=${mapWebpPath}
                alt=${mapDisplayName ?? ""}
                draggable="false"
                loading="lazy"
                decoding="async"
                class="w-full h-full object-cover"
              />
              <div
                class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"
              ></div>
              ${mapDisplayName
                ? html`<div
                    class="absolute bottom-2 left-3 text-xs font-bold text-white uppercase tracking-wider drop-shadow"
                  >
                    ${mapDisplayName}
                  </div>`
                : ""}
              <div class="absolute top-2 right-2">
                ${this.renderResultBadge(game, winners)}
              </div>
              <div
                class="absolute bottom-2 right-2 text-xs font-medium text-white bg-black/60 backdrop-blur-sm px-2 py-1 rounded-md whitespace-nowrap"
              >
                ${formatAbsoluteTime(game.start)}
              </div>
            </div>`
          : ""}
        <div
          class="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5"
        >
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="text-[10px] font-bold uppercase tracking-wider text-white/40"
              >${translateText("clan_modal.history_game_id")}:</span
            >
            <copy-button
              compact
              .copyText=${game.gameId}
              .displayText=${game.gameId}
              .showVisibilityToggle=${false}
            ></copy-button>
          </div>
          <button
            type="button"
            @click=${() => this.watchReplay(game.gameId)}
            class="shrink-0 px-3 py-1.5 text-xs font-bold text-white uppercase tracking-wider bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 rounded-lg transition-all"
          >
            ${translateText("clan_modal.history_watch_replay")}
          </button>
        </div>
        <div
          class="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 justify-items-center text-center"
        >
          ${this.renderField(
            translateText("clan_modal.history_game_type"),
            formatGameType(game),
          )}
          ${mapWebpPath
            ? ""
            : this.renderField(
                translateText("clan_modal.history_map"),
                mapDisplayName ?? "—",
              )}
          ${this.renderPlayersField(game)}
          ${this.renderField(
            translateText("clan_modal.history_duration"),
            renderDuration(game.durationSeconds),
          )}
        </div>
        ${this.renderPlayerLists(game, winners, losers)}
      </div>
    `;
  }

  private renderField(label: string, value: string): TemplateResult {
    return html`
      <div class="min-w-0">
        <div
          class="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-0.5"
        >
          ${label}
        </div>
        <div class="text-sm text-white truncate" title=${value}>${value}</div>
      </div>
    `;
  }

  // For FFA / Ranked 1v1 with multiple clan-mates in the same lobby,
  // calling the whole game a "Victory" because one of 20 won is
  // misleading — 19 lost. The server now stamps `won` per clan player
  // so we count exactly. Team/HvN games still surface Victory/Defeat
  // when the clan plays as a unit (everyone on the winning team won).
  private renderResultBadge(
    game: ClanGame,
    winners: ClanGame["clanPlayers"],
  ): TemplateResult {
    const result = game.result;
    if (!result) return html``;

    const clanCount = game.clanPlayers.length;
    const winCount = winners.length;
    const isIndividual =
      isFfa(game) ||
      (game.rankedType !== undefined && game.rankedType !== "unranked");
    const isPartial =
      isIndividual && clanCount > 1 && winCount > 0 && winCount < clanCount;

    let label: string;
    let tint: string;
    if (isPartial) {
      label = translateText("clan_modal.history_result_partial", {
        wins: winCount,
        total: clanCount,
      });
      tint = "text-white bg-amber-500 border-amber-400";
    } else if (result === "victory") {
      label = translateText("clan_modal.history_result_victory");
      tint = "text-white bg-green-600 border-green-500";
    } else {
      label = translateText("clan_modal.history_result_defeat");
      tint = "text-white bg-red-600 border-red-500";
    }
    return html`<span
      class="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border shadow-lg ${tint}"
      >${label}</span
    >`;
  }

  // Split the clan roster into winners and non-winners so the user can
  // tell at a glance which clan-mates actually won the match — a single
  // mixed list with crowns was hard to scan, especially in 50v50 lobbies.
  private renderPlayerLists(
    game: ClanGame,
    winners: ClanGame["clanPlayers"],
    losers: ClanGame["clanPlayers"],
  ): TemplateResult | string {
    if (game.clanPlayers.length === 0) return "";
    return html`
      ${winners.length > 0
        ? this.renderPlayerSection(
            translateText("clan_modal.history_clan_winners"),
            winners,
            "text-green-400",
          )
        : ""}
      ${losers.length > 0
        ? this.renderPlayerSection(
            translateText("clan_modal.history_clan_members"),
            losers,
            "text-white/40",
          )
        : ""}
    `;
  }

  private renderPlayerSection(
    label: string,
    players: ClanGame["clanPlayers"],
    labelClass: string,
  ): TemplateResult {
    return html`
      <div
        class="px-4 py-2 border-t border-white/5 text-xs text-white/60 flex flex-wrap items-center gap-x-1 gap-y-1"
      >
        <span
          class="text-[10px] font-bold uppercase tracking-wider mr-1 ${labelClass}"
          >${label}:</span
        >
        ${players.map(
          (p) => html`
            <copy-button
              compact
              .copyText=${p.publicId}
              .displayText=${p.username ?? p.publicId}
              .showVisibilityToggle=${false}
              .showCopyIcon=${false}
            ></copy-button>
          `,
        )}
      </div>
    `;
  }

  // Ranked games cap clan participation at a single player, so
  // "1 / N total" is noise — just show the total. FFA can carry
  // multiple clan members (renderResultBadge already handles partial
  // wins via clanCount > 1), so it keeps the clan-vs-total breakdown.
  // Team/HvN keep it too. Historical rows may carry a null
  // totalPlayers (games.num_players is nullable on the schema); render
  // "—" rather than "null".
  private renderPlayersField(game: ClanGame): TemplateResult {
    const isSingleClanSlot =
      game.rankedType !== undefined && game.rankedType !== "unranked";
    const total = game.totalPlayers ?? null;
    if (isSingleClanSlot) {
      return this.renderField(
        translateText("clan_modal.history_players"),
        total === null ? "—" : `${total}`,
      );
    }
    return this.renderField(
      translateText("clan_modal.history_clan_players"),
      total === null
        ? `${game.clanPlayers.length}`
        : translateText("clan_modal.history_clan_players_value", {
            clanCount: game.clanPlayers.length,
            total,
          }),
    );
  }
}
