import { LitElement, PropertyValues, TemplateResult, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  PlayerRecentStats,
  PlayerStatsGameMode,
  PlayerStatsGameModes,
  PlayerStatsLeaf,
  PlayerStatsTree,
} from "../../../../core/ApiSchemas";
import {
  Difficulty,
  GameMode,
  GameType,
  RankedType,
  isDifficulty,
} from "../../../../core/game/Game";
import { PlayerStats } from "../../../../core/StatsSchemas";
import { translateText } from "../../../Utils";
import "./PlayerStatsSummary";
import "./PlayerStatsTable";

const ALL_SELECTION = "all" as const;
type AllSelection = typeof ALL_SELECTION;
type AvailableType = GameType | "Ranked";
type TypeSelection = AvailableType | AllSelection;
type ModeSelection = PlayerStatsGameMode | AllSelection;
type DifficultySelection = Difficulty | AllSelection;
type RankedTypeSelection = RankedType | AllSelection;
const TYPE_ORDER: readonly AvailableType[] = [
  GameType.Public,
  GameType.Private,
  "Ranked",
  GameType.Singleplayer,
];

@customElement("player-stats-tree-view")
export class PlayerStatsTreeView extends LitElement {
  @property({ type: Object }) statsTree?: PlayerStatsTree;
  @state() selectedType: TypeSelection = ALL_SELECTION;
  @state() selectedMode: ModeSelection = ALL_SELECTION;
  @state() selectedDifficulty: DifficultySelection = ALL_SELECTION;
  @state() selectedRankedType: RankedTypeSelection = ALL_SELECTION;

  private get typeNode() {
    if (this.selectedType === ALL_SELECTION || this.selectedType === "Ranked") {
      return undefined;
    }
    return this.statsTree?.[this.selectedType];
  }

  private get availableTypes(): AvailableType[] {
    if (!this.statsTree) return [];
    return TYPE_ORDER.filter((type) =>
      type === "Ranked"
        ? Object.keys(this.statsTree?.Ranked ?? {}).length > 0
        : Object.keys(this.statsTree?.[type] ?? {}).length > 0,
    );
  }

  private get availableModes(): PlayerStatsGameMode[] {
    if (!this.typeNode) return [];
    return PlayerStatsGameModes.filter((mode) => this.typeNode?.[mode]);
  }

  private get availableRankedTypes(): RankedType[] {
    if (!this.statsTree?.Ranked) return [];
    return Object.keys(this.statsTree.Ranked).filter((k): k is RankedType =>
      Object.values(RankedType).includes(k as RankedType),
    );
  }

  private get availableDifficulties(): Difficulty[] {
    if (!this.typeNode || this.selectedType === GameType.Public) return [];
    const modes =
      this.selectedMode === ALL_SELECTION
        ? this.availableModes
        : [this.selectedMode];
    return Object.values(Difficulty).filter((difficulty) =>
      modes.some((mode) => this.typeNode?.[mode]?.[difficulty]),
    );
  }

  private labelForMode(m: PlayerStatsGameMode) {
    if (m === GameMode.FFA) return translateText("game_mode.ffa");
    if (m === GameMode.Team) return translateText("game_mode.teams");
    return translateText("game_mode.hvn");
  }

  private labelForType(t: TypeSelection) {
    if (t === ALL_SELECTION) {
      return translateText("player_stats_tree.all");
    }
    return t === "Ranked"
      ? translateText("player_stats_tree.ranked")
      : t === GameType.Public
        ? translateText("player_stats_tree.public")
        : t === GameType.Private
          ? translateText("player_stats_tree.private")
          : translateText("player_stats_tree.solo");
  }

  // A full-width filter row styled like the game-history tab: a pill container
  // wrapping tab-style buttons that grow to fill the row.
  private renderFilterRow(buttons: TemplateResult[]): TemplateResult {
    return html`
      <div
        role="tablist"
        class="flex flex-wrap gap-1 p-1 bg-white/5 border border-white/10 rounded-xl"
      >
        ${buttons}
      </div>
    `;
  }

  private renderFilterTab(
    label: string,
    isActive: boolean,
    onSelect: () => void,
    title?: string,
  ): TemplateResult {
    return html`
      <button
        type="button"
        role="tab"
        aria-selected=${isActive}
        title=${title ?? nothing}
        @click=${onSelect}
        class="grow basis-20 px-3 py-1.5 text-xs font-bold uppercase tracking-wider whitespace-nowrap rounded-lg transition-colors ${isActive
          ? "bg-malibu-blue/20 text-aquarius border border-malibu-blue/30"
          : "text-white/50 hover:text-white hover:bg-white/5 border border-transparent"}"
      >
        ${label}
      </button>
    `;
  }

