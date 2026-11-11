import { RankedType } from "@openfront/engine-api/game/GameTypes";
import {
  PlayerLeaderboardEntry,
  RankedLeaderboardEntry,
  RankedLeaderboardResponse,
} from "@openfront/shared/ApiSchemas";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { html, LitElement, nothing, PropertyValues, TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import {
  fetchFfaRankLeaderboard,
  fetchFfaAllRanksLeaderboard,
  fetchFfaRankPosition,
  fetchPlayerLeaderboard,
  getUserMe,
} from "../../Api";
import { loadModal } from "../../LazyModals";
import { isRealAccount } from "../../ProgressionAccount";
import { translateText } from "../../Utils";
import "../ffaRating/FfaTierBadge";
import { formatSeasonDate, seasonTiming } from "../ffaRating/FfaSeason";
import {
  FFA_TIER_BASES,
  FFA_TIER_NAME_KEYS,
  FfaTierBase,
  formatRating,
  parseFfaTier,
} from "../ffaRating/FfaTier";
import "../ffaRating/OfstatsCredit";
import { isPrestigedOrLegend, levelBadgeSlot } from "../LevelBadgeSlot";
import "../PlayerName";

/**
 * A ladder row. `uncertainty` and `tier` are present only once the API serves
 * the FFA rating; rows without them render as the plain Elo ladder.
 */
type LadderRow = PlayerLeaderboardEntry & {
  uncertainty?: number;
  tier?: string;
  globalPosition?: number;
};

/** The signed-in player's FFA progress while they have no tier yet. */
interface FfaCalibration {
  publicId: string;
  username: string | null;
  calibrationGames: number;
  games: number;
  wins: number;
}

/** One ranked ladder's loaded rows. */
interface LadderState {
  entries: LadderRow[];
  userEntry: LadderRow | null;
  hasMore: boolean;
}

/** One FFA rank's loaded rows, and the next page to ask for. */
interface RankLadderState extends LadderState {
  nextPage: number;
}

const emptyRankLadder = (): RankLadderState => ({
  entries: [],
  userEntry: null,
  hasMore: true,
  nextPage: 1,
});

// The ranked types with a player ladder. Clan wars rates the clan, not its
// players, so it has none.
export type PlayerLadder = Exclude<RankedType, RankedType.ClanWars>;

const RANKED_TYPES: PlayerLadder[] = [
  RankedType.OneVOne,
  RankedType.TwoVTwo,
  RankedType.FreeForAll,
];

const emptyLadders = (): Record<PlayerLadder, LadderState> => ({
  [RankedType.OneVOne]: { entries: [], userEntry: null, hasMore: true },
  [RankedType.TwoVTwo]: { entries: [], userEntry: null, hasMore: true },
  [RankedType.FreeForAll]: { entries: [], userEntry: null, hasMore: true },
});

const toPlayerEntry = (entry: RankedLeaderboardEntry): LadderRow => ({
  rank: entry.rank,
  playerId: entry.public_id,
  accountUsername: entry.accountUsername,
  elo: entry.elo,
  games: entry.total,
  wins: entry.wins,
  losses: entry.losses,
  winRate: entry.total > 0 ? entry.wins / entry.total : 0,
  level: entry.level,
  prestige: entry.prestige,
  legend: entry.legend,
  uncertainty: entry.uncertainty,
  tier: entry.tier,
  globalPosition: entry.globalPosition,
});

@customElement("leaderboard-player-list")
export class LeaderboardPlayerList extends LitElement {
  /**
   * Which ladder to display. Each ranked type is ranked independently — the
   * same player can hold a different elo and rank on each — but one request
   * returns all of them, so the other ladders ride along and are kept for
   * their own tabs.
   */
  @property({ attribute: false }) rankedType: PlayerLadder = RankedType.OneVOne;

  @state() private ladders: Record<PlayerLadder, LadderState> = emptyLadders();
  @state() private showStickyUser = false;
  @state() private isLoading = false;
  @state() private error: string | null = null;
  @state() private isLoadingMore = false;
  @state() private loadMoreError: string | null = null;

  private hasLoadedPlayers = false;
  private readonly playerPageSize = 50;
  private currentPage = 1;
  private currentUserId: string | null = null;
  private currentUserIdLoaded = false;
  @state() private ffaCalibration: FfaCalibration | null = null;
  // The signed-in player's rating while the board's ± rule keeps them off it.
  @state() private ffaHidden: LadderRow | null = null;
  @state() private ffaSeason: NonNullable<
    RankedLeaderboardResponse["ffaSeason"]
  > | null = null;

  // The selected rank tab on the FFA board, and each rank's rows so far.
  @state() private ffaRank: FfaTierBase | null = null;
  @state() private ffaAllRanks = false;
  @state() private ffaAllRows: LadderRow[] = [];
  @state() private ffaAllPage = 1;
  @state() private ffaAllHasMore = true;
  @state() private ffaAllLoading = false;
  @state() private ffaAllFailed = false;
  @state() private ffaRankLadders: Partial<
    Record<FfaTierBase, RankLadderState>
  > = {};
  @state() private ffaRanksLoading: ReadonlySet<FfaTierBase> = new Set();
  // Kept per rank: a rank can fail in the background while another ladder is
  // open, and that ladder must not show its retry.
  @state() private ffaRanksFailed: ReadonlySet<FfaTierBase> = new Set();
  private ffaOwnRank: FfaTierBase | null = null;
  // The signed-in player's row with their exact position, for when they aren't
  // in the loaded rows of their own rank.
  @state() private ffaPositionRow: LadderRow | null = null;
  // The signed-in player's rated row, the base for ffaPositionRow.
  private ffaOwnRow: LadderRow | null = null;
  // Bumped by a full reload, so an answer from before it is dropped.
  private ffaRankGeneration = 0;

  @query(".scroll-container") private scrollContainer?: HTMLElement;

  // The FFA board is split by rank once the API serves ratings.
  private get ffaRankActive(): boolean {
    return (
      this.rankedType === RankedType.FreeForAll &&
      this.ffaRatingServed &&
      !this.ffaAllRanks &&
      this.ffaRank !== null
    );
  }

  private get activeLadder(): LadderState {
    if (this.ffaAllRanks)
      return {
        entries: this.ffaAllRows,
        userEntry: null,
        hasMore: this.ffaAllHasMore,
      };
    if (this.ffaRankActive) {
      return this.ffaRankLadders[this.ffaRank!] ?? emptyRankLadder();
    }
    return this.ladders[this.rankedType];
  }

  private get playerData(): LadderRow[] {
    return this.activeLadder.entries;
  }

  private get currentUserEntry(): LadderRow | null {
    if (this.activeLadder.userEntry !== null) {
      return this.activeLadder.userEntry;
    }
    return this.ffaRankActive && this.ffaRank === this.ffaOwnRank
      ? this.ffaPositionRow
      : null;
  }

  // The FFA tab shows ratings (badge, rating ± uncertainty, OFstats credit)
  // only once the API sends them. Until then it is the plain Elo ladder.
  // The modal relabels its tab on "ffa-rating-live" (see updated()).
  private get ffaRatingLive(): boolean {
    return this.rankedType === RankedType.FreeForAll && this.ffaRatingServed;
  }

  // A hidden player counts: right after a season reset the ± rule can empty
  // the whole board, and only a live API sends hiddenByUncertainty.
  private get ffaRatingServed(): boolean {
    return (
      this.ffaHidden !== null ||
      this.ladders[RankedType.FreeForAll].entries.some(
        (row) => row.tier !== undefined,
      )
    );
  }

  private get hasLoadMoreError(): boolean {
    return this.ffaRankActive
      ? this.ffaRanksFailed.has(this.ffaRank!)
      : this.loadMoreError !== null;
  }

  private get playerHasMore(): boolean {
    return this.activeLadder.hasMore;
  }

  private mapLadders(
    fn: (ladder: LadderState) => LadderState,
  ): Record<PlayerLadder, LadderState> {
    const next = { ...this.ladders };
    for (const rankedType of RANKED_TYPES) {
      next[rankedType] = fn(this.ladders[rankedType]);
    }
    return next;
  }

  createRenderRoot() {
    return this;
  }

  private ffaRatingAnnounced = false;

  protected updated(changed: PropertyValues) {
    // Tells the modal once, whichever tab is up: a page carries every ladder.
    if (
      (changed.has("ladders") || changed.has("ffaHidden")) &&
      !this.ffaRatingAnnounced &&
      this.ffaRatingServed
    ) {
      this.ffaRatingAnnounced = true;
      this.dispatchEvent(new CustomEvent("ffa-rating-live", { bubbles: true }));
    }
    if (changed.has("rankedType")) {
      // The ladders are separate lists sharing one scroll container: show the
      // newly selected one from its top rather than the other one's offset.
      if (this.scrollContainer) this.scrollContainer.scrollTop = 0;
      this.scheduleStickyVisibilityCheck();
      this.schedulePlayerFillCheck();
    }
  }

  public async ensureLoaded() {
    if (this.hasLoadedPlayers || this.isLoading) return;
    await this.loadPlayerLeaderboard(true);
  }

  public async loadPlayerLeaderboard(reset = false) {
    if (!reset && this.ffaAllRanks) {
      await this.loadFfaAllPage();
      return;
    }
    if (!reset && this.ffaRankActive) {
      await this.loadFfaRankPage(this.ffaRank!);
      return;
    }

    if (reset) {
      this.currentPage = 1;
      this.loadMoreError = null;
      this.ladders = emptyLadders();
      this.showStickyUser = false;
      this.ffaRank = null;
      this.ffaAllRanks = false;
      this.ffaAllRows = [];
      this.ffaAllPage = 1;
      this.ffaAllHasMore = true;
      this.ffaAllLoading = false;
      this.ffaAllFailed = false;
      this.ffaRankLadders = {};
      this.ffaRanksLoading = new Set();
      this.ffaRanksFailed = new Set();
      this.ffaPositionRow = null;
      this.ffaRankGeneration++;
    } else if (!this.playerHasMore) {
      return;
    }

    if (this.isLoading || this.isLoadingMore) return;

    if (reset) {
      this.isLoading = true;
      this.error = null;
    } else {
      this.isLoadingMore = true;
      this.loadMoreError = null;
    }

    try {
      const result = await fetchPlayerLeaderboard(this.currentPage);

      if (result === false) {
        throw new Error("Failed to load player leaderboard");
      }

      // Past the last page. Not an error: stop paging, leave the footer clear.
      if (result === "reached_limit") {
        this.ladders = this.mapLadders((ladder) => ({
          ...ladder,
          hasMore: false,
        }));
        this.hasLoadedPlayers = true;
        return;
      }

      // A fresh load replaces it: between seasons the API sends none.
      this.ffaSeason = result.ffaSeason ?? (reset ? null : this.ffaSeason);

      const userJustLoaded = !this.currentUserIdLoaded;
      if (!this.currentUserIdLoaded) {
        this.currentUserIdLoaded = true;
        const userMe = await getUserMe();
        this.currentUserId = userMe ? userMe.player.publicId : null;
        // A calibrating player has no tier, so the board does not list them.
        // Guests are never rated, though the API answers {calibrationGames: 0}
        // for them too, so only a real account gets the row.
        const ffa = userMe ? userMe.player.leaderboard?.ffa : undefined;
        this.ffaOwnRank = ffa?.tier
          ? (parseFfaTier(ffa.tier)?.base ?? null)
          : null;
        this.ffaCalibration =
          userMe &&
          ffa?.calibrationGames !== undefined &&
          ffa.tier === undefined &&
          (await isRealAccount(userMe))
            ? {
                publicId: userMe.player.publicId,
                username: userMe.player.username ?? null,
                calibrationGames: ffa.calibrationGames,
                games: ffa.games ?? 0,
                wins: ffa.wins ?? 0,
              }
            : null;
        this.ffaOwnRow = null;
        if (
          userMe &&
          ffa?.tier !== undefined &&
          ffa.elo !== undefined &&
          ffa.hiddenByUncertainty !== true
        ) {
          const games = ffa.games ?? 0;
          const wins = ffa.wins ?? 0;
          this.ffaOwnRow = {
            rank: 0,
            playerId: userMe.player.publicId,
            accountUsername: userMe.player.username ?? null,
            elo: ffa.elo,
            games,
            wins,
            losses: games - wins,
            winRate: games ? wins / games : 0,
            uncertainty: ffa.uncertainty,
            tier: ffa.tier,
            globalPosition: ffa.globalPosition ?? undefined,
          };
        }
        this.ffaHidden =
          userMe &&
          ffa?.hiddenByUncertainty === true &&
          ffa.elo !== undefined &&
          ffa.tier !== undefined &&
          (await isRealAccount(userMe))
            ? {
                rank: 0,
                playerId: userMe.player.publicId,
                accountUsername: userMe.player.username ?? null,
                elo: ffa.elo,
                games: ffa.games ?? 0,
                wins: ffa.wins ?? 0,
                losses: (ffa.games ?? 0) - (ffa.wins ?? 0),
                winRate: ffa.games ? (ffa.wins ?? 0) / ffa.games : 0,
                uncertainty: ffa.uncertainty,
                tier: ffa.tier,
              }
            : null;
      }

      if ((reset || userJustLoaded) && this.ffaOwnRow !== null) {
        void this.loadFfaPosition(this.ffaOwnRow);
      }

      // One page carries a slice of every ladder, so fold them all in — even
      // the ones whose tab isn't showing.
      let receivedAny = false;
      const nextLadders = { ...this.ladders };
      for (const rankedType of RANKED_TYPES) {
        const ladder = this.ladders[rankedType];
        const nextPlayers = (result[rankedType] ?? []).map(toPlayerEntry);
        if (nextPlayers.length > 0) receivedAny = true;

        const existingIds = new Set(
          ladder.entries.map((player) => player.playerId),
        );
        nextLadders[rankedType] = {
          entries: [
            ...ladder.entries,
            ...nextPlayers.filter(
              (player) => !existingIds.has(player.playerId),
            ),
          ],
          // Ranks differ per ladder, so the pinned "your ranking" row is
          // whichever row this ladder gave the signed-in player.
          userEntry:
            ladder.userEntry ??
            nextPlayers.find(
              (player) => player.playerId === this.currentUserId,
            ) ??
            null,
          // A short page ends that ladder. The ladders run out at different
          // pages — the 2v2 board is younger and has no backfill — so this is
          // tracked per ladder rather than off the 1v1 page size.
          hasMore: ladder.hasMore && nextPlayers.length >= this.playerPageSize,
        };
      }
      this.ladders = nextLadders;

      if (receivedAny) {
        this.currentPage++;
      }

      if (this.ffaRank === null && this.ffaRatingServed) {
        // The overall board's first row is in the highest rank with players.
        const topTier = nextLadders[RankedType.FreeForAll].entries[0]?.tier;
        const topRank = topTier ? parseFfaTier(topTier)?.base : undefined;
        this.selectFfaRank(this.ffaOwnRank ?? topRank ?? "grandmaster");
      }

      this.hasLoadedPlayers = true;
      this.scheduleStickyVisibilityCheck();
      this.schedulePlayerFillCheck();
    } catch (err) {
      console.warn("loadPlayerLeaderboard: request failed", err);
      if (reset) {
        this.error = translateText("leaderboard_modal.error");
      } else {
        this.loadMoreError = translateText("leaderboard_modal.error");
      }
    } finally {
      if (reset) {
        this.isLoading = false;
      } else {
        this.isLoadingMore = false;
      }
    }
  }

  private async loadFfaPosition(row: LadderRow) {
    const generation = this.ffaRankGeneration;
    const position = await fetchFfaRankPosition();
    if (position === null || generation !== this.ffaRankGeneration) return;
    this.ffaPositionRow = { ...row, rank: position };
    this.scheduleStickyVisibilityCheck();
  }

  private selectAllFfaRanks() {
    if (this.ffaAllRanks) return;
    this.ffaAllRanks = true;
    this.ffaRank = null;
    this.loadMoreError = null;
    this.ffaAllFailed = false;
    this.showStickyUser = false;
    if (this.scrollContainer) this.scrollContainer.scrollTop = 0;
    if (this.ffaAllRows.length === 0) void this.loadFfaAllPage();
  }

  private async loadFfaAllPage() {
    if (!this.ffaAllHasMore || this.ffaAllLoading || this.ffaAllPage > 5)
      return;
    this.ffaAllLoading = true;
    this.ffaAllFailed = false;
    const page = this.ffaAllPage;
    const result = await fetchFfaAllRanksLeaderboard(page);
    this.ffaAllLoading = false;
    if (result === false) {
      this.ffaAllFailed = true;
      return;
    }
    if (result === "reached_limit") {
      this.ffaAllHasMore = false;
      return;
    }
    const seen = new Set(this.ffaAllRows.map((row) => row.playerId));
    const next = result.players
      .map(toPlayerEntry)
      .filter((row) => !seen.has(row.playerId));
    this.ffaAllRows = [...this.ffaAllRows, ...next];
    this.ffaAllPage = page + 1;
    this.ffaAllHasMore =
      page < 5 && result.players.length >= this.playerPageSize;
    this.schedulePlayerFillCheck();
  }

  private selectFfaRank(rank: FfaTierBase) {
    if (rank === this.ffaRank && !this.ffaAllRanks) return;
    this.ffaAllRanks = false;
    this.ffaAllFailed = false;
    this.ffaRank = rank;
    this.showStickyUser = false;
    if (this.scrollContainer) this.scrollContainer.scrollTop = 0;
    if (this.ffaRankLadders[rank] === undefined) {
      void this.loadFfaRankPage(rank);
    }
    this.scheduleStickyVisibilityCheck();
    this.schedulePlayerFillCheck();
  }

  private setFfaRankFailed(rank: FfaTierBase, failed: boolean) {
    const next = new Set(this.ffaRanksFailed);
    if (failed) next.add(rank);
    else next.delete(rank);
    this.ffaRanksFailed = next;
  }

  private handleRankTabKey(event: KeyboardEvent, rank: FfaTierBase) {
    const count = FFA_TIER_BASES.length;
    const index = FFA_TIER_BASES.indexOf(rank);
    const nextIndex = {
      ArrowRight: (index + 1) % count,
      ArrowLeft: (index - 1 + count) % count,
      Home: 0,
      End: count - 1,
    }[event.key];
    if (nextIndex === undefined) return;
    event.preventDefault();
    const next = FFA_TIER_BASES[nextIndex];
    this.selectFfaRank(next);
    void this.updateComplete.then(() =>
      this.querySelector<HTMLElement>(
        `[role="tab"][data-rank="${next}"]`,
      )?.focus(),
    );
  }

  private async loadFfaRankPage(rank: FfaTierBase) {
    const ladder = this.ffaRankLadders[rank] ?? emptyRankLadder();
    if (!ladder.hasMore || this.ffaRanksLoading.has(rank)) return;

    const generation = this.ffaRankGeneration;
    this.ffaRanksLoading = new Set([...this.ffaRanksLoading, rank]);
    this.setFfaRankFailed(rank, false);

    const result = await fetchFfaRankLeaderboard(rank, ladder.nextPage);

    if (generation !== this.ffaRankGeneration) return;
    const loading = new Set(this.ffaRanksLoading);
    loading.delete(rank);
    this.ffaRanksLoading = loading;

    if (result === false) {
      this.setFfaRankFailed(rank, true);
      return;
    }

    if (result === "reached_limit") {
      this.ffaRankLadders = {
        ...this.ffaRankLadders,
        [rank]: { ...ladder, hasMore: false },
      };
      return;
    }

    const rows = result.players.map((entry) => {
      const row = toPlayerEntry(entry);
      return row.playerId === this.currentUserId &&
        row.globalPosition === undefined &&
        this.ffaOwnRow?.globalPosition !== undefined
        ? { ...row, globalPosition: this.ffaOwnRow.globalPosition }
        : row;
    });
    const existingIds = new Set(ladder.entries.map((row) => row.playerId));
    this.ffaRankLadders = {
      ...this.ffaRankLadders,
      [rank]: {
        entries: [
          ...ladder.entries,
          ...rows.filter((row) => !existingIds.has(row.playerId)),
        ],
        userEntry:
          ladder.userEntry ??
          rows.find((row) => row.playerId === this.currentUserId) ??
          null,
        hasMore: rows.length >= this.playerPageSize,
        nextPage: ladder.nextPage + 1,
      },
    };
    this.scheduleStickyVisibilityCheck();
    this.schedulePlayerFillCheck();
  }

  public handleTabActivated() {
    this.scheduleStickyVisibilityCheck();
    this.schedulePlayerFillCheck();
  }

  // Same handoff as the clan views: the profile modal's back button reopens
  // the leaderboard (its loaded pages survive the close).
  private openProfile(publicId: string) {
    loadModal("player-profile-modal").then(
      () =>
        document
          .querySelector<
            HTMLElement & { openFromLeaderboard(publicId: string): void }
          >("player-profile-modal")
          ?.openFromLeaderboard(publicId),
      (err) => console.error("player-profile-modal failed to load:", err),
    );
  }

  // TODO: consider IntersectionObserver for better visibility detection?
  private isVisible() {
    return this.isConnected && this.getClientRects().length > 0;
  }

  private updateStickyVisibility() {
    if (!this.currentUserEntry) {
      this.showStickyUser = false;
      return;
    }

    if (!this.scrollContainer || !this.isVisible()) {
      this.showStickyUser = false;
      return;
    }

    const currentRow = this.scrollContainer.querySelector(
      '[data-current-user="true"]',
    ) as HTMLElement | null;

    if (!currentRow) {
      this.showStickyUser = true;
      return;
    }

    const containerRect = this.scrollContainer.getBoundingClientRect();
    const rowRect = currentRow.getBoundingClientRect();
    const isVisible =
      rowRect.top >= containerRect.top &&
      rowRect.bottom <= containerRect.bottom;
    this.showStickyUser = !isVisible;
  }

  private scheduleStickyVisibilityCheck() {
    void this.updateComplete.then(() => {
      requestAnimationFrame(() => this.updateStickyVisibility());
    });
  }

  private handleScroll() {
    this.updateStickyVisibility();
    this.maybeLoadMorePlayers();
  }

  private maybeLoadMorePlayers() {
    if (this.ffaAllRanks) {
      if (this.ffaAllLoading || !this.ffaAllHasMore || this.ffaAllFailed)
        return;
    } else {
      if (this.isLoading || this.isLoadingMore) return;
      if (!this.playerHasMore || this.error || this.hasLoadMoreError) return;
    }
    if (!this.scrollContainer || !this.isVisible()) return;

    const threshold = 64 * 3;
    const scrollTop = this.scrollContainer.scrollTop;
    const containerHeight = this.scrollContainer.clientHeight;
    const scrollHeight = this.scrollContainer.scrollHeight;
    const nearBottom = scrollTop + containerHeight >= scrollHeight - threshold;

    if (containerHeight === 0 || scrollHeight === 0) return; // guard

    if (nearBottom) {
      if (this.ffaAllRanks) void this.loadFfaAllPage();
      else void this.loadPlayerLeaderboard();
    }
  }

  private schedulePlayerFillCheck() {
    if (!this.playerHasMore || this.error || this.hasLoadMoreError) return;
    void this.updateComplete.then(() => this.maybeLoadMorePlayers());
  }

  // The pinned "your ranking" row lives in the table's own <tfoot> rather than
  // in an overlay. `table-fixed w-full` stretches the colgroup widths to fill
  // the container, so the resolved widths depend on the modal size and cannot
  // be reproduced by a separate element; and below 34rem the table scrolls
  // horizontally, which an overlay outside .scroll-container would not follow.
  private renderStickyUserRow(badgeSlot: boolean) {
    if (
      this.rankedType === RankedType.FreeForAll &&
      this.currentUserEntry === null &&
      this.ffaCalibration !== null
    ) {
      return this.renderCalibratingRow(this.ffaCalibration);
    }
    if (
      this.rankedType === RankedType.FreeForAll &&
      this.currentUserEntry === null &&
      this.ffaHidden !== null
    ) {
      return this.renderHiddenRow(this.ffaHidden);
    }
    if (!this.currentUserEntry || !this.showStickyUser) return nothing;
    const entry = this.currentUserEntry;
    const globalPosition = !this.ffaAllRanks ? entry.globalPosition : undefined;

    return html`
      <tfoot class="sticky bottom-0 z-20">
        <tr class="bg-blue-600 border-t border-blue-400/30 shadow-2xl">
          <td class="py-3 ${entry.rank >= 1000 ? "px-1" : "px-4"} text-center">
            <div
              class="min-w-10 h-10 mx-auto flex items-center justify-center rounded-lg font-bold font-mono ${
                entry.rank >= 1000 ? "text-xs" : "text-lg"
              } bg-white/20 text-white"
            >
              ${entry.rank}
            </div>
          </td>
          <td class="py-3 px-4">
            <div class="flex flex-col">
              <span
                class="text-[10px] uppercase font-bold text-blue-200/80 leading-tight"
                >${translateText("leaderboard_modal.your_ranking")}</span
              >
              <div class="flex items-center gap-2 min-w-0 mt-1">
                ${levelBadgeSlot(entry, isPrestigedOrLegend(entry), badgeSlot)}
                <player-name
                  class="min-w-0 flex-1"
                  .username=${entry.accountUsername}
                  .publicId=${entry.playerId}
                  .nameClass=${"font-bold text-white truncate text-base hover:underline"}
                  .onNameClick=${() => this.openProfile(entry.playerId)}
                ></player-name>
                ${
                  globalPosition === undefined
                    ? nothing
                    : html`<span
                        data-global-ffa-position
                        class="shrink-0 inline-flex items-center gap-1 text-sm font-semibold tabular-nums text-white"
                        title="Global Position"
                        ><span class="text-base leading-none" aria-hidden="true"
                          >🌍</span
                        >
                        #${globalPosition}</span
                      >`
                }
              </div>
            </div>
          </td>
          <td class="py-3 px-4 text-right">
            ${this.renderRatingCell(entry, true)}
          </td>
          <td class="py-3 px-4 text-right">
            <span class="font-mono text-white font-bold">${entry.games}</span>
          </td>
          <td class="py-3 px-4 text-right pr-6">
            <div class="inline-flex flex-col items-end">
              <span class="font-mono font-bold text-white"
                >${(entry.winRate * 100).toFixed(1)}%</span
              >
              <span
                class="text-[10px] uppercase text-blue-200/80 font-bold tracking-wider"
                >&#x200b;${translateText("leaderboard_modal.ratio")}</span
              >
            </div>
          </td>
        </tr>
      </tfoot>
    `;
  }

  // A player still calibrating has no tier and so no row on the board; this
  // pinned row stands in for it. It is always shown: there is no listed row to
  // scroll to.
  private renderCalibratingRow(me: FfaCalibration) {
    const ratio =
      me.games > 0 ? `${((me.wins / me.games) * 100).toFixed(1)}%` : "—";

    return html`
      <tfoot class="sticky bottom-0 z-20">
        <tr
          data-ffa-calibrating-row
          class="bg-blue-600 border-t border-blue-400/30 shadow-2xl"
        >
          <td class="py-3 px-4 text-center">
            <div
              class="w-10 h-10 mx-auto flex items-center justify-center rounded-lg font-bold font-mono text-lg bg-white/20 text-white"
            >
              —
            </div>
          </td>
          <td class="py-3 px-4">
            <div class="flex flex-col">
              <span
                class="text-[10px] uppercase font-bold text-blue-200/80 leading-tight"
                >${translateText("leaderboard_modal.your_ranking")}</span
              >
              <player-name
                class="min-w-0"
                .username=${me.username}
                .publicId=${me.publicId}
                .nameClass=${"font-bold text-white truncate text-base hover:underline"}
                .onNameClick=${() => this.openProfile(me.publicId)}
              ></player-name>
            </div>
          </td>
          <td class="py-3 px-4 text-right">
            <ffa-tier-badge
              .calibrationGames=${me.calibrationGames}
            ></ffa-tier-badge>
          </td>
          <td class="py-3 px-4 text-right">
            <span class="font-mono text-white font-bold">${me.games}</span>
          </td>
          <td class="py-3 px-4 text-right pr-6">
            <div class="inline-flex flex-col items-end">
              <span class="font-mono font-bold text-white">${ratio}</span>
              <span
                class="text-[10px] uppercase text-blue-200/80 font-bold tracking-wider"
                >${translateText("leaderboard_modal.ratio")}</span
              >
            </div>
          </td>
        </tr>
      </tfoot>
    `;
  }

  // A player the board's ± rule hides has no row on it either. This one shows
  // their rating and says why, and goes once games narrow the ± (the API stops
  // sending hiddenByUncertainty).
  private renderHiddenRow(me: LadderRow) {
    return html`
      <tfoot class="sticky bottom-0 z-20">
        <tr data-ffa-hidden-row class="bg-blue-600 border-t border-blue-400/30">
          <td class="py-3 px-4 text-center">
            <div
              class="w-10 h-10 mx-auto flex items-center justify-center rounded-lg font-bold font-mono text-lg bg-white/20 text-white"
            >
              —
            </div>
          </td>
          <td class="py-3 px-4">
            <div class="flex flex-col">
              <span
                class="text-[10px] uppercase font-bold text-blue-200/80 leading-tight"
                >${translateText("leaderboard_modal.your_ranking")}</span
              >
              <player-name
                class="min-w-0"
                .username=${me.accountUsername}
                .publicId=${me.playerId}
                .nameClass=${"font-bold text-white truncate text-base hover:underline"}
                .onNameClick=${() => this.openProfile(me.playerId)}
              ></player-name>
            </div>
          </td>
          <td class="py-3 px-4 text-right">
            ${this.renderRatingCell(me, true)}
          </td>
          <td class="py-3 px-4 text-right">
            <span class="font-mono text-white font-bold">${me.games}</span>
          </td>
          <td class="py-3 px-4 text-right pr-6">
            <div class="inline-flex flex-col items-end">
              <span class="font-mono font-bold text-white"
                >${(me.winRate * 100).toFixed(1)}%</span
              >
              <span
                class="text-[10px] uppercase text-blue-200/80 font-bold tracking-wider"
                >${translateText("leaderboard_modal.ratio")}</span
              >
            </div>
          </td>
        </tr>
        <tr data-ffa-hidden-note class="bg-blue-700 shadow-2xl">
          <td colspan="5" class="py-2 px-4 text-xs text-blue-100">
            <!-- Below 34rem the table scrolls sideways: keep the note in view. -->
            <div class="sticky left-4 max-w-[calc(100vw-2rem)]">
              ${translateText("ffa_rating.off_board_note")}
            </div>
          </td>
        </tr>
      </tfoot>
    `;
  }

  // Which season the live FFA board is in. The API sends it, so a new season
  // needs no client release.
  private renderSeasonLabel() {
    if (this.ffaSeason === null) return nothing;
    const { number, startDate, endDate } = this.ffaSeason;
    // The API refuses these, so this only guards against a bad response.
    if (endDate && endDate < startDate) return nothing;
    const timing = endDate
      ? seasonTiming(startDate, endDate, new Date())
      : null;
    const end = endDate ? formatSeasonDate(endDate, true) : null;
    const start = formatSeasonDate(startDate);
    const lastDay = timing?.daysLeft === 0;

    const panel = lastDay
      ? "border-orange-400/70 shadow-[0_0_24px_rgba(251,146,60,0.25)]"
      : "border-aquarius/40 shadow-[0_0_24px_rgba(63,169,245,0.15)]";
    const statusColor = lastDay ? "text-orange-400" : "text-aquarius";
    const status = lastDay
      ? translateText("ffa_rating.season_last_day")
      : timing
        ? translateText("ffa_rating.season_days_left", {
            days: timing.daysLeft,
          })
        : translateText("ffa_rating.season_in_progress");

    return html`
      <div data-ffa-season class="shrink-0 px-2 py-2 sm:px-3 sm:pt-3">
        <section
          class="rounded-xl border bg-gradient-to-br from-deep-navy via-[#0b1830] to-[#132644] px-4 py-3 text-white sm:px-5 sm:py-4 ${panel}"
        >
          <div
            class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
          >
            <h2
              class="text-2xl font-black uppercase italic leading-none tracking-wide sm:text-4xl"
            >
              ${translateText("ffa_rating.season", { n: number })}
            </h2>
            <span
              class="text-base font-black uppercase tracking-wide tabular-nums sm:text-2xl ${statusColor}"
              >${status}</span
            >
          </div>
          ${
            end === null
              ? nothing
              : html`<span class="sr-only"
                  >${translateText("ffa_rating.season_dates", {
                    start,
                    end,
                  })}</span
                >`
          }
          <div
            class="mt-3 flex items-center gap-3 text-xs font-bold tabular-nums sm:mt-4 sm:text-sm [@media(max-height:500px)]:hidden"
          >
            ${
              timing === null || end === null
                ? html`<span class="shrink-0 text-white/80"
                      >${translateText("ffa_rating.season_started", {
                        date: start,
                      })}</span
                    >
                    <span
                      aria-hidden="true"
                      class="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-aquarius bg-white"
                    ></span>
                    <div
                      class="-ml-3 h-0 min-w-0 flex-1 border-t-2 border-dashed border-aquarius/50"
                    ></div>
                    <span class="shrink-0 text-white/70"
                      >${translateText("ffa_rating.season_no_end_date")}</span
                    >`
                : html`<span aria-hidden="true" class="shrink-0 text-white/80"
                      >${start}</span
                    >
                    <div
                      aria-hidden="true"
                      class="h-2 min-w-0 flex-1 rounded-full bg-white/10"
                    >
                      <div
                        data-ffa-season-progress
                        class="relative h-full rounded-full ${
                          lastDay
                            ? "bg-orange-400 shadow-[0_0_10px_rgba(251,146,60,0.7)]"
                            : "bg-aquarius shadow-[0_0_10px_rgba(63,169,245,0.6)]"
                        }"
                        style="width: ${Math.round(timing.progress * 100)}%"
                      >
                        <span
                          class="absolute -right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 bg-white ${
                            lastDay
                              ? "border-orange-400 motion-safe:animate-pulse"
                              : "border-aquarius"
                          }"
                        ></span>
                      </div>
                    </div>
                    ${
                      lastDay
                        ? html`<span class="shrink-0 text-orange-400"
                            >${translateText(
                              "ffa_rating.season_ends_midnight_utc",
                            )}</span
                          >`
                        : html`<span
                            aria-hidden="true"
                            class="shrink-0 text-white/80"
                            >${end}</span
                          >`
                    }`
            }
          </div>
        </section>
      </div>
    `;
  }

  // One emblem per rank, lowest on the left. Names don't fit on a phone, so
  // there the selected rank is named on its own line underneath.
  private renderRankTabs() {
    const emblem = (rank: FfaTierBase, sizeClass: string) => html`
      <img
        src=${assetUrl(`images/ffa-tiers/compact/${rank}.svg`)}
        alt=""
        class=${sizeClass}
      />
    `;
    const selected = this.ffaRank!;
    return html`
      <div class="shrink-0 px-2 sm:px-3 pb-2">
        <div
          role="tablist"
          aria-label=${translateText("ffa_rating.rank_tabs")}
          class="grid grid-cols-8 gap-0.5 sm:gap-1"
        >
          ${FFA_TIER_BASES.map((rank) => {
            const name = translateText(FFA_TIER_NAME_KEYS[rank]);
            const active = rank === selected && !this.ffaAllRanks;
            return html`
              <button
                type="button"
                role="tab"
                data-rank=${rank}
                aria-selected=${active ? "true" : "false"}
                tabindex=${active ? 0 : -1}
                aria-label=${name}
                title=${name}
                class="flex flex-col items-center justify-center gap-1 min-w-0 py-1.5 sm:py-2 rounded-lg border transition-colors ${
                  active
                    ? "border-blue-400 bg-blue-500/25 text-white"
                    : "border-white/10 bg-white/5 text-white/50 opacity-70 hover:opacity-100 hover:bg-white/10"
                }"
                @click=${() => this.selectFfaRank(rank)}
                @keydown=${(event: KeyboardEvent) =>
                  this.handleRankTabKey(event, rank)}
              >
                ${emblem(rank, "w-5 h-5 sm:w-7 sm:h-7")}
                <span
                  class="hidden sm:block w-full truncate text-center text-[10px] font-bold"
                  >${name}</span
                >
              </button>
            `;
          })}
          <button
            type="button"
            role="tab"
            data-rank="all"
            aria-selected=${this.ffaAllRanks ? "true" : "false"}
            tabindex="0"
            aria-label=${translateText("ffa_rating.all_ranks")}
            title=${translateText("ffa_rating.all_ranks")}
            class="col-span-8 justify-self-center mt-1 flex flex-col items-center justify-center gap-1 w-36 py-1.5 sm:py-2 rounded-lg border transition-colors ${
              this.ffaAllRanks
                ? "border-blue-400 bg-blue-500/25 text-white"
                : "border-white/10 bg-white/5 text-white/50 opacity-70 hover:opacity-100 hover:bg-white/10"
            }"
            @click=${() => this.selectAllFfaRanks()}
            @keydown=${(event: KeyboardEvent) =>
              this.handleRankTabKey(event, "all" as never)}
          >
            <span class="text-base sm:text-lg leading-none" aria-hidden="true"
              >🏆</span
            >
            <span class="w-full truncate text-center text-[10px] font-bold"
              >${translateText("ffa_rating.all_ranks")}</span
            >
          </button>
        </div>
        <div class="sm:hidden flex items-center gap-2 pt-2 px-1">
          ${this.ffaAllRanks ? nothing : emblem(selected, "w-5 h-5")}
          <span class="text-sm font-bold uppercase tracking-wider text-white"
            >${this.ffaAllRanks ? translateText("ffa_rating.all_ranks") : translateText(FFA_TIER_NAME_KEYS[selected])}</span
          >
          <span class="ml-auto text-xs text-white/50"
            >${translateText("ffa_rating.rank_top_250")}</span
          >
        </div>
      </div>
    `;
  }

  // The rating column. On a live FFA board a rated row shows its tier badge
  // and "rating ± uncertainty"; every other ladder (and an FFA board whose
  // rows carry no tier) shows the plain Elo number, exactly as before. On a
  // phone the badge sits above the number, so the column stays narrow enough
  // to show without scrolling sideways.
  private renderRatingCell(row: LadderRow, strong: boolean): TemplateResult {
    const weight = strong ? "font-bold" : "font-medium";
    if (!this.ffaRatingLive || row.tier === undefined) {
      return html`<span class="font-mono text-white ${weight}"
        >${this.ffaRatingLive ? formatRating(row.elo) : row.elo}</span
      >`;
    }
    return html`
      <div
        class="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:justify-end sm:gap-2"
        data-ffa-rating-cell
      >
        <ffa-tier-badge .tier=${row.tier}></ffa-tier-badge>
        <span class="whitespace-nowrap" data-ffa-rating-value>
          <span class="font-mono text-white ${weight}"
            >${formatRating(row.elo)}</span
          >
          ${
            row.uncertainty === undefined
              ? nothing
              : html`<span class="font-mono text-white/40"
                  >± ${formatRating(row.uncertainty)}</span
                >`
          }
        </span>
      </div>
    `;
  }

  private renderPlayerRow(player: LadderRow, badgeSlot: boolean) {
    const isCurrentUser =
      this.currentUserId !== null && this.currentUserId === player.playerId;
    const displayRank = player.rank;
    const globalPosition =
      isCurrentUser && !this.ffaAllRanks ? player.globalPosition : undefined;

    const rankColor =
      {
        1: "text-yellow-400 bg-yellow-400/10 ring-1 ring-yellow-400/20",
        2: "text-slate-300 bg-slate-400/10 ring-1 ring-slate-400/20",
        3: "text-amber-600 bg-amber-600/10 ring-1 ring-amber-600/20",
      }?.[displayRank] ?? "text-white/40 bg-white/5";

    const rankIcon =
      {
        1: "👑",
        2: "🥈",
        3: "🥉",
      }?.[displayRank] ?? String(displayRank);

    return html`
      <tr
        data-player-id=${player.playerId}
        data-current-user=${isCurrentUser ? "true" : "false"}
        class="border-b border-white/5 hover:bg-white/[0.07] transition-colors group ${
          isCurrentUser ? "bg-blue-500/15" : ""
        }"
      >
        <td class="py-3 px-4 text-center">
          <div
            class="w-10 h-10 mx-auto flex items-center justify-center rounded-lg font-bold font-mono text-lg ${rankColor}"
          >
            ${rankIcon}
          </div>
        </td>
        <td class="py-3 px-4">
          <div class="flex items-center gap-2 min-w-0">
            ${levelBadgeSlot(player, isPrestigedOrLegend(player), badgeSlot)}
            <player-name
              class="min-w-0 flex-1"
              .username=${player.accountUsername}
              .publicId=${player.playerId}
              .nameClass=${"font-bold text-blue-300 truncate text-base hover:underline"}
              .onNameClick=${() => this.openProfile(player.playerId)}
            ></player-name>
            ${
              globalPosition === undefined
                ? nothing
                : html`<span
                    data-global-ffa-position
                    class="shrink-0 inline-flex items-center gap-1 text-sm font-semibold tabular-nums text-white"
                    title="Global Position"
                    ><span class="text-base leading-none" aria-hidden="true"
                      >🌍</span
                    >
                    #${globalPosition}</span
                  >`
            }
          </div>
        </td>
        <td class="py-3 px-4 text-right">
          ${this.renderRatingCell(player, false)}
        </td>
        <td class="py-3 px-4 text-right">
          <span class="font-mono text-white font-medium">${player.games}</span>
        </td>
        <td class="py-3 px-4 text-right pr-6">
          <div class="inline-flex flex-col items-end">
            <span
              class="font-mono font-bold ${
                player.winRate >= 0.5 ? "text-green-400" : "text-red-400"
              }"
              >${(player.winRate * 100).toFixed(1)}%</span
            >
            <span
              class="text-[10px] uppercase text-white/30 font-bold tracking-wider"
              >${translateText("leaderboard_modal.ratio")}</span
            >
          </div>
        </td>
      </tr>
    `;
  }

  private renderPlayerFooter() {
    // Each FFA rank tracks its own load, so a slow one can't hold up the
    // other ladders, which share isLoadingMore.
    const loading = this.ffaAllRanks
      ? this.ffaAllLoading
      : this.ffaRankActive
        ? this.ffaRanksLoading.has(this.ffaRank!)
        : this.isLoadingMore;
    if (loading) {
      return html`
        <div class="flex items-center justify-center py-4 text-white/50">
          <div
            class="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mr-2"
          ></div>
          <span class="text-[10px] font-bold uppercase tracking-widest">
            ${translateText("common.loading")}
          </span>
        </div>
      `;
    }

    if (this.ffaAllFailed)
      return html`<div class="py-4 text-center">
        <button
          class="text-xs text-red-300"
          @click=${() => this.loadFfaAllPage()}
        >
          ${translateText("leaderboard_modal.try_again")}
        </button>
      </div>`;
    if (this.hasLoadMoreError) {
      return html`
        <div class="flex items-center justify-center py-4">
          <button
            class="px-6 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-xl text-xs font-bold uppercase transition-all active:scale-95"
            @click=${() => this.loadPlayerLeaderboard()}
          >
            ${translateText("leaderboard_modal.try_again")}
          </button>
        </div>
      `;
    }

    if (
      this.ffaRankActive &&
      this.playerData.length === 0 &&
      !this.playerHasMore
    ) {
      return html`
        <p class="py-12 text-center text-sm text-white/40">
          ${translateText("ffa_rating.rank_empty")}
        </p>
      `;
    }

    return "";
  }

  private renderLoading() {
    return html`
      <div
        class="flex flex-col items-center justify-center p-12 text-white h-full"
      >
        <div
          class="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-6"
        ></div>
        <p class="text-blue-200/80 text-sm font-bold tracking-widest uppercase">
          ${translateText("common.loading")}
        </p>
      </div>
    `;
  }

  private renderError() {
    return html`
      <div
        class="flex flex-col items-center justify-center p-12 text-white h-full"
      >
        <div
          class="bg-red-500/10 p-6 rounded-full mb-6 border border-red-500/20 shadow-lg shadow-red-500/10"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-12 w-12 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <p class="mb-8 text-center text-red-100/80 font-medium">
          ${this.error ?? translateText("leaderboard_modal.error")}
        </p>
        <button
          class="px-8 py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-xl text-sm font-bold uppercase transition-all active:scale-95"
          @click=${() => this.loadPlayerLeaderboard(true)}
        >
          ${translateText("leaderboard_modal.try_again")}
        </button>
      </div>
    `;
  }

  // An empty ladder is a normal state, not an error: a ranked type that has
  // just launched starts with no rows and fills as games are played.
  private renderNoData() {
    return html`
      <div
        class="flex flex-col items-center justify-center p-12 text-white/40 h-full"
      >
        <div class="bg-white/5 p-6 rounded-full mb-6 border border-white/5">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-16 w-16 text-white/20"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
        </div>
        <h3 class="text-xl font-bold text-white/60 mb-2">
          ${translateText("leaderboard_modal.no_data_yet")}
        </h3>
        <p class="text-white/30 text-sm">
          ${translateText("leaderboard_modal.ranked_no_stats")}
        </p>
      </div>
    `;
  }

  render() {
    if (this.isLoading && this.playerData.length === 0)
      return this.renderLoading();
    if (this.error) return this.renderError();
    // An empty FFA board still shows a calibrating or hidden player their
    // pinned row.
    const pinnedCalibration =
      this.rankedType === RankedType.FreeForAll &&
      (this.ffaCalibration !== null || this.ffaHidden !== null);
    if (
      this.hasLoadedPlayers &&
      this.playerData.length === 0 &&
      !pinnedCalibration &&
      !this.ffaRankActive
    )
      return this.renderNoData();

    // Level badges mark prestiged players and Legends only (see
    // isPrestigedOrLegend for why). Rows without one keep an empty slot so
    // names line up — but only once some loaded row in this ladder has a
    // badge, so the board is unchanged until then.
    const badgeSlot = this.playerData.some(isPrestigedOrLegend);
    const ratingLive = this.ffaRatingLive;

    return html`
      <div class="h-full">
        <!--
          No bottom border: the pinned "your ranking" row sits flush against
          this edge, and a dark hairline under a saturated blue row reads as a
          stray outline. The rows above it end on their own border-b.
        -->
        <div
          class="h-full border-x border-t border-white/5 bg-black/20 relative ${
            ratingLive ? "flex flex-col" : ""
          }"
        >
          ${ratingLive ? this.renderSeasonLabel() : nothing}
          ${ratingLive ? this.renderRankTabs() : nothing}
          <div
            class="scroll-container ${
              ratingLive ? "flex-1 min-h-0" : "h-full"
            } overflow-y-auto overflow-x-auto scrollbar-thin scrollbar-thumb-white/20"
            @scroll=${() => this.handleScroll()}
          >
            <table class="w-full text-sm border-collapse table-fixed">
              <colgroup>
                <col style="width: 4rem" />
                <col style="width: 16rem" />
                ${
                  ratingLive
                    ? html`<col class="w-32 sm:w-60" />`
                    : html`<col style="width: 6rem" />`
                }
                <col style="width: 6rem" />
                <col style="width: 6rem" />
              </colgroup>
              <thead class="sticky top-0 z-10">
                <tr
                  class="text-white/40 text-[10px] uppercase tracking-wider border-b border-white/5 bg-[#1e2433]"
                >
                  <th class="py-4 px-4 text-center font-bold">
                    ${translateText("leaderboard_modal.rank")}
                  </th>
                  <th class="py-4 px-4 text-left font-bold">
                    ${translateText("leaderboard_modal.player")}
                  </th>
                  <th class="py-4 px-4 text-right font-bold">
                    ${translateText(
                      ratingLive
                        ? "ffa_rating.rating"
                        : "leaderboard_modal.elo",
                    )}
                  </th>
                  <th class="py-4 px-4 text-right font-bold">
                    ${translateText("leaderboard_modal.games")}
                  </th>
                  <th class="py-4 px-4 text-right font-bold pr-6">
                    ${translateText("leaderboard_modal.win_loss_ratio")}
                  </th>
                </tr>
              </thead>
              <tbody>
                ${this.playerData.map((player) =>
                  this.renderPlayerRow(player, badgeSlot),
                )}
              </tbody>
              ${this.renderStickyUserRow(badgeSlot)}
            </table>
            ${this.renderPlayerFooter()}
          </div>
          ${
            ratingLive
              ? html`<ofstats-credit
                  class="block shrink-0 py-2 text-center"
                ></ofstats-credit>`
              : nothing
          }
        </div>
      </div>
    `;
  }
}
