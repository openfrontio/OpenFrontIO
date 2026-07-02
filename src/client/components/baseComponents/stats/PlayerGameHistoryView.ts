import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  type PlayerGameModeFilter,
  type PlayerGameTypeFilter,
  type PublicPlayerGame,
} from "../../../../core/ApiSchemas";
import { GameMapType } from "../../../../core/game/Game";
import { fetchPublicPlayerGames } from "../../../Api";
import { GameInfoModal } from "../../../GameInfoModal";
import { terrainMapFileLoader } from "../../../TerrainMapFileLoader";
import { getMapName, renderDuration, translateText } from "../../../Utils";
import { renderLoadingSpinner } from "../../BaseModal";
import "../../CopyButton";
import {
  formatAbsoluteTime,
  formatDayHeader,
  groupByDay,
} from "./GameHistoryDates";
import { formatGameType } from "./GameTypeLabels";

type TypeKey = PlayerGameTypeFilter | "all";
type ModeKey = PlayerGameModeFilter | "all";

// Top row — game-type split (orthogonal to the mode row below). "All" reuses
// the clan filter label; the rest are account-modal-specific.
const TYPE_TABS: { key: TypeKey; labelKey: string }[] = [
  { key: "all", labelKey: "clan_modal.history_filter_all" },
  { key: "public", labelKey: "account_modal.games_type_public" },
  { key: "private", labelKey: "account_modal.games_type_private" },
  { key: "singleplayer", labelKey: "account_modal.games_type_singleplayer" },
];

// Bottom row — mode buckets. Mirrors the clan history filter exactly (FFA and
// Team reuse the type-label keys; HvN/Ranked have shorter filter labels).
const MODE_TABS: { key: ModeKey; labelKey: string }[] = [
  { key: "all", labelKey: "clan_modal.history_filter_all" },
  { key: "ffa", labelKey: "clan_modal.history_type_ffa" },
  { key: "team", labelKey: "clan_modal.history_type_team" },
  { key: "hvn", labelKey: "clan_modal.history_filter_hvn" },
  { key: "ranked", labelKey: "clan_modal.history_filter_ranked" },
];

// Cache survives a tab switch within the modal: keep the full accumulated list
// plus the cursor + both active filters so re-entering the Games tab restores
// the scroll position the user had built up.
export type PlayerGameHistoryCache = {
  publicId: string;
  typeFilter: TypeKey;
  modeFilter: ModeKey;
  games: PublicPlayerGame[];
  nextCursor: string | null;
};