  private labelForRankedType(r: RankedType) {
    switch (r) {
      case RankedType.OneVOne:
        return translateText("player_stats_tree.ranked_1v1");
      case RankedType.TwoVTwo:
        return translateText("player_stats_tree.ranked_2v2");
    }
  }

  createRenderRoot() {
    return this;
  }

  private getSelectedLeaf(): PlayerStatsLeaf | null {
    let leaf: PlayerStatsLeaf | null;
    if (this.selectedType === ALL_SELECTION) {
      leaf = this.mergeLeaves(
        this.availableTypes.flatMap((type) =>
          type === "Ranked"
            ? this.getRankedLeaves(ALL_SELECTION)
            : this.getGameTypeLeaves(type, ALL_SELECTION, ALL_SELECTION),
        ),
      );
    } else if (this.selectedType === "Ranked") {
      leaf = this.mergeLeaves(this.getRankedLeaves(this.selectedRankedType));
    } else {
      leaf = this.mergeLeaves(
        this.getGameTypeLeaves(
          this.selectedType,
          this.selectedMode,
          this.selectedType === GameType.Public
            ? ALL_SELECTION
            : this.selectedDifficulty,
        ),
      );
    }
    if (!leaf) return null;
    const recent = this.getSelectedRecentStats();
    return recent ? { ...leaf, recent } : leaf;
  }

  private getSelectedRecentStats(): PlayerRecentStats | undefined {
    const recent = this.statsTree?.recent;
    if (!recent) return undefined;
    if (this.selectedType === ALL_SELECTION) return recent.all;
    if (this.selectedType === "Ranked") {
      const rankedRecent = recent.Ranked;
      if (!rankedRecent) return undefined;
      return this.selectedRankedType === ALL_SELECTION
        ? rankedRecent.all
        : rankedRecent[this.selectedRankedType];
    }

    const typeRecent = recent[this.selectedType];
    if (!typeRecent) return undefined;
    if (this.selectedMode === ALL_SELECTION) {
      return this.selectedType === GameType.Public ||
        this.selectedDifficulty === ALL_SELECTION
        ? typeRecent.all
        : typeRecent[this.selectedDifficulty];
    }

    const modeRecent = typeRecent[this.selectedMode];
    if (!modeRecent) return undefined;
    return this.selectedType === GameType.Public ||
      this.selectedDifficulty === ALL_SELECTION
      ? modeRecent.all
      : modeRecent[this.selectedDifficulty];
  }

  private getGameTypeLeaves(
    type: GameType,
    modeSelection: ModeSelection,
    difficultySelection: DifficultySelection,
  ): PlayerStatsLeaf[] {
    const typeNode = this.statsTree?.[type];
    if (!typeNode) return [];
    const modes =
      modeSelection === ALL_SELECTION
        ? PlayerStatsGameModes.filter((mode) => typeNode[mode])
        : [modeSelection];

    return modes.flatMap((mode) => {
      const modeNode = typeNode[mode];
      if (!modeNode) return [];
      const difficulties =
        difficultySelection === ALL_SELECTION
          ? Object.keys(modeNode).filter(isDifficulty)
          : [difficultySelection];
      return difficulties.flatMap((difficulty) => {
        const leaf = modeNode[difficulty];
        return leaf ? [leaf] : [];
      });
    });
  }

  private getRankedLeaves(
    rankedTypeSelection: RankedTypeSelection,
  ): PlayerStatsLeaf[] {
    const rankedNode = this.statsTree?.Ranked;
    if (!rankedNode) return [];
    const rankedTypes =
      rankedTypeSelection === ALL_SELECTION
        ? this.availableRankedTypes
        : [rankedTypeSelection];
    return rankedTypes.flatMap((rankedType) => {
      const leaf = rankedNode[rankedType];
      return leaf ? [leaf] : [];
    });
  }

  private mergeLeaves(leaves: PlayerStatsLeaf[]): PlayerStatsLeaf | null {
    return leaves.reduce<PlayerStatsLeaf | null>((merged, leaf) => {
      if (!merged) {
        return {
          wins: leaf.wins,
          losses: leaf.losses,
          total: leaf.total,
          stats: this.cloneStats(leaf.stats),
          recentGames: this.mergeRecentGames(undefined, leaf.recentGames),
        };
      }
      return {
        wins: merged.wins + leaf.wins,
        losses: merged.losses + leaf.losses,
        total: merged.total + leaf.total,
        stats: this.mergeStats(merged.stats, leaf.stats),
        recentGames: this.mergeRecentGames(
          merged.recentGames,
          leaf.recentGames,
        ),
      };
    }, null);
  }

  private mergeRecentGames(
    base: PlayerStatsLeaf["recentGames"],
    next: PlayerStatsLeaf["recentGames"],
  ): PlayerStatsLeaf["recentGames"] {
    if (!base && !next) return undefined;
    const byGameId = new Map<
      bigint,
      NonNullable<PlayerStatsLeaf["recentGames"]>[number]
    >();
    for (const game of [...(base ?? []), ...(next ?? [])]) {
      byGameId.set(game.gameId, game);
    }
    return [...byGameId.values()]
      .sort((left, right) =>
        left.gameId === right.gameId ? 0 : left.gameId > right.gameId ? -1 : 1,
      )
      .slice(0, 100);
  }

  private syncSelection(): void {
    const types = this.availableTypes;
    if (
      this.selectedType !== ALL_SELECTION &&
      !types.includes(this.selectedType)
    ) {
      this.selectedType = ALL_SELECTION;
    }
    if (this.selectedType === ALL_SELECTION) {
      return;
    }
    if (this.selectedType === "Ranked") {
      const rankedTypes = this.availableRankedTypes;
      if (
        this.selectedRankedType !== ALL_SELECTION &&
        !rankedTypes.includes(this.selectedRankedType)
      ) {
        this.selectedRankedType = ALL_SELECTION;
      }
      return;
    }
    const modes = this.availableModes;
    if (
      this.selectedMode !== ALL_SELECTION &&
      !modes.includes(this.selectedMode)
    ) {
      this.selectedMode = ALL_SELECTION;
    }
    const diffs = this.availableDifficulties;
    if (
      this.selectedDifficulty !== ALL_SELECTION &&
      !diffs.includes(this.selectedDifficulty)
    ) {
      this.selectedDifficulty = ALL_SELECTION;
    }
  }

  protected willUpdate(changedProperties: PropertyValues) {
    if (changedProperties.has("statsTree")) {
      this.selectedType = ALL_SELECTION;
      this.selectedMode = ALL_SELECTION;
      this.selectedDifficulty = ALL_SELECTION;
      this.selectedRankedType = ALL_SELECTION;
    }
    if (
      changedProperties.has("statsTree") ||
      changedProperties.has("selectedType") ||
      changedProperties.has("selectedMode") ||
      changedProperties.has("selectedDifficulty") ||
      changedProperties.has("selectedRankedType")
    ) {
      this.syncSelection();
    }
  }

  private setGameType(t: TypeSelection) {
    if (this.selectedType === t) return;
    this.selectedType = t;
    this.requestUpdate();
  }

  private setMode(m: ModeSelection) {
    if (this.selectedMode === m) return;
    this.selectedMode = m;
    this.requestUpdate();
  }

  private setRankedType(r: RankedTypeSelection) {
    if (this.selectedRankedType === r) return;
    this.selectedRankedType = r;
    this.requestUpdate();
  }

  private setDifficulty(d: DifficultySelection) {
    if (this.selectedDifficulty === d) return;
    this.selectedDifficulty = d;
    this.requestUpdate();
  }

  private mergeStats(
    base: PlayerStats | undefined,
    next: PlayerStats | undefined,
  ): PlayerStats | undefined {
    if (!base && !next) return undefined;
    if (!base) return this.cloneStats(next);
    if (!next) return this.cloneStats(base);

    return {
      attacks: this.mergeStatArrays(base.attacks, next.attacks),
      betrayals: this.mergeStatValue(base.betrayals, next.betrayals),
      killedAt: this.mergeStatValue(base.killedAt, next.killedAt),
      conquests: this.mergeStatArrays(base.conquests, next.conquests),
      boats: this.mergeStatRecord(base.boats, next.boats),
      bombs: this.mergeStatRecord(base.bombs, next.bombs),
      gold: this.mergeStatArrays(base.gold, next.gold),
      units: this.mergeStatRecord(base.units, next.units),
    };
  }

  private mergeStatValue(
    base: bigint | undefined,
    next: bigint | undefined,
  ): bigint | undefined {
    if (base === undefined && next === undefined) return undefined;
    return (base ?? 0n) + (next ?? 0n);
  }

  private mergeStatArrays(
    base: bigint[] | undefined,
    next: bigint[] | undefined,
  ): bigint[] | undefined {
    if (!base && !next) return undefined;
    const maxLen = Math.max(base?.length ?? 0, next?.length ?? 0);
    const merged: bigint[] = [];
    for (let i = 0; i < maxLen; i += 1) {
      merged[i] = (base?.[i] ?? 0n) + (next?.[i] ?? 0n);
    }
    return merged;
  }