@customElement("player-game-history-view")
export class PlayerGameHistoryView extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property() publicId = "";
  @property({ type: Object }) cachedState: PlayerGameHistoryCache | null = null;

  @state() private games: PublicPlayerGame[] = [];
  @state() private nextCursor: string | null = null;
  @state() private loading = false;
  // Distinct from `loading` because it controls the inline footer spinner
  // rather than replacing the whole list with a centred spinner.
  @state() private loadingMore = false;
  @state() private loadState: "ok" | "failed" = "ok";
  @state() private appendFailed = false;
  @state() private typeFilter: TypeKey = "all";
  @state() private modeFilter: ModeKey = "all";
  private asyncGeneration = 0;
  private sentinel: HTMLElement | null = null;
  private observer: IntersectionObserver | null = null;
  // Memoise grouping against the current `games` reference so re-renders
  // triggered by unrelated state (e.g. `loadingMore` flipping) don't re-walk
  // the accumulated list each time.
  private groupedFor: PublicPlayerGame[] | null = null;
  private grouped: ReturnType<typeof groupByDay<PublicPlayerGame>> = [];

  connectedCallback() {
    super.connectedCallback();
    if (this.cachedState && this.cachedState.publicId === this.publicId) {
      this.games = this.cachedState.games;
      this.nextCursor = this.cachedState.nextCursor;
      this.typeFilter = this.cachedState.typeFilter;
      this.modeFilter = this.cachedState.modeFilter;
    } else if (this.publicId) {
      this.reload();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.teardownObserver();
  }

  updated() {
    // The IntersectionObserver target only exists when there's more to load AND
    // we're not mid-request — wire it up after each render so it tracks the
    // current sentinel node.
    this.ensureObserver();
  }

  // Hard reset on filter change — drop cached games and start fresh from the
  // newest game.
  private async reload() {
    this.games = [];
    this.nextCursor = null;
    this.appendFailed = false;
    await this.load({ append: false });
  }

  private setTypeFilter(filter: TypeKey) {
    if (filter === this.typeFilter) return;
    this.typeFilter = filter;
    this.reload();
  }

  private setModeFilter(filter: ModeKey) {
    if (filter === this.modeFilter) return;
    this.modeFilter = filter;
    this.reload();
  }

  private async load({ append }: { append: boolean }) {
    if (!this.publicId) return;
    const gen = ++this.asyncGeneration;
    if (append) {
      this.loadingMore = true;
      this.appendFailed = false;
    } else {
      this.loading = true;
      this.loadState = "ok";
      this.loadingMore = false;
    }
    // Append uses the saved cursor; a fresh load starts from the newest game
    // (no cursor).
    const cursor = append ? (this.nextCursor ?? undefined) : undefined;
    const res = await fetchPublicPlayerGames(this.publicId, {
      filter: this.modeFilter === "all" ? undefined : this.modeFilter,
      type: this.typeFilter === "all" ? undefined : this.typeFilter,
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
        this.loadState = "failed";
        this.games = [];
        this.nextCursor = null;
      }
      return;
    }
    this.games = append ? [...this.games, ...res.results] : res.results;
    this.nextCursor = res.nextCursor;
    this.dispatchEvent(
      new CustomEvent<PlayerGameHistoryCache>("history-updated", {
        detail: {
          publicId: this.publicId,
          typeFilter: this.typeFilter,
          modeFilter: this.modeFilter,
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

  private watchReplay(gameId: string) {
    // Navigation + modal close live in the host modal; just hand it the id.
    this.dispatchEvent(
      new CustomEvent<{ gameId: string }>("view-game", {
        detail: { gameId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // Opens the game-info ranking overlay on top of the account modal. The modal
  // is a global singleton in the document (queried the same way as Main.ts),
  // so we don't close the account modal — the overlay layers above it.
  private showRanking(gameId: string) {
    const gameInfoModal = document.querySelector(
      "game-info-modal",
    ) as GameInfoModal | null;
    if (!gameInfoModal) {
      console.warn("Game info modal element not found");
      return;
    }
    void gameInfoModal.loadGame(gameId);
    gameInfoModal.open();
  }

  render() {
    return html`<div class="space-y-3">
      ${this.renderFilters()}${this.renderBody()}
    </div>`;
  }

  private renderFilters(): TemplateResult {
    return html`
      <div class="space-y-2">
        ${this.renderFilterRow(TYPE_TABS, this.typeFilter, (k) =>
          this.setTypeFilter(k as TypeKey),
        )}
        ${this.renderFilterRow(MODE_TABS, this.modeFilter, (k) =>
          this.setModeFilter(k as ModeKey),
        )}
      </div>
    `;
  }

  private renderFilterRow(
    tabs: { key: string; labelKey: string }[],
    active: string,
    onSelect: (key: string) => void,
  ): TemplateResult {
    return html`
      <div
        role="tablist"
        class="flex flex-wrap gap-1 p-1 bg-white/5 border border-white/10 rounded-xl"
      >
        ${tabs.map((tab) => {
          const isActive = active === tab.key;
          // "All" gets a full row on mobile (basis-full) and normal sizing on
          // sm+. The others use basis-20 so longer labels stay comfortable and
          // flex-wrap drops them to a second line when needed.
          const basis =
            tab.key === "all" ? "basis-full sm:basis-20" : "basis-20";
          return html`
            <button
              type="button"
              role="tab"
              aria-selected=${isActive}
              @click=${() => onSelect(tab.key)}
              class="grow ${basis} px-3 py-1.5 text-xs font-bold uppercase tracking-wider whitespace-nowrap rounded-lg transition-colors ${isActive
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

    // Group consecutive games by their start day. Cached against the `games`
    // reference; `load()` always assigns a fresh array, so identity comparison
    // is safe.
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
    // Sentinel drives auto-load; the spinner sits adjacent to it (not *as* it)
    // so the sentinel node identity stays stable across pages — otherwise every
    // fetch tears down and recreates the IntersectionObserver.
    return html`
      <div class="py-3">
        <div data-scroll-sentinel aria-hidden="true" class="h-px"></div>
        ${this.loadingMore ? renderLoadingSpinner() : ""}
      </div>
    `;
  }

  private renderGameRow(game: PublicPlayerGame): TemplateResult {
    // getMapData() throws for unknown map values — guard so an unmapped server
    // response doesn't tank the whole history view.
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
                ${this.renderResultBadge(game)}
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
          <div class="flex items-center gap-2 shrink-0">
            <button
              type="button"
              @click=${() => this.showRanking(game.gameId)}
              class="px-3 py-1.5 text-xs font-bold text-white/80 uppercase tracking-wider bg-white/10 hover:bg-white/20 border border-white/10 rounded-lg transition-colors"
            >
              ${translateText("game_list.ranking")}
            </button>
            <button
              type="button"
              @click=${() => this.watchReplay(game.gameId)}
              class="px-3 py-1.5 text-xs font-bold text-white uppercase tracking-wider bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 rounded-lg transition-all"
            >
              ${translateText("clan_modal.history_watch_replay")}
            </button>
          </div>
        </div>
        <div
          class="px-4 py-3 grid grid-cols-2 gap-x-4 gap-y-2 justify-items-center text-center border-b border-white/5"
        >
          ${this.renderField(
            translateText("account_modal.games_clan_tag"),
            game.clanTag ?? "—",
          )}
          ${this.renderField(
            translateText("account_modal.games_username"),
            game.username,
          )}
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
          ${this.renderField(
            translateText("clan_modal.history_players"),
            game.totalPlayers === null ? "—" : `${game.totalPlayers}`,
          )}
          ${this.renderField(
            translateText("clan_modal.history_duration"),
            renderDuration(game.durationSeconds),
          )}
        </div>
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

  // The player's own outcome. "incomplete" (no recorded winner) gets a neutral
  // badge rather than collapsing into Defeat, so an unfinished game isn't
  // mislabelled as a loss in a personal history.
  private renderResultBadge(game: PublicPlayerGame): TemplateResult {
    let label: string;
    let tint: string;
    if (game.result === "victory") {
      label = translateText("clan_modal.history_result_victory");
      tint = "text-white bg-green-600 border-green-500";
    } else if (game.result === "defeat") {
      label = translateText("clan_modal.history_result_defeat");
      tint = "text-white bg-red-600 border-red-500";
    } else {
      label = translateText("account_modal.games_result_incomplete");
      tint = "text-white bg-gray-500 border-gray-400";
    }
    return html`<span
      class="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border shadow-lg ${tint}"
      >${label}</span
    >`;
  }
}