  private mergeStatRecord<T extends string>(
    base: Partial<Record<T, bigint[]>> | undefined,
    next: Partial<Record<T, bigint[]>> | undefined,
  ): Partial<Record<T, bigint[]>> | undefined {
    if (!base && !next) return undefined;
    const merged: Partial<Record<T, bigint[]>> = {};
    const keys = new Set([
      ...Object.keys(base ?? {}),
      ...Object.keys(next ?? {}),
    ]) as Set<T>;
    keys.forEach((key) => {
      const mergedArray = this.mergeStatArrays(base?.[key], next?.[key]);
      if (mergedArray) {
        merged[key] = mergedArray;
      }
    });
    return Object.keys(merged).length ? merged : undefined;
  }

  private cloneStats(stats: PlayerStats | undefined): PlayerStats | undefined {
    if (!stats) return undefined;
    return {
      attacks: stats.attacks ? [...stats.attacks] : undefined,
      betrayals: stats.betrayals,
      killedAt: stats.killedAt,
      conquests: stats.conquests ? [...stats.conquests] : undefined,
      boats: stats.boats ? { ...stats.boats } : undefined,
      bombs: stats.bombs ? { ...stats.bombs } : undefined,
      gold: stats.gold ? [...stats.gold] : undefined,
      units: stats.units ? { ...stats.units } : undefined,
    };
  }

  render() {
    const types = this.availableTypes;
    const modes = this.availableModes;
    const diffs = this.availableDifficulties;
    const rankedTypes = this.availableRankedTypes;
    const leaf = this.getSelectedLeaf();

    return html`
      <div class="flex flex-col gap-4">
        <!-- Filters: a type row, then a context-dependent second row (ranked
             type / mode / difficulty), styled like the game-history tab. -->
        <div class="space-y-2">
          ${this.renderFilterRow([
            this.renderFilterTab(
              this.labelForType(ALL_SELECTION),
              this.selectedType === ALL_SELECTION,
              () => this.setGameType(ALL_SELECTION),
            ),
            ...types.map((t) =>
              this.renderFilterTab(
                this.labelForType(t),
                this.selectedType === t,
                () => this.setGameType(t),
              ),
            ),
          ])}
          ${this.selectedType === "Ranked" && rankedTypes.length
            ? this.renderFilterRow([
                this.renderFilterTab(
                  this.labelForType(ALL_SELECTION),
                  this.selectedRankedType === ALL_SELECTION,
                  () => this.setRankedType(ALL_SELECTION),
                ),
                ...rankedTypes.map((r) =>
                  this.renderFilterTab(
                    this.labelForRankedType(r) ?? "",
                    this.selectedRankedType === r,
                    () => this.setRankedType(r),
                  ),
                ),
              ])
            : nothing}
          ${modes.length
            ? this.renderFilterRow([
                this.renderFilterTab(
                  this.labelForType(ALL_SELECTION),
                  this.selectedMode === ALL_SELECTION,
                  () => this.setMode(ALL_SELECTION),
                  translateText("player_stats_tree.mode"),
                ),
                ...modes.map((m) =>
                  this.renderFilterTab(
                    this.labelForMode(m),
                    this.selectedMode === m,
                    () => this.setMode(m),
                    translateText("player_stats_tree.mode"),
                  ),
                ),
              ])
            : nothing}
          ${diffs.length
            ? this.renderFilterRow([
                this.renderFilterTab(
                  this.labelForType(ALL_SELECTION),
                  this.selectedDifficulty === ALL_SELECTION,
                  () => this.setDifficulty(ALL_SELECTION),
                  translateText("difficulty.difficulty"),
                ),
                ...diffs.map((d) =>
                  this.renderFilterTab(
                    translateText(`difficulty.${d.toLowerCase()}`),
                    this.selectedDifficulty === d,
                    () => this.setDifficulty(d),
                    translateText("difficulty.difficulty"),
                  ),
                ),
              ])
            : nothing}
        </div>

        ${leaf
          ? html`
              <div class="border-t border-white/10">
                <div class="py-3">
                  <player-stats-summary .leaf=${leaf}></player-stats-summary>
                </div>

                <div class="border-t border-white/10 pt-6">
                  <player-stats-table
                    .stats=${leaf?.stats ?? null}
                  ></player-stats-table>
                </div>
              </div>
            `
          : html`
              <div
                class="py-12 text-center text-white/30 italic border border-white/5 rounded-xl bg-white/5"
              >
                ${translateText("player_stats_tree.no_stats")}
              </div>
            `}
      </div>
    `;
  }
}
